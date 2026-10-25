package com.keiros.tourapp.flow

import android.location.Location
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keiros.tourapp.data.DemoTour
import com.keiros.tourapp.data.DoorResult
import com.keiros.tourapp.data.Geo
import com.keiros.tourapp.data.JourneyStep
import com.keiros.tourapp.data.PropertyMeta
import com.keiros.tourapp.data.TourUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.abs
import kotlin.math.max

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
    val locationFollowsPhone: Boolean = false,
    val startMilesAway: Double = 0.0,
    val locationBusy: Boolean = false,
    val locationError: String? = null,
    val pristineOutdoor: com.keiros.tourapp.data.OutdoorRoute? = null,
    val pristineDriveInstruction: String? = null,
    val pristineDriveLat: Double? = null,
    val pristineDriveLng: Double? = null,
    val userLatitude: Double? = null,
    val userLongitude: Double? = null,
    val userHeading: Double = -1.0,
    val userAccuracy: Float = 12f,
    val userFixTimeMs: Long = 0L,
    val navDistanceMeters: Double? = null,
    val navEtaSeconds: Double? = null,
    val navInstruction: String = "",
    val liveRoute: List<Pair<Double, Double>> = emptyList(),
    val routeLegMeters: Double = 0.0,
    val gpsIndoor: Boolean = false,
    val atStop: Boolean = false,
)

class TourViewModel : ViewModel() {
    private val _state = MutableStateFlow(TourUiState())
    val state: StateFlow<TourUiState> = _state
    private var routeInFlight = false
    private var lastRouteAttemptMs = 0L
    private var lastRoutedLat = Double.NaN
    private var lastRoutedLng = Double.NaN
    private var lastDestLat = Double.NaN
    private var lastDestLng = Double.NaN
    private var gpsCourseAtMs = 0L
    private var roadRoute: List<Pair<Double, Double>> = emptyList()
    private var roadManeuvers: List<Maneuver> = emptyList()
    private var roadPace = 11.0
    private var lastOffRoute = 0.0

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
            _state.update { current ->
                val loadedTour = loaded ?: current.tour
                val assigned = withStartOffset(
                    current.copy(
                        busy = false,
                        property = property,
                        selectedFloorId = loadedTour.floors.firstOrNull()?.id ?: current.selectedFloorId,
                        scannedPropertyId = propertyId,
                        code = property.code,
                        firebaseNote = note,
                        step = TourStep.Validating,
                    ),
                    loadedTour,
                    resetBaseline = true,
                )
                val lat = assigned.userLatitude
                val lng = assigned.userLongitude
                if (assigned.locationFollowsPhone && lat != null && lng != null) anchorToPhone(assigned, lat, lng) else assigned
            }
            val placed = _state.value
            if (placed.startMilesAway > 0 && !placed.locationFollowsPhone) {
                loadRealApproach(placed.tour.outdoor)
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

    fun beginLocationRequest() = _state.update { it.copy(locationBusy = true, locationError = null) }

    fun continueWithLocation() {
        _state.update { current ->
            withStartOffset(
                current.copy(
                    locationBusy = false,
                    locationError = null,
                    locationFollowsPhone = true,
                    startMilesAway = 0.0,
                    step = TourStep.PropertyCode,
                ),
                current.tour,
                resetBaseline = false,
            )
        }
    }

    fun continueWithoutLocation() {
        _state.update { current ->
            withStartOffset(
                current.copy(
                    locationBusy = false,
                    locationError = null,
                    locationFollowsPhone = false,
                    startMilesAway = 5.0,
                    userLatitude = null,
                    userLongitude = null,
                    userHeading = -1.0,
                    navInstruction = "",
                    navDistanceMeters = null,
                    navEtaSeconds = null,
                    liveRoute = emptyList(),
                    routeLegMeters = 0.0,
                    gpsIndoor = false,
                    step = TourStep.PropertyCode,
                ),
                current.tour,
                resetBaseline = false,
            )
        }
        clearRoadRoute()
        val outdoor = _state.value.tour.outdoor
        loadRealApproach(outdoor)
    }

    fun noteHeading(heading: Double) {
        if (System.currentTimeMillis() - gpsCourseAtMs < 2000) return
        _state.update { current ->
            if (!current.locationFollowsPhone) return@update current
            if (current.userHeading >= 0 && abs(current.userHeading - heading) <= 4) return@update current
            current.copy(userHeading = heading)
        }
    }

    fun noteDeviceLocation(location: Location) {
        _state.update { applyFix(it, location) }
        val current = _state.value
        val lat = current.userLatitude ?: return
        val lng = current.userLongitude ?: return
        if (!current.locationFollowsPhone || current.insideBuilding) return
        if (current.step != TourStep.RoutePreview && current.step != TourStep.Navigation) return
        val outdoor = current.tour.outdoor
        val toParking = Geo.meters(lat, lng, outdoor.parkingLat, outdoor.parkingLng)
        val walking = toParking <= 70
        val destLat = if (walking) outdoor.entranceLat else outdoor.parkingLat
        val destLng = if (walking) outdoor.entranceLng else outdoor.parkingLng
        refreshLiveRoute(lat, lng, destLat, destLng, walking, force = lastOffRoute > 40)
    }

    fun onLocationDenied() {
        _state.update {
            it.copy(
                locationBusy = false,
                locationFollowsPhone = false,
                locationError = "Location is required to continue. Turn it on for Keiros in Settings, or continue without location.",
            )
        }
    }

    fun onLocationServicesDisabled() {
        _state.update {
            it.copy(
                locationBusy = false,
                locationFollowsPhone = false,
                locationError = "Turn on device location to continue, or continue without location.",
            )
        }
    }

    private fun withStartOffset(
        state: TourUiState,
        tour: com.keiros.tourapp.data.PropertyTour,
        resetBaseline: Boolean,
    ): TourUiState {
        val driveIndex = tour.journey.indexOfFirst { it.phase == "drive" }
        val drive = tour.journey.getOrNull(driveIndex)
        val captureBaseline = resetBaseline || state.pristineOutdoor == null
        val baseOutdoor = if (captureBaseline) tour.outdoor else state.pristineOutdoor
        val baseInstruction = if (captureBaseline) drive?.instruction else state.pristineDriveInstruction
        val baseLat = if (captureBaseline) drive?.latitude else state.pristineDriveLat
        val baseLng = if (captureBaseline) drive?.longitude else state.pristineDriveLng
        val useOffset = state.startMilesAway > 0.0 && !state.locationFollowsPhone
        if (driveIndex < 0 || drive == null) {
            val outdoor = if (useOffset) (baseOutdoor ?: tour.outdoor).startingMilesAway(state.startMilesAway) else (baseOutdoor ?: tour.outdoor)
            return state.copy(
                tour = tour.copy(outdoor = outdoor),
                pristineOutdoor = baseOutdoor,
                pristineDriveInstruction = baseInstruction,
                pristineDriveLat = baseLat,
                pristineDriveLng = baseLng,
            )
        }
        if (!useOffset && captureBaseline) {
            return state.copy(
                tour = tour,
                pristineOutdoor = baseOutdoor,
                pristineDriveInstruction = baseInstruction,
                pristineDriveLat = baseLat,
                pristineDriveLng = baseLng,
            )
        }
        val outdoor = if (useOffset) baseOutdoor!!.startingMilesAway(state.startMilesAway) else baseOutdoor!!
        val journey = tour.journey.toMutableList()
        journey[driveIndex] = drive.copy(
            instruction = if (useOffset) {
                "Start about 5 miles from the property and drive toward parking."
            } else {
                baseInstruction ?: drive.instruction
            },
            latitude = if (useOffset) outdoor.originLat else baseLat ?: drive.latitude,
            longitude = if (useOffset) outdoor.originLng else baseLng ?: drive.longitude,
        )
        return state.copy(
            tour = tour.copy(outdoor = outdoor, journey = journey),
            pristineOutdoor = baseOutdoor,
            pristineDriveInstruction = baseInstruction,
            pristineDriveLat = baseLat,
            pristineDriveLng = baseLng,
        )
    }

    private fun applyFix(state: TourUiState, location: Location): TourUiState {
        if (!state.locationFollowsPhone) return state
        if (location.accuracy < 0 || location.accuracy > 200f) return state
        val lat = location.latitude
        val lng = location.longitude
        if (state.userFixTimeMs > 0 && state.userLatitude != null && state.userLongitude != null) {
            val elapsed = (location.time - state.userFixTimeMs) / 1000.0
            val jumped = Geo.meters(state.userLatitude, state.userLongitude, lat, lng)
            if (elapsed > 0 && elapsed < 30 && jumped / elapsed > 50 && location.accuracy > 25) return state
        }
        var next = state.copy(
            userLatitude = lat,
            userLongitude = lng,
            userAccuracy = location.accuracy,
            userFixTimeMs = location.time,
        )
        if (location.hasSpeed() && location.speed > 0.5f && location.hasBearing()) {
            gpsCourseAtMs = System.currentTimeMillis()
            next = next.copy(userHeading = location.bearing.toDouble())
        }
        next = anchorToPhone(next, lat, lng)
        if (next.step != TourStep.RoutePreview && next.step != TourStep.Navigation) return next
        val entranceLat = next.tour.outdoor.entranceLat
        val entranceLng = next.tour.outdoor.entranceLng
        val parkingLat = next.tour.outdoor.parkingLat
        val parkingLng = next.tour.outdoor.parkingLng
        val toEntrance = Geo.meters(lat, lng, entranceLat, entranceLng)
        val toParking = Geo.meters(lat, lng, parkingLat, parkingLng)
        val entranceRadius = minOf(30.0, maxOf(16.0, location.accuracy.toDouble()))
        if (next.step == TourStep.Navigation && toEntrance <= entranceRadius) {
            if (!next.insideBuilding) {
                val indoorIndex = next.tour.journey.indexOfFirst { it.phase == "indoor" }.let { if (it >= 0) it else next.activeStepIndex }
                next = next.copy(
                    insideBuilding = true,
                    gpsIndoor = true,
                    forceView = "3d",
                    activeStepIndex = if (next.tour.journey.getOrNull(next.activeStepIndex)?.phase == "indoor") next.activeStepIndex else indoorIndex,
                )
            }
            val indoorRadius = minOf(22.0, maxOf(10.0, location.accuracy.toDouble() * 0.5))
            return trackIndoor(next, lat, lng, indoorRadius)
        }
        if (next.step == TourStep.Navigation && next.gpsIndoor && toEntrance > 80) {
            val phase = if (toParking <= 70) "walk" else "drive"
            val idx = next.tour.journey.indexOfFirst { it.phase == phase }
            return next.copy(
                gpsIndoor = false,
                insideBuilding = false,
                atStop = false,
                forceView = "map",
                navInstruction = "",
                activeStepIndex = if (idx >= 0) idx else next.activeStepIndex,
            )
        }
        if (next.step == TourStep.Navigation && !next.insideBuilding) {
            val phase = if (toParking <= 70) "walk" else "drive"
            val currentPhase = next.tour.journey.getOrNull(next.activeStepIndex)?.phase
            var updated = next
            if ((currentPhase == "drive" || currentPhase == "walk") && currentPhase != phase) {
                val idx = next.tour.journey.indexOfFirst { it.phase == phase }
                updated = updated.copy(
                    navInstruction = "",
                    activeStepIndex = if (idx >= 0) idx else updated.activeStepIndex,
                )
            }
            return applyRoadProgress(
                updated.copy(atStop = false),
                lat,
                lng,
                location.speed,
                phase == "walk",
                if (phase == "walk") toEntrance else toParking,
            )
        }
        if (next.step == TourStep.Navigation) {
            val indoorRadius = minOf(22.0, maxOf(10.0, location.accuracy.toDouble() * 0.5))
            return trackIndoor(next, lat, lng, indoorRadius)
        }
        return applyRoadProgress(
            next,
            lat,
            lng,
            location.speed,
            toParking <= 70,
            if (toParking > 70) toParking else toEntrance,
        )
    }

    private fun applyRoadProgress(
        state: TourUiState,
        lat: Double,
        lng: Double,
        speedMps: Float,
        walking: Boolean,
        straightMeters: Double,
    ): TourUiState {
        val route = roadRoute
        if (route.size < 2) {
            val pace = if (speedMps > 0.8f) speedMps.toDouble() else if (walking) 1.3 else 8.0
            lastOffRoute = 0.0
            return state.copy(
                navDistanceMeters = straightMeters,
                navEtaSeconds = straightMeters / pace,
                navInstruction = state.navInstruction.ifBlank {
                    if (walking) "Walk toward the entrance" else "Head toward parking"
                },
            )
        }
        val progress = Geo.along(route, lat, lng)
        lastOffRoute = progress.offRouteMeters
        val pace = when {
            speedMps > 0.8f -> speedMps.toDouble()
            roadPace > 0.4 -> roadPace
            walking -> 1.3
            else -> 11.0
        }
        val maneuver = maneuverAt(progress.traveledMeters)
        return state.copy(
            liveRoute = progress.trimmed,
            navDistanceMeters = progress.remainingMeters,
            navEtaSeconds = progress.remainingMeters / pace,
            navInstruction = maneuver.ifBlank { state.navInstruction },
        )
    }

    private fun maneuverAt(traveledMeters: Double): String {
        if (roadManeuvers.isEmpty()) return ""
        var cursor = 0.0
        for (step in roadManeuvers) {
            val end = cursor + step.meters
            if (traveledMeters < end - 12 || step == roadManeuvers.last()) return step.text
            cursor = end
        }
        return roadManeuvers.last().text
    }

    private fun anchorToPhone(state: TourUiState, lat: Double, lng: Double): TourUiState {
        if (!state.locationFollowsPhone) return state
        val outdoor = state.tour.outdoor
        if (Geo.meters(outdoor.originLat, outdoor.originLng, lat, lng) <= 25) return state
        val shifted = outdoor.copy(
            originLat = lat,
            originLng = lng,
            drivePath = listOf(lat to lng, outdoor.parkingLat to outdoor.parkingLng),
        )
        val journey = state.tour.journey.toMutableList()
        val idx = journey.indexOfFirst { it.phase == "drive" }
        if (idx >= 0) {
            journey[idx] = journey[idx].copy(
                latitude = lat,
                longitude = lng,
                instruction = "Starting from your current location.",
            )
        }
        return state.copy(tour = state.tour.copy(outdoor = shifted, journey = journey))
    }

    private fun trackIndoor(state: TourUiState, lat: Double, lng: Double, radius: Double): TourUiState {
        val measured = state.tour.journey.mapIndexedNotNull { index, step ->
            if (step.phase != "indoor") return@mapIndexedNotNull null
            val place = coordinateFor(state, step) ?: return@mapIndexedNotNull null
            val name = state.tour.units.find { it.id == step.stopId }?.name ?: "this stop"
            IndoorHit(index, step, Geo.meters(lat, lng, place.first, place.second), name)
        }
        if (measured.isEmpty()) {
            val step = state.tour.journey.getOrNull(state.activeStepIndex)
            return state.copy(
                navDistanceMeters = null,
                navEtaSeconds = null,
                navInstruction = step?.instruction ?: state.navInstruction,
            )
        }
        val current = measured.find { it.index == state.activeStepIndex }
        if (current != null && current.distance <= radius * 1.4) return publishIndoor(state, current, radius)
        val nearest = measured.minBy { it.distance }
        if (nearest.distance <= radius) return publishIndoor(state.copy(activeStepIndex = nearest.index), nearest, radius)
        val upcoming = measured.firstOrNull { hit ->
            val id = hit.step.stopId ?: return@firstOrNull true
            id !in state.visitedStopIds
        } ?: measured.first()
        return publishIndoor(state.copy(activeStepIndex = upcoming.index), upcoming, radius)
    }

    private fun publishIndoor(state: TourUiState, hit: IndoorHit, radius: Double): TourUiState {
        val arrived = hit.distance <= radius
        val id = hit.step.stopId
        val unit = id?.let { stopId -> state.tour.units.find { it.id == stopId } }
        val stopIndex = id?.let { stopId -> state.tour.stops.indexOfFirst { it.id == stopId } } ?: -1
        return state.copy(
            atStop = arrived,
            navDistanceMeters = hit.distance,
            navEtaSeconds = hit.distance / 1.25,
            navInstruction = if (arrived) "You're at ${hit.name}" else "Walk to ${hit.name}",
            visitedStopIds = if (arrived && id != null) state.visitedStopIds + id else state.visitedStopIds,
            destination = unit ?: state.destination,
            selectedFloorId = if (arrived && unit != null) unit.floorId else state.selectedFloorId,
            currentStopIndex = if (stopIndex >= 0) stopIndex else state.currentStopIndex,
            insideBuilding = true,
            forceView = "3d",
            gpsIndoor = true,
        )
    }

    private fun coordinateFor(state: TourUiState, step: JourneyStep): Pair<Double, Double>? {
        val id = step.stopId
        if (id != null) {
            val unit = state.tour.units.find { it.id == id }
            if (unit != null && Geo.isPlaced(unit.latitude, unit.longitude)) return unit.latitude to unit.longitude
        }
        if (Geo.isPlaced(step.latitude, step.longitude)) return step.latitude to step.longitude
        return null
    }

    private fun refreshLiveRoute(lat: Double, lng: Double, destLat: Double, destLng: Double, walking: Boolean, force: Boolean) {
        val now = System.currentTimeMillis()
        if (routeInFlight && now - lastRouteAttemptMs > 12_000) routeInFlight = false
        if (routeInFlight) return
        val drifted = if (lastRoutedLat.isNaN()) 999.0 else Geo.meters(lastRoutedLat, lastRoutedLng, lat, lng)
        val destMoved = if (lastDestLat.isNaN()) 999.0 else Geo.meters(lastDestLat, lastDestLng, destLat, destLng)
        val retryDue = now - lastRouteAttemptMs > 8_000
        if (!force && !lastRoutedLat.isNaN() && destMoved < 20 && !(drifted > 28 && retryDue)) return
        routeInFlight = true
        lastRouteAttemptMs = now
        lastDestLat = destLat
        lastDestLng = destLng
        lastOffRoute = 0.0
        viewModelScope.launch {
            val fetched = withContext(Dispatchers.IO) {
                fetchOsrm(lat, lng, destLat, destLng, walking)
            }
            routeInFlight = false
            lastRoutedLat = lat
            lastRoutedLng = lng
            val meters = fetched?.meters ?: Geo.meters(lat, lng, destLat, destLng)
            val seconds = fetched?.seconds ?: meters / if (walking) 1.35 else 11.0
            val path = fetched?.path?.takeIf { it.size >= 2 } ?: listOf(lat to lng, destLat to destLng)
            roadRoute = path
            roadManeuvers = fetched?.maneuvers ?: emptyList()
            roadPace = if (seconds > 1) meters / seconds else if (walking) 1.35 else 11.0
            val instruction = fetched?.instruction ?: if (walking) "Walk toward the entrance" else "Head toward parking"
            val geometryMeters = Geo.along(path, path.first().first, path.first().second).let { it.traveledMeters + it.remainingMeters }
            _state.update { current ->
                if (!current.locationFollowsPhone || current.insideBuilding) return@update current
                val seeded = current.copy(
                    routeLegMeters = if (geometryMeters > 1) geometryMeters else meters,
                    navInstruction = instruction,
                    navDistanceMeters = meters,
                    navEtaSeconds = seconds,
                    liveRoute = path,
                )
                val userLat = current.userLatitude
                val userLng = current.userLongitude
                if (userLat == null || userLng == null) seeded else applyRoadProgress(seeded, userLat, userLng, 0f, walking, meters)
            }
        }
    }

    private fun loadRealApproach(outdoor: com.keiros.tourapp.data.OutdoorRoute) {
        viewModelScope.launch {
            val fetched = withContext(Dispatchers.IO) {
                fetchOsrm(outdoor.originLat, outdoor.originLng, outdoor.parkingLat, outdoor.parkingLng, walking = false)
            } ?: return@launch
            if (fetched.path.size < 2) return@launch
            _state.update { current ->
                if (current.locationFollowsPhone || current.startMilesAway <= 0) return@update current
                val sameOrigin = kotlin.math.abs(current.tour.outdoor.originLat - outdoor.originLat) < 0.0004 &&
                    kotlin.math.abs(current.tour.outdoor.parkingLat - outdoor.parkingLat) < 0.0004
                if (!sameOrigin) return@update current
                val road = current.tour.outdoor.copy(drivePath = fetched.path)
                val journey = current.tour.journey.toMutableList()
                val driveIndex = journey.indexOfFirst { it.phase == "drive" }
                if (driveIndex >= 0) {
                    journey[driveIndex] = journey[driveIndex].copy(
                        latitude = fetched.path.first().first,
                        longitude = fetched.path.first().second,
                    )
                }
                current.copy(
                    tour = current.tour.copy(outdoor = road, journey = journey),
                    navDistanceMeters = fetched.meters,
                    navEtaSeconds = fetched.seconds,
                    navInstruction = fetched.instruction,
                    routeLegMeters = fetched.meters,
                    liveRoute = fetched.path,
                )
            }
        }
    }

    private fun clearRoadRoute() {
        roadRoute = emptyList()
        roadManeuvers = emptyList()
        roadPace = 11.0
        lastOffRoute = 0.0
        lastRoutedLat = Double.NaN
        lastRoutedLng = Double.NaN
        lastDestLat = Double.NaN
        lastDestLng = Double.NaN
    }

    private fun fetchOsrm(lat: Double, lng: Double, destLat: Double, destLng: Double, walking: Boolean): OsrmRoute? {
        val profile = if (walking) "walking" else "driving"
        val url = "https://router.project-osrm.org/route/v1/$profile/$lng,$lat;$destLng,$destLat?overview=full&geometries=geojson&steps=true"
        return try {
            val connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("User-Agent", "KeirosTour")
            }
            try {
                if (connection.responseCode !in 200..299) return null
                connection.inputStream.bufferedReader().use { reader ->
                    val root = JSONObject(reader.readText())
                    val route = root.optJSONArray("routes")?.optJSONObject(0) ?: return null
                    val coords = route.getJSONObject("geometry").getJSONArray("coordinates")
                    val path = buildList {
                        for (index in 0 until coords.length()) {
                            val pair = coords.getJSONArray(index)
                            add(pair.getDouble(1) to pair.getDouble(0))
                        }
                    }
                    val steps = route.optJSONArray("legs")?.optJSONObject(0)?.optJSONArray("steps")
                val maneuvers = readManeuvers(steps)
                val instruction = maneuvers.firstOrNull()?.text ?: if (walking) "Walk toward the entrance" else "Head toward parking"
                OsrmRoute(path, route.optDouble("distance"), route.optDouble("duration"), instruction, maneuvers)
                }
            } finally {
                connection.disconnect()
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun readManeuvers(steps: org.json.JSONArray?): List<Maneuver> {
        if (steps == null || steps.length() == 0) return emptyList()
        val maneuvers = mutableListOf<Maneuver>()
        for (index in 0 until steps.length()) {
            val step = steps.getJSONObject(index)
            val text = maneuverLine(step) ?: continue
            val type = step.optJSONObject("maneuver")?.optString("type").orEmpty()
            val distance = step.optDouble("distance", 0.0)
            if (distance < 8 && type != "arrive" && index != 0) continue
            maneuvers.add(Maneuver(text, distance.coerceAtLeast(1.0)))
        }
        return maneuvers
    }

    private fun maneuverLine(step: org.json.JSONObject): String? {
        val maneuver = step.optJSONObject("maneuver") ?: return null
        val type = maneuver.optString("type")
        val modifier = maneuver.optString("modifier")
        val name = step.optString("name")
        val action = when {
            type == "arrive" -> "Arrive"
            type == "depart" -> "Head"
            modifier.isNotBlank() -> modifier.replaceFirstChar { it.uppercase() }
            else -> "Continue"
        }
        return if (name.isNotBlank() && type != "arrive") "$action onto $name" else action
    }

    private data class IndoorHit(val index: Int, val step: JourneyStep, val distance: Double, val name: String)

    private data class Maneuver(val text: String, val meters: Double)

    private data class OsrmRoute(
        val path: List<Pair<Double, Double>>,
        val meters: Double,
        val seconds: Double,
        val instruction: String,
        val maneuvers: List<Maneuver> = emptyList(),
    )

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
        clearRoadRoute()
        _state.value = TourUiState()
    }
}
