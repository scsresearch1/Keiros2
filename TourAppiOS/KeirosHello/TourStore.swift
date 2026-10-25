import Foundation
import Combine
import CoreLocation

enum TourStep: String, CaseIterable {
    case splash, permissions, propertyCode, validating, download, overview, search, routePreview, navigation, doorAccess, complete
}

enum TourMode { case guided, browse }

struct TourUiState {
    var step: TourStep = .splash
    var code: String = ""
    var scannedPropertyId: String = ""
    var firebaseNote: String = ""
    var codeError: String?
    var busy: Bool = false
    var property: PropertyMeta?
    var tour: PropertyTour = DemoTour.pack
    var downloadPct: Int = 0
    var downloadLabel: String = "Preparing your tour…"
    var tourMode: TourMode = .guided
    var currentStopIndex: Int = 0
    var visitedStopIds: Set<String> = []
    var destination: TourUnit?
    var searchQuery: String = ""
    var filter: String = "all"
    var searchTab: String = "tour"
    var insideBuilding: Bool = false
    var forceView: String = "map"
    var panelCollapsed: Bool = false
    var activeStepIndex: Int = 0
    var showTrack: Bool = false
    var trackingEnabled: Bool = false
    var liveSec: Int = 0
    var weatherSummary: String = "Clear · 68°F"
    var trafficLevel: String = "Light"
    var listOpen: Bool = false
    var destOpen: Bool = false
    var showAllFloors: Bool = true
    var selectedFloorId: String = "f1"
    var doorBusyId: String?
    var doorResult: DoorResult?
    var rating: Int = 5
    var feedbackDone: Bool = false
    var navigateLoading: Bool = false
    var locationFollowsPhone: Bool = false
    var startMilesAway: Double = 0
    var locationBusy: Bool = false
    var locationError: String?
    var userLatitude: Double?
    var userLongitude: Double?
    var userHeading: Double = -1
    var userAccuracy: Double = 12
    var userFixTime: Date?
    var atStop: Bool = false
    var userFloorLevel: Int?
    var navDistanceMeters: Double?
    var navEtaSeconds: Double?
    var navInstruction: String = ""
    var navNextInstruction: String = ""
    var startReady: Bool = false
    var indoorPlan: String = "floor"
    var voiceOn: Bool = true
    var voiceMissing: Bool = false
    var pristineOutdoor: OutdoorRoute?
    var pristineDriveInstruction: String?
    var gpsIndoor: Bool = false
}

@MainActor
final class TourStore: ObservableObject {
    @Published var state = TourUiState()
    let voice = DirectionVoice()
    private var ticker: Timer?
    private let order = TourStep.allCases

    init() {
        state.voiceMissing = voice.engineState == "missing"
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.state.trackingEnabled && self.state.step == .navigation && self.state.atStop {
                    self.state.liveSec += 1
                }
            }
        }
    }

    func goNext() {
        guard let index = order.firstIndex(of: state.step), index < order.count - 1 else { return }
        state.step = order[index + 1]
    }

    func goBack() {
        guard let index = order.firstIndex(of: state.step), index > 0 else { return }
        state.step = order[index - 1]
    }

    func goTo(_ step: TourStep) { state.step = step }
    func setCode(_ value: String) { state.code = value; state.codeError = nil }
    func useDemoScan() { state.code = DemoTour.demoCode; state.codeError = nil }

    func onQrScanned(_ raw: String) {
        let scan = DemoTour.parseScan(raw)
        if scan.propertyId.isEmpty {
            state.codeError = "This QR has no property ID."
            return
        }
        state.code = scan.code
        state.scannedPropertyId = scan.propertyId
        state.codeError = nil
        openProperty(scan.propertyId, code: scan.code, propertyName: scan.propertyName)
    }

    func validateCode() {
        let raw = state.code
        let scannedId = state.scannedPropertyId
        state.busy = true
        state.codeError = nil
        Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            let knownLocal = DemoTour.propertyForId(scannedId) ?? DemoTour.propertyFor(raw)
            var live: PropertyMeta?
            do {
                let id = scannedId.isEmpty ? (knownLocal?.propertyId ?? "") : scannedId
                live = try await FirebaseTour.lookup(id)
            } catch {
                state.firebaseNote = error.localizedDescription
            }
            let known = live ?? knownLocal
            state.busy = false
            if known == nil && scannedId.isEmpty {
                state.codeError = "Invalid or inactive property code."
            } else if let known {
                state.property = known
                state.scannedPropertyId = known.propertyId
                if live != nil { state.firebaseNote = "Loaded from Firebase" }
                state.step = .validating
            } else {
                state.scannedPropertyId = scannedId
                state.property = PropertyMeta(code: raw.isEmpty ? scannedId : raw, propertyId: scannedId, name: "Property \(scannedId)", city: "", state: "", address: "", buildings: 1)
                state.step = .validating
            }
        }
    }

    private func openProperty(_ propertyId: String, code: String, propertyName: String) {
        state.busy = true
        state.codeError = nil
        state.firebaseNote = ""
        Task {
            var live: PropertyMeta?
            do { live = try await FirebaseTour.lookup(propertyId) }
            catch { state.firebaseNote = error.localizedDescription }
            var map: PropertyTour?
            do { map = try await FirebaseTour.loadMap(propertyId) }
            catch { state.firebaseNote = error.localizedDescription }
            let known = live ?? DemoTour.propertyForId(propertyId)
            let property = known ?? PropertyMeta(
                code: code.isEmpty ? propertyId : code,
                propertyId: propertyId,
                name: propertyName.isEmpty ? "Property \(propertyId)" : propertyName,
                city: "", state: "", address: "", buildings: 1
            )
            let loaded = map ?? (propertyId == DemoTour.pack.propertyId ? DemoTour.pack : nil)
            let note: String
            if live != nil && map != nil { note = "Loaded from Firebase" }
            else if map != nil { note = "Map loaded from Firebase" }
            else if !state.firebaseNote.isEmpty { note = state.firebaseNote }
            else { note = "Firebase had no map for this property." }
            state.busy = false
            state.property = property
            if let loaded {
                assignTour(loaded)
                state.selectedFloorId = loaded.floors.first?.id ?? state.selectedFloorId
            }
            state.scannedPropertyId = propertyId
            state.code = property.code
            state.firebaseNote = note
            state.step = .validating
        }
    }

    func runDownload() {
        guard state.step == .download else { return }
        let stages = [
            (12, "Opening your property tour…"),
            (28, "Loading floors & spaces…"),
            (48, "Gathering amenities & highlights…"),
            (68, "Lining up your tour stops…"),
            (86, "Preparing indoor guide…"),
            (100, "Tour ready"),
        ]
        Task {
            for (pct, label) in stages {
                try? await Task.sleep(nanoseconds: 420_000_000)
                state.downloadPct = pct
                state.downloadLabel = label
            }
            state.step = .overview
        }
    }

    func startGuidedTour() {
        guard let first = state.tour.stops.first else { return }
        state.tourMode = .guided
        state.currentStopIndex = 0
        state.visitedStopIds = []
        state.insideBuilding = false
        state.destination = first.unit
        state.searchTab = "tour"
        state.startReady = false
        state.step = .search
    }

    func startBrowseTour() {
        state.tourMode = .browse
        state.searchTab = "browse"
        state.destination = nil
        state.insideBuilding = false
        state.startReady = false
        state.step = .search
    }

    func setSearchQuery(_ value: String) { state.searchQuery = value }
    func setFilter(_ value: String) { state.filter = value }
    func setSearchTab(_ value: String) { state.searchTab = value }

    func selectStop(_ index: Int) {
        guard state.startReady else { return }
        guard state.tour.stops.indices.contains(index) else { return }
        state.currentStopIndex = index
        state.destination = state.tour.stops[index].unit
    }

    func selectUnit(_ unit: TourUnit) {
        guard state.startReady else { return }
        state.destination = unit
    }

    func confirmStart() { state.startReady = true }

    func setVoice(_ on: Bool) {
        state.voiceOn = on
        if !on { voice.stop() }
    }

    func setIndoorPlan(_ plan: String) {
        state.indoorPlan = plan
        state.forceView = "3d"
    }

    func hearAgain(line: String, next: String, meters: Double?) {
        voice.speak(VoiceGuide.cue(current: line, distanceMeters: meters, upcoming: next), force: true)
    }

    func runNavigate() {
        guard state.startReady, let dest = state.destination else { return }
        state.navigateLoading = true
        refreshConditions()
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            state.navigateLoading = false
            state.destination = dest
            state.activeStepIndex = 0
            state.insideBuilding = false
            state.forceView = "map"
            state.indoorPlan = "floor"
            state.panelCollapsed = false
            state.step = .routePreview
        }
    }

    func openNavigation() {
        state.step = .navigation
        state.showTrack = false
        refreshConditions()
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            if !state.trackingEnabled && state.step == .navigation { state.showTrack = true }
        }
    }

    func setForceView(_ view: String) {
        let phaseIndex = view == "3d" ? max(0, state.tour.journey.firstIndex { $0.phase == "indoor" } ?? 0) : 0
        state.forceView = view
        if !state.insideBuilding { state.activeStepIndex = phaseIndex }
    }

    func jumpPhase(_ phase: String) {
        if state.insideBuilding && phase != "indoor" { return }
        if let idx = state.tour.journey.firstIndex(where: { $0.phase == phase }) {
            state.activeStepIndex = idx
            state.forceView = phase == "indoor" ? "3d" : "map"
        }
    }

    func togglePanel() { state.panelCollapsed.toggle() }
    func toggleTips() { state.listOpen.toggle() }
    func toggleDest() { state.destOpen.toggle() }
    func selectFloor(_ id: String) { state.selectedFloorId = id; state.showAllFloors = false; state.destOpen = true }
    func pinFloor(_ id: String) { state.selectedFloorId = id; state.showAllFloors = false }
    func showAllFloors() { state.showAllFloors = true }
    func enableTracking() { state.trackingEnabled = true; state.showTrack = false; state.liveSec = 0 }
    func dismissTrack() { state.showTrack = false }

    func continueWithLocation() {
        state.locationBusy = true
        state.locationError = nil
        LocationAuth.shared.requestDecision { status in
            Task { @MainActor in
                self.finishLocationChoice(status)
            }
        }
    }

    func continueWithoutLocation() {
        state.locationBusy = false
        state.locationError = nil
        state.locationFollowsPhone = false
        state.startMilesAway = 5
        state.userLatitude = nil
        state.userLongitude = nil
        state.navInstruction = ""
        state.navDistanceMeters = nil
        state.navEtaSeconds = nil
        LocationAuth.shared.stop()
        applyStartOffset()
        goNext()
    }

    func ensurePhoneUpdates() {
        armPhoneLocation()
    }

    func armPhoneLocation() {
        if state.startMilesAway > 0 { return }
        LocationAuth.shared.requestDecision { status in
            Task { @MainActor in
                switch status {
                case .authorizedAlways, .authorizedWhenInUse:
                    self.state.locationFollowsPhone = true
                    self.state.locationError = nil
                    self.beginPhoneNavigation()
                    if let location = LocationAuth.shared.latest {
                        self.ingest(location)
                    }
                case .denied, .restricted:
                    self.state.locationFollowsPhone = false
                    self.state.locationError = "KeirosTour is not allowed to use this phone. Open Settings, tap KeirosTour, and set Location to While Using the App."
                default:
                    self.state.locationError = "Allow location for KeirosTour so the route can start at this phone."
                }
            }
        }
    }

    func noteDeviceLocation(_ location: CLLocation) {
        if state.startMilesAway > 0 { return }
        state.locationFollowsPhone = true
        guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 1500 else { return }
        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let moved = state.userLatitude.map { Geo.meters($0, state.userLongitude ?? lng, lat, lng) } ?? 999
        if moved > 1 {
            state.userLatitude = lat
            state.userLongitude = lng
            state.userAccuracy = location.horizontalAccuracy
            state.userFixTime = location.timestamp
            if location.speed > 0.5, location.course >= 0 {
                state.userHeading = location.course
            }
        }
        anchorOriginToPhone()
    }

    private func anchorOriginToPhone() {
        guard state.locationFollowsPhone, let lat = state.userLatitude, let lng = state.userLongitude else { return }
        guard Geo.meters(state.tour.outdoor.originLat, state.tour.outdoor.originLng, lat, lng) > 25 else { return }
        var outdoor = state.tour.outdoor
        outdoor.originLat = lat
        outdoor.originLng = lng
        outdoor.drivePath = [(lat, lng), (outdoor.parkingLat, outdoor.parkingLng)]
        state.tour.outdoor = outdoor
        if let idx = state.tour.journey.firstIndex(where: { $0.phase == "drive" }) {
            state.tour.journey[idx].latitude = lat
            state.tour.journey[idx].longitude = lng
            state.tour.journey[idx].instruction = "Starting from this phone. Head toward the nearest parking."
        }
    }

    func updateNavCue(meters: Double, seconds: Double, instruction: String, next: String = "", walking: Bool = false) {
        guard state.locationFollowsPhone || state.startMilesAway > 0 else { return }
        guard !state.insideBuilding else { return }
        let pullingIn = !walking && meters < 80
        let line = pullingIn ? "Drive into the nearest parking and leave the car." : instruction
        let upcoming = pullingIn ? "Leave the car and walk to the entrance." : next
        let sameInstruction = state.navInstruction == line
        let closeMeters = abs((state.navDistanceMeters ?? -999) - meters) < 12
        let closeEta = abs((state.navEtaSeconds ?? -999) - seconds) < 15
        let nextStable = upcoming.isEmpty || state.navNextInstruction == upcoming
        if sameInstruction && closeMeters && closeEta && nextStable { return }
        state.navDistanceMeters = meters
        state.navEtaSeconds = seconds
        state.navInstruction = line
        if !upcoming.isEmpty { state.navNextInstruction = upcoming }
        if !walking { state.trafficLevel = trafficBand(meters: meters, seconds: seconds) }
    }

    private func finishLocationChoice(_ status: CLAuthorizationStatus) {
        state.locationBusy = false
        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            state.locationError = nil
            state.locationFollowsPhone = true
            state.startMilesAway = 0
            applyStartOffset()
            beginPhoneNavigation()
            goNext()
        case .denied, .restricted:
            state.locationFollowsPhone = false
            state.locationError = "Location is required to continue. Turn it on for KeirosTour in Settings, or continue without location."
        default:
            state.locationError = "Location is required to continue."
        }
    }

    private func beginPhoneNavigation() {
        LocationAuth.shared.startNavigation(
            onLocation: { location in
                Task { @MainActor in self.ingest(location) }
            },
            onHeading: { heading in
                Task { @MainActor in
                    if self.state.userHeading < 0 || abs(self.state.userHeading - heading) > 4 {
                        self.state.userHeading = heading
                    }
                }
            }
        )
    }

    private func ingest(_ location: CLLocation) {
        if state.startMilesAway > 0 { return }
        state.locationFollowsPhone = true
        guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 1500 else { return }
        if let previous = state.userFixTime, let prevLat = state.userLatitude, let prevLng = state.userLongitude {
            let elapsed = location.timestamp.timeIntervalSince(previous)
            let jumped = Geo.meters(prevLat, prevLng, location.coordinate.latitude, location.coordinate.longitude)
            if elapsed > 0, elapsed < 30, jumped / elapsed > 50, location.horizontalAccuracy > 25 { return }
        }
        state.userLatitude = location.coordinate.latitude
        state.userLongitude = location.coordinate.longitude
        state.userAccuracy = location.horizontalAccuracy
        state.userFixTime = location.timestamp
        if location.speed > 0.5, location.course >= 0 {
            state.userHeading = location.course
        }
        anchorOriginToPhone()
        if location.horizontalAccuracy <= 40, let level = location.floor?.level, level != state.userFloorLevel {
            state.userFloorLevel = level
            if let floor = floorMatching(level) {
                state.selectedFloorId = floor.id
            }
        }
        guard state.step == .routePreview || state.step == .navigation else { return }
        let entrance = CLLocation(latitude: state.tour.outdoor.entranceLat, longitude: state.tour.outdoor.entranceLng)
        let parking = CLLocation(latitude: state.tour.outdoor.parkingLat, longitude: state.tour.outdoor.parkingLng)
        let toEntrance = location.distance(from: entrance)
        let toParking = location.distance(from: parking)
        let entranceRadius = min(30, max(16, location.horizontalAccuracy))
        if state.step == .navigation, toEntrance <= entranceRadius {
            if !state.insideBuilding {
                state.insideBuilding = true
                state.gpsIndoor = true
                state.forceView = "3d"
                if state.tour.journey[safe: state.activeStepIndex]?.phase != "indoor",
                   let idx = state.tour.journey.firstIndex(where: { $0.phase == "indoor" }) {
                    state.activeStepIndex = idx
                }
            }
            trackIndoor(location)
        } else if state.step == .navigation, state.gpsIndoor, toEntrance > 80 {
            state.gpsIndoor = false
            state.insideBuilding = false
            state.atStop = false
            state.forceView = "map"
            state.navInstruction = ""
            let phase = toParking <= 70 ? "walk" : "drive"
            if let idx = state.tour.journey.firstIndex(where: { $0.phase == phase }) {
                state.activeStepIndex = idx
            }
        } else if state.step == .navigation, !state.insideBuilding {
            let phase = toParking <= 70 ? "walk" : "drive"
            let current = state.tour.journey[safe: state.activeStepIndex]?.phase
            if current == "drive" || current == "walk", current != phase {
                state.navInstruction = ""
                if let idx = state.tour.journey.firstIndex(where: { $0.phase == phase }) {
                    state.activeStepIndex = idx
                }
            }
            state.atStop = false
            if state.navInstruction.isEmpty {
                state.navDistanceMeters = phase == "walk" ? toEntrance : toParking
                let speed = phase == "walk" ? 1.3 : max(location.speed, 8)
                state.navEtaSeconds = (state.navDistanceMeters ?? 0) / speed
            }
        } else if state.step == .navigation {
            trackIndoor(location)
        } else if state.navInstruction.isEmpty {
            state.navDistanceMeters = toParking > 70 ? toParking : toEntrance
        }
    }

    private func trackIndoor(_ location: CLLocation) {
        let radius = min(22, max(12, location.horizontalAccuracy))
        let measured: [(index: Int, step: JourneyStep, distance: CLLocationDistance, name: String)] = state.tour.journey.enumerated().compactMap { index, step in
            guard step.phase == "indoor", let place = coordinate(for: step) else { return nil }
            let name = state.tour.units.first { $0.id == step.stopId }?.name ?? "this stop"
            return (index, step, location.distance(from: place), name)
        }
        guard !measured.isEmpty else { return }
        if let current = measured.first(where: { $0.index == state.activeStepIndex }), current.distance <= radius * 1.4 {
            publishIndoor(current, radius: radius)
            return
        }
        if let nearest = measured.min(by: { $0.distance < $1.distance }), nearest.distance <= radius {
            state.activeStepIndex = nearest.index
            publishIndoor(nearest, radius: radius)
            return
        }
        let upcoming = measured.first { step in
            guard let id = step.step.stopId else { return true }
            return !state.visitedStopIds.contains(id)
        } ?? measured[0]
        state.activeStepIndex = upcoming.index
        publishIndoor(upcoming, radius: radius)
    }

    private func publishIndoor(_ hit: (index: Int, step: JourneyStep, distance: CLLocationDistance, name: String), radius: CLLocationDistance) {
        let arrived = hit.distance <= radius
        state.atStop = arrived
        state.navDistanceMeters = hit.distance
        state.navEtaSeconds = hit.distance / 1.25
        state.navInstruction = arrived ? "You're at \(hit.name)" : "Walk to \(hit.name)"
        if let following = state.tour.journey[safe: hit.index + 1] {
            if let stopId = following.stopId, let followingName = state.tour.units.first(where: { $0.id == stopId })?.name {
                state.navNextInstruction = "Continue to \(followingName)"
            } else {
                state.navNextInstruction = following.instruction
            }
        } else {
            state.navNextInstruction = ""
        }
        if arrived, let id = hit.step.stopId {
            state.visitedStopIds.insert(id)
        }
        guard let id = hit.step.stopId, let unit = state.tour.units.first(where: { $0.id == id }) else { return }
        state.destination = unit
        if arrived {
            state.selectedFloorId = unit.floorId
        }
        if let stopIndex = state.tour.stops.firstIndex(where: { $0.id == id }) {
            state.currentStopIndex = stopIndex
        }
        state.insideBuilding = true
        state.forceView = "3d"
    }

    private func coordinate(for step: JourneyStep) -> CLLocation? {
        if let id = step.stopId, let unit = state.tour.units.first(where: { $0.id == id }), Geo.isPlaced(unit.latitude, unit.longitude) {
            return CLLocation(latitude: unit.latitude, longitude: unit.longitude)
        }
        if Geo.isPlaced(step.latitude, step.longitude) {
            return CLLocation(latitude: step.latitude, longitude: step.longitude)
        }
        return nil
    }

    private func floorMatching(_ level: Int) -> FloorInfo? {
        if let exact = state.tour.floors.first(where: { $0.level == level }) { return exact }
        if let shifted = state.tour.floors.first(where: { $0.level == level + 1 }) { return shifted }
        if level <= 0 { return state.tour.floors.min { $0.level < $1.level } }
        return nil
    }

    private func assignTour(_ tour: PropertyTour) {
        state.pristineOutdoor = tour.outdoor
        state.pristineDriveInstruction = tour.journey.first { $0.phase == "drive" }?.instruction
        state.tour = tour
        applyStartOffset()
    }

    private func applyStartOffset() {
        let base = state.pristineOutdoor ?? state.tour.outdoor
        state.pristineOutdoor = base
        if state.pristineDriveInstruction == nil {
            state.pristineDriveInstruction = state.tour.journey.first { $0.phase == "drive" }?.instruction
        }
        guard let idx = state.tour.journey.firstIndex(where: { $0.phase == "drive" }) else {
            state.tour.outdoor = base
            return
        }
        if state.startMilesAway > 0 && !state.locationFollowsPhone {
            let shifted = OutdoorRoute.startingMilesAway(state.startMilesAway, from: base)
            state.tour.outdoor = shifted
            state.tour.journey[idx].instruction = "Start about 5 miles from the property and drive toward parking."
            state.tour.journey[idx].latitude = shifted.originLat
            state.tour.journey[idx].longitude = shifted.originLng
        } else {
            state.tour.outdoor = base
            state.tour.journey[idx].instruction = state.pristineDriveInstruction ?? "Drive to parking."
            state.tour.journey[idx].latitude = (base.originLat + base.parkingLat) / 2
            state.tour.journey[idx].longitude = (base.originLng + base.parkingLng) / 2
        }
    }

    func refreshConditions() {
        let lat = state.userLatitude ?? state.tour.outdoor.entranceLat
        let lng = state.userLongitude ?? state.tour.outdoor.entranceLng
        Task {
            if let summary = await fetchWeather(lat: lat, lng: lng) {
                state.weatherSummary = summary
            }
        }
    }

    private func trafficBand(meters: Double, seconds: Double) -> String {
        if seconds < 1 { return "Light" }
        let mph = (meters / 1609.344) / (seconds / 3600.0)
        let expected = meters >= 1500 ? 55.0 : (meters >= 400 ? 32.0 : 18.0)
        if mph >= expected * 0.85 { return "Light" }
        if mph >= expected * 0.55 { return "Moderate" }
        return "Heavy"
    }

    private func fetchWeather(lat: Double, lng: Double) async -> String? {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(lat)),
            URLQueryItem(name: "longitude", value: String(lng)),
            URLQueryItem(name: "current", value: "temperature_2m,weather_code"),
            URLQueryItem(name: "temperature_unit", value: "fahrenheit"),
        ]
        guard let url = components?.url else { return nil }
        guard let (data, _) = try? await URLSession.shared.data(from: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let current = json["current"] as? [String: Any] else { return nil }
        let temp = current["temperature_2m"] as? Double ?? (current["temperature_2m"] as? NSNumber)?.doubleValue
        guard let temp else { return nil }
        let code = current["weather_code"] as? Int
            ?? (current["weather_code"] as? NSNumber)?.intValue
            ?? -1
        return "\(weatherName(code)) · \(Int(temp))°F"
    }

    private func weatherName(_ code: Int) -> String {
        switch code {
        case 0: return "Clear"
        case 1, 2: return "Mostly clear"
        case 3: return "Cloudy"
        case 45, 48: return "Fog"
        case 51, 53, 55, 61, 63, 65, 80, 81, 82: return "Rain"
        case 71, 73, 75, 85, 86: return "Snow"
        case 95, 96, 99: return "Storms"
        default: return "Weather"
        }
    }

    func selectTip(_ index: Int) { applyJourneyIndex(index) }

    func previousStep() {
        if state.activeStepIndex <= 0 { return }
        applyJourneyIndex(state.activeStepIndex - 1)
    }

    func nextStep() {
        if state.activeStepIndex >= state.tour.journey.count - 1 {
            completeCurrentStop()
            return
        }
        applyJourneyIndex(state.activeStepIndex + 1)
    }

    private func applyJourneyIndex(_ index: Int) {
        guard state.tour.journey.indices.contains(index) else { return }
        let step = state.tour.journey[index]
        let unit = state.tour.units.first { $0.id == step.stopId }
        let stopIndex = state.tour.stops.firstIndex { $0.id == step.stopId } ?? -1
        let indoor = step.phase == "indoor"
        state.activeStepIndex = index
        state.forceView = indoor ? "3d" : "map"
        state.insideBuilding = state.insideBuilding || indoor
        state.destOpen = state.destOpen || indoor
        if indoor { state.panelCollapsed = false }
        if let unit { state.destination = unit }
        if let floor = unit?.floorId { state.selectedFloorId = floor }
        if stopIndex >= 0 { state.currentStopIndex = stopIndex }
    }

    func choosePlace(_ id: String, floorId: String) {
        if let unit = state.tour.units.first(where: { $0.id == id }) { state.destination = unit }
        state.selectedFloorId = floorId
        state.insideBuilding = true
        state.forceView = "3d"
    }

    private func completeCurrentStop() {
        if let stop = state.tour.stops[safe: state.currentStopIndex] {
            state.visitedStopIds.insert(stop.id)
        }
        let nextIndex = state.currentStopIndex + 1
        if state.tourMode == .guided, state.tour.stops.indices.contains(nextIndex) {
            let nextStop = state.tour.stops[nextIndex]
            state.currentStopIndex = nextIndex
            state.destination = nextStop.unit
            state.insideBuilding = true
            state.forceView = "3d"
            state.activeStepIndex = max(0, state.tour.journey.firstIndex { $0.phase == "indoor" } ?? 0)
            state.selectedFloorId = nextStop.floorId
        } else {
            state.step = .doorAccess
        }
    }

    func endTour() { state.step = .doorAccess }

    func unlock(_ id: String) {
        state.doorBusyId = id
        Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            let facility = state.tour.facilities.first { $0.id == id }
            let denied = facility?.type == "parking"
            state.doorBusyId = nil
            state.doorResult = DoorResult(
                facilityName: facility?.name ?? "Unknown",
                granted: !denied,
                message: denied ? "Access denied — visitor parking requires front-desk approval." : "Temporary access granted for 15 minutes."
            )
        }
    }

    func setRating(_ value: Int) { state.rating = value }

    func submitFeedback() {
        state.busy = true
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            state.busy = false
            state.feedbackDone = true
        }
    }

    func resetTour() {
        voice.stop()
        LocationAuth.shared.stop()
        state = TourUiState()
        state.voiceMissing = voice.engineState == "missing"
    }

    func filteredUnits() -> [TourUnit] {
        let query = state.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return state.tour.units.filter { unit in
            let hay = "\(unit.type) \(unit.name)".lowercased()
            let filterOk: Bool
            switch state.filter {
            case "all": filterOk = true
            case "unit": filterOk = hay.contains("unit") || hay.contains("home") || hay.contains("apt")
            case "park": filterOk = hay.contains("park")
            default: filterOk = hay.contains(state.filter)
            }
            let queryOk = query.isEmpty || hay.contains(query) || unit.buildingName.lowercased().contains(query)
            return filterOk && queryOk
        }
    }
}

final class LocationAuth: NSObject, CLLocationManagerDelegate {
    static let shared = LocationAuth()
    private let manager = CLLocationManager()
    private var decision: ((CLAuthorizationStatus) -> Void)?
    private var onLocation: ((CLLocation) -> Void)?
    private var onHeading: ((Double) -> Void)?
    private(set) var latest: CLLocation?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = 1
        manager.headingFilter = 2
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    var currentStatus: CLAuthorizationStatus { manager.authorizationStatus }

    var isAuthorized: Bool {
        let status = manager.authorizationStatus
        return status == .authorizedAlways || status == .authorizedWhenInUse
    }

    func requestDecision(_ handler: @escaping (CLAuthorizationStatus) -> Void) {
        let status = manager.authorizationStatus
        if status == .notDetermined {
            decision = handler
            manager.requestWhenInUseAuthorization()
        } else {
            handler(status)
        }
    }

    func startNavigation(onLocation: @escaping (CLLocation) -> Void, onHeading: @escaping (Double) -> Void) {
        self.onLocation = onLocation
        self.onHeading = onHeading
        let status = manager.authorizationStatus
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return }
        if let latest {
            onLocation(latest)
        }
        manager.requestLocation()
        manager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() {
            manager.startUpdatingHeading()
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
        onLocation = nil
        onHeading = nil
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        guard status != .notDetermined, let decision else { return }
        self.decision = nil
        decision(status)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        latest = location
        onLocation?(location)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        let heading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        guard heading >= 0 else { return }
        onHeading?(heading)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
