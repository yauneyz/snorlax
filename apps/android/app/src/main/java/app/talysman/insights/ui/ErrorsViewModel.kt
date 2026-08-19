package app.talysman.insights.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.talysman.insights.data.ErrorReport
import app.talysman.insights.data.InsightsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ErrorsUiState(
    val errors: List<ErrorReport>? = null,
    val isRefreshing: Boolean = false,
    val error: String? = null,
)

class ErrorsViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = InsightsRepository(application)
    private val _state = MutableStateFlow(ErrorsUiState(errors = repository.cachedErrors()))
    val state: StateFlow<ErrorsUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(isRefreshing = true, error = null)
            repository.refreshErrors()
                .onSuccess { errors -> _state.value = _state.value.copy(errors = errors, isRefreshing = false) }
                .onFailure { e -> _state.value = _state.value.copy(isRefreshing = false, error = e.message ?: "Failed to refresh") }
        }
    }
}
