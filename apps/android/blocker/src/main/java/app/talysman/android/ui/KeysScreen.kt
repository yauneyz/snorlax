package app.talysman.android.ui

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.talysman.android.TalysmanApp
import app.talysman.android.engine.Commands
import app.talysman.android.engine.EngineSnapshot
import app.talysman.android.keys.KeyActivity
import app.talysman.android.ui.theme.Panel
import app.talysman.android.ui.theme.TalysmanPalette

/**
 * Keys (spec §3.3): NFC tags and printed QR codes. Pairing is free until something is blocking;
 * then an existing key must be verified first, so a spare tag can't be used to switch off. The
 * last key can't be removed; removing any key needs a key.
 */
@Composable
fun KeysScreen(app: TalysmanApp, snapshot: EngineSnapshot) {
    val context = LocalContext.current
    val runner = LocalKeyRunner.current
    var version by remember { mutableIntStateOf(0) }
    var pairMode by remember { mutableStateOf(KeyActivity.MODE_PAIR_NFC) }
    var message by remember { mutableStateOf<String?>(null) }
    val keys = remember(version, snapshot.generation) { app.keys.all() }

    val pair = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        version++
        app.engine.refreshSnapshot()
    }
    val verifyThenPair = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val keyId = result.data?.getStringExtra(KeyActivity.RESULT_KEY_ID)
        if (result.resultCode == Activity.RESULT_OK && keyId != null) pair.launch(KeyActivity.intent(context, pairMode, keyId))
    }
    fun startPairing(mode: String) {
        pairMode = mode
        val gate = app.engine.gate(Commands.pairKey())
        if (gate.kind == "needsKey") {
            message = "Blocking is on: verify a key you already paired first."
            verifyThenPair.launch(KeyActivity.intent(context, KeyActivity.MODE_VERIFY))
        } else {
            pair.launch(KeyActivity.intent(context, mode))
        }
    }

    ScreenColumn("Keys") {
        Muted("Turning blocking off, loosening a profile, or removing a key needs one of these. Keep them somewhere inconvenient.")
        keys.forEach { key ->
            Panel {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(key.label, color = TalysmanPalette.ForegroundStrong)
                        Muted(
                            (if (key.kind == "nfc") "NFC tag" else "QR code") +
                                if (key.uidOnly) " · identified by serial number (can be copied)" else "",
                        )
                    }
                    TextButton(
                        enabled = keys.size > 1,
                        onClick = {
                            runner.run(Commands.unpairKey()) {
                                app.keys.remove(key.id)
                                version++
                            }
                        },
                    ) { Text("Remove") }
                }
            }
        }
        if (keys.size == 1) Muted("Pair another key before removing your last one.")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = { startPairing(KeyActivity.MODE_PAIR_NFC) }) { Text("Pair NFC tag") }
            OutlinedButton(onClick = { startPairing(KeyActivity.MODE_PAIR_QR) }) { Text("Make QR key") }
        }
        message?.let { Muted(it) }
        Muted("Lost every key? An emergency unlock turns everything off; then you can pair a new one.")
        Muted("${snapshot.emergencyLeft} emergency unlocks left")
    }
}
