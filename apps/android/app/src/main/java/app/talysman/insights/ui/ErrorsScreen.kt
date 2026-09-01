package app.talysman.insights.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import app.talysman.insights.data.ErrorReport

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ErrorsScreen(viewModel: ErrorsViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        containerColor = TalysmanPalette.Background,
        topBar = {
            TopAppBar(
                title = { Text("Errors", color = TalysmanPalette.ForegroundStrong, fontWeight = FontWeight.Bold) },
                colors = androidx.compose.material3.TopAppBarDefaults.topAppBarColors(containerColor = TalysmanPalette.Background),
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = state.isRefreshing,
            onRefresh = { viewModel.refresh() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            val errors = state.errors
            when {
                state.error != null && errors.isNullOrEmpty() -> Column(
                    Modifier.fillMaxWidth().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) { Text(state.error ?: "Failed to load", color = TalysmanPalette.DangerInk, fontSize = 13.sp) }

                errors == null -> Column(
                    Modifier.fillMaxSize().padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) { CircularProgressIndicator(color = TalysmanPalette.ForegroundStrong) }

                errors.isEmpty() -> Column(Modifier.fillMaxWidth().padding(32.dp)) {
                    Text("No install-blocking errors reported. Good sign.", color = TalysmanPalette.ForegroundMuted, fontSize = 13.sp)
                }

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(errors, key = { "${it.deviceId}:${it.event}:${it.occurredAt}" }) { report ->
                        ErrorCard(report)
                    }
                }
            }
        }
    }
}

@Composable
private fun ErrorCard(report: ErrorReport) {
    var expanded by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(TalysmanPalette.PanelRaised, RoundedCornerShape(14.dp))
            .clickable { expanded = !expanded }
            .padding(16.dp),
    ) {
        Text(
            "${report.platform ?: "?"} · ${report.event}",
            color = TalysmanPalette.DangerInk,
            fontWeight = FontWeight.Bold,
            fontSize = 14.sp,
        )
        Text(report.occurredAt, color = TalysmanPalette.ForegroundMuted, fontSize = 11.sp)
        report.appVersion?.let { Text("v$it", color = TalysmanPalette.ForegroundMuted, fontSize = 11.sp) }
        androidx.compose.foundation.layout.Spacer(Modifier.padding(top = 6.dp))
        SelectionContainer {
            Text(
                report.message,
                color = TalysmanPalette.ForegroundStrong,
                fontSize = 13.sp,
                maxLines = if (expanded) Int.MAX_VALUE else 3,
            )
        }
        if (expanded && report.stack != null) {
            androidx.compose.foundation.layout.Spacer(Modifier.padding(top = 8.dp))
            SelectionContainer {
                Text(report.stack, color = TalysmanPalette.ForegroundMuted, fontSize = 11.sp)
            }
        }
    }
}
