package app.talysman.android.engine

import android.content.Context
import android.os.SystemClock
import android.util.Log
import app.talysman.android.service.WakeScheduler
import java.io.File
import java.util.TimeZone
import java.util.concurrent.CopyOnWriteArraySet
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import uniffi.talysman_engine_ffi.EngineFfiException
import uniffi.talysman_engine_ffi.EngineHandle

/**
 * Owns the one Rust engine instance (spec §6.2): persistence (atomic writes with a `.bak`), the
 * clock the engine sees, the snapshot the UI renders, and the alarm for the next time-driven
 * change. Every command goes through here; the accessibility service asks it for decisions.
 *
 * Calls are synchronized — the engine is cheap, and a single lock keeps "apply, persist, publish"
 * atomic across the UI, the accessibility service, and alarms.
 */
class EngineHost(private val context: Context) {
    private val file = File(context.filesDir, "engine-state.json")
    private val backup = File(context.filesDir, "engine-state.json.bak")
    private val clock = TrustedClock(context)

    /** Whether any NFC/QR key is paired (set by the key repository). */
    @Volatile var hasPairedKeys: () -> Boolean = { false }

    /** The plan's profile allowance (`null` = unlimited). */
    @Volatile var maxProfiles: Int? = null

    // Declared after everything `ctxJson()` reads: `load()` runs during construction.
    private val engine: EngineHandle = load()
    private val _snapshot = MutableStateFlow(EngineSnapshot())
    private val listeners = CopyOnWriteArraySet<() -> Unit>()

    val snapshot: StateFlow<EngineSnapshot> = _snapshot.asStateFlow()

    /** Called after anything that can change what's enforced (the accessibility service re-checks). */
    fun addListener(listener: () -> Unit) = listeners.add(listener)
    fun removeListener(listener: () -> Unit) = listeners.remove(listener)

    private fun load(): EngineHandle {
        for (candidate in listOf(file, backup)) {
            if (!candidate.exists()) continue
            try {
                return EngineHandle.load(candidate.readText())
            } catch (e: EngineFfiException) {
                Log.e(TAG, "engine state ${candidate.name} failed to load", e)
            }
        }
        // First run: one empty "Default" profile, used by "Turn on".
        val fresh = EngineHandle.empty(java.util.UUID.randomUUID().toString())
        val ctx = ctxJson()
        fresh.apply(Commands.upsertProfile(DEFAULT_PROFILE_ID, "Default", DEFAULT_COLOR, ConfigEdits.empty()).toString(), AUTH_NONE, ctx)
        fresh.apply(Commands.setDefaultProfile(DEFAULT_PROFILE_ID).toString(), AUTH_NONE, ctx)
        return fresh
    }

    fun ctxJson(): String = buildJsonObject {
        val now = clock.now()
        put("now", buildJsonObject {
            put("epochMs", now)
            put("utcOffsetS", TimeZone.getDefault().getOffset(now) / 1000)
        })
        put("hasPairedKeys", hasPairedKeys())
        put("limits", buildJsonObject { maxProfiles?.let { put("maxProfiles", it) } })
    }.toString()

    private fun <T> call(block: () -> T): T = try {
        block()
    } catch (e: EngineFfiException.Refused) {
        throw EngineRefusal(e.code, e.detail)
    }

    @Synchronized
    fun gate(command: JsonObject): Gate = call { EngineJson.decodeFromString(engine.gate(command.toString(), ctxJson())) }

    /**
     * Apply a command. Pass `keyId` only right after [app.talysman.android.keys.KeyVerifyActivity]
     * verified a paired key in this process. Throws [EngineRefusal] (KEY_REQUIRED, LOCKED, …).
     */
    @Synchronized
    fun apply(command: JsonObject, keyId: String? = null) {
        val auth = if (keyId == null) AUTH_NONE else buildJsonObject {
            put("kind", "keyVerified")
            put("keyId", keyId)
        }.toString()
        val applied: Applied = call { EngineJson.decodeFromString(engine.apply(command.toString(), auth, ctxJson())) }
        afterChange(applied.tick)
    }

    /** Advance time: schedule edges, pool expiry, timed overrides. */
    @Synchronized
    fun tick() {
        val tick: Tick = call { EngineJson.decodeFromString(engine.tick(ctxJson())) }
        afterChange(tick)
    }

    fun decideApp(packageName: String, label: String): Decision = synchronized(this) {
        call { EngineJson.decodeFromString(engine.decideApp(Items.appRef(packageName, label).toString(), ctxJson())) }
    }

    fun decideUrl(url: String, extensionCapable: Boolean): Decision = synchronized(this) {
        call { EngineJson.decodeFromString(engine.decideUrl(url, extensionCapable, ctxJson())) }
    }

    fun popupInfoForApp(packageName: String, label: String): PopupInfo = popupInfo(buildJsonObject {
        put("kind", "app")
        put("app", Items.appRef(packageName, label))
    })

    fun popupInfoForUrl(url: String): PopupInfo = popupInfo(buildJsonObject {
        put("kind", "url")
        put("url", url)
    })

    private fun popupInfo(target: JsonObject): PopupInfo = synchronized(this) {
        call { EngineJson.decodeFromString(engine.popupInfo(target.toString(), ctxJson())) }
    }

    /** The Firefox extension's `state` frame for its `hello`. */
    fun extensionStateFrame(helloJson: String): String = synchronized(this) {
        call { engine.extensionStateFrame(ctxJson(), helloJson) }
    }

    fun sinkholeDomains(): List<String> = synchronized(this) { call { engine.sinkholeDomains(ctxJson()) } }

    fun anyActive(): Boolean = _snapshot.value.anyActive

    @Synchronized
    fun refreshSnapshot() {
        _snapshot.value = call { EngineJson.decodeFromString(engine.snapshot(ctxJson())) }
    }

    private fun afterChange(tick: Tick) {
        persist()
        refreshSnapshot()
        WakeScheduler.schedule(context, tick.nextWakeMs)
        clock.record()
        listeners.forEach { runCatching(it) }
    }

    private fun persist() {
        val json = engine.exportState()
        val tmp = File(context.filesDir, "engine-state.json.tmp")
        tmp.writeText(json)
        if (file.exists()) file.renameTo(backup)
        if (!tmp.renameTo(file)) Log.e(TAG, "could not move engine state into place")
    }

    companion object {
        private const val TAG = "EngineHost"
        const val DEFAULT_PROFILE_ID = "profile-default"
        const val DEFAULT_COLOR = "#4fd1c5"
        private const val AUTH_NONE = """{"kind":"none"}"""
    }
}

/**
 * The wall clock, guarded against being set back (spec §4.6): with a pool unlock or timed
 * override running, setting the clock back would stretch it. We keep (wall, elapsed-realtime)
 * pairs; if the wall clock moves backwards by more than two minutes relative to elapsed time
 * since the last check (and the device hasn't rebooted), we use the elapsed-time estimate.
 */
class TrustedClock(context: Context) {
    private val prefs = context.getSharedPreferences("trusted-clock", Context.MODE_PRIVATE)

    fun now(): Long {
        val wall = System.currentTimeMillis()
        val elapsed = SystemClock.elapsedRealtime()
        val lastWall = prefs.getLong("wall", 0)
        val lastElapsed = prefs.getLong("elapsed", -1)
        if (lastWall == 0L || lastElapsed < 0 || elapsed < lastElapsed) return wall
        val expected = lastWall + (elapsed - lastElapsed)
        return if (wall < expected - SKEW_MS) expected else wall
    }

    fun record() {
        prefs.edit().putLong("wall", now()).putLong("elapsed", SystemClock.elapsedRealtime()).apply()
    }

    private companion object {
        const val SKEW_MS = 2 * 60_000L
    }
}
