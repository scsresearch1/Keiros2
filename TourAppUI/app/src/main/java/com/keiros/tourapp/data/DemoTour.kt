package com.keiros.tourapp.data

data class PropertyMeta(
    val code: String,
    val propertyId: String,
    val name: String,
    val city: String,
    val state: String,
    val address: String,
    val buildings: Int,
)

data class AccessScan(
    val propertyId: String,
    val code: String,
    val propertyName: String,
)

data class TourUnit(
    val id: String,
    val name: String,
    val type: String,
    val buildingName: String,
    val floorId: String,
    val floorLabel: String,
    val floorLevel: Int,
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
)

data class TourStop(
    val id: String,
    val unit: TourUnit,
    val title: String,
    val blurb: String,
    val order: Int,
    val floorId: String,
    val floorLabel: String,
    val role: String,
)

data class FloorInfo(val id: String, val label: String, val level: Int)

data class JourneyStep(
    val id: String,
    val phase: String,
    val instruction: String,
    val latitude: Double = 41.8874,
    val longitude: Double = -87.6236,
    val stopId: String? = null,
)

data class Place(
    val id: String,
    val name: String,
    val type: String,
    val floorId: String,
)

data class Facility(val id: String, val name: String, val type: String = "")

data class DoorResult(val facilityName: String, val granted: Boolean, val message: String)

object Photos {
    const val splash =
        "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80"
    const val campus =
        "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80"
    const val lobby =
        "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80"
    const val unit =
        "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=1000&q=80"
    const val amenity =
        "https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1000&q=80"
    const val pool =
        "https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?auto=format&fit=crop&w=1000&q=80"
    const val parking =
        "https://images.unsplash.com/photo-1506521781263-d8422e82f27a?auto=format&fit=crop&w=1000&q=80"
    const val night =
        "https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=1200&q=80"

    fun forType(type: String, name: String = ""): String {
        val hay = "$type $name".lowercase()
        return when {
            "pool" in hay -> pool
            "gym" in hay || "fitness" in hay -> amenity
            "park" in hay -> parking
            "lobby" in hay || "leas" in hay || "office" in hay || "club" in hay -> lobby
            else -> unit
        }
    }
}

object DemoTour {
    const val demoCode = "OC-CHI-2026"

    val properties = listOf(
        PropertyMeta("OC-CHI-2026", "cpx-001", "Orion Complex", "Chicago", "IL", "1200 N Michigan Ave, Chicago, IL", 2),
        PropertyMeta("HM-BOS-RETAIL", "cpx-002", "Harbor Mall Campus", "Boston", "MA", "88 Seaport Blvd, Boston, MA", 1),
        PropertyMeta("SMC-DEN-PAT", "cpx-004", "Summit Medical Campus", "Denver", "CO", "2550 E 17th Ave, Denver, CO", 2),
    )

    val floors = listOf(
        FloorInfo("f1", "Ground", 1),
        FloorInfo("f2", "Level 2", 2),
        FloorInfo("f3", "Level 3", 3),
    )

    val units = listOf(
        TourUnit("u1", "Main Lobby", "lobby", "Tower A", "f1", "Ground", 1),
        TourUnit("u2", "Leasing Office", "leasing", "Tower A", "f1", "Ground", 1),
        TourUnit("u3", "Fitness Center", "gym", "Tower A", "f2", "Level 2", 2),
        TourUnit("u4", "Pool Deck", "pool", "Tower A", "f2", "Level 2", 2),
        TourUnit("u5", "Clubhouse", "club", "Tower A", "f2", "Level 2", 2),
        TourUnit("u6", "Model Home 301", "unit", "Tower A", "f3", "Level 3", 3),
        TourUnit("u7", "Model Home 302", "unit", "Tower A", "f3", "Level 3", 3),
        TourUnit("u8", "Resident Parking", "parking", "Garage", "f1", "Ground", 1),
    )

    val stops: List<TourStop> = units.filter { it.type != "parking" }.mapIndexed { index, unit ->
        val onFloor = units.count { it.floorId == unit.floorId && it.type != "parking" }
        TourStop(
            id = unit.id,
            unit = unit,
            title = unit.name,
            blurb = if (index == 0) {
                "Enter on ${unit.floorLabel}, then we’ll visit every space floor by floor."
            } else if (unit.type == "unit") {
                "${unit.floorLabel} · home on this floor."
            } else {
                "${unit.floorLabel} · stop on this level · $onFloor spaces."
            },
            order = index + 1,
            floorId = unit.floorId,
            floorLabel = unit.floorLabel,
            role = if (index == 0) "entry" else "inside",
        )
    }

    const val originLat = 41.8920
    const val originLng = -87.6290
    const val parkingLat = 41.8884
    const val parkingLng = -87.6248
    const val entranceLat = 41.8876
    const val entranceLng = -87.6239

    val drivePath = listOf(
        originLat to originLng,
        41.8912 to -87.6274,
        41.8901 to -87.6262,
        41.8892 to -87.6254,
        parkingLat to parkingLng,
    )
    val walkPath = listOf(
        parkingLat to parkingLng,
        41.8880 to -87.6244,
        entranceLat to entranceLng,
    )

    val journey = listOf(
        JourneyStep("s1", "drive", "Head north toward resident parking on the side of Tower A.", 41.8901, -87.6262),
        JourneyStep("s2", "walk", "Walk from the garage to the main lobby entrance.", entranceLat, entranceLng),
        JourneyStep("s3", "indoor", "Enter through the lobby doors and check in.", stopId = "u1"),
        JourneyStep("s4", "indoor", "Continue to the leasing office on this floor.", stopId = "u2"),
        JourneyStep("s5", "indoor", "Take the elevator to Level 2 and enter the fitness center.", stopId = "u3"),
        JourneyStep("s6", "indoor", "Walk across Level 2 to the pool deck.", stopId = "u4"),
        JourneyStep("s7", "indoor", "Step into the clubhouse beside the pool.", stopId = "u5"),
        JourneyStep("s8", "indoor", "Go up to Level 3 and enter Model Home 301.", stopId = "u6"),
        JourneyStep("s9", "indoor", "Finish at Model Home 302 next door.", stopId = "u7"),
    )

    val facilities = listOf(
        Facility("door_lobby", "Main Lobby"),
        Facility("door_gym", "Fitness Center"),
        Facility("door_pool", "Pool Deck"),
        Facility("door_pkg", "Resident Parking Gate"),
        Facility("door_club", "Clubhouse"),
    )

    val filters = listOf(
        "all" to "All",
        "unit" to "Homes",
        "gym" to "Gym",
        "pool" to "Pool",
        "club" to "Club",
        "park" to "Parking",
    )

    fun propertyFor(raw: String): PropertyMeta? {
        val code = raw.trim().uppercase().replace(Regex("\\s+"), "-")
        return properties.find { it.code == code }
    }

    fun propertyForId(propertyId: String): PropertyMeta? {
        return properties.find { it.propertyId == propertyId.trim() }
    }

    fun parseScan(raw: String): AccessScan {
        val text = raw.trim()
        var propertyId = ""
        var code = ""
        var propertyName = ""
        try {
            if (text.startsWith("http", true) || text.startsWith("keiros://", true)) {
                val normalized = text.replace(Regex("^keiros://", RegexOption.IGNORE_CASE), "https://keiros.local/")
                val uri = android.net.Uri.parse(normalized)
                propertyId = uri.getQueryParameter("propertyId")?.trim().orEmpty()
                code = uri.getQueryParameter("code")?.trim().orEmpty()
                propertyName = uri.getQueryParameter("property")?.trim().orEmpty()
            }
        } catch (_: Exception) {
            /* plain text */
        }
        if (propertyId.isEmpty()) {
            Regex("[?&]propertyId=([^&#\\s]+)", RegexOption.IGNORE_CASE).find(text)?.groupValues?.getOrNull(1)?.let {
                propertyId = android.net.Uri.decode(it).trim()
            }
        }
        if (code.isEmpty()) {
            code = text.uppercase().replace(Regex("\\s+"), "-")
        }
        return AccessScan(propertyId, code.uppercase().replace(Regex("\\s+"), "-"), propertyName)
    }

    fun estimateMinutes(stopCount: Int) = maxOf(20, (stopCount * 2.5).toInt() + 8)

    val pack = PropertyTour(
        propertyId = "cpx-001",
        buildingName = "Tower A",
        floors = floors,
        units = units,
        stops = stops,
        journey = journey,
        facilities = facilities,
        filters = filters,
        outdoor = OutdoorRoute(
            originLat, originLng, parkingLat, parkingLng, entranceLat, entranceLng, drivePath, walkPath,
        ),
    )
}
