package app.talysman.android.keys

import android.content.Context
import app.talysman.android.engine.EngineJson
import java.io.File
import java.security.SecureRandom
import kotlinx.serialization.Serializable
import uniffi.talysman_engine_ffi.hashKeySecret
import uniffi.talysman_engine_ffi.verifyKeySecret

/**
 * Paired keys (spec §3.3): NFC tags and printed QR codes. Only salted hashes are stored
 * (`SaltedHash` from the engine's pairing module — the same code the desktop uses); the secret
 * itself lives on the tag or the printout. UID-only NFC tags are weaker (UIDs can be cloned) and
 * the UI says so.
 */
@Serializable
data class PairedKey(
    val id: String,
    val label: String,
    /** "nfc" | "qr" */
    val kind: String,
    /** NFC tag that couldn't hold a secret: identified by its UID alone. */
    val uidOnly: Boolean = false,
    val pairedAt: Long,
    /** `SaltedHash` JSON. */
    val hash: String,
)

@Serializable
private data class KeyFile(val keys: List<PairedKey> = emptyList())

class KeyRepository(context: Context) {
    private val file = File(context.filesDir, "paired-keys.json")
    private val random = SecureRandom()

    @Volatile
    private var keys: List<PairedKey> = load()

    private fun load(): List<PairedKey> =
        if (file.exists()) runCatching { EngineJson.decodeFromString<KeyFile>(file.readText()).keys }.getOrDefault(emptyList()) else emptyList()

    private fun save() {
        val tmp = File(file.parentFile, "paired-keys.json.tmp")
        tmp.writeText(EngineJson.encodeToString(KeyFile.serializer(), KeyFile(keys)))
        tmp.renameTo(file)
    }

    fun all(): List<PairedKey> = keys
    fun hasKeys(): Boolean = keys.isNotEmpty()

    fun newSecret(): ByteArray = ByteArray(SECRET_BYTES).also(random::nextBytes)

    /** Store a new key's hash. The caller has already passed the engine's `pairKey` gate. */
    @Synchronized
    fun add(label: String, kind: String, secret: ByteArray, uidOnly: Boolean): PairedKey {
        val salt = ByteArray(SALT_BYTES).also(random::nextBytes)
        val key = PairedKey(
            id = "key-" + java.util.UUID.randomUUID().toString().take(8),
            label = label,
            kind = kind,
            uidOnly = uidOnly,
            pairedAt = System.currentTimeMillis(),
            hash = hashKeySecret(secret, salt),
        )
        keys = keys + key
        save()
        return key
    }

    /** The paired key this secret belongs to, if any. */
    fun verify(secret: ByteArray): PairedKey? = keys.firstOrNull { verifyKeySecret(secret, it.hash) }

    @Synchronized
    fun remove(id: String) {
        keys = keys.filterNot { it.id == id }
        save()
    }

    companion object {
        const val SECRET_BYTES = 32
        const val SALT_BYTES = 16
    }
}
