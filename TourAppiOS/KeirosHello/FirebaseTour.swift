import Foundation

enum FirebaseTour {
    static var enabled: Bool {
        !FirebaseConfig.projectId.isEmpty && !FirebaseConfig.apiKey.isEmpty
    }

    static func lookup(_ propertyId: String) async throws -> PropertyMeta? {
        if !enabled || propertyId.isEmpty { return nil }
        let site = try await getDocument("site_properties", propertyId)
        let complex = try await getDocument("complexes", propertyId)
        let codeDoc = try await findCode(propertyId)
        let codeStatus = TourBuilder.stringValue(codeDoc?["status"])
        if codeStatus.caseInsensitiveCompare("Revoked") == .orderedSame || codeStatus.caseInsensitiveCompare("Expired") == .orderedSame {
            throw FirebaseError.message("This property code is \(codeStatus).")
        }
        var name = TourBuilder.stringValue(site?["name"])
        if name.isEmpty { name = TourBuilder.stringValue(complex?["name"]) }
        if name.isEmpty { name = TourBuilder.stringValue(codeDoc?["propertyName"]) }
        if name.isEmpty && codeDoc == nil { return nil }
        let city = TourBuilder.stringValue(site?["city"]).isEmpty ? TourBuilder.stringValue(complex?["city"]) : TourBuilder.stringValue(site?["city"])
        let address = TourBuilder.stringValue(site?["address"]).isEmpty ? TourBuilder.stringValue(complex?["address"]) : TourBuilder.stringValue(site?["address"])
        let buildings = TourBuilder.intValue(site?["buildings"]) ?? TourBuilder.intValue(complex?["buildings"]) ?? 1
        return PropertyMeta(
            code: TourBuilder.stringValue(codeDoc?["code"]).isEmpty ? propertyId : TourBuilder.stringValue(codeDoc?["code"]),
            propertyId: propertyId,
            name: name.isEmpty ? "Property \(propertyId)" : name,
            city: city,
            state: "",
            address: address,
            buildings: buildings
        )
    }

    static func loadMap(_ propertyId: String) async throws -> PropertyTour? {
        if !enabled || propertyId.isEmpty { return nil }
        let floors = try await query("floors", field: "propertyId", value: propertyId, limit: 80)
        let locations = try await query("locations", field: "propertyId", value: propertyId, limit: 250)
        let buildings = try await query("buildings", field: "complexId", value: propertyId, limit: 20)
        return TourBuilder.fromFirebase(propertyId: propertyId, buildings: buildings, floors: floors, locations: locations)
    }

    private static func query(_ collection: String, field: String, value: String, limit: Int) async throws -> [[String: Any]] {
        let body: [String: Any] = [
            "structuredQuery": [
                "from": [["collectionId": collection]],
                "where": [
                    "fieldFilter": [
                        "field": ["fieldPath": field],
                        "op": "EQUAL",
                        "value": ["stringValue": value],
                    ],
                ],
                "limit": limit,
            ],
        ]
        let rows = try await post("documents:runQuery", body)
        return rows.compactMap { ($0["document"] as? [String: Any]).map(fieldsOf) }
    }

    private static func findCode(_ propertyId: String) async throws -> [String: Any]? {
        let rows = try await query("property_codes", field: "propertyId", value: propertyId, limit: 5)
        return rows.first
    }

    private static func getDocument(_ collection: String, _ id: String) async throws -> [String: Any]? {
        let (status, object) = try await request(path: "documents/\(collection)/\(id)", method: "GET", body: nil)
        if status == 404 { return nil }
        guard let object else { return nil }
        return fieldsOf(object)
    }

    private static func fieldsOf(_ document: [String: Any]) -> [String: Any] {
        guard let fields = document["fields"] as? [String: Any] else { return [:] }
        var flat: [String: Any] = [:]
        for (key, raw) in fields {
            guard let value = raw as? [String: Any] else { continue }
            if let text = value["stringValue"] { flat[key] = text }
            else if let number = value["integerValue"] { flat[key] = number }
            else if let number = value["doubleValue"] { flat[key] = number }
            else if let flag = value["booleanValue"] { flat[key] = flag }
        }
        return flat
    }

    private static func post(_ path: String, _ body: [String: Any]) async throws -> [[String: Any]] {
        let (status, object) = try await request(path: path, method: "POST", body: body)
        if status == 404 { return [] }
        if let rows = object?["rows"] as? [[String: Any]] { return rows }
        return []
    }

    private static func request(path: String, method: String, body: [String: Any]?) async throws -> (Int, [String: Any]?) {
        var components = URLComponents(string: "https://firestore.googleapis.com/v1/projects/\(FirebaseConfig.projectId)/databases/(default)/\(path)")!
        components.queryItems = [URLQueryItem(name: "key", value: FirebaseConfig.apiKey)]
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 12
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let text = String(data: data, encoding: .utf8) ?? ""
        if status == 403 || text.contains("PERMISSION_DENIED") {
            throw FirebaseError.message("Firebase refused the property read. Deploy the updated Firestore rules.")
        }
        if !(200...299).contains(status) && status != 404 {
            throw FirebaseError.message("Firebase request failed (\(status)).")
        }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("[") {
            let rows = (try JSONSerialization.jsonObject(with: data) as? [[String: Any]]) ?? []
            return (status, ["rows": rows])
        }
        if data.isEmpty { return (status, nil) }
        return (status, try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}

enum FirebaseError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let text) = self { return text }
        return nil
    }
}
