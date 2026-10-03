package com.keiros.tourapp.flow

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keiros.tourapp.data.DemoTour
import com.keiros.tourapp.data.DoorResult
import com.keiros.tourapp.data.PropertyMeta
import com.keiros.tourapp.data.TourUnit
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class TourStep {
    Splash,
    Permissions,
    PropertyCode,
    Validating,
    Download,
    Overview,
    Search,
    RoutePreview,
    Navigation,
    DoorAccess,
    Complete,
}

enum class TourMode { Guided, Browse }

data class TourUiState(
    val step: TourStep = TourStep.Splash,
    val code: String = "",
    val scannedPropertyId: String = "",
    val firebaseNote: String = "",
    val codeError: String? = null,
    val busy: Boolean = false,
    val property: PropertyMeta? = null,
    val tour: com.keiros.tourapp.data.PropertyTour = DemoTour.pack,
    val downloadPct: Int = 0,
    val downloadLabel: String = "Preparing your tour…",
    val tourMode: TourMode = TourMode.Guided,
    val currentStopIndex: Int = 0,
    val visitedStopIds: Set<String> = emptySet(),
    val destination: TourUnit? = null,
    val searchQuery: String = "",
    val filter: String = "all",
    val searchTab: String = "tour",
    val insideBuilding: Boolean = false,
    val forceView: String = "map",
    val panelCollapsed: Boolean = false,
    val activeStepIndex: Int = 0,
    val showTrack: Boolean = false,
    val trackingEnabled: Boolean = false,
    val liveSec: Int = 0,
    val weatherSummary: String = "Clear · 68°F",
    val trafficLevel: String = "Light",
    val listOpen: Boolean = false,
    val destOpen: Boolean = false,
    val showAllFloors: Boolean = true,
    val selectedFloorId: String = "f1",
    val doorBusyId: String? = null,
    val doorResult: DoorResult? = null,
    val rating: Int = 5,
    val feedbackDone: Boolean = false,
    val navigateLoading: Boolean = false,
)

class TourViewModel : ViewModel() {
    private val _state = MutableStateFlow(TourUiState())
    val state: StateFlow<TourUiState> = _state

    init {
        viewModelScope.launch {
            while (true) {
                delay(1000)
                if (_state.value.trackingEnabled && _state.value.step == TourStep.Navigation) {
                    _state.update { it.copy(liveSec = it.liveSec + 1) }
                }
            }
        }
    }

    private val order = TourStep.entries

    private fun tour() = _state.value.tour

    fun goNext() {
        val i = order.indexOf(_state.value.step)
        if (i in 0 until order.lastIndex) _state.update { it.copy(step = order[i + 1]) }
    }

    fun goBack() {
        val i = order.indexOf(_state.value.step)
        if (i > 0) _state.update { it.copy(step = order[i - 1]) }
    }

    fun goTo(step: TourStep) = _state.update { it.copy(step = step) }

    fun setCode(value: String) = _state.update { it.copy(code = value, codeError = null) }

    fun useDemoScan() = _state.update { it.copy(code = DemoTour.demoCode, codeError = null) }

    fun onQrScanned(raw: String) {
        val scan = DemoTour.parseScan(raw)
        if (scan.propertyId.isBlank()) {
            _state.update { it.copy(codeError = "This QR has no property ID.") }
            return
        }
        _state.update { it.copy(code = scan.code, scannedPropertyId = scan.propertyId, codeError = null) }
        openProperty(scan.propertyId, scan.code, scan.propertyName)
    }

    fun validateCode() {
        val raw = _state.value.code
        val scannedId = _state.value.scannedPropertyId
        viewModelScope.launch {
            _state.update { it.copy(busy = true, codeError = null) }
            delay(400)
            val knownLocal = DemoTour.propertyForId(scannedId) ?: DemoTour.propertyFor(raw)
            val live = try {
                val id = scannedId.ifBlank { knownLocal?.propertyId.orEmpty() }
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.keiros.tourapp.data.FirebaseTour.lookup(id)
                }
            } catch (e: Exception) {
                _state.update { it.copy(firebaseNote = e.message ?: "Firebase lookup failed.") }
                null
            }
            val known = live ?: knownLocal
            if (known == null && scannedId.isBlank()) {
                _state.update { it.copy(busy = false, codeError = "Invalid or inactive property code.") }
            } else if (known != null) {
                _state.update {
                    it.copy(
                        busy = false,
                        property = known,
                        scannedPropertyId = known.propertyId,
                        firebaseNote = if (live != null) "Loaded from Firebase" else it.firebaseNote,
                        step = TourStep.Validating,
                    )
                }
            } else {
                _state.update {
                    it.copy(
                        busy = false,
                        scannedPropertyId = scannedId,
                        property = com.keiros.tourapp.data.PropertyMeta(
                            code = raw.ifBlank { scannedId },
                            propertyId = scannedId,
                            name = "Property $scannedId",
                            city = "",
                            state = "",
                            address = "",
                            buildings = 1,
                        ),
                        step = TourStep.Validating,
                    )
                }
            }
        }
    }

    private fun openProperty(propertyId: String, code: String, propertyName: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, codeError = null, firebaseNote = "") }
            val live = try {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.keiros.tourapp.data.FirebaseTour.lookup(propertyId)
                }
            } catch (e: Exception) {
                _state.update { it.copy(firebaseNote = e.message ?: "Firebase lookup failed.") }
                null
            }
            val map = try {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    com.keiros.tourapp.data.FirebaseTour.loadMap(propertyId)
                }
            } catch (e: Exception) {
                _state.update { it.copy(firebaseNote = e.message ?: "Firebase map read failed.") }
                null
            }
            val known = live ?: DemoTour.propertyForId(propertyId)
            val property = known ?: com.keiros.tourapp.data.PropertyMeta(
                code = code.ifBlank { propertyId },
                propertyId = propertyId,
                name = propertyName.ifBlank { "Property $propertyId" },
                city = "",
                state = "",
                address = "",
                buildings = 1,
            )
            val loaded = map ?: if (propertyId == DemoTour.pack.propertyId) DemoTour.pack else map
            val note = when {
                live != null && map != null -> "Loaded from Firebase"
                map != null -> "Map loaded from Firebase"
                _state.value.firebaseNote.isNotBlank() -> _state.value.firebaseNote
                else -> "Firebase had no map for this property."
            }
            _state.update {
                it.copy(
                    busy = false,
                    property = property,
                    tour = loaded ?: it.tour,
                    selectedFloorId = loaded?.floors?.firstOrNull()?.id ?: it.selectedFloorId,
                    scannedPropertyId = propertyId,
                    code = property.code,
                    firebaseNote = note,
                    step = TourStep.Validating,
                )
            }
        }
    }

    fun runDownload() {
        if (_state.value.step != TourStep.Download) return
        viewModelScope.launch {
            val stages = listOf(
                12 to "Opening your property tour…",
                28 to "Loading floors & spaces…",
                48 to "Gathering amenities & highlights…",
                68 to "Lining up your tour stops…",
                86 to "Preparing indoor guide…",
                100 to "Tour ready",
            )
            for ((pct, label) in stages) {
                delay(420)
                _state.update { it.copy(downloadPct = pct, downloadLabel = label) }
            }
            _state.update { it.copy(step = TourStep.Overview) }
        }
    }

    fun startGuidedTour() {
        val first = tour().stops.firstOrNull() ?: return
        _state.update {
            it.copy(
                tourMode = TourMode.Guided,
                currentStopIndex = 0,
                visitedStopIds = emptySet(),
                insideBuilding = false,
                destination = first.unit,
                searchTab = "tour",
                step = TourStep.Search,
            )
        }
    }

    fun startBrowseTour() {
        _state.update {
            it.copy(
                tourMode = TourMode.Browse,
                searchTab = "browse",
                destination = null,
                insideBuilding = false,
                step = TourStep.Search,
            )
        }
    }

    fun setSearchQuery(value: String) = _state.update { it.copy(searchQuery = value) }
    fun setFilter(value: String) = _state.update { it.copy(filter = value) }
    fun setSearchTab(value: String) = _state.update { it.copy(searchTab = value) }

    fun selectStop(index: Int) {
        val stop = tour().stops.getOrNull(index) ?: return
        _state.update { it.copy(currentStopIndex = index, destination = stop.unit) }
    }

    fun selectUnit(unit: TourUnit) = _state.update { it.copy(destination = unit) }

    fun runNavigate() {
        val dest = _state.value.destination ?: return
        viewModelScope.launch {
            _state.update { it.copy(navigateLoading = true) }
            delay(600)
            _state.update {
                it.copy(
                    navigateLoading = false,
                    destination = dest,
                    activeStepIndex = 0,
                    insideBuilding = false,
                    forceView = "map",
                    panelCollapsed = false,
                    step = TourStep.RoutePreview,
                )
            }
        }
    }

    fun openNavigation() {
        _state.update { it.copy(step = TourStep.Navigation, showTrack = false) }
        viewModelScope.launch {
            delay(1600)
            if (!_state.value.trackingEnabled && _state.value.step == TourStep.Navigation) {
                _state.update { it.copy(showTrack = true) }
            }
        }
    }

    fun setForceView(view: String) {
        val phaseIndex = when (view) {
            "3d" -> tour().journey.indexOfFirst { it.phase == "indoor" }.coerceAtLeast(0)
            else -> 0
        }
        _state.update {
            it.copy(
                forceView = view,
                activeStepIndex = if (it.insideBuilding) it.activeStepIndex else phaseIndex,
            )
        }
    }

    fun jumpPhase(phase: String) {
        if (_state.value.insideBuilding && phase != "indoor") return
        val idx = tour().journey.indexOfFirst { it.phase == phase }
        if (idx >= 0) {
            _state.update {
                it.copy(
                    activeStepIndex = idx,
                    forceView = if (phase == "indoor") "3d" else "map",
                )
            }
        }
    }

    fun togglePanel() = _state.update { it.copy(panelCollapsed = !it.panelCollapsed) }
    fun toggleTips() = _state.update { it.copy(listOpen = !it.listOpen) }
    fun toggleDest() = _state.update { it.copy(destOpen = !it.destOpen) }
    fun selectFloor(id: String) = _state.update { it.copy(selectedFloorId = id, showAllFloors = false, destOpen = true) }
    fun showAllFloors() = _state.update { it.copy(showAllFloors = true) }

    fun enableTracking() = _state.update { it.copy(trackingEnabled = true, showTrack = false, liveSec = 0) }

    fun refreshConditions() {
        val options = listOf(
            "Clear · 68°F" to "Light",
            "Partly cloudy · 66°F" to "Moderate",
            "Breezy · 64°F" to "Light",
        )
        val current = _state.value.weatherSummary
        val next = options[(options.indexOfFirst { it.first == current } + 1).coerceAtLeast(0) % options.size]
        _state.update { it.copy(weatherSummary = next.first, trafficLevel = next.second) }
    }
    fun dismissTrack() = _state.update { it.copy(showTrack = false) }

    fun selectTip(index: Int) = applyJourneyIndex(index)

    fun previousStep() {
        if (_state.value.activeStepIndex <= 0) return
        applyJourneyIndex(_state.value.activeStepIndex - 1)
    }

    fun nextStep() {
        val s = _state.value
        if (s.activeStepIndex >= tour().journey.lastIndex) {
            completeCurrentStop()
            return
        }
        applyJourneyIndex(s.activeStepIndex + 1)
    }

    private fun applyJourneyIndex(index: Int) {
        val step = tour().journey.getOrNull(index) ?: return
        val unit = tour().units.find { it.id == step.stopId }
        val stopIndex = tour().stops.indexOfFirst { it.id == step.stopId }
        val indoor = step.phase == "indoor"
        _state.update {
            it.copy(
                activeStepIndex = index,
                forceView = if (indoor) "3d" else "map",
                insideBuilding = it.insideBuilding || indoor,
                destOpen = it.destOpen || indoor,
                panelCollapsed = if (indoor) false else it.panelCollapsed,
                destination = unit ?: it.destination,
                selectedFloorId = unit?.floorId ?: it.selectedFloorId,
                currentStopIndex = if (stopIndex >= 0) stopIndex else it.currentStopIndex,
            )
        }
    }

    fun choosePlace(id: String, floorId: String) {
        val unit = tour().units.find { it.id == id }
        _state.update {
            it.copy(
                destination = unit ?: it.destination,
                selectedFloorId = floorId,
                insideBuilding = true,
                forceView = "3d",
            )
        }
    }

    private fun completeCurrentStop() {
        val s = _state.value
        val stop = tour().stops.getOrNull(s.currentStopIndex)
        val visited = if (stop != null) s.visitedStopIds + stop.id else s.visitedStopIds
        val nextIndex = s.currentStopIndex + 1
        if (s.tourMode == TourMode.Guided && nextIndex < tour().stops.size) {
            val nextStop = tour().stops[nextIndex]
            _state.update {
                it.copy(
                    visitedStopIds = visited,
                    currentStopIndex = nextIndex,
                    destination = nextStop.unit,
                    insideBuilding = true,
                    forceView = "3d",
                    activeStepIndex = tour().journey.indexOfFirst { step -> step.phase == "indoor" }.coerceAtLeast(0),
                    selectedFloorId = nextStop.floorId,
                )
            }
        } else {
            _state.update { it.copy(visitedStopIds = visited, step = TourStep.DoorAccess) }
        }
    }

    fun endTour() = _state.update { it.copy(step = TourStep.DoorAccess) }

    fun unlock(id: String) {
        viewModelScope.launch {
            _state.update { it.copy(doorBusyId = id) }
            delay(700)
            val facility = tour().facilities.find { it.id == id }
            val denied = facility?.type == "parking"
            _state.update {
                it.copy(
                    doorBusyId = null,
                    doorResult = DoorResult(
                        facilityName = facility?.name ?: "Unknown",
                        granted = !denied,
                        message = if (denied) {
                            "Access denied — visitor parking requires front-desk approval."
                        } else {
                            "Temporary access granted for 15 minutes."
                        },
                    ),
                )
            }
        }
    }

    fun setRating(value: Int) = _state.update { it.copy(rating = value) }

    fun submitFeedback() {
        viewModelScope.launch {
            _state.update { it.copy(busy = true) }
            delay(500)
            _state.update { it.copy(busy = false, feedbackDone = true) }
        }
    }

    fun resetTour() {
        _state.value = TourUiState()
    }
}
