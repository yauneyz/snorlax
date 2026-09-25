package app.talysman.android.a11y

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.inputmethod.InputMethodManager
import android.widget.Toast
import app.talysman.android.TalysmanApp
import app.talysman.android.block.BlockActivity
import app.talysman.android.bridge.BridgeServer
import app.talysman.android.engine.ConfigEdits
import app.talysman.android.service.AppSettings

/**
 * The enforcer (spec §6.4): watches which app is in front and what the browser shows, asks the
 * engine, and acts — home + block screen for a hard-blocked app, back + block screen for a
 * blocked page, in-app soft blocks through [AppFeatureEngine], and backing out of the system
 * screens that could switch Talysman off while blocking is on ([Guard]s).
 *
 * It knows nothing about any specific app or site: packages, address bars, screens and guards are
 * all catalog data.
 */
class TalysmanAccessibilityService : AccessibilityService() {
    private lateinit var app: TalysmanApp
    private lateinit var settings: AppSettings
    private lateinit var features: AppFeatureEngine
    private val handler = Handler(Looper.getMainLooper())
    private var foreground: String? = null
    private var foregroundActivity: String? = null
    private var lastBlockedKey: String? = null
    private var lastBlockedAt = 0L
    private val alwaysAllowed = HashSet<String>()
    private var unsupportedBrowsers: Set<String> = emptySet()
    private val onEngineChange: () -> Unit = { handler.post { reevaluate() } }

    override fun onServiceConnected() {
        super.onServiceConnected()
        app = application as TalysmanApp
        settings = AppSettings(this)
        features = AppFeatureEngine(this)
        refreshSystemPackages()
        app.engine.addListener(onEngineChange)
        instance = this
    }

    override fun onDestroy() {
        if (::app.isInitialized) app.engine.removeListener(onEngineChange)
        instance = null
        super.onDestroy()
    }

    override fun onInterrupt() = Unit

    /**
     * Never blocked, whatever an allow-list says (spec §3.2): Talysman, the launcher, System UI,
     * the keyboard, the dialer and messaging defaults, and the package installer/Settings (the
     * latter two are guarded instead).
     */
    private fun refreshSystemPackages() {
        alwaysAllowed.clear()
        alwaysAllowed += listOf(packageName, "android", "com.android.systemui", "com.android.settings", "com.android.emergency")
        fun defaultFor(intent: Intent) = packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
        defaultFor(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))?.let(alwaysAllowed::add)
        defaultFor(Intent(Intent.ACTION_DIAL))?.let(alwaysAllowed::add)
        defaultFor(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:")))?.let(alwaysAllowed::add)
        getSystemService(InputMethodManager::class.java)?.enabledInputMethodList?.forEach { alwaysAllowed.add(it.packageName) }
        alwaysAllowed += listOf("com.google.android.packageinstaller", "com.android.packageinstaller", "com.google.android.permissioncontroller")
        // Apps that open arbitrary web links are browsers; the catalog names the ones we can read.
        val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://talysman-browser-probe.invalid/")).addCategory(Intent.CATEGORY_BROWSABLE)
        unsupportedBrowsers = packageManager.queryIntentActivities(probe, PackageManager.MATCH_ALL)
            .map { it.activityInfo.packageName }
            .filter { app.catalog.browser(it) == null }
            .toSet()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val pkg = event.packageName?.toString() ?: return
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                if (pkg != foreground) features.clear()
                foreground = pkg
                foregroundActivity = event.className?.toString()
                evaluate(pkg)
            }
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED, AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                if (pkg != foreground) return
                // Debounce bursts of content changes (scrolling feeds, typing in the URL bar).
                handler.removeCallbacks(contentCheck)
                handler.postDelayed(contentCheck, if (app.catalog.browser(pkg) != null) 300 else 150)
            }
        }
    }

    private val contentCheck = Runnable { foreground?.let(::evaluate) }

    private fun reevaluate() {
        foreground?.let(::evaluate)
    }

    private fun evaluate(pkg: String) {
        if (!::app.isInitialized) return
        if (guard(pkg)) return
        if (pkg in alwaysAllowed) return
        val browser = app.catalog.browser(pkg)
        if (browser != null) {
            evaluateBrowser(pkg, browser)
            return
        }
        if (pkg in unsupportedBrowsers && settings.blockUnsupportedBrowsers && webRulesActive()) {
            block("app:$pkg") { BlockActivity.forApp(this, pkg, label(pkg), unsupportedBrowser = true) }
            performGlobalAction(GLOBAL_ACTION_HOME)
            return
        }
        val decision = runCatching { app.engine.decideApp(pkg, label(pkg)) }.getOrNull() ?: return
        when (decision.verdict.kind) {
            "hard" -> {
                performGlobalAction(GLOBAL_ACTION_HOME)
                block("app:$pkg") { BlockActivity.forApp(this, pkg, label(pkg)) }
            }
            "soft" -> {
                val entry = app.catalog.appFor(pkg) ?: return
                val root = rootInActiveWindow ?: return
                if (features.apply(root, entry, decision.verdict.features, foregroundActivity) == AppFeatureEngine.Outcome.ESCALATE) {
                    performGlobalAction(GLOBAL_ACTION_HOME)
                    block("soft:$pkg") { BlockActivity.forApp(this, pkg, label(pkg)) }
                }
            }
            else -> features.clear()
        }
    }

    private fun evaluateBrowser(pkg: String, browser: Browser) {
        val root = rootInActiveWindow ?: return
        val node = browser.urlBarIds.asSequence().flatMap { root.findAccessibilityNodeInfosByViewId(it).asSequence() }.firstOrNull() ?: return
        // While the user is typing, the bar holds their input, not the page's address.
        if (node.isFocused) return
        val url = node.text?.toString()?.trim().orEmpty()
        if (url.isEmpty() || !url.contains('.')) return
        val extension = browser.extensionCapable && BridgeServer.connected(pkg)
        val decision = runCatching { app.engine.decideUrl(url, extension) }.getOrNull() ?: return
        if (decision.verdict.blocking) {
            performGlobalAction(GLOBAL_ACTION_BACK)
            block("url:$url") { BlockActivity.forUrl(this, url) }
        }
    }

    /** Back out of screens that could switch Talysman off while anything is blocked. */
    private fun guard(pkg: String): Boolean {
        if (!app.engine.anyActive()) return false
        val guards = app.catalog.guards.filter { pkg in it.packages }
        if (guards.isEmpty()) return false
        val root = rootInActiveWindow ?: return false
        val hit = guards.firstOrNull { NodeMatching.allPresent(root, it.match, foregroundActivity) } ?: return false
        performGlobalAction(GLOBAL_ACTION_BACK)
        Toast.makeText(this, "${hit.label} is protected while blocking is on", Toast.LENGTH_SHORT).show()
        return true
    }

    private fun webRulesActive(): Boolean = app.engine.snapshot.value.profiles.any { status ->
        status.activation.active && run {
            val config = status.profile.config
            ConfigEdits.blockedDomains(config).isNotEmpty() || ConfigEdits.defaultAction(config) != "allow" ||
                ConfigEdits.softRules(config).isNotEmpty() ||
                ConfigEdits.strings(ConfigEdits.policy(config), "enabledPremadeLists").isNotEmpty()
        }
    }

    /** Show the block screen once per blocked thing per couple of seconds. */
    private fun block(key: String, intent: () -> Intent) {
        val now = android.os.SystemClock.uptimeMillis()
        if (key == lastBlockedKey && now - lastBlockedAt < 2_000) return
        lastBlockedKey = key
        lastBlockedAt = now
        startActivity(intent().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun label(pkg: String): String = runCatching {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    }.getOrDefault(pkg)

    companion object {
        @Volatile
        var instance: TalysmanAccessibilityService? = null
            private set

        fun isEnabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            val me = ComponentName(context, TalysmanAccessibilityService::class.java).flattenToString()
            return enabled.split(':').any { it.equals(me, ignoreCase = true) }
        }
    }
}
