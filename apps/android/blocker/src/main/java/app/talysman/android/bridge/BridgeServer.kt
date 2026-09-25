package app.talysman.android.bridge

import android.content.Context
import android.os.SystemClock
import android.util.Log
import app.talysman.android.TalysmanApp
import app.talysman.android.engine.EngineJson
import app.talysman.android.engine.EngineRefusal
import app.talysman.android.engine.PopupInfo
import java.net.InetSocketAddress
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import uniffi.talysman_engine_ffi.relayRequest
import uniffi.talysman_engine_ffi.relayResponseFrame

/**
 * The Firefox extension bridge (spec §6.8). Firefox for Android can't use native messaging, so
 * the Talysman extension connects to this loopback WebSocket instead and speaks the same frames:
 * it says `hello` (with the pairing code the user typed from Talysman's settings), receives
 * `state` frames built by the same Rust code as the desktop hosts, sends heartbeats, and relays
 * the blocked page's popup requests through the same allowlist.
 *
 * While a paired Firefox is connected, the accessibility service leaves soft rules to the
 * extension; if the connection goes quiet, Firefox is treated like any extension-less browser.
 */
object BridgeServer {
    const val PORT = 47623
    private const val TAG = "BridgeServer"
    private const val STALE_MS = 2 * 60_000L

    private var server: WebSocketServer? = null
    private val hellos = ConcurrentHashMap<WebSocket, String>()
    @Volatile private var lastSeen = 0L

    /** Whether a paired extension is live. (There's one Firefox; `pkg` is for future browsers.) */
    fun connected(@Suppress("UNUSED_PARAMETER") pkg: String): Boolean =
        hellos.isNotEmpty() && SystemClock.elapsedRealtime() - lastSeen < STALE_MS

    fun pairingCode(context: Context): String {
        val prefs = context.getSharedPreferences("bridge", Context.MODE_PRIVATE)
        prefs.getString("code", null)?.let { return it }
        val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        val random = SecureRandom()
        val code = (1..8).map { alphabet[random.nextInt(alphabet.length)] }.joinToString("")
        prefs.edit().putString("code", code).apply()
        return code
    }

    fun resetPairing(context: Context) {
        context.getSharedPreferences("bridge", Context.MODE_PRIVATE).edit().remove("code").apply()
        hellos.keys.forEach { it.close() }
    }

    @Synchronized
    fun start(app: TalysmanApp) {
        if (server != null) return
        val code = pairingCode(app)
        val s = object : WebSocketServer(InetSocketAddress("127.0.0.1", PORT)) {
            override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
                val origin = handshake.getFieldValue("Origin").orEmpty()
                if (!origin.startsWith("moz-extension://")) conn.close(1008, "origin")
            }

            override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
                hellos.remove(conn)
            }

            override fun onMessage(conn: WebSocket, message: String) {
                val frame = runCatching { EngineJson.parseToJsonElement(message).jsonObject }.getOrNull() ?: return
                when (frame["type"]?.jsonPrimitive?.content) {
                    "hello" -> {
                        if (frame["pairingCode"]?.jsonPrimitive?.content != code) {
                            conn.close(1008, "pairing")
                            return
                        }
                        hellos[conn] = message
                        lastSeen = SystemClock.elapsedRealtime()
                        sendState(app, conn)
                    }
                    "heartbeat" -> {
                        if (!hellos.containsKey(conn)) return
                        lastSeen = SystemClock.elapsedRealtime()
                        conn.send(buildJsonObject {
                            put("type", "heartbeatAck")
                            frame["sequence"]?.let { put("sequence", it) }
                            put("healthy", true)
                        }.toString())
                    }
                    "service-request" -> if (hellos.containsKey(conn)) relay(app, conn, message)
                }
            }

            override fun onError(conn: WebSocket?, ex: Exception) {
                Log.w(TAG, "bridge error", ex)
            }

            override fun onStart() = Unit
        }
        s.isReuseAddr = true
        runCatching { s.start() }.onFailure { Log.e(TAG, "bridge failed to start", it) }
        server = s
        app.engine.addListener { hellos.keys.forEach { sendState(app, it) } }
    }

    private fun sendState(app: TalysmanApp, conn: WebSocket) {
        val hello = hellos[conn] ?: return
        runCatching { conn.send(app.engine.extensionStateFrame(hello)) }
    }

    private fun relay(app: TalysmanApp, conn: WebSocket, message: String) {
        val request = relayRequest(message)?.let { EngineJson.parseToJsonElement(it).jsonObject }
        val requestId = request?.get("requestId") ?: EngineJson.parseToJsonElement(message).jsonObject["requestId"]
        val response: JsonObject = if (request == null) {
            buildJsonObject {
                put("ok", false)
                put("code", "BAD_REQUEST")
                put("message", "The extension may not make that request.")
            }
        } else {
            try {
                val params = request["params"]!!.jsonObject
                val result = when (request["method"]!!.jsonPrimitive.content) {
                    "getPopupInfo" -> EngineJson.parseToJsonElement(
                        EngineJson.encodeToString(
                            PopupInfo.serializer(),
                            app.engine.popupInfoForUrl(params["target"]!!.jsonObject["url"]!!.jsonPrimitive.content),
                        ),
                    )
                    else -> {
                        app.engine.apply(params["command"]!!.jsonObject)
                        buildJsonObject { put("ok", true) }
                    }
                }
                buildJsonObject {
                    put("ok", true)
                    put("result", result)
                }
            } catch (e: EngineRefusal) {
                buildJsonObject {
                    put("ok", false)
                    put("code", e.code)
                    put("message", e.message ?: e.code)
                }
            }
        }
        conn.send(relayResponseFrame(requestId.toString(), response.toString()))
    }
}
