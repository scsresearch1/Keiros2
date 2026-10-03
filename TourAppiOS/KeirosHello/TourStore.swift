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
                if self.state.trackingEnabled && self.state.step == .navigation {
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
                state.tour = loaded
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

    func resetTour() { state = TourUiState() }

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
    static func request() { shared.manager.requestWhenInUseAuthorization() }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
