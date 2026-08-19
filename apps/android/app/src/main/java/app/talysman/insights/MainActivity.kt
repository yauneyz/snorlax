package app.talysman.insights

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import app.talysman.insights.notifications.PushNotifications
import app.talysman.insights.ui.ErrorsScreen
import app.talysman.insights.ui.InsightsScreen

class MainActivity : ComponentActivity() {
    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        PushNotifications.registerCurrentToken(this)
        enableEdgeToEdge()
        val initialTab = mutableStateOf(if (intent.getBooleanExtra(EXTRA_OPEN_ERRORS, false)) Tab.ERRORS else Tab.DASHBOARD)
        tabState = initialTab
        setContent {
            MaterialTheme {
                var tab by initialTab
                Column(Modifier.fillMaxSize()) {
                    TabRow(selectedTabIndex = tab.ordinal) {
                        Tab(
                            selected = tab == Tab.DASHBOARD,
                            onClick = { tab = Tab.DASHBOARD },
                            text = { androidx.compose.material3.Text("Dashboard") },
                        )
                        Tab(
                            selected = tab == Tab.ERRORS,
                            onClick = { tab = Tab.ERRORS },
                            text = { androidx.compose.material3.Text("Errors") },
                        )
                    }
                    when (tab) {
                        Tab.DASHBOARD -> InsightsScreen()
                        Tab.ERRORS -> ErrorsScreen()
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_OPEN_ERRORS, false)) {
            tabState?.value = Tab.ERRORS
        }
    }

    private enum class Tab { DASHBOARD, ERRORS }

    companion object {
        const val EXTRA_OPEN_ERRORS = "open_errors"
        private var tabState: androidx.compose.runtime.MutableState<Tab>? = null
    }
}
