package com.keiros.tourapp.data

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

object Geo {
    fun meters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val r = 6371000.0
        val p1 = Math.toRadians(lat1)
        val p2 = Math.toRadians(lat2)
        val dp = Math.toRadians(lat2 - lat1)
        val dl = Math.toRadians(lng2 - lng1)
        val a = sin(dp / 2).pow(2) + cos(p1) * cos(p2) * sin(dl / 2).pow(2)
        return 2 * r * atan2(sqrt(a), sqrt(1 - a))
    }

    fun isPlaced(latitude: Double, longitude: Double) = kotlin.math.abs(latitude) > 0.01 || kotlin.math.abs(longitude) > 0.01

    data class RouteProgress(
        val remainingMeters: Double,
        val traveledMeters: Double,
        val offRouteMeters: Double,
        val trimmed: List<Pair<Double, Double>>,
    )

    fun along(path: List<Pair<Double, Double>>, lat: Double, lng: Double): RouteProgress {
        if (path.isEmpty()) return RouteProgress(0.0, 0.0, 0.0, emptyList())
        if (path.size == 1) {
            val only = path.first()
            val gap = meters(lat, lng, only.first, only.second)
            return RouteProgress(gap, 0.0, gap, path)
        }
        var cursor = 0.0
        var bestGap = Double.MAX_VALUE
        var bestAlong = 0.0
        var bestIndex = 0
        var bestLat = path.first().first
        var bestLng = path.first().second
        val lengths = DoubleArray(path.lastIndex)
        for (index in 0 until path.lastIndex) {
            val start = path[index]
            val end = path[index + 1]
            val length = meters(start.first, start.second, end.first, end.second)
            lengths[index] = length
            val fraction = if (length < 0.5) 0.0 else closestFraction(lat, lng, start, end)
            val snapLat = start.first + (end.first - start.first) * fraction
            val snapLng = start.second + (end.second - start.second) * fraction
            val gap = meters(lat, lng, snapLat, snapLng)
            if (gap < bestGap) {
                bestGap = gap
                bestAlong = cursor + length * fraction
                bestIndex = index
                bestLat = snapLat
                bestLng = snapLng
            }
            cursor += length
        }
        val trimmed = buildList {
            add(bestLat to bestLng)
            for (index in bestIndex + 1 until path.size) {
                val point = path[index]
                val previous = last()
                if (meters(previous.first, previous.second, point.first, point.second) > 1.5) add(point)
            }
            if (size < 2) add(path.last())
        }
        return RouteProgress((cursor - bestAlong).coerceAtLeast(0.0), bestAlong.coerceAtLeast(0.0), bestGap, trimmed)
    }

    private fun closestFraction(lat: Double, lng: Double, start: Pair<Double, Double>, end: Pair<Double, Double>): Double {
        val latScale = 111_320.0
        val lngScale = 111_320.0 * cos(Math.toRadians(lat)).coerceAtLeast(0.2)
        val east = (end.second - start.second) * lngScale
        val north = (end.first - start.first) * latScale
        val pointEast = (lng - start.second) * lngScale
        val pointNorth = (lat - start.first) * latScale
        val lengthSquared = east * east + north * north
        if (lengthSquared < 0.01) return 0.0
        return ((pointEast * east + pointNorth * north) / lengthSquared).coerceIn(0.0, 1.0)
    }

    fun formatDistance(meters: Double): String {
        val miles = meters / 1609.344
        if (miles >= 0.2) {
            return if (miles >= 10) "%.0f mi".format(miles) else "%.1f mi".format(miles)
        }
        return "${(meters * 3.28084).roundToInt()} ft"
    }

    fun formatEta(seconds: Double): String {
        val minutes = maxOf(1, (seconds / 60.0).roundToInt())
        if (minutes >= 60) {
            val hours = minutes / 60
            val remain = minutes % 60
            return if (remain == 0) "$hours hr" else "$hours hr $remain min"
        }
        return "$minutes min"
    }

    fun slabPoint(
        latitude: Double,
        longitude: Double,
        anchorLat: Double,
        anchorLng: Double,
        width: Float,
        depth: Float,
        metersPerUnit: Float = 10f,
    ): Pair<Float, Float> {
        val east = (longitude - anchorLng) * 111_320.0 * cos(Math.toRadians(anchorLat))
        val north = (latitude - anchorLat) * 111_320.0
        val x = (width / 2f + (east / metersPerUnit)).toFloat()
        val y = (0.35f + (north / metersPerUnit)).toFloat()
        return x.coerceIn(0.2f, width - 0.2f) to y.coerceIn(0.15f, depth - 0.2f)
    }
}
