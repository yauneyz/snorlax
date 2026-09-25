package app.talysman.android.keys

import android.graphics.Bitmap
import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.Tag
import android.nfc.tech.Ndef
import android.nfc.tech.NdefFormatable
import android.util.Base64
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.EncodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter

/**
 * NFC tags: a random secret in a Talysman MIME record when the tag is writable; otherwise the
 * tag's UID (weaker — UIDs can be cloned; the UI warns).
 */
object NfcKeys {
    const val MIME = "application/vnd.talysman.key"

    data class Read(val secret: ByteArray, val uidOnly: Boolean)

    /** What this tag presents as a key. */
    fun read(tag: Tag): Read {
        Ndef.get(tag)?.let { ndef ->
            runCatching {
                ndef.connect()
                val message = ndef.cachedNdefMessage ?: ndef.ndefMessage
                ndef.close()
                message?.records?.firstOrNull { it.tnf == NdefRecord.TNF_MIME_MEDIA && String(it.type) == MIME }
            }.getOrNull()?.let { return Read(it.payload, uidOnly = false) }
        }
        return Read(tag.id ?: ByteArray(0), uidOnly = true)
    }

    /** Write `secret` onto the tag. False when the tag can't hold it (fall back to its UID). */
    fun write(tag: Tag, secret: ByteArray): Boolean {
        val message = NdefMessage(arrayOf(NdefRecord.createMime(MIME, secret)))
        Ndef.get(tag)?.let { ndef ->
            return runCatching {
                ndef.connect()
                val ok = ndef.isWritable && ndef.maxSize >= message.byteArrayLength
                if (ok) ndef.writeNdefMessage(message)
                ndef.close()
                ok
            }.getOrDefault(false)
        }
        NdefFormatable.get(tag)?.let { formatable ->
            return runCatching {
                formatable.connect()
                formatable.format(message)
                formatable.close()
                true
            }.getOrDefault(false)
        }
        return false
    }
}

/** Printed / saved QR codes: `talysman-key:v1:<base64url secret>`. */
object QrKeys {
    private const val PREFIX = "talysman-key:v1:"

    fun encode(secret: ByteArray): String =
        PREFIX + Base64.encodeToString(secret, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    fun decode(text: String): ByteArray? {
        if (!text.startsWith(PREFIX)) return null
        return runCatching { Base64.decode(text.removePrefix(PREFIX), Base64.URL_SAFE) }.getOrNull()
    }

    fun bitmap(payload: String, size: Int = 720): Bitmap {
        val matrix = QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 2))
        val pixels = IntArray(size * size) { i -> if (matrix[i % size, i / size]) 0xFF000000.toInt() else 0xFFFFFFFF.toInt() }
        return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
    }

    private val reader = QRCodeReader()

    /** Decode a QR from a camera frame's luminance plane, or null. */
    fun scan(luminance: ByteArray, width: Int, height: Int): String? = runCatching {
        val source = PlanarYUVLuminanceSource(luminance, width, height, 0, 0, width, height, false)
        reader.decode(BinaryBitmap(HybridBinarizer(source))).text
    }.getOrNull().also { reader.reset() }
}
