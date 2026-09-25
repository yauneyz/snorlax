package app.talysman.android.block

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.talysman.android.TalysmanApp
import app.talysman.android.engine.Commands
import app.talysman.android.engine.EngineRefusal
import app.talysman.android.engine.PoolRef
import app.talysman.android.engine.PopupInfo
import app.talysman.android.ui.MainActivity
import app.talysman.android.ui.theme.ProfileDot
import app.talysman.android.ui.theme.StreakBadge
import app.talysman.android.ui.theme.TalysmanPalette
import app.talysman.android.ui.theme.TalysmanTheme
import kotlinx.coroutines.delay

/**
 * The block / unlock screen (spec §3.10) over a blocked app or page: who's blocking it, the
 * streak, the item's pool with what's left today, the pause (countdown or breathing) before an
 * unlock, and "Other options" into the key-gated overrides. Unlocking relaunches the app (or
 * reopens the page).
 */
class BlockActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        render()
    }

    private fun render() {
        val app = application as TalysmanApp
        val pkg = intent.getStringExtra(EXTRA_PACKAGE)
        val label = intent.getStringExtra(EXTRA_LABEL) ?: pkg ?: ""
        val url = intent.getStringExtra(EXTRA_URL)
        val unsupportedBrowser = intent.getBooleanExtra(EXTRA_UNSUPPORTED_BROWSER, false)
        fun load(): PopupInfo? = runCatching {
            if (url != null) app.engine.popupInfoForUrl(url) else app.engine.popupInfoForApp(pkg!!, label)
        }.getOrNull()
        setContent {
            TalysmanTheme {
                var info by remember { mutableStateOf(load()) }
                var error by remember { mutableStateOf<String?>(null) }
                var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
                LaunchedEffect(Unit) {
                    while (true) {
                        delay(250)
                        now = System.currentTimeMillis()
                    }
                }

                fun unlocked() {
                    val intent = when {
                        url != null -> Intent(Intent.ACTION_VIEW, Uri.parse(if (url.contains("://")) url else "https://$url"))
                        pkg != null -> packageManager.getLaunchIntentForPackage(pkg)
                        else -> null
                    }
                    intent?.let { runCatching { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
                    finish()
                }

                fun run(confirm: Boolean) {
                    val current = info ?: return
                    val refs = current.pools.map { PoolRef(it.profileId, it.poolId) }
                    try {
                        app.engine.apply(if (confirm) Commands.confirmPoolUnlock(refs) else Commands.requestPoolUnlock(refs))
                        val next = load()
                        info = next
                        if (next != null && (!next.verdict.blocking && next.verdict.kind != "soft" || next.pools.any { (it.activeUntilMs ?: 0) > System.currentTimeMillis() })) {
                            unlocked()
                        }
                    } catch (e: EngineRefusal) {
                        error = e.message
                    }
                }

                BlockScreen(
                    info = info,
                    title = label.ifBlank { url ?: "" },
                    unsupportedBrowser = unsupportedBrowser,
                    now = now,
                    error = error,
                    onUnlock = { run(confirm = info?.pending != null) },
                    onNotNow = {
                        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        finish()
                    },
                    onOtherOptions = {
                        startActivity(Intent(this, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_OVERRIDES, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        finish()
                    },
                )
            }
        }
    }

    @Deprecated("Back goes home, never into the blocked app.")
    override fun onBackPressed() {
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    companion object {
        private const val EXTRA_PACKAGE = "package"
        private const val EXTRA_LABEL = "label"
        private const val EXTRA_URL = "url"
        private const val EXTRA_UNSUPPORTED_BROWSER = "unsupportedBrowser"

        fun forApp(context: Context, pkg: String, label: String, unsupportedBrowser: Boolean = false) =
            Intent(context, BlockActivity::class.java)
                .putExtra(EXTRA_PACKAGE, pkg)
                .putExtra(EXTRA_LABEL, label)
                .putExtra(EXTRA_UNSUPPORTED_BROWSER, unsupportedBrowser)

        fun forUrl(context: Context, url: String) = Intent(context, BlockActivity::class.java).putExtra(EXTRA_URL, url)
    }
}

@Composable
private fun BlockScreen(
    info: PopupInfo?,
    title: String,
    unsupportedBrowser: Boolean,
    now: Long,
    error: String?,
    onUnlock: () -> Unit,
    onNotNow: () -> Unit,
    onOtherOptions: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(TalysmanPalette.Background).padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(title, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = TalysmanPalette.ForegroundStrong)
        if (unsupportedBrowser) {
            Text(
                "Talysman can’t see which sites this browser opens, so it’s blocked while your web rules are on. " +
                    "Use a supported browser, or change this in Talysman’s settings.",
                color = TalysmanPalette.Foreground,
            )
        }
        if (info == null) {
            Text("Blocked by Talysman", color = TalysmanPalette.Foreground)
        } else {
            if (info.blockingProfiles.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Blocked by", color = TalysmanPalette.ForegroundMuted)
                    info.blockingProfiles.forEach { profile ->
                        Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
                            ProfileDot(profile.color)
                            Text(profile.name, color = TalysmanPalette.ForegroundStrong)
                        }
                    }
                }
            }
            if (info.verdict.kind == "pageBlocked" && info.verdict.feature != null) {
                Text("This part of the site is hidden: ${info.verdict.feature}.", color = TalysmanPalette.Foreground)
            }
            StreakBadge(info.streak.currentDays, info.streak.bestDays)
            if (info.pools.isEmpty()) {
                Text("This isn’t in an unlock pool.", color = TalysmanPalette.ForegroundMuted)
            } else {
                val left = info.pools.minOf { it.leftToday }
                val perDay = info.pools.minOf { it.unlocksPerDay }
                val minutes = info.pools.maxOf { it.unlockMinutes }
                Text(
                    "${info.pools.joinToString(" + ") { it.name }} · $left of $perDay unlocks left today",
                    color = TalysmanPalette.ForegroundStrong,
                    fontWeight = FontWeight.SemiBold,
                )
                Text("Each unlock: $minutes minutes", color = TalysmanPalette.ForegroundMuted)
                if (info.unpooledProfiles.isNotEmpty()) {
                    Text("Another profile blocks this with no unlocks.", color = TalysmanPalette.Warning)
                } else if (left == 0) {
                    Text("Resets at midnight.", color = TalysmanPalette.Warning)
                }
                val pending = info.pending
                val remaining = if (pending != null) ((pending.readyMs - now + 999) / 1000).coerceAtLeast(0) else 0
                if (pending != null && remaining > 0) {
                    Pause(remaining.toInt(), breathing = info.friction.kind == "breathing")
                }
                if (info.unlockAvailable) {
                    Button(onClick = onUnlock, enabled = pending == null || remaining == 0L, modifier = Modifier.fillMaxWidth()) {
                        Text(if (pending != null && remaining > 0) "Unlock in $remaining s" else "Unlock for $minutes min")
                    }
                }
            }
        }
        error?.let { Text(it, color = TalysmanPalette.Danger) }
        OutlinedButton(onClick = onNotNow, modifier = Modifier.fillMaxWidth()) { Text("Not now") }
        TextButton(onClick = onOtherOptions) {
            Text("Other options (${info?.emergencyLeft ?: 5} emergency unlocks left)", color = TalysmanPalette.ForegroundMuted)
        }
    }
}

@Composable
private fun Pause(seconds: Int, breathing: Boolean) {
    val transition = rememberInfiniteTransition(label = "breathe")
    val scale by transition.animateFloat(
        initialValue = 0.82f,
        targetValue = if (breathing) 1.12f else 0.82f,
        animationSpec = infiniteRepeatable(tween(4000), RepeatMode.Reverse),
        label = "scale",
    )
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.size(110.dp).scale(scale).background(TalysmanPalette.Signal.copy(alpha = 0.12f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text("$seconds", fontSize = 26.sp, color = TalysmanPalette.ForegroundStrong)
        }
        Text(if (breathing) "Breathe in… and out." else "Take a moment.", color = TalysmanPalette.ForegroundMuted)
    }
}
