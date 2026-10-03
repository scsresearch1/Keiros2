package com.keiros.tourapp.screens

import android.graphics.Color as AndroidColor
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.keiros.tourapp.data.JourneyStep
import com.keiros.tourapp.data.OutdoorRoute
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polyline
import org.osmdroid.views.overlay.infowindow.InfoWindow

private val darkTiles = XYTileSource(
    "CartoDark",
    0,
    20,
    256,
    ".png",
    arrayOf(
        "https://a.basemaps.cartocdn.com/dark_all/",
        "https://b.basemaps.cartocdn.com/dark_all/",
        "https://c.basemaps.cartocdn.com/dark_all/",
    ),
)

@Composable
fun OutdoorMapView(route: OutdoorRoute, activeStep: JourneyStep?, weather: String, traffic: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val map = androidx.compose.runtime.remember {
        Configuration.getInstance().userAgentValue = context.packageName
        MapView(context).apply {
            setTileSource(darkTiles)
            setMultiTouchControls(true)
            controller.setZoom(15.0)
            controller.setCenter(GeoPoint(route.parkingLat, route.parkingLng))
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
            view.controller.setZoom(15.0)
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
            view.overlays.add(drive)
            view.overlays.add(walk)
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
            pin(route.originLat, route.originLng, "Start", "#0EA5E9")
            pin(route.parkingLat, route.parkingLng, "Parking", "#A78BFA")
            pin(route.entranceLat, route.entranceLng, "Entrance", "#FBBF24")
            val step = activeStep
            if (step != null && step.phase != "indoor") {
                pin(step.latitude, step.longitude, step.instruction, if (step.phase == "walk") "#38BDF8" else "#22C55E")
                view.controller.animateTo(GeoPoint(step.latitude, step.longitude))
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
