package app.talysman.android.keys

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.talysman.android.TalysmanApp
import app.talysman.android.engine.Commands
import app.talysman.android.engine.EngineRefusal
import app.talysman.android.ui.theme.TalysmanPalette
import app.talysman.android.ui.theme.TalysmanTheme

/**
 * Verifies a paired key for one key-gated action, or pairs a new key (spec §3.3, §6.5).
 *
 * VERIFY: tap a paired NFC tag or scan a paired QR code; the result carries the key id, which the
 * caller passes to [app.talysman.android.engine.EngineHost.apply] as proof. Not exported — no
 * other app can hand us a verified key.
 *
 * PAIR_NFC / PAIR_QR: pairing while blocking is on needs an already-verified key (`authKeyId`);
 * the engine's `pairKey` gate decides.
 */
class KeyActivity : ComponentActivity() {
    private var nfc: NfcAdapter? = null
    private var onTag: ((Tag) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        nfc = NfcAdapter.getDefaultAdapter(this)
        val mode = intent.getStringExtra(EXTRA_MODE) ?: MODE_VERIFY
        val authKeyId = intent.getStringExtra(EXTRA_AUTH_KEY_ID)
        val app = application as TalysmanApp
        setContent {
            TalysmanTheme {
                var status by remember { mutableStateOf<String?>(null) }
                var scanning by remember { mutableStateOf(false) }
                var label by remember { mutableStateOf(if (mode == MODE_PAIR_QR) "QR key" else "NFC key") }
                var qrSecret by remember { mutableStateOf<ByteArray?>(null) }

                fun pair(secret: ByteArray, kind: String, uidOnly: Boolean) {
                    try {
                        app.engine.apply(Commands.pairKey(), authKeyId)
                        app.keys.add(label.ifBlank { "Key" }, kind, secret, uidOnly)
                        setResult(Activity.RESULT_OK)
                        finish()
                    } catch (e: EngineRefusal) {
                        status = e.message
                    }
                }

                fun verified(secret: ByteArray) {
                    val key = app.keys.verify(secret)
                    if (key == null) {
                        status = "That isn’t one of your paired keys."
                    } else {
                        setResult(Activity.RESULT_OK, Intent().putExtra(RESULT_KEY_ID, key.id))
                        finish()
                    }
                }

                onTag = { tag ->
                    when (mode) {
                        MODE_VERIFY -> verified(NfcKeys.read(tag).secret)
                        MODE_PAIR_NFC -> {
                            val secret = app.keys.newSecret()
                            if (NfcKeys.write(tag, secret)) {
                                pair(secret, "nfc", uidOnly = false)
                            } else {
                                val read = NfcKeys.read(tag)
                                if (read.secret.isEmpty()) status = "Couldn’t read that tag." else pair(read.secret, "nfc", read.uidOnly)
                            }
                        }
                    }
                }

                Column(
                    Modifier.fillMaxSize().padding(24.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    val title = when (mode) {
                        MODE_PAIR_NFC -> "Pair an NFC tag"
                        MODE_PAIR_QR -> "Make a QR key"
                        else -> "Verify your key"
                    }
                    Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = TalysmanPalette.ForegroundStrong)
                    if (mode != MODE_VERIFY) {
                        OutlinedTextField(label, { label = it }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
                    }
                    when (mode) {
                        MODE_VERIFY -> {
                            Text(
                                if (nfc?.isEnabled == true) "Hold a paired NFC tag to the back of your phone, or scan your QR key."
                                else "Scan your QR key. (Turn on NFC to use a tag.)",
                                color = TalysmanPalette.Foreground,
                            )
                            if (scanning) {
                                QrScanner(onScanned = { text ->
                                    val secret = QrKeys.decode(text)
                                    if (secret == null) status = "That isn’t a Talysman key." else verified(secret)
                                })
                            } else {
                                Button(onClick = { scanning = true }) { Text("Scan QR key") }
                            }
                        }
                        MODE_PAIR_NFC -> Text(
                            "Hold a blank or rewritable NFC tag to the back of your phone. Talysman writes a random secret to it. " +
                                "Tags that can’t be written are identified by their serial number, which can be copied — prefer writable tags.",
                            color = TalysmanPalette.Foreground,
                        )
                        MODE_PAIR_QR -> {
                            val secret = qrSecret ?: app.keys.newSecret().also { qrSecret = it }
                            val payload = QrKeys.encode(secret)
                            val bitmap = remember(payload) { QrKeys.bitmap(payload) }
                            Text(
                                "Print this or save it somewhere away from your phone — anyone with it can unlock Talysman. " +
                                    "Once you’ve kept a copy, finish pairing.",
                                color = TalysmanPalette.Foreground,
                            )
                            Image(bitmap.asImageBitmap(), contentDescription = "QR key", modifier = Modifier.fillMaxWidth())
                            if (Build.VERSION.SDK_INT >= 29) {
                                OutlinedButton(onClick = {
                                    status = if (saveToPictures(this@KeyActivity, bitmap, label)) "Saved to Pictures." else "Couldn’t save the image."
                                }) { Text("Save image") }
                            }
                            Button(onClick = { pair(secret, "qr", uidOnly = false) }) { Text("I’ve kept a copy — pair it") }
                        }
                    }
                    status?.let { Text(it, color = TalysmanPalette.Warning) }
                    OutlinedButton(onClick = { finish() }) { Text("Cancel") }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        nfc?.enableReaderMode(
            this,
            { tag -> runOnUiThread { onTag?.invoke(tag) } },
            NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_NFC_F or
                NfcAdapter.FLAG_READER_NFC_V or NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
            null,
        )
    }

    override fun onPause() {
        nfc?.disableReaderMode(this)
        super.onPause()
    }

    companion object {
        const val EXTRA_MODE = "mode"
        const val EXTRA_AUTH_KEY_ID = "authKeyId"
        const val RESULT_KEY_ID = "keyId"
        const val MODE_VERIFY = "verify"
        const val MODE_PAIR_NFC = "pairNfc"
        const val MODE_PAIR_QR = "pairQr"

        fun intent(context: Context, mode: String, authKeyId: String? = null) =
            Intent(context, KeyActivity::class.java).putExtra(EXTRA_MODE, mode).putExtra(EXTRA_AUTH_KEY_ID, authKeyId)

        private fun saveToPictures(context: Context, bitmap: android.graphics.Bitmap, label: String): Boolean = runCatching {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, "Talysman key - $label.png")
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            }
            val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
            context.contentResolver.openOutputStream(uri)?.use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            true
        }.getOrDefault(false)
    }
}
