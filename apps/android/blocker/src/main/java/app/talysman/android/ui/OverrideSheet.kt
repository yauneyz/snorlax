package app.talysman.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.talysman.android.TalysmanApp
import app.talysman.android.engine.Commands
import app.talysman.android.engine.EngineSnapshot
import app.talysman.android.engine.PoolRef
import app.talysman.android.engine.PoolStatus
import app.talysman.android.service.AppSettings
import app.talysman.android.ui.theme.StreakBadge
import app.talysman.android.ui.theme.TalysmanPalette
import kotlinx.coroutines.delay

private val PAUSE_PRESETS = listOf(10, 30, 60, 120)
private const val UNLOCK_COUNTDOWN_SECS = 5

private fun poolKey(p: PoolStatus) = "${p.profileId}/${p.poolId}"

/**
 * What Home's pause/unlock button opens (spec §3.5). Pause everything until a chosen time (needs
 * the key, breaks the streak), or — without the key — a temporary unlock of one of an active
 * profile's unlock groups: keyless, limited per day, behind a short countdown, with the group last
 * unlocked here preselected. There's no way to sense a key on Android, so the sheet starts on
 * pause when a key is paired and lets you switch. Emergency unlocks live in Settings.
 */
@Composable
fun OverrideSheet(app: TalysmanApp, snapshot: EngineSnapshot, onClose: () -> Unit) {
    val hasKeys = remember { app.keys.hasKeys() }
    var unlock by remember { mutableStateOf(!hasKeys) }
    if (unlock) {
        TemporaryUnlockSheet(app, snapshot, onClose, onPause = if (hasKeys) ({ unlock = false }) else null)
    } else {
        PauseSheet(snapshot, onClose, onUnlock = { unlock = true })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PauseSheet(snapshot: EngineSnapshot, onClose: () -> Unit, onUnlock: () -> Unit) {
    val runner = LocalKeyRunner.current
    var minutes by remember { mutableIntStateOf(30) }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Pause until…") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                StreakBadge(snapshot.streak.currentDays, snapshot.streak.bestDays)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    PAUSE_PRESETS.forEach { m ->
                        Toggle(if (m < 60) "$m min" else "${m / 60} h", minutes == m) { minutes = m }
                    }
                }
                Muted("Back on at ${formatClock(System.currentTimeMillis() + minutes * 60_000L)}. Needs your key and resets your streak.")
                TextButton(onClick = onUnlock) {
                    Text("No key with you? Temporary unlock", color = TalysmanPalette.ForegroundMuted)
                }
            }
        },
        confirmButton = {
            Button(onClick = { runner.run(Commands.startOverrideTimed(minutes), onClose) }) { Text("Pause") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}

@Composable
private fun TemporaryUnlockSheet(app: TalysmanApp, snapshot: EngineSnapshot, onClose: () -> Unit, onPause: (() -> Unit)?) {
    val runner = LocalKeyRunner.current
    val settings = remember { AppSettings(app) }
    val activeIds = snapshot.profiles.filter { it.activation.active }.map { it.profile.id }.toSet()
    val pools = snapshot.pools.filter { it.profileId in activeIds }
    var selected by remember {
        val last = settings.lastUnlockPool
        mutableStateOf(pools.firstOrNull { poolKey(it) == last }?.let(::poolKey) ?: pools.firstOrNull()?.let(::poolKey))
    }
    var countdown by remember { mutableIntStateOf(UNLOCK_COUNTDOWN_SECS) }
    LaunchedEffect(countdown) {
        if (countdown > 0) {
            delay(1000)
            countdown--
        }
    }
    val pool = pools.firstOrNull { poolKey(it) == selected }
    val showProfile = pools.map { it.profileId }.toSet().size > 1
    val now = System.currentTimeMillis()

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Temporary unlock") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (pools.isEmpty()) {
                    Muted("None of the profiles that are on has an unlock group.")
                } else {
                    Muted("Unlock one group for a while, no key needed.")
                    Column(Modifier.selectableGroup()) {
                        pools.forEach { p ->
                            val key = poolKey(p)
                            val profileName = snapshot.profiles.firstOrNull { it.profile.id == p.profileId }?.profile?.name
                            val until = p.activeUntilMs?.takeIf { it > now }
                            Row(
                                Modifier.fillMaxWidth().selectable(selected = key == selected, role = Role.RadioButton) { selected = key },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(selected = key == selected, onClick = null)
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        if (showProfile && profileName != null) "${p.name} · $profileName" else p.name,
                                        color = TalysmanPalette.ForegroundStrong,
                                    )
                                    Muted(
                                        if (until != null) "Unlocked until ${formatClock(until, now)}"
                                        else "${p.unlockMinutes} min each · ${p.leftToday} of ${p.unlocksPerDay} left today",
                                    )
                                }
                            }
                        }
                    }
                }
                if (onPause != null) {
                    TextButton(onClick = onPause) { Text("Have your key? Pause instead", color = TalysmanPalette.ForegroundMuted) }
                }
            }
        },
        confirmButton = {
            if (pools.isNotEmpty()) {
                Button(
                    enabled = countdown == 0 && pool != null && pool.leftToday > 0,
                    onClick = {
                        val p = pool ?: return@Button
                        runner.run(Commands.confirmPoolUnlock(listOf(PoolRef(p.profileId, p.poolId)))) {
                            settings.lastUnlockPool = poolKey(p)
                            onClose()
                        }
                    },
                ) {
                    Text(
                        when {
                            countdown > 0 -> "Unlock in $countdown…"
                            pool != null && pool.leftToday == 0 -> "None left today"
                            else -> "Unlock for ${pool?.unlockMinutes ?: 0} min"
                        },
                    )
                }
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
    )
}
