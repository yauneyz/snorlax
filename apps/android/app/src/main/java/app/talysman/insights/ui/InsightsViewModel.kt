package app.talysman.insights.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.talysman.insights.data.InsightsRepository
import app.talysman.insights.data.InsightsSummary
import app.talysman.insights.widget.InsightsWidget
import app.talysman.insights.work.RefreshScheduler
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class InsightsUiState(
    val summary: InsightsSummary? = null,
    val isRefreshing: Boolean = false,
    val error: String? = null,
)

class InsightsViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = InsightsRepository(application)
    private val _state = MutableStateFlow(InsightsUiState(summary = repository.cached()))
    val state: StateFlow<InsightsUiState> = _state.asStateFlow()

    init {
        RefreshScheduler.ensureScheduled(application)
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isRefreshing = true, error = null)
            repository.refresh()
                .onSuccess { summary -> _state.value = _state.value.copy(summary = summary, isRefreshing = false) }
                .onFailure { e -> _state.value = _state.value.copy(isRefreshing = false, error = e.message ?: "Failed to refresh") }
            InsightsWidget.updateAll(getApplication())
        }
    }
}
