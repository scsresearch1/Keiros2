package com.keiros.tourapp.screens

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.GradientDrawable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.keiros.tourapp.data.Geo
import com.keiros.tourapp.data.JourneyStep
import com.keiros.tourapp.data.OutdoorRoute
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polyline
import org.osmdroid.views.overlay.infowindow.InfoWindow

private val streetTiles = XYTileSource(
    "OsmStreets",
    0,
    19,
    256,
    ".png",
    arrayOf("https://tile.openstreetmap.org/"),
)

@Composable
fun OutdoorMapView(
    route: OutdoorRoute,
    activeStep: JourneyStep?,
    weather: String,
    traffic: String,
    modifier: Modifier = Modifier,
    followPhone: Boolean = false,
    chaseCamera: Boolean = false,
    userLatitude: Double? = null,
    userLongitude: Double? = null,
    userHeading: Double = -1.0,
    liveRoute: List<Pair<Double, Double>> = emptyList(),
) {
    val context = LocalContext.current
    val chevron = remember {
        BitmapDrawable(context.resources, navigationChevron())
    }
    val camera = remember { doubleArrayOf(Double.NaN, Double.NaN, -1.0) }
    val map = androidx.compose.runtime.remember {
        Configuration.getInstance().userAgentValue = "KeirosTour/9 (com.keiros.tourapp)"
        Configuration.getInstance().osmdroidBasePath = context.cacheDir
        Configuration.getInstance().osmdroidTileCache = java.io.File(context.cacheDir, "osmdroid")
        MapView(context).apply {
            setTileSource(streetTiles)
            setMultiTouchControls(true)
            controller.setZoom(15.0)
            controller.setCenter(GeoPoint(route.parkingLat, route.parkingLng))
            overlayManager.tilesOverlay.loadingBackgroundColor = AndroidColor.parseColor("#0B1220")
            overlayManager.tilesOverlay.setColorFilter(
                ColorMatrixColorFilter(
                    ColorMatrix(
                        floatArrayOf(
                            -0.9f, 0f, 0f, 0f, 235f,
                            0f, -0.9f, 0f, 0f, 235f,
                            0f, 0f, -0.85f, 0f, 245f,
                            0f, 0f, 0f, 1f, 0f,
                        ),
                    ),
                ),
            )
        }
    }
    DisposableEffect(map) {
        map.onResume()
        onDispose { map.onPause() }
    }
    Box(modifier) {
    AndroidView(
        modifier = Modifier.matchParentSize(),
        factory = { map },
        update = { view ->
            view.overlays.clear()
            val drive = Polyline().apply {
                setPoints(route.drivePath.map { GeoPoint(it.first, it.second) })
                outlinePaint.color = AndroidColor.parseColor("#22C55E")
                outlinePaint.strokeWidth = 12f
                outlinePaint.strokeCap = Paint.Cap.ROUND
            }
            val walk = Polyline().apply {
                setPoints(route.walkPath.map { GeoPoint(it.first, it.second) })
                outlinePaint.color = AndroidColor.parseColor("#38BDF8")
                outlinePaint.strokeWidth = 12f
                outlinePaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(24f, 18f), 0f)
            }
            fun pin(lat: Double, lng: Double, title: String, color: String) {
                val marker = Marker(view)
                marker.position = GeoPoint(lat, lng)
                marker.title = title
                marker.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                marker.icon = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(AndroidColor.parseColor(color))
                    setStroke(4, AndroidColor.WHITE)
                    setSize(36, 36)
                }
                marker.infoWindow = object : InfoWindow(android.R.layout.simple_list_item_1, view) {
                    override fun onOpen(item: Any?) {
                        mView.findViewById<android.widget.TextView>(android.R.id.text1).text = title
                    }
                    override fun onClose() = Unit
                }
                view.overlays.add(marker)
            }
            pin(route.parkingLat, route.parkingLng, "Parking", "#A78BFA")
            pin(route.entranceLat, route.entranceLng, "Entrance", "#FBBF24")
            val step = activeStep
            val tracking = followPhone && userLatitude != null && userLongitude != null
            if (tracking) {
                val gpsLat = userLatitude!!
                val gpsLng = userLongitude!!
                val roadPoint = liveRoute.firstOrNull()
                val markerLat: Double
                val markerLng: Double
                if (roadPoint != null && Geo.meters(gpsLat, gpsLng, roadPoint.first, roadPoint.second) < 30) {
                    markerLat = roadPoint.first
                    markerLng = roadPoint.second
                } else {
                    markerLat = gpsLat
                    markerLng = gpsLng
                }
                val you = Marker(view)
                you.position = GeoPoint(markerLat, markerLng)
                you.title = "You"
                you.setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                you.icon = chevron
                you.rotation = if (userHeading >= 0) userHeading.toFloat() else 0f
                you.setOnMarkerClickListener { _, _ -> true }
                view.overlays.add(you)
                val line = if (liveRoute.size >= 2) {
                    liveRoute
                } else {
                    val toParking = Geo.meters(gpsLat, gpsLng, route.parkingLat, route.parkingLng)
                    val destLat = if (toParking <= 70) route.entranceLat else route.parkingLat
                    val destLng = if (toParking <= 70) route.entranceLng else route.parkingLng
                    listOf(gpsLat to gpsLng, destLat to destLng)
                }
                view.overlays.add(0, Polyline().apply {
                    setPoints(line.map { GeoPoint(it.first, it.second) })
                    outlinePaint.color = AndroidColor.parseColor("#4285F4")
                    outlinePaint.strokeWidth = 14f
                    outlinePaint.strokeCap = Paint.Cap.ROUND
                    outlinePaint.strokeJoin = Paint.Join.ROUND
                })
                val heading = if (userHeading >= 0) userHeading else 0.0
                val moved = if (camera[0].isNaN()) 999.0 else Geo.meters(camera[0], camera[1], markerLat, markerLng)
                val turned = abs(heading - camera[2])
                if (chaseCamera && (moved > 3 || turned > 8 || camera[0].isNaN())) {
                    if (camera[0].isNaN()) view.controller.setZoom(17.5)
                    camera[0] = markerLat
                    camera[1] = markerLng
                    camera[2] = heading
                    view.mapOrientation = if (userHeading >= 0) (-userHeading).toFloat() else 0f
                    val look = lookAhead(markerLat, markerLng, heading)
                    view.controller.animateTo(GeoPoint(look.first, look.second))
                } else if (!chaseCamera) {
                    view.mapOrientation = 0f
                    val fitKey = "you-${"%.4f".format(markerLat)}-${"%.4f".format(markerLng)}-${route.parkingLat}"
                    if (view.tag != fitKey) {
                        view.tag = fitKey
                        val box = BoundingBox.fromGeoPointsSafe(line.map { GeoPoint(it.first, it.second) })
                        view.post { view.zoomToBoundingBox(box, true, 80) }
                    }
                }
            } else {
                view.overlays.add(drive)
                view.overlays.add(walk)
                if (view.mapOrientation != 0f) view.mapOrientation = 0f
                camera[0] = Double.NaN
                pin(route.originLat, route.originLng, "Start", "#0EA5E9")
                if (step != null && step.phase != "indoor") {
                    pin(step.latitude, step.longitude, step.instruction, if (step.phase == "walk") "#38BDF8" else "#22C55E")
                }
                val farStart = abs(route.originLat - route.parkingLat) > 0.02 || abs(route.originLng - route.parkingLng) > 0.02
                val fitKey = "${route.originLat},${route.originLng},${route.parkingLat},${step?.id.orEmpty()}"
                if (view.tag != fitKey) {
                    view.tag = fitKey
                    if (farStart) {
                        val box = BoundingBox.fromGeoPointsSafe(route.drivePath.map { GeoPoint(it.first, it.second) })
                        view.post { view.zoomToBoundingBox(box, true, 72) }
                    } else if (step != null && step.phase != "indoor") {
                        view.controller.setZoom(15.0)
                        view.controller.animateTo(GeoPoint(step.latitude, step.longitude))
                    } else {
                        view.controller.setZoom(15.0)
                        view.controller.setCenter(GeoPoint(route.parkingLat, route.parkingLng))
                    }
                }
            }
            view.invalidate()
        },
    )
        Text(
            "$weather · Traffic $traffic",
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(12.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Color(0xE607111E))
                .padding(horizontal = 10.dp, vertical = 6.dp),
            color = Color(0xFF7DD3FC),
            fontSize = 12.sp,
        )
    }
}

private fun lookAhead(lat: Double, lng: Double, heading: Double): Pair<Double, Double> {
    val ahead = 55.0
    val rad = Math.toRadians(heading)
    val latScale = 111_320.0
    val lngScale = 111_320.0 * cos(Math.toRadians(lat)).coerceAtLeast(0.2)
    return (lat + cos(rad) * (ahead / latScale)) to (lng + sin(rad) * (ahead / lngScale))
}

private fun navigationChevron(): Bitmap {
    val size = 128
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawCircle(size / 2f, size / 2f, 46f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = AndroidColor.parseColor("#664285F4") })
    val arrow = Path().apply {
        moveTo(size / 2f, 18f)
        lineTo(size * 0.78f, size * 0.78f)
        lineTo(size / 2f, size * 0.62f)
        lineTo(size * 0.22f, size * 0.78f)
        close()
    }
    canvas.drawPath(arrow, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = AndroidColor.parseColor("#1A73E8") })
    canvas.drawPath(arrow, Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = AndroidColor.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 6f
        strokeJoin = Paint.Join.ROUND
    })
    return bitmap
}
