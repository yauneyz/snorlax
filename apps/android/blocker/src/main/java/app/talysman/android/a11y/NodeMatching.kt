package app.talysman.android.a11y

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Matching catalog [NodeMatch]es against the active window's node tree. The walk is bounded so a
 * huge feed can't stall the service.
 */
object NodeMatching {
    private const val MAX_NODES = 2500
    private val regexCache = HashMap<String, Regex>()

    private fun regex(pattern: String): Regex = regexCache.getOrPut(pattern) {
        val insensitive = pattern.startsWith("(?i)")
        val body = if (insensitive) pattern.removePrefix("(?i)") else pattern
        if (insensitive) Regex(body, RegexOption.IGNORE_CASE) else Regex(body)
    }

    fun matches(node: AccessibilityNodeInfo, match: NodeMatch): Boolean {
        match.viewId?.let { if (node.viewIdResourceName != it) return false }
        match.className?.let { if (node.className?.toString() != it) return false }
        match.selected?.let { if (node.isSelected != it) return false }
        match.text?.let { if (!regex(it).containsMatchIn(node.text?.toString() ?: "")) return false }
        match.contentDesc?.let { if (!regex(it).containsMatchIn(node.contentDescription?.toString() ?: "")) return false }
        return true
    }

    /** Every node under `root` matching `match` (activity is checked by the caller). */
    fun find(root: AccessibilityNodeInfo, match: NodeMatch, limit: Int = 8): List<AccessibilityNodeInfo> {
        val onlyId = match.viewId != null && match.text == null && match.contentDesc == null && match.className == null && match.selected == null
        if (onlyId) return root.findAccessibilityNodeInfosByViewId(match.viewId!!).take(limit)
        val out = ArrayList<AccessibilityNodeInfo>()
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        var seen = 0
        while (queue.isNotEmpty() && seen < MAX_NODES && out.size < limit) {
            val node = queue.removeFirst()
            seen++
            if (matches(node, match)) out.add(node)
            for (i in 0 until node.childCount) node.getChild(i)?.let(queue::add)
        }
        return out
    }

    fun present(root: AccessibilityNodeInfo, match: NodeMatch, activity: String?): Boolean {
        match.activity?.let { if (activity == null || !activity.endsWith(it)) return false }
        val nodeFields = match.copy(activity = null)
        if (nodeFields == NodeMatch()) return true
        return find(root, nodeFields, limit = 1).isNotEmpty()
    }

    fun allPresent(root: AccessibilityNodeInfo, matches: List<NodeMatch>, activity: String?): Boolean =
        matches.all { present(root, it, activity) }

    fun bounds(node: AccessibilityNodeInfo): Rect = Rect().also(node::getBoundsInScreen)

    /** The node itself if clickable, else its nearest clickable ancestor. */
    fun clickable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        var depth = 0
        while (current != null && depth < 8) {
            if (current.isClickable) return current
            current = current.parent
            depth++
        }
        return null
    }
}
