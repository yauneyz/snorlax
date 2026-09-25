package app.talysman.android.a11y

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.TextView
import app.talysman.android.ui.theme.TalysmanPalette
import androidx.compose.ui.graphics.toArgb

/**
 * In-app soft blocks (spec §7.2): for an app whose catalog entry has blocked features, find the
 * catalog's screen matchers for those features in the active window and act — back out, go home,
 * tap an alternative tab, or cover the region with a "Hidden by Talysman" card. Library and
 * messaging surfaces aren't matched, so they stay usable.
 *
 * Loop protection: at most one back/home/click per 700 ms, and a matcher that fires more than five
 * times in ten seconds escalates to the full block screen (the caller shows it).
 */
class AppFeatureEngine(private val service: AccessibilityService) {
    private val windowManager = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val overlays = HashMap<String, List<View>>()
    private var lastActionAt = 0L
    private val recentFires = ArrayDeque<Long>()

    enum class Outcome { NONE, ACTED, ESCALATE }

    /**
     * Apply the first matching screen for any blocked feature. `features` is the soft verdict's
     * feature → action map for `app`.
     */
    fun apply(root: AccessibilityNodeInfo, app: CatalogApp, features: Map<String, String>, activity: String?): Outcome {
        val blocked = features.filterValues { it == "block" }.keys
        val live = HashSet<String>()
        var outcome = Outcome.NONE
        for ((index, screen) in app.screens.withIndex()) {
            if (screen.feature !in blocked) continue
            if (!NodeMatching.allPresent(root, screen.match, activity)) continue
            val key = "${app.id}:$index"
            when (screen.action) {
                "overlay" -> {
                    live.add(key)
                    showOverlay(key, root, screen)
                    outcome = Outcome.ACTED
                }
                else -> {
                    val now = SystemClock.uptimeMillis()
                    if (now - lastActionAt < 700) return Outcome.ACTED
                    lastActionAt = now
                    recentFires.addLast(now)
                    while (recentFires.isNotEmpty() && now - recentFires.first() > 10_000) recentFires.removeFirst()
                    if (recentFires.size > 5) {
                        recentFires.clear()
                        return Outcome.ESCALATE
                    }
                    when (screen.action) {
                        "back" -> service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                        "home" -> service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
                        "clickAlternative" -> {
                            val target = screen.alternative?.let { NodeMatching.find(root, it, 1).firstOrNull() }
                            val clicked = target?.let(NodeMatching::clickable)?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
                            if (!clicked) service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                        }
                    }
                    return Outcome.ACTED
                }
            }
        }
        // Screens that no longer match lose their covers.
        (overlays.keys - live).forEach(::removeOverlay)
        return outcome
    }

    /** Leaving the app removes every cover. */
    fun clear() = overlays.keys.toList().forEach(::removeOverlay)

    private fun showOverlay(key: String, root: AccessibilityNodeInfo, screen: ScreenMatcher) {
        val rects: List<Rect> = if (screen.hideNodes.isEmpty()) {
            listOf(NodeMatching.bounds(root))
        } else {
            screen.hideNodes.flatMap { NodeMatching.find(root, it, 12) }.map(NodeMatching::bounds).filter { !it.isEmpty }
        }
        removeOverlay(key)
        overlays[key] = rects.map(::addCover)
    }

    private fun addCover(rect: Rect): View {
        val view = TextView(service).apply {
            text = "Hidden by Talysman"
            gravity = Gravity.CENTER
            setTextColor(TalysmanPalette.ForegroundMuted.toArgb())
            setBackgroundColor(TalysmanPalette.Background.toArgb())
            // Covers swallow touches: that's the point.
            isClickable = true
        }
        val params = WindowManager.LayoutParams(
            rect.width(),
            rect.height(),
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.OPAQUE,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = rect.left
            y = rect.top
        }
        runCatching { windowManager.addView(view, params) }
        return view
    }

    private fun removeOverlay(key: String) {
        overlays.remove(key)?.forEach { view -> runCatching { windowManager.removeView(view) } }
    }
}
