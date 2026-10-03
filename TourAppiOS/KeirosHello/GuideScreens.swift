import SwiftUI

struct NavigationScreen: View {
    @ObservedObject var store: TourStore

    var body: some View {
        let tour = store.state.tour
        let step = tour.journey[safe: store.state.activeStepIndex]
        let phase = step?.phase ?? "drive"
        let indoors = store.state.insideBuilding || store.state.forceView == "3d"
        let stop = tour.stops[safe: store.state.currentStopIndex]
        let atEnd = !tour.journey.isEmpty && store.state.activeStepIndex >= tour.journey.count - 1
        let nextStop = tour.stops[safe: store.state.currentStopIndex + 1]
        let arrive = atEnd && nextStop != nil ? "Next: \(nextStop!.title)" : (atEnd ? "Finish building tour" : "Next")
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                if indoors {
                    IndoorSketch(store: store)
                } else {
                    OutdoorMapView(route: tour.outdoor, active: step, weather: store.state.weatherSummary, traffic: store.state.trafficLevel)
                }
                HStack {
                    BackChip(action: store.goBack)
                    Spacer()
                    if !store.state.insideBuilding {
                        HStack(spacing: 0) {
                            mode("Outside", store.state.forceView == "map") { store.setForceView("map") }
                            mode("Inside", store.state.forceView == "3d") { store.setForceView("3d") }
                        }
                        .padding(3)
                        .background(Color.black.opacity(0.55))
                        .clipShape(Capsule())
                    } else {
                        Button("End tour", action: store.endTour)
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color(red: 0.996, green: 0.804, blue: 0.827))
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .background(Color(red: 0.5, green: 0.11, blue: 0.11).opacity(0.55))
                            .clipShape(Capsule())
                    }
                }
                .padding(12)
                if store.state.showTrack && !store.state.trackingEnabled {
                    HStack {
                        Text("Track time at each stop?").font(.system(size: 13)).foregroundStyle(KeirosColor.text)
                        Spacer()
                        Button("Enable", action: store.enableTracking).font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 6).background(KeirosColor.blue).clipShape(Capsule())
                        Button("Later", action: store.dismissTrack).font(.system(size: 12)).foregroundStyle(KeirosColor.secondary)
                    }
                    .padding(10)
                    .background(Color(red: 0.08, green: 0.15, blue: 0.25))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(.top, 64)
                    .padding(.horizontal, 12)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(stopLabel(stop).uppercased()).font(.system(size: 11, weight: .bold)).foregroundStyle(indoors ? Color(red: 0.976, green: 0.659, blue: 0.831) : Color(red: 0.49, green: 0.83, blue: 0.99))
                    Text(step?.instruction ?? "").font(.system(size: 15, weight: .semibold)).foregroundStyle(KeirosColor.text)
                    Text("\((tour.journey.count - store.state.activeStepIndex) * 90) ft · tip \(store.state.activeStepIndex + 1)/\(max(tour.journey.count, 1))")
                        .font(.system(size: 12)).foregroundStyle(KeirosColor.muted)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.black.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(12)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .allowsHitTesting(false)
            }
            .frame(maxHeight: .infinity)
            if !store.state.panelCollapsed {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            if !store.state.insideBuilding {
                                phaseButton("Arrive", phase == "drive") { store.jumpPhase("drive") }
                                phaseButton("Walk in", phase == "walk") { store.jumpPhase("walk") }
                            }
                            phaseButton(store.state.insideBuilding ? "Places inside" : "Explore", phase == "indoor" || indoors) { store.jumpPhase("indoor") }
                        }
                        if !indoors {
                            HStack {
                                meta("WEATHER", store.state.weatherSummary)
                                meta("TRAFFIC", store.state.trafficLevel)
                                Button("Refresh", action: store.refreshConditions).font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.secondary)
                            }
                        }
                        if indoors {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text("LOOKING AROUND?").font(.system(size: 10, weight: .bold)).foregroundStyle(Color(red: 0.976, green: 0.659, blue: 0.831))
                                    Text(store.state.destination?.name ?? "Pick a place").foregroundStyle(KeirosColor.text)
                                }
                                Spacer()
                                Button(store.state.destOpen ? "Hide list" : "Show units", action: store.toggleDest)
                                    .font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.secondary)
                            }
                            if store.state.destOpen {
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack {
                                        floorChip("All", store.state.showAllFloors) { store.showAllFloors() }
                                        ForEach(tour.floors) { floor in
                                            floorChip(floor.label, !store.state.showAllFloors && store.state.selectedFloorId == floor.id) { store.selectFloor(floor.id) }
                                        }
                                    }
                                }
                                ForEach(tour.units.filter { store.state.showAllFloors || $0.floorId == store.state.selectedFloorId }) { place in
                                    Button { store.choosePlace(place.id, floorId: place.floorId) } label: {
                                        HStack {
                                            VStack(alignment: .leading) {
                                                Text(place.name).font(.system(size: 14, weight: .bold)).foregroundStyle(KeirosColor.text)
                                                Text(place.floorLabel).font(.system(size: 11)).foregroundStyle(KeirosColor.muted)
                                            }
                                            Spacer()
                                            Text(store.state.destination?.id == place.id ? "Current" : "Go").font(.system(size: 12, weight: .bold)).foregroundStyle(Color(red: 0.49, green: 0.83, blue: 0.99))
                                        }
                                        .padding(10)
                                        .background(Color.white.opacity(0.05))
                                        .clipShape(RoundedRectangle(cornerRadius: 12))
                                    }
                                }
                            }
                        }
                        if store.state.trackingEnabled {
                            Text("You’re spending time here · \(store.state.destination?.name ?? "Lobby") · \(store.state.liveSec / 60)m \(store.state.liveSec % 60)s")
                                .font(.system(size: 12)).foregroundStyle(KeirosColor.verified)
                        }
                        HStack {
                            Button(store.state.listOpen ? "Hide tips" : "Direction tips", action: store.toggleTips)
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.secondary)
                            Button("End tour", action: store.endTour).font(.system(size: 12, weight: .bold)).foregroundStyle(Color(red: 0.996, green: 0.804, blue: 0.827))
                        }
                        if store.state.listOpen {
                            ForEach(Array(tour.journey.enumerated()), id: \.offset) { index, item in
                                Button { store.selectTip(index) } label: {
                                    Text("\(index + 1)  \(item.phase.uppercased())  \(item.instruction)")
                                        .font(.system(size: 13))
                                        .foregroundStyle(index == store.state.activeStepIndex ? KeirosColor.text : KeirosColor.muted)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            }
                        }
                        HStack {
                            PrimaryButton(label: "Previous", action: store.previousStep, enabled: store.state.activeStepIndex > 0, variant: "ghost")
                            PrimaryButton(label: arrive, action: store.nextStep)
                        }
                    }
                    .padding(16)
                }
                .frame(maxHeight: 320)
                .background(KeirosColor.navy)
            }
            Button(store.state.panelCollapsed ? "Show controls" : "Hide controls", action: store.togglePanel)
                .font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.secondary)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity)
                .background(KeirosColor.navy)
        }
        .background(KeirosColor.navy)
    }

    private func stopLabel(_ stop: TourStop?) -> String {
        if store.state.tourMode == .guided, let stop, store.state.insideBuilding {
            return "\(stop.floorLabel) · \(store.state.currentStopIndex + 1)/\(store.state.tour.stops.count) · \(stop.title)"
        }
        if store.state.tourMode == .guided, let stop { return "Enter building · \(stop.title)" }
        return store.state.destination?.name ?? "Destination"
    }

    private func mode(_ label: String, _ active: Bool, action: @escaping () -> Void) -> some View {
        Button(label, action: action)
            .font(.system(size: 12, weight: .bold))
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(active ? Color(red: 0.22, green: 0.74, blue: 0.97) : Color.clear)
            .foregroundStyle(active ? Color(red: 0.016, green: 0.06, blue: 0.12) : KeirosColor.secondary)
            .clipShape(Capsule())
    }

    private func phaseButton(_ label: String, _ active: Bool, action: @escaping () -> Void) -> some View {
        Button(label, action: action)
            .font(.system(size: 12, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(active ? KeirosColor.teal.opacity(0.2) : Color.white.opacity(0.05))
            .foregroundStyle(active ? KeirosColor.text : KeirosColor.muted)
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func meta(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(label).font(.system(size: 10, weight: .bold)).foregroundStyle(KeirosColor.blue)
            Text(value).font(.system(size: 13, weight: .bold)).foregroundStyle(KeirosColor.text)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func floorChip(_ label: String, _ active: Bool, action: @escaping () -> Void) -> some View {
        Button(label, action: action)
            .font(.system(size: 12, weight: .bold))
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(active ? Color(red: 0.62, green: 0.09, blue: 0.30).opacity(0.4) : Color.white.opacity(0.06))
            .foregroundStyle(active ? Color(red: 0.988, green: 0.906, blue: 0.953) : KeirosColor.secondary)
            .clipShape(Capsule())
    }
}

private struct MapHit {
    var point: CGPoint
    var floorId: String?
    var unitId: String?
}

private struct IndoorCamera {
    var yaw: Double
    var pitch: Double
    var zoom: Double
}

struct IndoorSketch: View {
    @ObservedObject var store: TourStore
    @State private var yaw = 0.48
    @State private var pitch = 0.52
    @State private var zoom = 1.12
    @State private var yawStart = 0.48
    @State private var pitchStart = 0.52
    @State private var zoomStart = 1.12
    @State private var dragging = false

    var body: some View {
        let tour = store.state.tour
        let activeStopIndex = resolvedStopIndex(tour)
        let floorName = tour.floors.first { $0.id == store.state.selectedFloorId }?.label ?? ""
        GeometryReader { geo in
            Canvas { context, size in
                drawBuilding(context: &context, size: size, tour: tour, activeStopIndex: activeStopIndex)
            }
            .contentShape(Rectangle())
            .gesture(dragGesture(size: geo.size, tour: tour))
            .simultaneousGesture(magnifyGesture)
            .overlay(alignment: .topTrailing) {
                VStack(spacing: 6) {
                    mapButton("+") { zoom = min(2.2, zoom * 1.15); zoomStart = zoom }
                    mapButton("−") { zoom = max(0.6, zoom / 1.15); zoomStart = zoom }
                    mapButton("Reset") {
                        yaw = 0.48
                        pitch = 0.52
                        zoom = 1.12
                        zoomStart = 1.12
                    }
                }
                .padding(.top, 56)
                .padding(.trailing, 8)
            }
            .overlay(alignment: .bottomLeading) {
                Text("\(tour.buildingName) · \(tour.floors.count) floors · \(floorName) · stop \(activeStopIndex + 1)/\(max(tour.stops.count, 1))")
                    .font(.system(size: 11))
                    .foregroundStyle(KeirosColor.secondary)
                    .padding(.leading, 12)
                    .padding(.bottom, 108)
            }
        }
        .background(
            LinearGradient(
                colors: [Color(red: 0.071, green: 0.188, blue: 0.416), Color(red: 0.039, green: 0.102, blue: 0.227), Color(red: 0.024, green: 0.063, blue: 0.122)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private func resolvedStopIndex(_ tour: PropertyTour) -> Int {
        let step = tour.journey[safe: store.state.activeStepIndex]
        if let stopId = step?.stopId, let index = tour.stops.firstIndex(where: { $0.id == stopId }) {
            return index
        }
        return store.state.currentStopIndex
    }

    private func dragGesture(size: CGSize, tour: PropertyTour) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let distance = hypot(value.translation.width, value.translation.height)
                if distance < 8 { return }
                if !dragging {
                    dragging = true
                    yawStart = yaw
                    pitchStart = pitch
                }
                yaw = wrapAngle(yawStart - value.translation.width * 0.01)
                pitch = min(1.25, max(0.18, pitchStart + value.translation.height * 0.008))
            }
            .onEnded { value in
                let distance = hypot(value.translation.width, value.translation.height)
                if distance < 12 {
                    selectHit(at: value.location, size: size, tour: tour)
                }
                dragging = false
            }
    }

    private var magnifyGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                zoom = min(2.2, max(0.6, zoomStart * value))
            }
            .onEnded { _ in
                zoomStart = zoom
            }
    }

    private func mapButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(label, action: action)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color(red: 0.490, green: 0.827, blue: 0.988))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color(red: 0.059, green: 0.157, blue: 0.314).opacity(0.9))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(red: 0.490, green: 0.827, blue: 0.988).opacity(0.35), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func selectHit(at location: CGPoint, size: CGSize, tour: PropertyTour) {
        let hits = collectHits(size: size, tour: tour)
        guard let hit = hits.min(by: { distance($0.point, location) < distance($1.point, location) }) else { return }
        if distance(hit.point, location) > 48 { return }
        if let unitId = hit.unitId, let floorId = hit.floorId {
            store.choosePlace(unitId, floorId: floorId)
        } else if let floorId = hit.floorId {
            store.selectFloor(floorId)
        }
    }

    private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        hypot(a.x - b.x, a.y - b.y)
    }

    private func wrapAngle(_ value: Double) -> Double {
        let turn = Double.pi * 2
        let remainder = value.truncatingRemainder(dividingBy: turn)
        return remainder < 0 ? remainder + turn : remainder
    }

    private func camera() -> IndoorCamera {
        IndoorCamera(yaw: yaw, pitch: pitch, zoom: zoom)
    }

    private func drawBuilding(context: inout GraphicsContext, size: CGSize, tour: PropertyTour, activeStopIndex: Int) {
        let metrics = BuildingMetrics(size: size, floorCount: tour.floors.count, camera: camera())
        let p = metrics.project
        face(context: &context, points: [p(0, 0, 0), p(metrics.width, 0, 0), p(metrics.width, metrics.depth, 0), p(0, metrics.depth, 0)], fill: Color(red: 0.008, green: 0.024, blue: 0.090).opacity(0.45), stroke: .clear, width: 0)
        face(context: &context, points: [p(metrics.width, 0, 0), p(metrics.width, metrics.depth, 0), p(metrics.width, metrics.depth, metrics.topZ), p(metrics.width, 0, metrics.topZ)], fill: Color(red: 0.220, green: 0.741, blue: 0.973).opacity(0.45), stroke: Color(red: 0.490, green: 0.827, blue: 0.988), width: 2)
        face(context: &context, points: [p(0, 0, 0), p(metrics.width, 0, 0), p(metrics.width, 0, metrics.topZ), p(0, 0, metrics.topZ)], fill: Color(red: 0.220, green: 0.741, blue: 0.973).opacity(0.35), stroke: Color(red: 0.878, green: 0.949, blue: 0.996), width: 2.5)

        for (index, floor) in tour.floors.enumerated() {
            let z = CGFloat(index + 1) * metrics.storyH
            let active = floor.id == store.state.selectedFloorId
            let stroke = active ? Color(red: 0.984, green: 0.749, blue: 0.141) : Color(red: 0.133, green: 0.827, blue: 0.933)
            let slab = [p(0, 0, z), p(metrics.width, 0, z), p(metrics.width, metrics.depth, z), p(0, metrics.depth, z)]
            let path = polygon(slab)
            if active { context.fill(path, with: .color(Color(red: 0.984, green: 0.749, blue: 0.141).opacity(0.2))) }
            context.stroke(path, with: .color(stroke), lineWidth: active ? 4 : 2)
            let labelAt = p(metrics.width + 0.2, metrics.depth * 0.35, z)
            context.draw(
                Text(floor.label).font(.system(size: 11, weight: .bold)).foregroundColor(active ? Color(red: 0.992, green: 0.902, blue: 0.541) : Color(red: 0.490, green: 0.827, blue: 0.988)),
                at: labelAt,
                anchor: .topLeading
            )
            let z0 = CGFloat(index) * metrics.storyH
            for col in 0..<4 {
                let x0 = 0.35 + CGFloat(col) * (metrics.width - 0.6) / 4
                let x1 = x0 + 0.45
                face(
                    context: &context,
                    points: [
                        p(x0, 0, z0 + metrics.storyH * 0.28),
                        p(x1, 0, z0 + metrics.storyH * 0.28),
                        p(x1, 0, z - metrics.storyH * 0.18),
                        p(x0, 0, z - metrics.storyH * 0.18),
                    ],
                    fill: Color(red: 0.878, green: 0.949, blue: 0.996).opacity(0.67),
                    stroke: Color(red: 0.490, green: 0.827, blue: 0.988).opacity(0.4),
                    width: 1
                )
            }
        }

        let roof = metrics.topZ + metrics.storyH * 0.25
        let pent = roof + metrics.storyH * 0.7
        face(context: &context, points: [p(0.2, 0.2, roof), p(metrics.width - 0.2, 0.2, roof), p(metrics.width - 0.2, metrics.depth - 0.2, roof), p(0.2, metrics.depth - 0.2, roof)], fill: Color(red: 0.118, green: 0.227, blue: 0.541).opacity(0.4), stroke: Color(red: 0.404, green: 0.910, blue: 0.976), width: 2)
        face(context: &context, points: [p(metrics.width * 0.55, metrics.depth * 0.12, roof), p(metrics.width * 0.88, metrics.depth * 0.12, roof), p(metrics.width * 0.88, metrics.depth * 0.12, pent), p(metrics.width * 0.55, metrics.depth * 0.12, pent)], fill: Color(red: 0.388, green: 0.400, blue: 0.945).opacity(0.4), stroke: Color(red: 0.769, green: 0.710, blue: 0.992), width: 2)
        face(context: &context, points: [p(metrics.width * 0.55, metrics.depth * 0.12, pent), p(metrics.width * 0.88, metrics.depth * 0.12, pent), p(metrics.width * 0.88, metrics.depth * 0.42, pent), p(metrics.width * 0.55, metrics.depth * 0.42, pent)], fill: Color(red: 0.388, green: 0.400, blue: 0.945).opacity(0.6), stroke: Color(red: 0.769, green: 0.710, blue: 0.992), width: 2)

        let route = tour.stops.compactMap { stop -> (TourStop, CGPoint)? in
            guard let at = metrics.unitPoint(stop.id, tour: tour) else { return nil }
            return (stop, at)
        }
        if route.count > 1 {
            for index in 0..<(route.count - 1) {
                let activeSeg = index == activeStopIndex || index + 1 == activeStopIndex
                var line = Path()
                line.move(to: route[index].1)
                line.addLine(to: route[index + 1].1)
                context.stroke(line, with: .color(activeSeg ? Color(red: 0.957, green: 0.447, blue: 0.714) : Color(red: 0.133, green: 0.773, blue: 0.369)), style: StrokeStyle(lineWidth: activeSeg ? 7 : 4.5, lineCap: .round))
            }
        }
        for (index, item) in route.enumerated() {
            let active = index == activeStopIndex
            let radius: CGFloat = active ? 16 : 11
            let dot = Path(ellipseIn: CGRect(x: item.1.x - radius, y: item.1.y - radius, width: radius * 2, height: radius * 2))
            context.fill(dot, with: .color(active ? Color(red: 0.957, green: 0.447, blue: 0.714) : Color(red: 0.020, green: 0.180, blue: 0.086)))
            context.stroke(dot, with: .color(active ? Color(red: 0.988, green: 0.906, blue: 0.953) : Color(red: 0.290, green: 0.871, blue: 0.502)), lineWidth: 3)
            context.draw(Text("\(index + 1)").font(.system(size: 10, weight: .bold)).foregroundColor(.white), at: item.1, anchor: .center)
            context.draw(
                Text(item.0.title).font(.system(size: 11, weight: .bold)).foregroundColor(active ? Color(red: 0.988, green: 0.906, blue: 0.953) : Color(red: 0.925, green: 0.992, blue: 0.961)),
                at: CGPoint(x: item.1.x + 18, y: item.1.y),
                anchor: .leading
            )
        }
        let routed = Set(route.map { $0.0.id })
        for unit in tour.units.filter({ $0.type != "parking" && $0.floorId == store.state.selectedFloorId }).prefix(12) where !routed.contains(unit.id) {
            guard let at = metrics.unitPoint(unit.id, tour: tour) else { continue }
            let hot = unit.id == store.state.destination?.id
            let radius: CGFloat = hot ? 12 : 8
            let dot = Path(ellipseIn: CGRect(x: at.x - radius, y: at.y - radius, width: radius * 2, height: radius * 2))
            context.fill(dot, with: .color(hot ? Color(red: 0.957, green: 0.447, blue: 0.714) : Color(red: 0.204, green: 0.827, blue: 0.600)))
            context.stroke(dot, with: .color(hot ? Color(red: 0.988, green: 0.906, blue: 0.953) : Color(red: 0.925, green: 0.992, blue: 0.961)), lineWidth: 2)
            context.draw(Text(unit.name).font(.system(size: 10)).foregroundColor(Color(red: 0.925, green: 0.992, blue: 0.961)), at: CGPoint(x: at.x + 14, y: at.y - 8), anchor: .topLeading)
        }
    }

    private func collectHits(size: CGSize, tour: PropertyTour) -> [MapHit] {
        let metrics = BuildingMetrics(size: size, floorCount: tour.floors.count, camera: camera())
        let p = metrics.project
        var hits: [MapHit] = []
        for (index, floor) in tour.floors.enumerated() {
            let z = CGFloat(index + 1) * metrics.storyH
            hits.append(MapHit(point: p(metrics.width + 0.2, metrics.depth * 0.35, z), floorId: floor.id, unitId: nil))
        }
        for stop in tour.stops {
            if let at = metrics.unitPoint(stop.id, tour: tour) {
                hits.append(MapHit(point: at, floorId: stop.floorId, unitId: stop.id))
            }
        }
        let routed = Set(tour.stops.map(\.id))
        for unit in tour.units.filter({ $0.type != "parking" && $0.floorId == store.state.selectedFloorId }).prefix(12) where !routed.contains(unit.id) {
            if let at = metrics.unitPoint(unit.id, tour: tour) {
                hits.append(MapHit(point: at, floorId: unit.floorId, unitId: unit.id))
            }
        }
        return hits
    }

    private func polygon(_ points: [CGPoint]) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)
        points.dropFirst().forEach { path.addLine(to: $0) }
        path.closeSubpath()
        return path
    }

    private func face(context: inout GraphicsContext, points: [CGPoint], fill: Color, stroke: Color, width: CGFloat) {
        let path = polygon(points)
        context.fill(path, with: .color(fill))
        if width > 0 {
            context.stroke(path, with: .color(stroke), lineWidth: width)
        }
    }
}

private struct BuildingMetrics {
    var width: CGFloat = 4.8
    var depth: CGFloat = 3.6
    var storyH: CGFloat = 0.55
    var topZ: CGFloat
    var project: (CGFloat, CGFloat, CGFloat) -> CGPoint

    init(size: CGSize, floorCount: Int, camera: IndoorCamera) {
        let storyCount = max(floorCount, 3)
        topZ = CGFloat(storyCount) * storyH
        let base = min(size.width, size.height) * 0.16
        let ox = size.width / 2
        let oy = size.height * 0.46
        let cx = width / 2
        let cy = depth / 2
        let cz = topZ / 2
        project = { x, y, z in
            let lx = x - cx
            let ly = y - cy
            let lz = z - cz
            let cosY = CGFloat(cos(camera.yaw))
            let sinY = CGFloat(sin(camera.yaw))
            let rx = lx * cosY - ly * sinY
            let ry = lx * sinY + ly * cosY
            let cosP = CGFloat(cos(camera.pitch))
            let sinP = CGFloat(sin(camera.pitch))
            let py = ry * cosP - lz * sinP
            let pz = ry * sinP + lz * cosP
            let scale = base * CGFloat(camera.zoom)
            return CGPoint(x: ox + rx * scale, y: oy - pz * scale + py * scale * 0.18)
        }
    }

    func unitPoint(_ unitId: String, tour: PropertyTour) -> CGPoint? {
        guard let unit = tour.units.first(where: { $0.id == unitId }) else { return nil }
        guard let floorIndex = tour.floors.firstIndex(where: { $0.id == unit.floorId }) else { return nil }
        let peers = tour.units.filter { $0.floorId == unit.floorId && $0.type != "parking" }
        let lngs = peers.map(\.longitude)
        let lats = peers.map(\.latitude)
        let minLng = lngs.min() ?? 0
        let maxLng = lngs.max() ?? 0
        let minLat = lats.min() ?? 0
        let maxLat = lats.max() ?? 0
        let local = peers.firstIndex(where: { $0.id == unit.id }) ?? 0
        let u: CGFloat
        let v: CGFloat
        if maxLng == minLng {
            u = CGFloat(local % 4) / 4
        } else {
            u = CGFloat((unit.longitude - minLng) / (maxLng - minLng))
        }
        if maxLat == minLat {
            v = CGFloat(local / 4) / 4
        } else {
            v = CGFloat((unit.latitude - minLat) / (maxLat - minLat))
        }
        let z = CGFloat(floorIndex + 1) * storyH + 0.04
        return project(0.45 + u * (width - 0.9), 0.4 + v * (depth - 0.8), z)
    }
}

struct DoorAccessScreen: View {
    @ObservedObject var store: TourStore
    var body: some View {
        let seen = store.state.visitedStopIds.count
        ZStack(alignment: .bottom) {
            HeroBackdrop(url: Photos.lobby)
            VStack { HStack { BackChip(action: store.goBack); Spacer() }; Spacer() }.padding(14)
            SheetCard(title: "Almost done", subtitle: seen > 0 ? "Nice — you visited \(seen) tour stop\(seen == 1 ? "" : "s"). Unlock amenities if you need access." : "Optional door unlocks for guest amenities.") {
                ForEach(store.state.tour.facilities) { facility in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(facility.name).font(.system(size: 15, weight: .bold)).foregroundStyle(KeirosColor.text)
                            Text("Guest access").font(.system(size: 12)).foregroundStyle(KeirosColor.muted)
                        }
                        Spacer()
                        Button(store.state.doorBusyId == facility.id ? "…" : "Unlock") { store.unlock(facility.id) }
                            .font(.system(size: 14, weight: .bold))
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            .background(KeirosColor.teal)
                            .foregroundStyle(Color(red: 0.016, green: 0.18, blue: 0.18))
                            .clipShape(Capsule())
                            .disabled(store.state.doorBusyId == facility.id)
                    }
                }
                if let result = store.state.doorResult {
                    VStack(alignment: .leading) {
                        Text("\(result.facilityName): \(result.granted ? "Unlocked" : "Unavailable")").font(.system(size: 15, weight: .bold)).foregroundStyle(KeirosColor.text)
                        Text(result.message).font(.system(size: 13)).foregroundStyle(KeirosColor.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background((result.granted ? KeirosColor.verified : KeirosColor.danger).opacity(0.15))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                PrimaryButton(label: "Wrap up my tour", action: store.goNext)
            }
        }
    }
}

struct CompleteScreen: View {
    @ObservedObject var store: TourStore
    var body: some View {
        ZStack(alignment: .bottom) {
            HeroBackdrop(url: Photos.unit)
            SheetCard(
                title: store.state.feedbackDone ? "Thanks for visiting" : "Tour complete",
                subtitle: store.state.feedbackDone ? "We saved your feedback." : (store.state.property?.name ?? "Property")
            ) {
                if !store.state.feedbackDone {
                    HStack {
                        stat("\(store.state.visitedStopIds.count)", "Stops seen")
                        stat("\(store.state.tour.stops.count)", "On your list")
                        stat("18m", "Tour time")
                    }
                    ForEach(store.state.tour.stops) { stop in
                        let seen = store.state.visitedStopIds.contains(stop.id)
                        Text("\(seen ? "✓" : "○") \(stop.title)")
                            .foregroundStyle(seen ? Color(red: 0.431, green: 0.906, blue: 0.718) : KeirosColor.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Text("How was this self-guided tour?").foregroundStyle(KeirosColor.secondary)
                    HStack {
                        ForEach(1...5, id: \.self) { n in
                            Button { store.setRating(n) } label: {
                                Text("★").font(.system(size: 28)).foregroundStyle(n <= store.state.rating ? KeirosColor.amber : KeirosColor.muted)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    PrimaryButton(label: store.state.busy ? "Saving…" : "Submit & finish", action: store.submitFeedback, enabled: !store.state.busy)
                } else {
                    PrimaryButton(label: "Tour another property", action: store.resetTour)
                }
            }
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack {
            Text(value).font(.system(size: 16, weight: .semibold)).foregroundStyle(KeirosColor.text)
            Text(label).font(.system(size: 11)).foregroundStyle(KeirosColor.muted)
        }
        .frame(maxWidth: .infinity).padding(8).background(Color.white.opacity(0.06)).clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
