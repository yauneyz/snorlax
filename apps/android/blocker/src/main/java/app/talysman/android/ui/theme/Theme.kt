package app.talysman.android.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val TalysmanColorScheme = darkColorScheme(
    primary = TalysmanPalette.Signal,
    onPrimary = TalysmanPalette.SignalInk,
    background = TalysmanPalette.Background,
    onBackground = TalysmanPalette.Foreground,
    surface = TalysmanPalette.Panel,
    surfaceVariant = TalysmanPalette.PanelRaised,
    onSurface = TalysmanPalette.ForegroundStrong,
    onSurfaceVariant = TalysmanPalette.ForegroundMuted,
    outline = TalysmanPalette.Border,
    error = TalysmanPalette.Danger,
    onError = TalysmanPalette.White,
)

@Composable
fun TalysmanTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = TalysmanColorScheme, content = content)
}

/** Parse a profile colour ("#rrggbb"); anything else falls back to the brand colour. */
fun profileColor(hex: String): Color = runCatching {
    Color(android.graphics.Color.parseColor(hex))
}.getOrDefault(TalysmanPalette.Brand)

/** Monospaced small-caps section label — the desktop's "kicker". */
@Composable
fun Kicker(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        modifier = modifier,
        color = TalysmanPalette.ForegroundMuted,
        fontFamily = FontFamily.Monospace,
        fontSize = 10.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 1.6.sp,
    )
}

@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .background(TalysmanPalette.Panel, RoundedCornerShape(14.dp))
            .border(1.dp, TalysmanPalette.Border, RoundedCornerShape(14.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@Composable
fun ProfileDot(color: String, modifier: Modifier = Modifier) {
    androidx.compose.foundation.layout.Box(
        modifier
            .size(10.dp)
            .background(profileColor(color), RoundedCornerShape(2.dp)),
    )
}

@Composable
fun StreakBadge(days: Int, best: Int) {
    Row(
        Modifier
            .background(TalysmanPalette.Warning.copy(alpha = 0.10f), RoundedCornerShape(50))
            .border(1.dp, TalysmanPalette.Warning.copy(alpha = 0.3f), RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val bestText = if (best > days) " · best $best" else ""
        Text("🔥 $days-day streak$bestText", color = TalysmanPalette.Warning, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}
