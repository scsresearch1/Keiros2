import SwiftUI

struct OverviewScreen: View {
    @ObservedObject var store: TourStore
    var body: some View {
        let property = store.state.property
        let places = store.state.tour.stops.count
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        BackChip(action: store.goBack)
                        Text("KeirosTour").font(.system(size: 18, weight: .bold)).foregroundStyle(KeirosColor.teal)
                    }
                    Text("WELCOME").font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.teal)
                    Text("Tour \(property?.name ?? "the property")").font(.system(size: 30, weight: .semibold)).foregroundStyle(KeirosColor.text)
                    Text("No guide needed. Follow a curated walkthrough of highlights, or wander freely — you’re in control.")
                        .foregroundStyle(KeirosColor.secondary)
                    ZStack(alignment: .bottomLeading) {
                        AsyncImage(url: URL(string: Photos.campus)) { image in image.resizable().scaledToFill() } placeholder: { KeirosColor.navy }
                            .frame(height: 280).clipped()
                        LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .center, endPoint: .bottom)
                        VStack(alignment: .leading, spacing: 6) {
                            if let code = property?.code {
                                Text(code).font(.system(size: 11, weight: .bold)).padding(.horizontal, 10).padding(.vertical, 6)
                                    .background(KeirosColor.teal).clipShape(Capsule()).foregroundStyle(Color(red: 0.016, green: 0.18, blue: 0.18))
                            }
                            Text(property?.name ?? "Property").font(.system(size: 26, weight: .semibold)).foregroundStyle(.white)
                            Text([property?.city, "\(property?.buildings ?? 2) buildings", "\(places)+ places"].compactMap { $0 }.joined(separator: " · "))
                                .foregroundStyle(.white.opacity(0.85))
                            Button("Start self-guided tour", action: store.startGuidedTour)
                                .font(.system(size: 14, weight: .bold)).foregroundStyle(Color(red: 0.04, green: 0.09, blue: 0.16))
                                .padding(.horizontal, 16).padding(.vertical, 10).background(.white).clipShape(Capsule())
                        }
                        .padding(16)
                    }
                    .frame(height: 280)
                    .clipShape(RoundedRectangle(cornerRadius: 28))
                    note("Enter once", "Get inside the building first")
                    note("Lowest floor first", "Visit every unit on a floor, then move up")
                    note("End anytime", "Leave the tour whenever you’re ready")
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 130)
            }
            VStack(spacing: 8) {
                PrimaryButton(label: "Start self-guided tour", action: store.startGuidedTour)
                Button("Browse places instead", action: store.startBrowseTour).foregroundStyle(KeirosColor.secondary)
            }
            .padding(18)
            .background(LinearGradient(colors: [.clear, KeirosColor.navy], startPoint: .top, endPoint: .bottom))
        }
        .background(KeirosColor.navy)
    }

    private func note(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading) {
            Text(title).font(.system(size: 15, weight: .bold)).foregroundStyle(KeirosColor.text)
            Text(body).font(.system(size: 13)).foregroundStyle(KeirosColor.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct SearchScreen: View {
    @ObservedObject var store: TourStore
    var body: some View {
        let showTour = store.state.searchTab == "tour" && store.state.tourMode == .guided
        let tour = store.state.tour
        let stop = tour.stops[safe: store.state.currentStopIndex]
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    BackChip(action: store.goBack)
                    if store.state.tourMode == .guided {
                        HStack {
                            pill("My tour", store.state.searchTab == "tour") { store.setSearchTab("tour") }
                            pill("Explore map", store.state.searchTab == "browse") { store.setSearchTab("browse") }
                        }
                    }
                    if showTour {
                        Text("SELF-GUIDED · ~\(tour.estimateMinutes()) MIN").font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.teal)
                        Text("Floor by floor").font(.system(size: 30, weight: .semibold)).foregroundStyle(KeirosColor.text)
                        Text("Start on the lowest floor, visit every unit there, then move up one floor at a time.")
                            .foregroundStyle(KeirosColor.secondary)
                        ForEach(Array(tour.floors.enumerated()), id: \.element.id) { index, floor in
                            let group = tour.stops.filter { $0.floorId == floor.id }
                            if !group.isEmpty {
                                HStack {
                                    Text("FLOOR \(index + 1)").font(.system(size: 11, weight: .bold)).foregroundStyle(Color(red: 0.49, green: 0.83, blue: 0.99))
                                    Text(floor.label).foregroundStyle(KeirosColor.text)
                                    Spacer()
                                    Text("\(group.count) stops").font(.system(size: 12)).foregroundStyle(KeirosColor.muted)
                                }
                                ForEach(group) { item in StopCard(stop: item, store: store) }
                            }
                        }
                    } else {
                        Text("EXPLORE").font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.teal)
                        Text("Places to see").font(.system(size: 30, weight: .semibold)).foregroundStyle(KeirosColor.text)
                        TextField("Search homes or amenities", text: Binding(get: { store.state.searchQuery }, set: store.setSearchQuery))
                            .foregroundStyle(KeirosColor.text)
                            .padding(14)
                            .background(Color.white.opacity(0.06))
                            .clipShape(Capsule())
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(tour.filters, id: \.0) { id, label in
                                    Button(label) { store.setFilter(id) }
                                        .font(.system(size: 13, weight: .semibold))
                                        .padding(.horizontal, 14).padding(.vertical, 8)
                                        .background(store.state.filter == id ? KeirosColor.blue : Color.white.opacity(0.08))
                                        .foregroundStyle(store.state.filter == id ? .white : KeirosColor.secondary)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                        let results = store.filteredUnits()
                        if results.isEmpty { Text("No matches — try another filter.").foregroundStyle(KeirosColor.muted) }
                        ForEach(results) { unit in
                            Button { store.selectUnit(unit) } label: {
                                HStack {
                                    RemoteThumb(url: Photos.forType(unit.type, name: unit.name))
                                    VStack(alignment: .leading) {
                                        Text(unit.name).font(.system(size: 15, weight: .bold)).foregroundStyle(KeirosColor.text)
                                        Text("\(unit.buildingName) · \(unit.floorLabel)").font(.system(size: 13)).foregroundStyle(KeirosColor.muted)
                                    }
                                    Spacer()
                                }
                                .padding(6)
                                .background(Color.white.opacity(0.05))
                                .overlay(RoundedRectangle(cornerRadius: 22).stroke(store.state.destination?.id == unit.id ? KeirosColor.blue : Color.white.opacity(0.12), lineWidth: 1))
                                .clipShape(RoundedRectangle(cornerRadius: 22))
                            }
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 120)
            }
            let label: String = {
                if store.state.navigateLoading { return "Getting directions…" }
                if showTour, let stop { return "Head to \(stop.title)" }
                if let dest = store.state.destination { return "Head to \(dest.name)" }
                return "Choose a stop"
            }()
            PrimaryButton(label: label, action: store.runNavigate, enabled: store.state.destination != nil && !store.state.navigateLoading)
                .padding(18)
                .background(LinearGradient(colors: [.clear, KeirosColor.navy], startPoint: .top, endPoint: .bottom))
        }
        .background(KeirosColor.navy)
    }

    private func pill(_ label: String, _ active: Bool, action: @escaping () -> Void) -> some View {
        Button(label, action: action)
            .font(.system(size: 13, weight: .bold))
            .padding(.horizontal, 18).padding(.vertical, 10)
            .background(active ? Color(red: 0.22, green: 0.74, blue: 0.97) : Color.clear)
            .foregroundStyle(active ? Color(red: 0.016, green: 0.06, blue: 0.12) : KeirosColor.secondary)
            .clipShape(Capsule())
    }
}

struct StopCard: View {
    var stop: TourStop
    @ObservedObject var store: TourStore
    var body: some View {
        let index = store.state.tour.stops.firstIndex { $0.id == stop.id } ?? 0
        let current = index == store.state.currentStopIndex
        let visited = store.state.visitedStopIds.contains(stop.id)
        Button { store.selectStop(index) } label: {
            HStack {
                RemoteThumb(url: Photos.forType(stop.unit.type, name: stop.unit.name))
                VStack(alignment: .leading, spacing: 2) {
                    Text((stop.role == "entry" ? "Enter here" : "Stop \(stop.order)") + (visited ? " · Seen" : current ? " · Up next" : ""))
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Color(red: 0.49, green: 0.83, blue: 0.99))
                    Text(stop.title).font(.system(size: 15, weight: .bold)).foregroundStyle(KeirosColor.text)
                    Text(stop.blurb).font(.system(size: 12)).foregroundStyle(KeirosColor.muted)
                }
                Spacer()
            }
            .padding(8)
            .background(Color.white.opacity(0.05))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(current ? Color(red: 0.22, green: 0.74, blue: 0.97).opacity(0.7) : Color.white.opacity(0.12), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }
}

struct RoutePreviewScreen: View {
    @ObservedObject var store: TourStore
    var body: some View {
        let tour = store.state.tour
        let stop = tour.stops[safe: store.state.currentStopIndex]
        let title = stop?.title ?? store.state.destination?.name ?? "Next stop"
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                OutdoorMapView(route: tour.outdoor, active: tour.journey.first, weather: store.state.weatherSummary, traffic: store.state.trafficLevel)
                BackChip(action: store.goBack).padding(14)
                Text("\(store.state.weatherSummary) · Traffic \(store.state.trafficLevel)")
                    .font(.system(size: 12)).foregroundStyle(Color(red: 0.49, green: 0.83, blue: 0.99))
                    .padding(8).background(KeirosColor.navy.opacity(0.85)).clipShape(RoundedRectangle(cornerRadius: 12))
                    .padding(12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(store.state.tourMode == .guided && store.state.currentStopIndex == 0 ? "STEP 1 · GET INSIDE" : "NEXT ON YOUR TOUR")
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.teal)
                Text(title).font(.system(size: 22, weight: .semibold)).foregroundStyle(KeirosColor.text)
                if let stop { Text(stop.blurb).foregroundStyle(KeirosColor.secondary) }
                HStack {
                    stat("6m", "To parking")
                    stat("3m", "To entrance")
                    stat("\(tour.journey.filter { $0.phase == "indoor" }.count)m", "Inside")
                }
                PrimaryButton(label: "Continue to this stop", action: store.openNavigation)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(KeirosColor.navy)
        }
        .background(KeirosColor.navy)
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack {
            Text(value).font(.system(size: 16, weight: .semibold)).foregroundStyle(KeirosColor.text)
            Text(label).font(.system(size: 11)).foregroundStyle(KeirosColor.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
