package app.talysman.android.engine

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Typed views of the engine's JSON (the shapes are defined by native/engine and generated for
 * TypeScript into packages/shared/src/generated). Only the fields the Android UI reads are
 * declared; unknown keys are ignored, and anything the app writes back (profile configs) is kept
 * as raw JSON so no field is ever dropped on a round trip.
 */
val EngineJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

@Serializable
data class Latch(val state: String) {
    val on get() = state == "on"
}

@Serializable
data class Profile(
    val id: String,
    val name: String,
    val color: String,
    val createdAtMs: Long = 0,
    /** Raw `ProfileConfig`; edit it with [ConfigEdits]. */
    val config: JsonObject,
    val latch: Latch = Latch("off"),
)

@Serializable
data class WindowOccurrence(
    val profileId: String,
    val windowId: String,
    val startMs: Long,
    val endMs: Long,
    val locked: Boolean,
)

@Serializable
data class Activation(
    val profileId: String,
    val active: Boolean,
    val latched: Boolean,
    val windows: List<WindowOccurrence> = emptyList(),
    val lockedUntilMs: Long? = null,
    val paused: Boolean = false,
)

@Serializable
data class ProfileStatus(val profile: Profile, val activation: Activation, val committed: Boolean)

@Serializable
data class Friction(val kind: String, val secs: Int = 0)

@Serializable
data class PoolStatus(
    val profileId: String,
    val poolId: String,
    val name: String,
    val unlocksPerDay: Int,
    val usedToday: Int,
    val leftToday: Int,
    val unlockMinutes: Int,
    val friction: Friction,
    val activeUntilMs: Long? = null,
)

@Serializable
data class PoolRef(val profileId: String, val poolId: String)

@Serializable
data class PendingPoolUnlock(val pools: List<PoolRef>, val requestedMs: Long, val readyMs: Long)

@Serializable
data class Streak(val currentDays: Int = 0, val bestDays: Int = 0, val lastBreakLocalDate: String? = null)

@Serializable
data class TimedOff(val sinceMs: Long, val untilMs: Long)

@Serializable
data class Overrides(
    val allOff: JsonElement? = null,
    val exempt: JsonElement? = null,
    val timed: TimedOff? = null,
)

@Serializable
data class UpcomingEvent(val atMs: Long, val profileId: String, val kind: String)

@Serializable
data class EngineSnapshot(
    val nowMs: Long = 0,
    val generation: Long = 0,
    val profiles: List<ProfileStatus> = emptyList(),
    val defaultProfileId: String? = null,
    val anyActive: Boolean = false,
    val overrides: Overrides = Overrides(),
    val overridden: Boolean = false,
    val pools: List<PoolStatus> = emptyList(),
    val pendingUnlocks: List<PendingPoolUnlock> = emptyList(),
    val streak: Streak = Streak(),
    val emergencyLeft: Int = 5,
    val nextEvents: List<UpcomingEvent> = emptyList(),
)

/** `Verdict`: allow | soft | pageBlocked | hard. */
@Serializable
data class Verdict(
    val kind: String,
    val site: String? = null,
    val feature: String? = null,
    val features: Map<String, String> = emptyMap(),
) {
    val blocking get() = kind == "hard" || kind == "pageBlocked"
}

@Serializable
data class Decision(
    val verdict: Verdict,
    val item: JsonElement? = null,
    val blockingProfiles: List<String> = emptyList(),
)

@Serializable
data class ProfileSummary(val id: String, val name: String, val color: String, val lockedUntilMs: Long? = null)

@Serializable
data class PopupInfo(
    val item: JsonElement? = null,
    val label: String,
    val verdict: Verdict,
    val blockingProfiles: List<ProfileSummary> = emptyList(),
    val pools: List<PoolStatus> = emptyList(),
    val unpooledProfiles: List<String> = emptyList(),
    val unlockAvailable: Boolean = false,
    val friction: Friction = Friction("none"),
    val pending: PendingPoolUnlock? = null,
    val streak: Streak = Streak(),
    val emergencyLeft: Int = 5,
    val lockedUntilMs: Long? = null,
)

@Serializable
data class LockedProfile(val profileId: String, val untilMs: Long)

/** `Gate`: free | needsKey | locked | denied. */
@Serializable
data class Gate(
    val kind: String,
    val relaxations: List<String> = emptyList(),
    val lockedProfiles: List<LockedProfile> = emptyList(),
    val untilMs: Long? = null,
    val profiles: List<String> = emptyList(),
    val code: String? = null,
    val message: String? = null,
)

@Serializable
data class Layer(val profileId: String)

@Serializable
data class EffectivePolicy(val generation: Long = 0, val suspendedUntilMs: Long? = null, val layers: List<Layer> = emptyList())

@Serializable
data class Tick(val effective: EffectivePolicy, val nextWakeMs: Long, val events: List<JsonObject> = emptyList())

@Serializable
data class Applied(val tick: Tick)

/** A refusal from the engine (`EngineError`). */
class EngineRefusal(val code: String, message: String) : Exception(message)

/** Error codes, mirrored from packages/shared/src/constants.ts. */
object Codes {
    const val KEY_REQUIRED = "KEY_REQUIRED"
    const val LOCKED = "LOCKED"
    const val NO_PAIRED_KEY = "NO_PAIRED_KEY"
    const val POOL_EXHAUSTED = "POOL_EXHAUSTED"
    const val FRICTION_PENDING = "FRICTION_PENDING"
    const val NO_EMERGENCY_LEFT = "NO_EMERGENCY_LEFT"
}

@Serializable
data class SiteFeature(val id: String, val label: String, @SerialName("default") val defaultAction: String)
