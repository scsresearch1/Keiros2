import Foundation

struct OutdoorRoute: Equatable {
    var originLat: Double
    var originLng: Double
    var parkingLat: Double
    var parkingLng: Double
    var entranceLat: Double
    var entranceLng: Double
    var drivePath: [(Double, Double)]
    var walkPath: [(Double, Double)]

    static func == (lhs: OutdoorRoute, rhs: OutdoorRoute) -> Bool {
        lhs.originLat == rhs.originLat && lhs.parkingLat == rhs.parkingLat && lhs.entranceLat == rhs.entranceLat
    }
}

struct PropertyTour: Equatable {
    var propertyId: String
    var buildingName: String
    var floors: [FloorInfo]
    var units: [TourUnit]
    var stops: [TourStop]
    var journey: [JourneyStep]
    var facilities: [Facility]
    var filters: [(String, String)]
    var outdoor: OutdoorRoute

    static func == (lhs: PropertyTour, rhs: PropertyTour) -> Bool { lhs.propertyId == rhs.propertyId && lhs.stops.count == rhs.stops.count }

    func estimateMinutes() -> Int { max(12, Int((Double(stops.count) * 2.5).rounded(.down)) + 6) }
}

struct PropertyMeta: Equatable {
    var code: String
    var propertyId: String
    var name: String
    var city: String
    var state: String
    var address: String
    var buildings: Int
}

struct AccessScan {
    var propertyId: String
    var code: String
    var propertyName: String
}

struct TourUnit: Equatable, Identifiable {
    var id: String
    var name: String
    var type: String
    var buildingName: String
    var floorId: String
    var floorLabel: String
    var floorLevel: Int
    var latitude: Double = 0
    var longitude: Double = 0
}

struct TourStop: Equatable, Identifiable {
    var id: String
    var unit: TourUnit
    var title: String
    var blurb: String
    var order: Int
    var floorId: String
    var floorLabel: String
    var role: String
}

struct FloorInfo: Equatable, Identifiable {
    var id: String
    var label: String
    var level: Int
}

struct JourneyStep: Equatable, Identifiable {
    var id: String
    var phase: String
    var instruction: String
    var latitude: Double = 41.8874
    var longitude: Double = -87.6236
    var stopId: String?
}

struct Facility: Equatable, Identifiable {
    var id: String
    var name: String
    var type: String = ""
}

struct DoorResult: Equatable {
    var facilityName: String
    var granted: Bool
    var message: String
}

enum Photos {
    static let splash = "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80"
    static let campus = "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80"
    static let lobby = "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80"
    static let unit = "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1000&q=80"
    static let amenity = "https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1000&q=80"
    static let pool = "https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=1000&q=80"
    static let parking = "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&w=1000&q=80"
    static let night = "https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=1200&q=80"

    static func forType(_ type: String, name: String = "") -> String {
        let hay = "\(type) \(name)".lowercased()
        if hay.contains("pool") { return pool }
        if hay.contains("gym") || hay.contains("fitness") { return amenity }
        if hay.contains("park") { return parking }
        if hay.contains("lobby") || hay.contains("leas") || hay.contains("office") || hay.contains("club") { return lobby }
        return unit
    }
}

enum DemoTour {
    static let demoCode = "OC-CHI-2026"

    static let properties: [PropertyMeta] = [
        PropertyMeta(code: "OC-CHI-2026", propertyId: "cpx-001", name: "Orion Complex", city: "Chicago", state: "IL", address: "1200 N Michigan Ave, Chicago, IL", buildings: 2),
        PropertyMeta(code: "HM-BOS-RETAIL", propertyId: "cpx-002", name: "Harbor Mall Campus", city: "Boston", state: "MA", address: "88 Seaport Blvd, Boston, MA", buildings: 1),
        PropertyMeta(code: "SMC-DEN-PAT", propertyId: "cpx-004", name: "Summit Medical Campus", city: "Denver", state: "CO", address: "2550 E 17th Ave, Denver, CO", buildings: 2),
    ]

    static let floors: [FloorInfo] = [
        FloorInfo(id: "f1", label: "Ground", level: 1),
        FloorInfo(id: "f2", label: "Level 2", level: 2),
        FloorInfo(id: "f3", label: "Level 3", level: 3),
    ]

    static let units: [TourUnit] = [
        TourUnit(id: "u1", name: "Main Lobby", type: "lobby", buildingName: "Tower A", floorId: "f1", floorLabel: "Ground", floorLevel: 1),
        TourUnit(id: "u2", name: "Leasing Office", type: "leasing", buildingName: "Tower A", floorId: "f1", floorLabel: "Ground", floorLevel: 1),
        TourUnit(id: "u3", name: "Fitness Center", type: "gym", buildingName: "Tower A", floorId: "f2", floorLabel: "Level 2", floorLevel: 2),
        TourUnit(id: "u4", name: "Pool Deck", type: "pool", buildingName: "Tower A", floorId: "f2", floorLabel: "Level 2", floorLevel: 2),
        TourUnit(id: "u5", name: "Clubhouse", type: "club", buildingName: "Tower A", floorId: "f2", floorLabel: "Level 2", floorLevel: 2),
        TourUnit(id: "u6", name: "Model Home 301", type: "unit", buildingName: "Tower A", floorId: "f3", floorLabel: "Level 3", floorLevel: 3),
        TourUnit(id: "u7", name: "Model Home 302", type: "unit", buildingName: "Tower A", floorId: "f3", floorLabel: "Level 3", floorLevel: 3),
        TourUnit(id: "u8", name: "Resident Parking", type: "parking", buildingName: "Garage", floorId: "f1", floorLabel: "Ground", floorLevel: 1),
    ]

    static let stops: [TourStop] = units.filter { $0.type != "parking" }.enumerated().map { index, unit in
        let onFloor = units.filter { $0.floorId == unit.floorId && $0.type != "parking" }.count
        let blurb: String
        if index == 0 {
            blurb = "Enter on \(unit.floorLabel), then we’ll visit every space floor by floor."
        } else if unit.type == "unit" {
            blurb = "\(unit.floorLabel) · home on this floor."
        } else {
            blurb = "\(unit.floorLabel) · stop on this level · \(onFloor) spaces."
        }
        return TourStop(id: unit.id, unit: unit, title: unit.name, blurb: blurb, order: index + 1, floorId: unit.floorId, floorLabel: unit.floorLabel, role: index == 0 ? "entry" : "inside")
    }

    static let originLat = 41.8920
    static let originLng = -87.6290
    static let parkingLat = 41.8884
    static let parkingLng = -87.6248
    static let entranceLat = 41.8876
    static let entranceLng = -87.6239

    static let drivePath: [(Double, Double)] = [
        (originLat, originLng), (41.8912, -87.6274), (41.8901, -87.6262), (41.8892, -87.6254), (parkingLat, parkingLng),
    ]
    static let walkPath: [(Double, Double)] = [
        (parkingLat, parkingLng), (41.8880, -87.6244), (entranceLat, entranceLng),
    ]

    static let journey: [JourneyStep] = [
        JourneyStep(id: "s1", phase: "drive", instruction: "Head north toward resident parking on the side of Tower A.", latitude: 41.8901, longitude: -87.6262),
        JourneyStep(id: "s2", phase: "walk", instruction: "Walk from the garage to the main lobby entrance.", latitude: entranceLat, longitude: entranceLng),
        JourneyStep(id: "s3", phase: "indoor", instruction: "Enter through the lobby doors and check in.", stopId: "u1"),
        JourneyStep(id: "s4", phase: "indoor", instruction: "Continue to the leasing office on this floor.", stopId: "u2"),
        JourneyStep(id: "s5", phase: "indoor", instruction: "Take the elevator to Level 2 and enter the fitness center.", stopId: "u3"),
        JourneyStep(id: "s6", phase: "indoor", instruction: "Walk across Level 2 to the pool deck.", stopId: "u4"),
        JourneyStep(id: "s7", phase: "indoor", instruction: "Step into the clubhouse beside the pool.", stopId: "u5"),
        JourneyStep(id: "s8", phase: "indoor", instruction: "Go up to Level 3 and enter Model Home 301.", stopId: "u6"),
        JourneyStep(id: "s9", phase: "indoor", instruction: "Finish at Model Home 302 next door.", stopId: "u7"),
    ]

    static let facilities: [Facility] = [
        Facility(id: "door_lobby", name: "Main Lobby"),
        Facility(id: "door_gym", name: "Fitness Center"),
        Facility(id: "door_pool", name: "Pool Deck"),
        Facility(id: "door_pkg", name: "Resident Parking Gate"),
        Facility(id: "door_club", name: "Clubhouse"),
    ]

    static let filters: [(String, String)] = [
        ("all", "All"), ("unit", "Homes"), ("gym", "Gym"), ("pool", "Pool"), ("club", "Club"), ("park", "Parking"),
    ]

    static func propertyFor(_ raw: String) -> PropertyMeta? {
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased().replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
        return properties.first { $0.code == code }
    }

    static func propertyForId(_ propertyId: String) -> PropertyMeta? {
        properties.first { $0.propertyId == propertyId.trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    static func parseScan(_ raw: String) -> AccessScan {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        var propertyId = ""
        var code = ""
        var propertyName = ""
        let normalized = text.replacingOccurrences(of: "keiros://", with: "https://keiros.local/", options: .caseInsensitive)
        if let components = URLComponents(string: normalized) {
            propertyId = components.queryItems?.first { $0.name.caseInsensitiveCompare("propertyId") == .orderedSame }?.value?.trimmingCharacters(in: .whitespaces) ?? ""
            code = components.queryItems?.first { $0.name.caseInsensitiveCompare("code") == .orderedSame }?.value?.trimmingCharacters(in: .whitespaces) ?? ""
            propertyName = components.queryItems?.first { $0.name.caseInsensitiveCompare("property") == .orderedSame }?.value?.trimmingCharacters(in: .whitespaces) ?? ""
        }
        if propertyId.isEmpty, let match = text.range(of: "[?&]propertyId=([^&#\\s]+)", options: .regularExpression) {
            let chunk = String(text[match])
            propertyId = chunk.components(separatedBy: "=").dropFirst().joined(separator: "=").removingPercentEncoding ?? ""
        }
        if code.isEmpty {
            code = text.uppercased().replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
        }
        return AccessScan(propertyId: propertyId, code: code.uppercased().replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression), propertyName: propertyName)
    }

    static let pack = PropertyTour(
        propertyId: "cpx-001",
        buildingName: "Tower A",
        floors: floors,
        units: units,
        stops: stops,
        journey: journey,
        facilities: facilities,
        filters: filters,
        outdoor: OutdoorRoute(
            originLat: originLat, originLng: originLng,
            parkingLat: parkingLat, parkingLng: parkingLng,
            entranceLat: entranceLat, entranceLng: entranceLng,
            drivePath: drivePath, walkPath: walkPath
        )
    )
}

enum TourBuilder {
    static func fromFirebase(propertyId: String, buildings: [[String: Any]], floors: [[String: Any]], locations: [[String: Any]]) -> PropertyTour? {
        struct RawPlace {
            var id: String
            var name: String
            var type: String
            var buildingName: String
            var floorId: String
            var floorLabel: String
            var lat: Double
            var lng: Double
            var elevation: Double
        }
        let places: [RawPlace] = locations.compactMap { loc in
            guard let lat = doubleValue(loc["latitude"]), let lng = doubleValue(loc["longitude"]) else { return nil }
            let id = stringValue(loc["id"])
            if id.isEmpty { return nil }
            return RawPlace(
                id: id,
                name: stringValue(loc["name"]).isEmpty ? "Place" : stringValue(loc["name"]),
                type: normalize(stringValue(loc["type"])),
                buildingName: stringValue(loc["buildingName"]).isEmpty ? "Building" : stringValue(loc["buildingName"]),
                floorId: stringValue(loc["floorId"]),
                floorLabel: stringValue(loc["floorLabel"]).isEmpty ? "Floor" : stringValue(loc["floorLabel"]),
                lat: lat, lng: lng,
                elevation: doubleValue(loc["elevation"]) ?? 0
            )
        }
        if places.isEmpty { return nil }
        var floorRows = floors.compactMap { row -> FloorInfo? in
            let id = stringValue(row["id"])
            if id.isEmpty || !places.contains(where: { $0.floorId == id }) { return nil }
            return FloorInfo(id: id, label: stringValue(row["label"]).isEmpty ? "Floor" : stringValue(row["label"]), level: intValue(row["level"]) ?? 0)
        }.sorted { $0.level < $1.level }
        if floorRows.isEmpty {
            var seen = Set<String>()
            floorRows = places.compactMap { place in
                if seen.contains(place.floorId) { return nil }
                seen.insert(place.floorId)
                return FloorInfo(id: place.floorId, label: place.floorLabel, level: 0)
            }
        }
        let levelOf = Dictionary(uniqueKeysWithValues: floorRows.map { ($0.id, $0.level) })
        let buildingName = stringValue(buildings.first?["name"]).isEmpty
            ? (Dictionary(grouping: places, by: \.buildingName).max { $0.value.count < $1.value.count }?.key ?? "Building")
            : stringValue(buildings.first?["name"])
        let units = places.map { place in
            TourUnit(id: place.id, name: place.name, type: place.type, buildingName: place.buildingName, floorId: place.floorId, floorLabel: place.floorLabel, floorLevel: levelOf[place.floorId] ?? 0, latitude: place.lat, longitude: place.lng)
        }
        let highlights = places.filter { $0.type != "parking" && $0.type != "path" }
            .sorted { a, b in
                let pa = priority(a.type), pb = priority(b.type)
                if pa != pb { return pa < pb }
                let la = levelOf[a.floorId] ?? 0, lb = levelOf[b.floorId] ?? 0
                if la != lb { return la < lb }
                return a.name < b.name
            }
        var chosen: [RawPlace] = []
        for place in highlights where ["lobby", "entry", "amenity", "gym", "pool", "club"].contains(place.type) { chosen.append(place) }
        for place in highlights where place.type == "unit" || place.type == "room" {
            if chosen.filter({ $0.type == "unit" || $0.type == "room" }).count < 4 { chosen.append(place) }
        }
        if chosen.isEmpty { chosen = Array(highlights.prefix(6)) }
        var seenIds = Set<String>()
        chosen = chosen.filter { seenIds.insert($0.id).inserted }
            .sorted {
                let la = levelOf[$0.floorId] ?? 0, lb = levelOf[$1.floorId] ?? 0
                return la == lb ? $0.name < $1.name : la < lb
            }
        chosen = Array(chosen.prefix(10))
        let stops: [TourStop] = chosen.enumerated().map { index, place in
            let unit = units.first { $0.id == place.id }!
            return TourStop(id: place.id, unit: unit, title: place.name, blurb: "\(place.floorLabel) · \(place.buildingName)", order: index + 1, floorId: place.floorId, floorLabel: place.floorLabel, role: index == 0 ? "entry" : "inside")
        }
        let parking = places.first { $0.type == "parking" } ?? places.min { $0.elevation < $1.elevation }!
        let entrance = chosen.first ?? places.min { $0.elevation < $1.elevation }!
        let originLat = entrance.lat - 0.006
        let originLng = entrance.lng - 0.004
        let outdoor = OutdoorRoute(
            originLat: originLat, originLng: originLng,
            parkingLat: parking.lat, parkingLng: parking.lng,
            entranceLat: entrance.lat, entranceLng: entrance.lng,
            drivePath: [(originLat, originLng), ((originLat + parking.lat) / 2, (originLng + parking.lng) / 2), (parking.lat, parking.lng)],
            walkPath: [(parking.lat, parking.lng), ((parking.lat + entrance.lat) / 2, (parking.lng + entrance.lng) / 2), (entrance.lat, entrance.lng)]
        )
        var journey: [JourneyStep] = [
            JourneyStep(id: "drive", phase: "drive", instruction: "Drive to parking at \(buildingName).", latitude: (originLat + parking.lat) / 2, longitude: (originLng + parking.lng) / 2),
            JourneyStep(id: "walk", phase: "walk", instruction: "Walk from parking to \(entrance.name).", latitude: entrance.lat, longitude: entrance.lng),
        ]
        journey.append(contentsOf: stops.map { JourneyStep(id: $0.id, phase: "indoor", instruction: "Continue to \($0.title) on \($0.floorLabel).", stopId: $0.id) })
        let doors = places.filter { ["door", "lobby", "entry", "gym", "pool", "parking", "amenity"].contains($0.type) }
        var doorSeen = Set<String>()
        let uniqueDoors = doors.filter { doorSeen.insert($0.name).inserted }.prefix(6)
        let facilities: [Facility] = uniqueDoors.isEmpty
            ? stops.prefix(4).map { Facility(id: $0.id, name: $0.title, type: $0.unit.type) }
            : uniqueDoors.map { Facility(id: $0.id, name: $0.name, type: $0.type) }
        var filters: [(String, String)] = [("all", "All")]
        if units.contains(where: { $0.type == "unit" || $0.type == "room" }) { filters.append(("unit", "Places")) }
        if units.contains(where: { $0.type == "gym" }) { filters.append(("gym", "Gym")) }
        if units.contains(where: { $0.type == "pool" }) { filters.append(("pool", "Pool")) }
        if units.contains(where: { $0.type == "amenity" || $0.type == "lobby" }) { filters.append(("amenity", "Amenities")) }
        if units.contains(where: { $0.type == "parking" }) { filters.append(("park", "Parking")) }
        var shown = floorRows.filter { floor in stops.contains { $0.floorId == floor.id } || units.contains { $0.floorId == floor.id } }
        if shown.count > 12 { shown = shown.filter { floor in stops.contains { $0.floorId == floor.id } } }
        return PropertyTour(propertyId: propertyId, buildingName: buildingName, floors: shown.isEmpty ? Array(floorRows.prefix(8)) : shown, units: units, stops: stops, journey: journey, facilities: facilities, filters: filters, outdoor: outdoor)
    }

    private static func normalize(_ type: String) -> String {
        switch type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "unit": return "unit"
        case "room": return "room"
        case "lobby": return "lobby"
        case "gym": return "gym"
        case "pool": return "pool"
        case "parking": return "parking"
        case "amenity": return "amenity"
        case "entry", "exit", "door": return "entry"
        case "elevator", "stairs", "corridor": return "path"
        default:
            let trimmed = type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return trimmed.isEmpty ? "room" : trimmed
        }
    }

    private static func priority(_ type: String) -> Int {
        switch type {
        case "lobby", "entry": return 0
        case "amenity", "gym", "pool", "club": return 1
        case "unit", "room": return 2
        default: return 3
        }
    }

    static func stringValue(_ value: Any?) -> String {
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return ""
    }

    static func doubleValue(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue }
        if let text = value as? String { return Double(text) }
        return nil
    }

    static func intValue(_ value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String {
            if let int = Int(text) { return int }
            if let dbl = Double(text) { return Int(dbl) }
            return nil
        }
        return nil
    }
}
