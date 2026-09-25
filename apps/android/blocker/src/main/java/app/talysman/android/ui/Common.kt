package app.talysman.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.talysman.android.engine.ProfileStatus
import app.talysman.android.ui.theme.TalysmanPalette
import java.text.DateFormat
import java.util.Calendar
import java.util.Date

@Composable
fun ScreenColumn(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = TalysmanPalette.ForegroundStrong)
        content()
    }
}

@Composable
fun Muted(text: String) = Text(text, color = TalysmanPalette.ForegroundMuted, fontSize = 13.sp)

@Composable
fun Toggle(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(selected = selected, onClick = onClick, label = { Text(label) })
}

/** "9:30 AM" today, "Tue 9:30 AM" otherwise. */
fun formatClock(ms: Long, now: Long = System.currentTimeMillis()): String {
    val time = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(ms))
    val a = Calendar.getInstance().apply { timeInMillis = ms }
    val b = Calendar.getInstance().apply { timeInMillis = now }
    if (a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)) return time
    return "${android.text.format.DateFormat.format("EEE", a)} $time"
}

fun formatDuration(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    if (total < 60) return "$total s"
    val minutes = (total + 30) / 60
    if (minutes < 60) return "$minutes min"
    val h = minutes / 60
    val m = minutes % 60
    return if (m == 0L) "$h h" else "$h h $m min"
}

fun activationLabel(status: ProfileStatus): String {
    val a = status.activation
    return when {
        a.paused -> "paused"
        !a.active -> "off"
        a.lockedUntilMs != null -> "locked until ${formatClock(a.lockedUntilMs)}"
        a.windows.isNotEmpty() -> "scheduled until ${formatClock(a.windows.first().endMs)}"
        else -> "on"
    }
}
