package app.talysman.android

import app.talysman.android.engine.Applied
import app.talysman.android.engine.Commands
import app.talysman.android.engine.ConfigEdits
import app.talysman.android.engine.Decision
import app.talysman.android.engine.EngineJson
import app.talysman.android.engine.EngineSnapshot
import app.talysman.android.engine.Gate
import app.talysman.android.engine.Items
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import uniffi.talysman_engine_ffi.EngineFfiException
import uniffi.talysman_engine_ffi.EngineHandle

/**
 * The Kotlin side of the engine contract, run on the JVM against a host build of
 * native/engine-ffi (`cargo build` in native/engine-ffi). Skipped when that library isn't built.
 */
class EngineJvmTest {
    private val hostLib = File("../../../native/engine-ffi/target/debug/libtalysman_engine_ffi.so")

    private fun engine(): EngineHandle {
        assumeTrue("host engine-ffi not built", hostLib.exists())
        System.setProperty("jna.library.path", hostLib.parentFile.absolutePath)
        return EngineHandle.empty("jvm-test")
    }

    private val ctx = """{"now":{"epochMs":1790000000000,"utcOffsetS":0},"hasPairedKeys":true}"""
    private val none = """{"kind":"none"}"""

    @Test
    fun configEditsRoundTripAndBlockAnApp() {
        val engine = engine()
        val config = ConfigEdits.setBlockedApps(ConfigEdits.empty(), listOf("com.instagram.android" to "Instagram"))
        assertEquals(listOf("com.instagram.android"), ConfigEdits.blockedPackages(config))
        engine.apply(Commands.upsertProfile("p", "P", "#000000", config).toString(), none, ctx)
        engine.apply(Commands.setLatch("p", true).toString(), none, ctx)
        val decision = EngineJson.decodeFromString<Decision>(engine.decideApp(Items.appRef("com.instagram.android", "Instagram").toString(), ctx))
        assertEquals("hard", decision.verdict.kind)
        val snapshot = EngineJson.decodeFromString<EngineSnapshot>(engine.snapshot(ctx))
        assertTrue(snapshot.anyActive)
        assertEquals(5, snapshot.emergencyLeft)
    }

    @Test
    fun keyGatedCommandsReportTheirGateAndRefuseWithoutAKey() {
        val engine = engine()
        engine.apply(Commands.upsertProfile("p", "P", "#000000", ConfigEdits.empty()).toString(), none, ctx)
        engine.apply(Commands.setLatch("p", true).toString(), none, ctx)
        val gate = EngineJson.decodeFromString<Gate>(engine.gate(Commands.startOverrideAll().toString(), ctx))
        assertEquals("needsKey", gate.kind)
        val refused = runCatching { engine.apply(Commands.startOverrideAll().toString(), none, ctx) }.exceptionOrNull()
        assertTrue(refused is EngineFfiException.Refused && refused.code == "KEY_REQUIRED")
        val applied = EngineJson.decodeFromString<Applied>(engine.apply(Commands.emergencyUnlock().toString(), none, ctx))
        assertTrue(applied.tick.effective.layers.isEmpty())
    }
}
