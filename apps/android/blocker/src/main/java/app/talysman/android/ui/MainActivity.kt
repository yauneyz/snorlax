package app.talysman.android.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.talysman.android.TalysmanApp
import app.talysman.android.engine.Codes
import app.talysman.android.engine.EngineRefusal
import app.talysman.android.engine.EngineSnapshot
import app.talysman.android.keys.KeyActivity
import app.talysman.android.service.AppSettings
import app.talysman.android.ui.theme.TalysmanPalette
import app.talysman.android.ui.theme.TalysmanTheme
import kotlinx.serialization.json.JsonObject

/** The app's screens: status, profiles (and their editor), keys, settings. */
class MainActivity : ComponentActivity() {
    private var openOverrides = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        openOverrides.value = intent.getBooleanExtra(EXTRA_OPEN_OVERRIDES, false)
        val app = application as TalysmanApp
        setContent {
            TalysmanTheme {
                val snapshot by app.engine.snapshot.collectAsStateWithLifecycle()
                val runner = rememberKeyRunner(app)
                CompositionLocalProvider(LocalKeyRunner provides runner) {
                    var onboarded by remember { mutableStateOf(AppSettings(app).onboarded) }
                    if (!onboarded) {
                        OnboardingScreen(onDone = {
                            AppSettings(app).onboarded = true
                            onboarded = true
                        })
                    } else {
                        Main(app, snapshot, openOverrides.value) { openOverrides.value = it }
                    }
                    runner.message?.let { message ->
                        AlertDialog(
                            onDismissRequest = { runner.message = null },
                            confirmButton = { TextButton(onClick = { runner.message = null }) { Text("OK") } },
                            text = { Text(message) },
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_OPEN_OVERRIDES, false)) openOverrides.value = true
    }

    override fun onResume() {
        super.onResume()
        (application as TalysmanApp).engine.tick()
    }

    companion object {
        const val EXTRA_OPEN_OVERRIDES = "openOverrides"
    }
}

private enum class Tab(val label: String) { Home("Home"), Profiles("Profiles"), Keys("Keys"), Settings("Settings") }

@Composable
private fun Main(app: TalysmanApp, snapshot: EngineSnapshot, overridesOpen: Boolean, setOverridesOpen: (Boolean) -> Unit) {
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    Scaffold(
        containerColor = TalysmanPalette.Background,
        bottomBar = {
            NavigationBar(containerColor = TalysmanPalette.Panel) {
                Tab.entries.forEach { entry ->
                    NavigationBarItem(
                        selected = tab == entry && editing == null,
                        onClick = {
                            tab = entry
                            editing = null
                        },
                        icon = {},
                        label = { Text(entry.label) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val profileId = editing
            when {
                profileId != null -> ProfileEditor(app, snapshot, profileId, onBack = { editing = null })
                tab == Tab.Home -> HomeScreen(app, snapshot, onOverrides = { setOverridesOpen(true) })
                tab == Tab.Profiles -> ProfilesScreen(app, snapshot, onEdit = { editing = it })
                tab == Tab.Keys -> KeysScreen(app, snapshot)
                tab == Tab.Settings -> SettingsScreen(app)
            }
        }
    }
    if (overridesOpen) OverrideSheet(app, snapshot, onClose = { setOverridesOpen(false) })
}

/**
 * Runs engine commands with the key flow (spec §6.5): ask the engine's gate; when it needs the
 * key, launch [KeyActivity] to verify an NFC tag or QR code, then apply with that key's id.
 * Refusals surface as a dialog.
 */
class KeyRunner(private val app: TalysmanApp, private val launch: () -> Unit) {
    var message: String? by mutableStateOf(null)
    private var pending: Pair<JsonObject, () -> Unit>? = null

    fun run(command: JsonObject, onDone: () -> Unit = {}) {
        val gate = try {
            app.engine.gate(command)
        } catch (e: EngineRefusal) {
            message = e.message
            return
        }
        when (gate.kind) {
            "free" -> apply(command, null, onDone)
            "needsKey" -> {
                pending = command to onDone
                launch()
            }
            "locked" -> message = "A locked schedule holds this. Only an emergency unlock gets past it."
            else -> message = gate.message ?: "Not allowed."
        }
    }

    /** Result of the key activity. */
    fun keyVerified(keyId: String?) {
        val (command, onDone) = pending ?: return
        pending = null
        if (keyId != null) apply(command, keyId, onDone)
    }

    private fun apply(command: JsonObject, keyId: String?, onDone: () -> Unit) {
        try {
            app.engine.apply(command, keyId)
            onDone()
        } catch (e: EngineRefusal) {
            message = when (e.code) {
                Codes.NO_PAIRED_KEY -> "Pair a key first (Keys tab)."
                else -> e.message
            }
        }
    }
}

val LocalKeyRunner = staticCompositionLocalOf<KeyRunner> { error("no key runner") }

@Composable
private fun rememberKeyRunner(app: TalysmanApp): KeyRunner {
    val context = LocalContext.current
    var runner: KeyRunner? = null
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        runner?.keyVerified(if (result.resultCode == Activity.RESULT_OK) result.data?.getStringExtra(KeyActivity.RESULT_KEY_ID) else null)
    }
    return remember {
        KeyRunner(app) { launcher.launch(KeyActivity.intent(context, KeyActivity.MODE_VERIFY)) }.also { runner = it }
    }.also { runner = it }
}
