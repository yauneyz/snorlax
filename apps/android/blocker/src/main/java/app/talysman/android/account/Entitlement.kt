package app.talysman.android.account

import android.content.Context
import app.talysman.android.BuildConfig

/**
 * The plan (spec §3.11, §6.9). The sideloaded build is always Pro without an account. The Play
 * build applies the Free limits (one profile) until account sign-in lands; the plan it would
 * fetch from `GET /api/app/entitlement` is cached here.
 */
class Entitlement(context: Context) {
    private val prefs = context.getSharedPreferences("entitlement", Context.MODE_PRIVATE)

    val source: String get() = BuildConfig.ENTITLEMENT_SOURCE

    val isPro: Boolean
        get() = source == "sideload" || prefs.getString("plan", "free") == "pro"

    /** Free keeps one profile (`FREE_PROFILE_LIMIT` in packages/product); Pro is unlimited. */
    fun maxProfiles(): Int? = if (isPro) null else FREE_PROFILE_LIMIT

    fun cachePlan(plan: String) {
        prefs.edit().putString("plan", plan).apply()
    }

    private companion object {
        const val FREE_PROFILE_LIMIT = 1
    }
}
