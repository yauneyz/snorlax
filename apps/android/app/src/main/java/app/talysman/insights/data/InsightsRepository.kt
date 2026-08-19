package app.talysman.insights.data

import android.content.Context
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

class InsightsRepository(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private val errorListSerializer = ListSerializer(ErrorReport.serializer())

    fun cached(): InsightsSummary? {
        val raw = prefs.getString(KEY_JSON, null) ?: return null
        return runCatching { json.decodeFromString(InsightsSummary.serializer(), raw) }.getOrNull()
    }

    fun cachedErrors(): List<ErrorReport>? {
        val raw = prefs.getString(KEY_ERRORS_JSON, null) ?: return null
        return runCatching { json.decodeFromString(errorListSerializer, raw) }.getOrNull()
    }

    suspend fun refresh(): Result<InsightsSummary> =
        runCatching { InsightsApi.fetchSummary() }.onSuccess { summary ->
            prefs.edit()
                .putString(KEY_JSON, json.encodeToString(InsightsSummary.serializer(), summary))
                .apply()
        }

    suspend fun refreshErrors(): Result<List<ErrorReport>> =
        runCatching { InsightsApi.fetchErrors() }.onSuccess { errors ->
            prefs.edit()
                .putString(KEY_ERRORS_JSON, json.encodeToString(errorListSerializer, errors))
                .apply()
        }

    companion object {
        private const val PREFS_NAME = "insights_cache"
        private const val KEY_JSON = "summary_json"
        private const val KEY_ERRORS_JSON = "errors_json"
    }
}
