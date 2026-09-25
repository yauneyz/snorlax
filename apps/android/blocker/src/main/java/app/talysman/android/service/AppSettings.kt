package app.talysman.android.service

import android.content.Context

/** Device-local preferences that aren't blocking policy (spec §6.6 Settings). */
class AppSettings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    /** Block browsers Talysman can't read addresses from while web rules are on [DEFAULT 4]. */
    var blockUnsupportedBrowsers: Boolean
        get() = prefs.getBoolean("blockUnsupportedBrowsers", true)
        set(value) = prefs.edit().putBoolean("blockUnsupportedBrowsers", value).apply()

    /** Show the first-run permission walkthrough. */
    var onboarded: Boolean
        get() = prefs.getBoolean("onboarded", false)
        set(value) = prefs.edit().putBoolean("onboarded", value).apply()
}
