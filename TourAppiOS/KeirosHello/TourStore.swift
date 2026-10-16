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
    var pristineOutdoor: OutdoorRoute?
    var pristineDriveInstruction: String?
    var gpsIndoor: Bool = false
}

@MainActor
final class TourStore: ObservableObject {
    @Published var state = TourUiState()
    private var ticker: Timer?
    private let order = TourStep.allCases

    init() {
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
        state.step = .search
    }

    func startBrowseTour() {
        state.tourMode = .browse
        state.searchTab = "browse"
        state.destination = nil
        state.insideBuilding = false
        state.step = .search
    }

    func setSearchQuery(_ value: String) { state.searchQuery = value }
    func setFilter(_ value: String) { state.filter = value }
    func setSearchTab(_ value: String) { state.searchTab = value }

    func selectStop(_ index: Int) {
        guard state.tour.stops.indices.contains(index) else { return }
        state.currentStopIndex = index
        state.destination = state.tour.stops[index].unit
    }

    func selectUnit(_ unit: TourUnit) { state.destination = unit }

    func runNavigate() {
        guard let dest = state.destination else { return }
        state.navigateLoading = true
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            state.navigateLoading = false
            state.destination = dest
            state.activeStepIndex = 0
            state.insideBuilding = false
            state.forceView = "map"
            state.panelCollapsed = false
            state.step = .routePreview
        }
    }

    func openNavigation() {
        state.step = .navigation
        state.showTrack = false
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
        guard state.locationFollowsPhone else { return }
        beginPhoneNavigation()
        anchorOriginToPhone()
    }

    func noteDeviceLocation(_ location: CLLocation) {
        guard state.locationFollowsPhone else { return }
        guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 500 else { return }
        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let moved = state.userLatitude.map { Geo.meters($0, state.userLongitude ?? lng, lat, lng) } ?? 999
        if moved > 4 {
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
            state.tour.journey[idx].instruction = "Starting from your current location."
        }
    }

    func updateNavCue(meters: Double, seconds: Double, instruction: String) {
        guard state.locationFollowsPhone || state.startMilesAway > 0 else { return }
        guard !state.insideBuilding else { return }
        let sameInstruction = state.navInstruction == instruction
        let closeMeters = abs((state.navDistanceMeters ?? -999) - meters) < 12
        let closeEta = abs((state.navEtaSeconds ?? -999) - seconds) < 15
        if sameInstruction && closeMeters && closeEta { return }
        state.navDistanceMeters = meters
        state.navEtaSeconds = seconds
        state.navInstruction = instruction
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
        guard state.locationFollowsPhone else { return }
        guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 200 else { return }
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
        let options = [("Clear · 68°F", "Light"), ("Partly cloudy · 66°F", "Moderate"), ("Breezy · 64°F", "Light")]
        let index = options.firstIndex { $0.0 == state.weatherSummary } ?? -1
        let next = options[(index + 1 + options.count) % options.count]
        state.weatherSummary = next.0
        state.trafficLevel = next.1
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
        LocationAuth.shared.stop()
        state = TourUiState()
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

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = 1
        manager.headingFilter = 2
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
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
