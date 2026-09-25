package app.talysman.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.talysman.android.TalysmanApp
import app.talysman.android.apps.InstalledApps
import app.talysman.android.engine.Commands
import app.talysman.android.engine.ConfigEdits
import app.talysman.android.engine.EngineSnapshot
import app.talysman.android.engine.Items
import app.talysman.android.ui.theme.Kicker
import app.talysman.android.ui.theme.Panel
import app.talysman.android.ui.theme.TalysmanPalette
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

private val DAYS = listOf("mon", "tue", "wed", "thu", "fri", "sat", "sun")
private val WEEKDAYS = listOf("mon", "tue", "wed", "thu", "fri")
private val HM = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

/**
 * One profile's config (spec §6.6): apps, websites, soft blocks, pools, schedule. Every edit is
 * one `upsertProfile`; the engine decides whether it loosens a committed profile and so needs
 * the key.
 */
@Composable
fun ProfileEditor(app: TalysmanApp, snapshot: EngineSnapshot, profileId: String, onBack: () -> Unit) {
    val runner = LocalKeyRunner.current
    val status = snapshot.profiles.firstOrNull { it.profile.id == profileId } ?: run {
        onBack()
        return
    }
    val profile = status.profile
    val config = profile.config
    fun save(next: JsonObject, name: String = profile.name) = runner.run(Commands.upsertProfile(profile.id, name, profile.color, next))
    var tab by rememberSaveable { mutableStateOf(0) }
    val tabs = listOf("Apps", "Websites", "Soft blocks", "Pools", "Schedule", "Profile")
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Profiles") }
            Text(profile.name, color = TalysmanPalette.ForegroundStrong)
            Muted("  ${activationLabel(status)}")
        }
        ScrollableTabRow(selectedTabIndex = tab, containerColor = TalysmanPalette.Background, edgePadding = 12.dp) {
            tabs.forEachIndexed { index, title -> Tab(selected = tab == index, onClick = { tab = index }, text = { Text(title) }) }
        }
        ScreenColumn(tabs[tab]) {
            when (tab) {
                0 -> AppsTab(config, ::save)
                1 -> WebsitesTab(config, ::save)
                2 -> SoftBlocksTab(app, config, ::save)
                3 -> PoolsTab(app, config, ::save)
                4 -> ScheduleTab(config, ::save)
                5 -> ProfileTab(app, snapshot, profileId, onBack) { name -> save(config, name) }
            }
            if (status.committed) Muted("This profile is on or scheduled: loosening it needs your key and resets your streak.")
        }
    }
}

@Composable
private fun AppsTab(config: JsonObject, save: (JsonObject) -> Unit) {
    val context = LocalContext.current
    val installed = remember { InstalledApps.load(context) }
    var query by remember { mutableStateOf("") }
    val whitelist = ConfigEdits.appMode(config) == "whitelist"
    val chosen = if (whitelist) ConfigEdits.allowedPackages(config) else ConfigEdits.blockedPackages(config)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Toggle("Block these apps", !whitelist) { save(ConfigEdits.setAppMode(config, "blacklist")) }
        Toggle("Allow only these", whitelist) { save(ConfigEdits.setAppMode(config, "whitelist")) }
    }
    Muted(if (whitelist) "Everything else is blocked. Phone, messages and the keyboard always work." else "Checked apps are blocked while this profile is on.")
    OutlinedTextField(query, { query = it }, label = { Text("Search") }, modifier = Modifier.fillMaxWidth())
    installed.filter { query.isBlank() || it.label.contains(query, true) || it.packageName.contains(query, true) }.forEach { entry ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = entry.packageName in chosen, onCheckedChange = { on ->
                val current = installed.filter { it.packageName in chosen }.map { it.packageName to it.label } +
                    chosen.filter { pkg -> installed.none { it.packageName == pkg } }.map { it to it }
                val next = if (on) current + (entry.packageName to entry.label) else current.filterNot { it.first == entry.packageName }
                save(if (whitelist) ConfigEdits.setAllowedApps(config, next) else ConfigEdits.setBlockedApps(config, next))
            })
            Column {
                Text(entry.label, color = TalysmanPalette.ForegroundStrong)
                Muted(entry.packageName)
            }
        }
    }
}

@Composable
private fun WebsitesTab(config: JsonObject, save: (JsonObject) -> Unit) {
    val whitelist = ConfigEdits.defaultAction(config) == "block"
    val key = if (whitelist) "allowedDomains" else "blockedDomains"
    val domains = ConfigEdits.strings(ConfigEdits.policy(config), key)
    var input by remember { mutableStateOf("") }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Toggle("Block these sites", !whitelist) { save(ConfigEdits.setDefaultAction(config, "allow")) }
        Toggle("Allow only these", whitelist) { save(ConfigEdits.setDefaultAction(config, "block")) }
    }
    Muted("Blocked in every browser Talysman can read. Firefox with the Talysman extension also gets soft blocks.")
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(input, { input = it.trim().lowercase() }, label = { Text("reddit.com") }, modifier = Modifier.weight(1f))
        Button(onClick = {
            if (input.contains('.')) save(ConfigEdits.setDomains(config, key, (domains + input).distinct()))
            input = ""
        }) { Text("Add") }
    }
    domains.forEach { domain ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(domain, color = TalysmanPalette.ForegroundStrong, modifier = Modifier.weight(1f))
            TextButton(onClick = { save(ConfigEdits.setDomains(config, key, domains - domain)) }) { Text("Remove") }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SoftBlocksTab(app: TalysmanApp, config: JsonObject, save: (JsonObject) -> Unit) {
    val rules = ConfigEdits.softRules(config)
    Muted("Keep an app but hide its worst parts — Shorts, Reels, feeds. Messages and things you search for stay usable.")
    app.catalog.apps.forEach { entry ->
        val rule = rules[entry.id]
        Panel {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(entry.label, color = TalysmanPalette.ForegroundStrong, modifier = Modifier.weight(1f))
                Switch(checked = rule != null, onCheckedChange = { on ->
                    save(ConfigEdits.setSoftRule(config, entry.id, if (on) emptyMap() else null))
                })
            }
            if (rule != null) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    entry.features.forEach { feature ->
                        val action = rule[feature.id] ?: feature.defaultAction
                        val hidden = action == "block"
                        Toggle((if (hidden) "Hide " else "Show ") + feature.label, hidden) {
                            save(ConfigEdits.setSoftRule(config, entry.id, rule + (feature.id to if (hidden) "allow" else "block")))
                        }
                    }
                }
            }
        }
    }
}

/** A pool member's display label. */
private fun itemLabel(app: TalysmanApp, item: JsonElement): String = Items.label(item) { app.catalog.app(it)?.label }.let { label ->
    val pkg = item.jsonObject["app"]?.jsonObject?.get("androidPackage")?.jsonPrimitive?.content
    if (pkg != null) runCatching { app.packageManager.getApplicationLabel(app.packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrDefault(label) else label
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PoolsTab(app: TalysmanApp, config: JsonObject, save: (JsonObject) -> Unit) {
    val pools = ConfigEdits.pools(config)
    val candidates: List<JsonElement> = ConfigEdits.blockedPackages(config).map { Items.app(it, it) } +
        ConfigEdits.blockedDomains(config).map { Items.domain(it) } +
        ConfigEdits.softRules(config).keys.map { Items.catalog(it) }
    fun key(item: JsonElement) = item.toString()
    Muted("A pool lets you unlock its apps and sites without your key a few times a day, with an optional pause first. Pool unlocks don’t reset your streak.")
    pools.forEachIndexed { index, pool ->
        fun update(next: JsonObject) = save(ConfigEdits.setPools(config, pools.toMutableList().also { it[index] = next }))
        val items = pool["items"]?.jsonArray ?: JsonArray(emptyList())
        val friction = pool["friction"]?.jsonObject
        val frictionKind = friction?.get("kind")?.jsonPrimitive?.content ?: "none"
        val secs = friction?.get("secs")?.jsonPrimitive?.intOrNull ?: 15
        Panel {
            var name by remember(pool) { mutableStateOf(pool["name"]?.jsonPrimitive?.content ?: "Pool") }
            OutlinedTextField(name, { name = it }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
            if (name != pool["name"]?.jsonPrimitive?.content && name.isNotBlank()) {
                TextButton(onClick = { update(JsonObject(pool + ("name" to JsonPrimitive(name)))) }) { Text("Save name") }
            }
            Stepper("Unlocks per day", pool["unlocksPerDay"]?.jsonPrimitive?.intOrNull ?: 3, 0..20) {
                update(JsonObject(pool + ("unlocksPerDay" to JsonPrimitive(it))))
            }
            Stepper("Minutes each", pool["unlockMinutes"]?.jsonPrimitive?.intOrNull ?: 10, 1..120) {
                update(JsonObject(pool + ("unlockMinutes" to JsonPrimitive(it))))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("none" to "No pause", "countdown" to "Countdown", "breathing" to "Breathing").forEach { (kind, label) ->
                    Toggle(label, frictionKind == kind) {
                        update(JsonObject(pool + ("friction" to buildJsonObject {
                            put("kind", kind)
                            if (kind != "none") put("secs", secs)
                        })))
                    }
                }
            }
            if (frictionKind != "none") {
                Stepper("Pause seconds", secs, 5..60) { value ->
                    update(JsonObject(pool + ("friction" to buildJsonObject {
                        put("kind", frictionKind)
                        put("secs", value)
                    })))
                }
            }
            Kicker("In this pool")
            val elsewhere = pools.filterIndexed { i, _ -> i != index }.flatMap { it["items"]?.jsonArray ?: JsonArray(emptyList()) }.map(::key).toSet()
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                candidates.filter { key(it) !in elsewhere }.forEach { item ->
                    val inPool = items.any { key(it) == key(item) }
                    Toggle(itemLabel(app, item), inPool) {
                        val next = if (inPool) items.filterNot { key(it) == key(item) } else items + item
                        update(JsonObject(pool + ("items" to JsonArray(next))))
                    }
                }
            }
            TextButton(onClick = { save(ConfigEdits.setPools(config, pools.filterIndexed { i, _ -> i != index })) }) {
                Text("Delete pool", color = TalysmanPalette.Danger)
            }
        }
    }
    OutlinedButton(onClick = {
        save(ConfigEdits.setPools(config, pools + buildJsonObject {
            put("id", newId("pool"))
            put("name", "Pool ${pools.size + 1}")
            put("items", JsonArray(emptyList()))
            put("unlocksPerDay", 3)
            put("unlockMinutes", 10)
            put("friction", buildJsonObject { put("kind", "none") })
        }))
    }, enabled = candidates.isNotEmpty()) { Text("New pool") }
}

@Composable
private fun Stepper(label: String, value: Int, range: IntRange, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = TalysmanPalette.Foreground, modifier = Modifier.weight(1f))
        TextButton(onClick = { onChange((value - 1).coerceIn(range)) }) { Text("−") }
        Text("$value", color = TalysmanPalette.ForegroundStrong, modifier = Modifier.width(32.dp))
        TextButton(onClick = { onChange((value + 1).coerceIn(range)) }) { Text("+") }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DayChips(days: List<String>, onChange: (List<String>) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        DAYS.forEach { day ->
            val on = day in days
            Toggle(day.replaceFirstChar { it.uppercase() }, on) { onChange(if (on) days - day else DAYS.filter { it == day || it in days }) }
        }
    }
}

@Composable
private fun TimeField(label: String, value: String, onChange: (String) -> Unit) {
    var text by remember(value) { mutableStateOf(value) }
    OutlinedTextField(
        text,
        { next ->
            text = next
            if (HM.matches(next)) onChange(next)
        },
        label = { Text(label) },
        isError = !HM.matches(text),
        modifier = Modifier.width(120.dp),
    )
}

@Composable
private fun ScheduleTab(config: JsonObject, save: (JsonObject) -> Unit) {
    val rules = ConfigEdits.schedule(config)
    fun replace(index: Int, next: JsonObject?) =
        save(ConfigEdits.setSchedule(config, rules.toMutableList().also { if (next == null) it.removeAt(index) else it[index] = next }))
    fun strings(rule: JsonObject, key: String) = rule[key]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()

    Kicker("Blocks")
    Muted("This profile is on during these times. A locked block can’t be turned off with your key — only an emergency unlock ends it early.")
    rules.forEachIndexed { index, rule ->
        if (rule["kind"]?.jsonPrimitive?.content != "window") return@forEachIndexed
        Panel {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                TimeField("Start", rule["start"]!!.jsonPrimitive.content) { replace(index, JsonObject(rule + ("start" to JsonPrimitive(it)))) }
                TimeField("End", rule["end"]!!.jsonPrimitive.content) { replace(index, JsonObject(rule + ("end" to JsonPrimitive(it)))) }
            }
            DayChips(strings(rule, "days")) { days -> replace(index, JsonObject(rule + ("days" to JsonArray(days.map(::JsonPrimitive))))) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Locked", color = TalysmanPalette.Foreground, modifier = Modifier.weight(1f))
                val locked = rule["locked"]?.jsonPrimitive?.booleanOrNull == true
                Switch(checked = locked, onCheckedChange = { replace(index, JsonObject(rule + ("locked" to JsonPrimitive(it)))) })
            }
            TextButton(onClick = { replace(index, null) }) { Text("Delete", color = TalysmanPalette.Danger) }
        }
    }
    OutlinedButton(onClick = {
        save(ConfigEdits.setSchedule(config, rules + buildJsonObject {
            put("kind", "window")
            put("id", newId("win"))
            put("days", JsonArray(WEEKDAYS.map(::JsonPrimitive)))
            put("start", "09:00")
            put("end", "17:00")
            put("locked", false)
        }))
    }) { Text("New block") }

    Kicker("On at / off at")
    rules.forEachIndexed { index, rule ->
        if (rule["kind"]?.jsonPrimitive?.content != "at") return@forEachIndexed
        Panel {
            val action = rule["action"]?.jsonPrimitive?.content ?: "on"
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (action == "on") "Turns on at" else "Turns off at", color = TalysmanPalette.Foreground)
                TimeField("Time", rule["at"]!!.jsonPrimitive.content) { replace(index, JsonObject(rule + ("at" to JsonPrimitive(it)))) }
            }
            DayChips(strings(rule, "days")) { days -> replace(index, JsonObject(rule + ("days" to JsonArray(days.map(::JsonPrimitive))))) }
            TextButton(onClick = { replace(index, null) }) { Text("Delete", color = TalysmanPalette.Danger) }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("on" to "09:00", "off" to "17:00").forEach { (action, at) ->
            OutlinedButton(onClick = {
                save(ConfigEdits.setSchedule(config, rules + buildJsonObject {
                    put("kind", "at")
                    put("id", newId("at"))
                    put("days", JsonArray(WEEKDAYS.map(::JsonPrimitive)))
                    put("at", at)
                    put("action", action)
                }))
            }) { Text(if (action == "on") "+ On at…" else "+ Off at…") }
        }
    }

    Kicker("One-time")
    val shots = ConfigEdits.oneShots(config)
    shots.forEach { shot ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            val at = shot["atMs"]?.jsonPrimitive?.longOrNull ?: 0
            val fired = shot["firedAtMs"]?.jsonPrimitive?.longOrNull != null
            Text("Turns ${shot["action"]?.jsonPrimitive?.content} · ${formatClock(at)}${if (fired) " · done" else ""}", color = TalysmanPalette.Foreground, modifier = Modifier.weight(1f))
            if (!fired) TextButton(onClick = { save(ConfigEdits.setOneShots(config, shots - shot)) }) { Text("Remove") }
        }
    }
    var when_ by remember { mutableStateOf("") }
    var action by remember { mutableStateOf("on") }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedTextField(when_, { when_ = it }, label = { Text("YYYY-MM-DD HH:MM") }, modifier = Modifier.weight(1f))
        Toggle(if (action == "on") "On" else "Off", true) { action = if (action == "on") "off" else "on" }
    }
    Button(onClick = {
        val atMs = runCatching { java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.US).parse(when_.trim())?.time }.getOrNull()
        if (atMs != null && atMs > System.currentTimeMillis()) {
            save(ConfigEdits.setOneShots(config, shots + buildJsonObject {
                put("id", newId("once"))
                put("atMs", atMs)
                put("action", action)
            }))
            when_ = ""
        }
    }) { Text("Add one-time event") }
}

@Composable
private fun ProfileTab(app: TalysmanApp, snapshot: EngineSnapshot, profileId: String, onBack: () -> Unit, rename: (String) -> Unit) {
    val runner = LocalKeyRunner.current
    val profile = snapshot.profiles.first { it.profile.id == profileId }.profile
    var name by remember(profile.name) { mutableStateOf(profile.name) }
    OutlinedTextField(name, { name = it.take(40) }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
    Button(onClick = { if (name.isNotBlank()) rename(name.trim()) }, enabled = name != profile.name) { Text("Rename") }
    if (snapshot.defaultProfileId != profileId) {
        OutlinedButton(onClick = { runner.run(Commands.setDefaultProfile(profileId)) }) { Text("Use for “Turn on focus”") }
    } else {
        Muted("“Turn on focus” turns this profile on.")
    }
    OutlinedButton(onClick = {
        runner.run(Commands.duplicateProfile(profileId, newId("profile"), nextColor(snapshot)))
    }) { Text("Duplicate") }
    if (snapshot.profiles.size > 1) {
        TextButton(onClick = { runner.run(Commands.deleteProfile(profileId), onBack) }) { Text("Delete profile", color = TalysmanPalette.Danger) }
    }
    if (!app.entitlement.isPro) Muted("More profiles are part of Pro.")
}
