package app.talysman.android.engine

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Engine `Command` JSON (see native/engine/src/engine.rs). */
object Commands {
    private fun command(type: String, body: JsonObjectBuilderScope = {}) = buildJsonObject {
        put("type", type)
        body()
    }

    fun upsertProfile(id: String, name: String, color: String, config: JsonObject) = command("upsertProfile") {
        put("profile", buildJsonObject {
            put("id", id)
            put("name", name)
            put("color", color)
            put("config", config)
        })
    }

    fun duplicateProfile(profileId: String, newId: String, color: String?) = command("duplicateProfile") {
        put("profileId", profileId)
        put("newId", newId)
        color?.let { put("color", it) }
    }

    fun deleteProfile(profileId: String) = command("deleteProfile") { put("profileId", profileId) }

    fun setLatch(profileId: String, on: Boolean) = command("setLatch") {
        put("profileId", profileId)
        put("on", on)
    }

    fun setDefaultProfile(profileId: String) = command("setDefaultProfile") { put("profileId", profileId) }

    private fun pools(refs: List<PoolRef>) = buildJsonArray {
        refs.forEach { ref ->
            add(buildJsonObject {
                put("profileId", ref.profileId)
                put("poolId", ref.poolId)
            })
        }
    }

    fun requestPoolUnlock(refs: List<PoolRef>) = command("requestPoolUnlock") { put("pools", pools(refs)) }
    fun confirmPoolUnlock(refs: List<PoolRef>) = command("confirmPoolUnlock") { put("pools", pools(refs)) }
    fun cancelPoolUnlock(refs: List<PoolRef>) = command("cancelPoolUnlock") { put("pools", pools(refs)) }

    fun startOverrideAll() = command("startOverrideAll")

    fun startOverrideExempt(items: List<JsonElement>, profiles: List<String>) = command("startOverrideExempt") {
        put("items", JsonArray(items))
        put("profiles", JsonArray(profiles.map(::JsonPrimitive)))
    }

    fun startOverrideTimed(minutes: Int) = command("startOverrideTimed") { put("minutes", minutes) }
    fun reenableAll() = command("reenableAll")
    fun emergencyUnlock() = command("emergencyUnlock")
    fun pairKey() = command("pairKey")
    fun unpairKey() = command("unpairKey")
}

private typealias JsonObjectBuilderScope = kotlinx.serialization.json.JsonObjectBuilder.() -> Unit

/** Item references (`ItemRef`) for pools and override (2). */
object Items {
    fun domain(domain: String) = buildJsonObject {
        put("kind", "domain")
        put("domain", domain)
    }

    fun catalog(id: String) = buildJsonObject {
        put("kind", "catalog")
        put("id", id)
    }

    fun app(packageName: String, label: String) = buildJsonObject {
        put("kind", "app")
        put("app", appRef(packageName, label))
    }

    fun appRef(packageName: String, label: String) = buildJsonObject {
        put("androidPackage", packageName)
        put("label", label)
    }

    fun label(item: JsonElement, catalogLabel: (String) -> String?): String {
        val obj = item.jsonObject
        return when (obj["kind"]?.jsonPrimitive?.content) {
            "domain" -> obj["domain"]?.jsonPrimitive?.content ?: "?"
            "catalog" -> obj["id"]?.jsonPrimitive?.content?.let { catalogLabel(it) ?: it } ?: "?"
            "app" -> obj["app"]?.jsonObject?.get("label")?.jsonPrimitive?.content ?: "?"
            else -> "?"
        }
    }
}

/**
 * Pure edits on a raw `ProfileConfig` JSON object. They only change the field they name, so a
 * config round-trips through the app without losing anything the Android UI doesn't show (AI
 * judge settings from the desktop, for instance).
 */
object ConfigEdits {
    fun empty(): JsonObject = buildJsonObject {
        put("policy", buildJsonObject {
            put("blockedDomains", JsonArray(emptyList()))
            put("allowedDomains", JsonArray(emptyList()))
            put("defaultAction", "allow")
            put("judge", kotlinx.serialization.json.JsonNull)
            put("apps", JsonArray(emptyList()))
            put("enabledPremadeLists", JsonArray(emptyList()))
            put("sites", buildJsonObject {})
        })
        put("appMode", "blacklist")
        put("allowedApps", JsonArray(emptyList()))
        put("pools", JsonArray(emptyList()))
        put("schedule", JsonArray(emptyList()))
        put("oneShots", JsonArray(emptyList()))
    }

    fun policy(config: JsonObject): JsonObject = config["policy"]?.jsonObject ?: empty()["policy"]!!.jsonObject

    fun with(config: JsonObject, key: String, value: JsonElement): JsonObject = JsonObject(config + (key to value))

    fun withPolicy(config: JsonObject, key: String, value: JsonElement): JsonObject =
        with(config, "policy", JsonObject(policy(config) + (key to value)))

    fun strings(obj: JsonObject, key: String): List<String> =
        obj[key]?.jsonArray?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()

    fun array(obj: JsonObject, key: String): List<JsonElement> = obj[key]?.jsonArray ?: emptyList()

    fun blockedDomains(config: JsonObject) = strings(policy(config), "blockedDomains")
    fun allowedDomains(config: JsonObject) = strings(policy(config), "allowedDomains")
    fun defaultAction(config: JsonObject) = policy(config)["defaultAction"]?.jsonPrimitive?.content ?: "allow"
    fun appMode(config: JsonObject) = config["appMode"]?.jsonPrimitive?.content ?: "blacklist"

    /** Android packages the profile blacklists. */
    fun blockedPackages(config: JsonObject): List<String> =
        array(policy(config), "apps").mapNotNull { it.jsonObject["androidPackage"]?.jsonPrimitive?.content }

    fun allowedPackages(config: JsonObject): List<String> =
        array(config, "allowedApps").mapNotNull { it.jsonObject["androidPackage"]?.jsonPrimitive?.content }

    fun softRules(config: JsonObject): Map<String, Map<String, String>> =
        policy(config)["sites"]?.jsonObject?.mapValues { (_, rule) ->
            rule.jsonObject["features"]?.jsonObject?.mapValues { it.value.jsonPrimitive.content } ?: emptyMap()
        } ?: emptyMap()

    fun setDomains(config: JsonObject, key: String, domains: List<String>) =
        withPolicy(config, key, JsonArray(domains.map(::JsonPrimitive)))

    fun setDefaultAction(config: JsonObject, action: String) = withPolicy(config, "defaultAction", JsonPrimitive(action))

    fun setAppMode(config: JsonObject, mode: String) = with(config, "appMode", JsonPrimitive(mode))

    /** Replace the Android entries of `policy.apps`, keeping desktop entries untouched. */
    fun setBlockedApps(config: JsonObject, apps: List<Pair<String, String>>): JsonObject {
        val desktop = array(policy(config), "apps").filter { it.jsonObject["androidPackage"] == null }
        return withPolicy(config, "apps", JsonArray(desktop + apps.map { (pkg, label) -> Items.appRef(pkg, label) }))
    }

    fun setAllowedApps(config: JsonObject, apps: List<Pair<String, String>>): JsonObject {
        val desktop = array(config, "allowedApps").filter { it.jsonObject["androidPackage"] == null }
        return with(config, "allowedApps", JsonArray(desktop + apps.map { (pkg, label) -> Items.appRef(pkg, label) }))
    }

    fun setSoftRule(config: JsonObject, siteId: String, features: Map<String, String>?): JsonObject {
        val sites = policy(config)["sites"]?.jsonObject ?: JsonObject(emptyMap())
        val next = if (features == null) {
            JsonObject(sites - siteId)
        } else {
            JsonObject(sites + (siteId to buildJsonObject {
                put("features", JsonObject(features.mapValues { JsonPrimitive(it.value) }))
            }))
        }
        return withPolicy(config, "sites", next)
    }

    fun pools(config: JsonObject): List<JsonObject> = array(config, "pools").map { it.jsonObject }
    fun setPools(config: JsonObject, pools: List<JsonObject>) = with(config, "pools", JsonArray(pools))

    fun schedule(config: JsonObject): List<JsonObject> = array(config, "schedule").map { it.jsonObject }
    fun setSchedule(config: JsonObject, rules: List<JsonObject>) = with(config, "schedule", JsonArray(rules))

    fun oneShots(config: JsonObject): List<JsonObject> = array(config, "oneShots").map { it.jsonObject }
    fun setOneShots(config: JsonObject, events: List<JsonObject>) = with(config, "oneShots", JsonArray(events))
}
