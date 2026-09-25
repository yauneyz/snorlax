package app.talysman.android.a11y

import android.content.Context
import app.talysman.android.engine.EngineJson
import app.talysman.android.engine.SiteFeature
import kotlinx.serialization.Serializable

/**
 * The Android half of the site catalog (apps/android/blocker/catalog/android-catalog.json,
 * generated from packages/shared/src/sites): in-app screens per catalog entry, browsers and
 * their address bars, and the system screens guarded while blocking is on. Kotlin never names a
 * specific app — everything app-specific is this data.
 */
@Serializable
data class NodeMatch(
    val viewId: String? = null,
    val text: String? = null,
    val contentDesc: String? = null,
    val className: String? = null,
    val activity: String? = null,
    val selected: Boolean? = null,
)

@Serializable
data class ScreenMatcher(
    val feature: String,
    val match: List<NodeMatch>,
    val action: String,
    val alternative: NodeMatch? = null,
    val hideNodes: List<NodeMatch> = emptyList(),
    val maxTested: String? = null,
)

@Serializable
data class CatalogApp(
    val id: String,
    val label: String,
    val features: List<SiteFeature>,
    val packages: List<String>,
    val screens: List<ScreenMatcher> = emptyList(),
)

@Serializable
data class Browser(
    val `package`: String,
    val label: String,
    val urlBarIds: List<String>,
    val extensionCapable: Boolean = false,
)

@Serializable
data class Guard(val id: String, val label: String, val packages: List<String>, val match: List<NodeMatch>)

@Serializable
data class AndroidCatalog(
    val apps: List<CatalogApp> = emptyList(),
    val browsers: List<Browser> = emptyList(),
    val guards: List<Guard> = emptyList(),
) {
    fun appFor(packageName: String) = apps.firstOrNull { packageName in it.packages }
    fun app(id: String) = apps.firstOrNull { it.id == id }
    fun browser(packageName: String) = browsers.firstOrNull { it.`package` == packageName }

    companion object {
        fun load(context: Context): AndroidCatalog =
            context.assets.open("android-catalog.json").bufferedReader().use { EngineJson.decodeFromString(it.readText()) }
    }
}
