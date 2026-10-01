package app.talysman.android.ui

import android.Manifest
import android.app.AlarmManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.talysman.android.engine.Commands
import app.talysman.android.engine.EngineRefusal
import androidx.lifecycle.compose.LifecycleResumeEffect
import app.talysman.android.BuildConfig
import app.talysman.android.TalysmanApp
import app.talysman.android.a11y.TalysmanAccessibilityService
import app.talysman.android.admin.TalysmanDeviceAdmin
import app.talysman.android.bridge.BridgeServer
import app.talysman.android.service.AppSettings
import app.talysman.android.ui.theme.Kicker
import app.talysman.android.ui.theme.Panel
import app.talysman.android.ui.theme.TalysmanPalette

/** Permission status, unsupported-browser blocking, Firefox pairing, emergency unlock, plan (spec §6.6). */
@Composable
fun SettingsScreen(app: TalysmanApp) {
    val context = LocalContext.current
    val settings = remember { AppSettings(app) }
    var refresh by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        refresh++
        onPauseOrDispose {}
    }
    var blockBrowsers by remember { mutableStateOf(settings.blockUnsupportedBrowsers) }
    ScreenColumn("Settings") {
        Kicker("Permissions")
        PermissionRows(app, refresh)
        Kicker("Browsers")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Block browsers Talysman can’t read", color = TalysmanPalette.ForegroundStrong)
                Muted("While a profile with website rules is on.")
            }
            Switch(checked = blockBrowsers, onCheckedChange = {
                settings.blockUnsupportedBrowsers = it
                blockBrowsers = it
            })
        }
        Panel {
            Text("Firefox soft blocks", color = TalysmanPalette.ForegroundStrong)
            Muted(
                "Install the Talysman extension in Firefox, open its popup, and enter this pairing code. " +
                    "Firefox then hides feeds and Shorts inside pages, like on desktop.",
            )
            Text(BridgeServer.pairingCode(app), color = TalysmanPalette.Signal)
            Muted(if (BridgeServer.connected("org.mozilla.firefox")) "Connected" else "Not connected")
            OutlinedButton(onClick = {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://addons.mozilla.org/firefox/addon/talysman/")))
            }) { Text("Get the extension") }
        }
        Kicker("Emergency unlock")
        EmergencyUnlock(app)
        Kicker("Plan")
        Muted(if (app.entitlement.isPro) "Pro" + if (BuildConfig.ENTITLEMENT_SOURCE == "sideload") " (included with this build)" else "" else "Free — one profile")
    }
}

/** Keyless, five per device for life (spec §3.7): everything off, even locked schedules. */
@Composable
private fun EmergencyUnlock(app: TalysmanApp) {
    val snapshot by app.engine.snapshot.collectAsStateWithLifecycle()
    var confirming by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("${snapshot.emergencyLeft} left", color = TalysmanPalette.ForegroundStrong)
            Muted("For a lost or broken key. Turns everything off and resets your streak.")
        }
        OutlinedButton(onClick = { confirming = true }, enabled = snapshot.emergencyLeft > 0) { Text("Use…") }
    }
    if (confirming) {
        var error by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Emergency unlock") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Use 1 of your ${snapshot.emergencyLeft} remaining emergency unlocks? Everything turns off — even locked " +
                            "schedules — until you or a schedule turn it back on. You can never get this unlock back." +
                            if (snapshot.streak.currentDays > 0) " Your ${snapshot.streak.currentDays}-day streak resets." else "",
                    )
                    Muted("Lost your key? Afterwards you can pair a new one on the Keys tab.")
                    error?.let { Text(it, color = TalysmanPalette.Danger) }
                }
            },
            confirmButton = {
                Button(onClick = {
                    try {
                        app.engine.apply(Commands.emergencyUnlock())
                        confirming = false
                    } catch (e: EngineRefusal) {
                        error = e.message
                    }
                }) { Text("Use emergency unlock") }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun PermissionRows(app: TalysmanApp, refresh: Int) {
    val context = LocalContext.current
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    @Suppress("UNUSED_EXPRESSION") refresh
    Permission(
        "Accessibility service",
        "Required: this is what blocks apps and sites.",
        TalysmanAccessibilityService.isEnabled(context),
    ) { context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
    Permission("Notifications", "Shows what’s on and “Re-enable all”.", NotificationManagerCompat.from(context).areNotificationsEnabled()) {
        if (Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    if (Build.VERSION.SDK_INT >= 31) {
        val alarms = context.getSystemService(AlarmManager::class.java)
        Permission("Exact alarms", "Schedules start and unlocks end on the minute.", alarms?.canScheduleExactAlarms() == true) {
            context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}")))
        }
    }
    val power = context.getSystemService(PowerManager::class.java)
    Permission("Unrestricted battery", "Keeps Android from stopping Talysman.", power?.isIgnoringBatteryOptimizations(context.packageName) == true) {
        context.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")))
    }
    if (BuildConfig.DEVICE_ADMIN) {
        Permission("Uninstall protection", "Talysman can’t be uninstalled while blocking is on.", TalysmanDeviceAdmin.isActive(context)) {
            context.startActivity(TalysmanDeviceAdmin.enableIntent(context))
        }
    }
    @Suppress("UNUSED_VARIABLE") val unused = app
}

@Composable
private fun Permission(title: String, detail: String, granted: Boolean, request: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, color = TalysmanPalette.ForegroundStrong)
            Muted(detail)
        }
        if (granted) Text("On", color = TalysmanPalette.Success) else Button(onClick = request) { Text("Turn on") }
    }
}

/** First run: why each permission matters, then the app. */
@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    val app = LocalContext.current.applicationContext as TalysmanApp
    var refresh by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        refresh++
        onPauseOrDispose {}
    }
    ScreenColumn("Welcome to Talysman") {
        Muted(
            "Talysman blocks apps and sites on a schedule or when you turn a profile on — and only a key you keep " +
                "somewhere else (an NFC tag or a printed QR code) turns it back off early.",
        )
        PermissionRows(app, refresh)
        Muted("Next: pair a key on the Keys tab, then set up a profile.")
        Button(onClick = onDone) { Text("Continue") }
    }
}
