package app.talysman.android.apps

import android.content.Context
import android.content.Intent
import android.graphics.drawable.Drawable

data class InstalledApp(val packageName: String, val label: String, val icon: Drawable?)

/** Launcher-visible apps for the app pickers (spec §6.2 `apps/`). */
object InstalledApps {
    fun load(context: Context): List<InstalledApp> {
        val pm = context.packageManager
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(launcher, 0)
            .map { it.activityInfo.packageName }
            .distinct()
            .filter { it != context.packageName }
            .map { pkg ->
                val info = pm.getApplicationInfo(pkg, 0)
                InstalledApp(pkg, pm.getApplicationLabel(info).toString(), runCatching { pm.getApplicationIcon(pkg) }.getOrNull())
            }
            .sortedBy { it.label.lowercase() }
    }
}
