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
                    IndoorPlan(store: store)
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

struct IndoorPlan: View {
    @ObservedObject var store: TourStore
    var body: some View {
        let floors = store.state.tour.floors
        GeometryReader { geo in
            ZStack {
                LinearGradient(colors: [Color(red: 0.07, green: 0.19, blue: 0.42), Color(red: 0.02, green: 0.06, blue: 0.12)], startPoint: .top, endPoint: .bottom)
                VStack(spacing: 8) {
                    ForEach(floors.reversed()) { floor in
                        let active = floor.id == store.state.selectedFloorId
                        VStack(alignment: .leading, spacing: 6) {
                            Text(floor.label).font(.system(size: 12, weight: .bold)).foregroundStyle(.white.opacity(0.8))
                            let units = store.state.tour.units.filter { $0.floorId == floor.id }
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6)], spacing: 6) {
                                ForEach(units) { unit in
                                    Button { store.choosePlace(unit.id, floorId: floor.id) } label: {
                                        Text(unit.name)
                                            .font(.system(size: 11, weight: .bold))
                                            .foregroundStyle(.white)
                                            .frame(maxWidth: .infinity, minHeight: 36)
                                            .padding(4)
                                            .background(store.state.destination?.id == unit.id ? KeirosColor.teal.opacity(0.7) : Color.white.opacity(0.12))
                                            .clipShape(RoundedRectangle(cornerRadius: 8))
                                    }
                                }
                            }
                        }
                        .padding(10)
                        .background(active ? Color.white.opacity(0.08) : Color.black.opacity(0.25))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(active ? KeirosColor.teal : Color.white.opacity(0.15), lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                .padding(.top, 70)
                .padding(.horizontal, 16)
                .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
            }
        }
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
