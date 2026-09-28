package com.keiros.tourapp.data

import org.json.JSONObject

data class OutdoorRoute(
    val originLat: Double,
    val originLng: Double,
    val parkingLat: Double,
    val parkingLng: Double,
    val entranceLat: Double,
    val entranceLng: Double,
    val drivePath: List<Pair<Double, Double>>,
    val walkPath: List<Pair<Double, Double>>,
)

data class PropertyTour(
    val propertyId: String,
    val buildingName: String,
    val floors: List<FloorInfo>,
    val units: List<TourUnit>,
    val stops: List<TourStop>,
    val journey: List<JourneyStep>,
    val facilities: List<Facility>,
    val filters: List<Pair<String, String>>,
    val outdoor: OutdoorRoute,
) {
    fun estimateMinutes() = maxOf(12, (stops.size * 2.5).toInt() + 6)
}

object TourBuilder {
    fun fromFirebase(propertyId: String, buildings: List<JSONObject>, floors: List<JSONObject>, locations: List<JSONObject>): PropertyTour? {
        val places = locations.mapNotNull { loc ->
            val lat = loc.optDouble("latitude", Double.NaN)
            val lng = loc.optDouble("longitude", Double.NaN)
            if (lat.isNaN() || lng.isNaN()) return@mapNotNull null
            RawPlace(
                id = loc.optString("id").ifBlank { return@mapNotNull null },
                name = loc.optString("name").ifBlank { "Place" },
                type = normalize(loc.optString("type")),
                buildingName = loc.optString("buildingName").ifBlank { "Building" },
                floorId = loc.optString("floorId"),
                floorLabel = loc.optString("floorLabel").ifBlank { "Floor" },
                lat = lat,
                lng = lng,
                elevation = loc.optDouble("elevation", 0.0),
            )
        }
        if (places.isEmpty()) return null
        val floorRows = floors.map {
            FloorInfo(it.optString("id"), it.optString("label").ifBlank { "Floor" }, it.optString("level").toIntOrNull() ?: 0)
        }.filter { floor -> places.any { it.floorId == floor.id } }.sortedBy { it.level }
        val resolvedFloors = if (floorRows.isNotEmpty()) floorRows else {
            places.map { FloorInfo(it.floorId, it.floorLabel, 0) }.distinctBy { it.id }
        }
        val levelOf = resolvedFloors.associate { it.id to it.level }
        val buildingName = buildings.firstOrNull()?.optString("name").orEmpty()
            .ifBlank { places.groupingBy { it.buildingName }.eachCount().maxByOrNull { it.value }?.key ?: "Building" }
        val units = places.map { place ->
            TourUnit(
                id = place.id,
                name = place.name,
                type = place.type,
                buildingName = place.buildingName,
                floorId = place.floorId,
                floorLabel = place.floorLabel,
                floorLevel = levelOf[place.floorId] ?: 0,
                latitude = place.lat,
                longitude = place.lng,
            )
        }
        val highlights = places.filter { it.type != "parking" && it.type != "path" }
            .sortedWith(compareBy({ priority(it.type) }, { levelOf[it.floorId] ?: 0 }, { it.name }))
        val chosen = buildList {
            highlights.filter { it.type in setOf("lobby", "entry", "amenity", "gym", "pool", "club") }.forEach { add(it) }
            highlights.filter { it.type == "unit" || it.type == "room" }.take(4).forEach { add(it) }
            if (isEmpty()) highlights.take(6).forEach { add(it) }
        }.distinctBy { it.id }.sortedWith(compareBy({ levelOf[it.floorId] ?: 0 }, { it.name })).take(10)
        val stops = chosen.mapIndexed { index, place ->
            val unit = units.first { it.id == place.id }
            TourStop(
                id = place.id,
                unit = unit,
                title = place.name,
                blurb = "${place.floorLabel} · ${place.buildingName}",
                order = index + 1,
                floorId = place.floorId,
                floorLabel = place.floorLabel,
                role = if (index == 0) "entry" else "inside",
            )
        }
        val parking = places.firstOrNull { it.type == "parking" } ?: places.minBy { it.elevation }
        val entrance = chosen.firstOrNull() ?: places.minBy { it.elevation }
        val originLat = entrance.lat - 0.006
        val originLng = entrance.lng - 0.004
        val midLat = (originLat + parking.lat) / 2
        val midLng = (originLng + parking.lng) / 2
        val walkMidLat = (parking.lat + entrance.lat) / 2
        val walkMidLng = (parking.lng + entrance.lng) / 2
        val outdoor = OutdoorRoute(
            originLat, originLng, parking.lat, parking.lng, entrance.lat, entrance.lng,
            listOf(originLat to originLng, midLat to midLng, parking.lat to parking.lng),
            listOf(parking.lat to parking.lng, walkMidLat to walkMidLng, entrance.lat to entrance.lng),
        )
        val journey = buildList {
            add(JourneyStep("drive", "drive", "Drive to parking at ${buildingName}.", midLat, midLng))
            add(JourneyStep("walk", "walk", "Walk from parking to ${entrance.name}.", entrance.lat, entrance.lng))
            stops.forEach { stop ->
                add(JourneyStep(stop.id, "indoor", "Continue to ${stop.title} on ${stop.floorLabel}.", stopId = stop.id))
            }
        }
        val doors = places.filter { it.type in setOf("door", "lobby", "entry", "gym", "pool", "parking", "amenity") }
            .distinctBy { it.name }
            .take(6)
        val facilities = if (doors.isEmpty()) {
            stops.take(4).map { Facility(it.id, it.title, it.unit.type) }
        } else {
            doors.map { Facility(it.id, it.name, it.type) }
        }
        val filters = buildList {
            add("all" to "All")
            if (units.any { it.type == "unit" || it.type == "room" }) add("unit" to "Places")
            if (units.any { it.type == "gym" }) add("gym" to "Gym")
            if (units.any { it.type == "pool" }) add("pool" to "Pool")
            if (units.any { it.type == "amenity" || it.type == "lobby" }) add("amenity" to "Amenities")
            if (units.any { it.type == "parking" }) add("park" to "Parking")
        }
        val shownFloors = resolvedFloors.filter { floor ->
            stops.any { it.floorId == floor.id } || units.count { it.floorId == floor.id } > 0
        }.let { rows -> if (rows.size <= 12) rows else rows.filter { floor -> stops.any { it.floorId == floor.id } } }
        return PropertyTour(propertyId, buildingName, shownFloors.ifEmpty { resolvedFloors.take(8) }, units, stops, journey, facilities, filters, outdoor)
    }

    private fun normalize(type: String) = when (type.trim().lowercase()) {
        "unit" -> "unit"
        "room" -> "room"
        "lobby" -> "lobby"
        "gym" -> "gym"
        "pool" -> "pool"
        "parking" -> "parking"
        "amenity" -> "amenity"
        "entry", "exit", "door" -> "entry"
        "elevator", "stairs", "corridor" -> "path"
        else -> type.trim().lowercase().ifBlank { "room" }
    }

    private fun priority(type: String) = when (type) {
        "lobby", "entry" -> 0
        "amenity", "gym", "pool", "club" -> 1
        "unit", "room" -> 2
        else -> 3
    }

    private data class RawPlace(
        val id: String,
        val name: String,
        val type: String,
        val buildingName: String,
        val floorId: String,
        val floorLabel: String,
        val lat: Double,
        val lng: Double,
        val elevation: Double,
    )
}
