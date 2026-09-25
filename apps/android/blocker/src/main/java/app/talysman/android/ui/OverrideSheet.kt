package app.talysman.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.talysman.android.TalysmanApp
import app.talysman.android.engine.Commands
import app.talysman.android.engine.ConfigEdits
import app.talysman.android.engine.EngineRefusal
import app.talysman.android.engine.EngineSnapshot
import app.talysman.android.engine.Items
import app.talysman.android.ui.theme.StreakBadge
import app.talysman.android.ui.theme.TalysmanPalette
import kotlinx.serialization.json.JsonElement

/**
 * The key-gated override paths (spec §3.5): everything off until re-enabled, some profiles /
 * sites / apps off until "Re-enable all", or everything off for a while. Plus the keyless
 * emergency unlock — always "everything off", five per device for life.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OverrideSheet(app: TalysmanApp, snapshot: EngineSnapshot, onClose: () -> Unit) {
    val runner = LocalKeyRunner.current
    var path by remember { mutableStateOf("menu") }
    var emergency by remember { mutableStateOf(false) }
    val chosenProfiles = remember { mutableStateOf(setOf<String>()) }
    val chosenItems = remember { mutableStateOf(setOf<String>()) }
    val active = snapshot.profiles.filter { it.activation.active && it.activation.lockedUntilMs == null }
    val locked = snapshot.profiles.filter { it.activation.active && it.activation.lockedUntilMs != null }
    val items: Map<String, JsonElement> = buildMap {
        active.forEach { status ->
            val config = status.profile.config
            ConfigEdits.blockedDomains(config).forEach { put("domain:$it", Items.domain(it)) }
            ConfigEdits.softRules(config).keys.forEach { put("catalog:$it", Items.catalog(it)) }
            ConfigEdits.blockedPackages(config).forEach { put("app:$it", Items.app(it, it)) }
        }
    }
    fun label(key: String, item: JsonElement) = Items.label(item) { app.catalog.app(it)?.label }.let {
        if (key.startsWith("app:")) runCatching {
            app.packageManager.getApplicationLabel(app.packageManager.getApplicationInfo(it, 0)).toString()
        }.getOrDefault(it) else it
    }

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Turn blocking off") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                StreakBadge(snapshot.streak.currentDays, snapshot.streak.bestDays)
                if (locked.isNotEmpty()) {
                    Muted(
                        "${locked.joinToString { it.profile.name }} ${if (locked.size == 1) "is" else "are"} locked until " +
                            "${formatClock(locked.maxOf { it.activation.lockedUntilMs ?: 0 })}. Overrides leave locked profiles alone.",
                    )
                }
                when (path) {
                    "menu" -> {
                        Button(onClick = { runner.run(Commands.startOverrideAll(), onClose) }, enabled = active.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                            Text("Turn everything off")
                        }
                        OutlinedButton(onClick = { path = "some" }, enabled = active.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                            Text("Turn off some things…")
                        }
                        OutlinedButton(onClick = { path = "pause" }, modifier = Modifier.fillMaxWidth()) { Text("Pause everything for…") }
                        Muted("These need your key and reset your streak.")
                    }
                    "some" -> {
                        Muted("Profiles")
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            active.forEach { status ->
                                val on = status.profile.id in chosenProfiles.value
                                Toggle(status.profile.name, on) {
                                    chosenProfiles.value = if (on) chosenProfiles.value - status.profile.id else chosenProfiles.value + status.profile.id
                                }
                            }
                        }
                        if (items.isNotEmpty()) {
                            Muted("Sites and apps")
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                items.forEach { (key, item) ->
                                    val on = key in chosenItems.value
                                    Toggle(label(key, item), on) {
                                        chosenItems.value = if (on) chosenItems.value - key else chosenItems.value + key
                                    }
                                }
                            }
                        }
                        Button(
                            enabled = chosenProfiles.value.isNotEmpty() || chosenItems.value.isNotEmpty(),
                            onClick = {
                                runner.run(
                                    Commands.startOverrideExempt(chosenItems.value.mapNotNull { items[it] }, chosenProfiles.value.toList()),
                                    onClose,
                                )
                            },
                        ) { Text("Turn off selected") }
                    }
                    "pause" -> FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(10, 30, 60, 120).forEach { minutes ->
                            OutlinedButton(onClick = { runner.run(Commands.startOverrideTimed(minutes), onClose) }) {
                                Text(if (minutes < 60) "$minutes min" else "${minutes / 60} h")
                            }
                        }
                    }
                }
                TextButton(onClick = { emergency = true }, enabled = snapshot.emergencyLeft > 0) {
                    Text(
                        if (snapshot.emergencyLeft > 0) "No key? Emergency unlock — turns everything off (${snapshot.emergencyLeft} left)"
                        else "No emergency unlocks left",
                        color = TalysmanPalette.ForegroundMuted,
                    )
                }
            }
        },
        confirmButton = {
            if (snapshot.overridden) TextButton(onClick = { runner.run(Commands.reenableAll(), onClose) }) { Text("Re-enable all") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Close") } },
    )

    if (emergency) {
        var error by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { emergency = false },
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
                        emergency = false
                        onClose()
                    } catch (e: EngineRefusal) {
                        error = e.message
                    }
                }) { Text("Use emergency unlock") }
            },
            dismissButton = { TextButton(onClick = { emergency = false }) { Text("Cancel") } },
        )
    }
}
