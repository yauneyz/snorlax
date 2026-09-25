package app.talysman.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.talysman.android.TalysmanApp
import app.talysman.android.engine.Commands
import app.talysman.android.engine.ConfigEdits
import app.talysman.android.engine.EngineSnapshot
import app.talysman.android.ui.theme.Panel
import app.talysman.android.ui.theme.ProfileDot
import app.talysman.android.ui.theme.TalysmanPalette

val PROFILE_COLORS = listOf("#4fd1c5", "#a78bfa", "#fb7185", "#fbbf24", "#60a5fa", "#f472b6")

fun nextColor(snapshot: EngineSnapshot): String {
    val used = snapshot.profiles.map { it.profile.color }.toSet()
    return PROFILE_COLORS.firstOrNull { it !in used } ?: PROFILE_COLORS[snapshot.profiles.size % PROFILE_COLORS.size]
}

fun newId(prefix: String) = "$prefix-" + java.util.UUID.randomUUID().toString().take(8)

/** Profiles (spec §6.6): list, create, open the editor. */
@Composable
fun ProfilesScreen(app: TalysmanApp, snapshot: EngineSnapshot, onEdit: (String) -> Unit) {
    val runner = LocalKeyRunner.current
    ScreenColumn("Profiles") {
        Muted("Each profile is its own set of apps, sites, soft blocks, unlock pools and schedule. Any number can be on.")
        snapshot.profiles.forEach { status ->
            Panel(Modifier.clickable { onEdit(status.profile.id) }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ProfileDot(status.profile.color)
                    Column(Modifier.weight(1f)) {
                        Text(status.profile.name, color = TalysmanPalette.ForegroundStrong)
                        val config = status.profile.config
                        Muted(
                            "${activationLabel(status)} · ${ConfigEdits.blockedPackages(config).size} apps · " +
                                "${ConfigEdits.blockedDomains(config).size} sites · ${ConfigEdits.softRules(config).size} soft blocks",
                        )
                    }
                }
            }
        }
        Button(onClick = {
            val id = newId("profile")
            runner.run(Commands.upsertProfile(id, "Profile ${snapshot.profiles.size + 1}", nextColor(snapshot), ConfigEdits.empty())) { onEdit(id) }
        }, modifier = Modifier.fillMaxWidth()) { Text("New profile") }
        if (!app.entitlement.isPro) Muted("Free includes one profile. Pro is unlimited.")
    }
}
