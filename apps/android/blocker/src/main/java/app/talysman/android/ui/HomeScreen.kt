package app.talysman.android.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.talysman.android.TalysmanApp
import app.talysman.android.a11y.TalysmanAccessibilityService
import app.talysman.android.engine.Commands
import app.talysman.android.engine.EngineSnapshot
import app.talysman.android.ui.theme.Kicker
import app.talysman.android.ui.theme.Panel
import app.talysman.android.ui.theme.ProfileDot
import app.talysman.android.ui.theme.StreakBadge
import app.talysman.android.ui.theme.TalysmanPalette
import kotlinx.coroutines.delay

/** Home (spec §6.6): what's on and why, streak, overrides in effect, what's next. */
@Composable
fun HomeScreen(app: TalysmanApp, snapshot: EngineSnapshot, onOverrides: () -> Unit) {
    val runner = LocalKeyRunner.current
    val context = LocalContext.current
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            now = System.currentTimeMillis()
        }
    }
    val active = snapshot.profiles.filter { it.activation.active }
    ScreenColumn("Talysman") {
        if (snapshot.anyActive && !TalysmanAccessibilityService.isEnabled(context)) {
            Panel {
                Text("Protection is off", color = TalysmanPalette.Danger, fontWeight = FontWeight.Bold)
                Muted("Talysman can’t block anything until its accessibility service is on.")
                Button(onClick = { context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }) { Text("Turn it on") }
            }
        }
        Text(
            when {
                snapshot.anyActive -> "FOCUSED"
                snapshot.overrides.timed != null -> "PAUSED"
                else -> "UNPROTECTED"
            },
            fontSize = 30.sp,
            fontWeight = FontWeight.Bold,
            color = if (snapshot.anyActive) TalysmanPalette.Success else TalysmanPalette.ForegroundStrong,
        )
        StreakBadge(snapshot.streak.currentDays, snapshot.streak.bestDays)
        snapshot.overrides.timed?.let { Muted("Paused until ${formatClock(it.untilMs, now)}") }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (snapshot.anyActive) {
                Button(onClick = onOverrides) { Text("Turn off…") }
            } else {
                Button(onClick = {
                    snapshot.defaultProfileId?.let { runner.run(Commands.setLatch(it, true)) }
                }) { Text("Turn on focus") }
            }
            if (snapshot.overridden) {
                OutlinedButton(onClick = { runner.run(Commands.reenableAll()) }) { Text("Re-enable all") }
            }
        }

        Kicker("Profiles")
        snapshot.profiles.forEach { status ->
            val on = status.activation.active || status.activation.paused
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ProfileDot(status.profile.color)
                Text(status.profile.name, color = TalysmanPalette.ForegroundStrong, modifier = Modifier.weight(1f))
                Muted(activationLabel(status))
                Switch(checked = on, onCheckedChange = { turnOn ->
                    if (turnOn) runner.run(Commands.setLatch(status.profile.id, true)) else onOverrides()
                })
            }
        }
        if (active.size > 1) Muted("Everything any of them blocks is blocked.")

        val unlocked = snapshot.pools.filter { (it.activeUntilMs ?: 0) > now }
        if (unlocked.isNotEmpty()) {
            Kicker("Unlocked now")
            unlocked.forEach { Muted("${it.name} · ${formatDuration((it.activeUntilMs ?: now) - now)} left") }
        }
        if (snapshot.nextEvents.isNotEmpty()) {
            Kicker("Coming up")
            snapshot.nextEvents.take(4).forEach { event ->
                val name = snapshot.profiles.firstOrNull { it.profile.id == event.profileId }?.profile?.name ?: "Profile"
                val verb = when (event.kind) {
                    "windowStart" -> "starts"
                    "windowEnd" -> "ends"
                    "on" -> "turns on"
                    else -> "turns off"
                }
                Muted("$name $verb · ${formatClock(event.atMs, now)}")
            }
        }
        Muted("${snapshot.emergencyLeft} emergency unlocks left")
    }
}
