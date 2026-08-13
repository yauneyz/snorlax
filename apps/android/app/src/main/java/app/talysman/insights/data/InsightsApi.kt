package app.talysman.insights.data

import app.talysman.insights.BuildConfig
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

class InsightsApiException(message: String, val httpCode: Int? = null) : Exception(message)

object InsightsApi {
    private val client = OkHttpClient.Builder().build()
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun fetchSummary(): InsightsSummary {
        val request = Request.Builder()
            .url("${BuildConfig.INSIGHTS_BASE_URL}/api/analytics/summary")
            .header("Authorization", "Bearer ${BuildConfig.INSIGHTS_API_KEY}")
            .get()
            .build()

        val body = await(request)
        return json.decodeFromString(InsightsSummary.serializer(), body)
    }

    private suspend fun await(request: Request): String = suspendCancellableCoroutine { cont ->
        val call = client.newCall(request)
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                cont.resumeWithException(InsightsApiException(e.message ?: "network error"))
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val text = it.body?.string().orEmpty()
                    if (!it.isSuccessful) {
                        cont.resumeWithException(InsightsApiException("HTTP ${it.code}", it.code))
                        return
                    }
                    cont.resume(text)
                }
            }
        })
    }
}
