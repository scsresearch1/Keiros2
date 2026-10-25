package com.keiros.tourapp.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.keiros.tourapp.data.Geo
import com.keiros.tourapp.data.PropertyTour
import com.keiros.tourapp.ui.Manrope
import kotlin.math.abs
import kotlin.math.roundToInt

@Composable
fun IndoorFloorMap(
    tour: PropertyTour,
    activeStepIndex: Int,
    selectedFloorId: String,
    distanceMeters: Double?,
    onSelectFloor: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val active = tour.journey.getOrNull(activeStepIndex)
    val activeUnit = active?.stopId?.let { id -> tour.units.find { it.id == id } }
    val activeFloor = activeUnit?.floorId ?: selectedFloorId
    var pinned by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(activeStepIndex) { pinned = null }
    val floorId = pinned ?: activeFloor
    val floor = tour.floors.find { it.id == floorId }
    val rooms = tour.units.filter { it.floorId == floorId && it.type != "parking" && it.type != "path" }
    val nextUnit = tour.journey.getOrNull(activeStepIndex + 1)?.stopId?.let { id -> tour.units.find { it.id == id } }
    val thenLine = when {
        nextUnit == null -> "You've arrived"
        nextUnit.floorId != floorId -> "Take the stairs or elevator"
        else -> "Continue to ${nextUnit.name}"
    }
    val meters = distanceMeters ?: if (
        activeUnit != null && nextUnit != null &&
        Geo.isPlaced(activeUnit.latitude, activeUnit.longitude) &&
        Geo.isPlaced(nextUnit.latitude, nextUnit.longitude)
    ) {
        Geo.meters(activeUnit.latitude, activeUnit.longitude, nextUnit.latitude, nextUnit.longitude)
    } else {
        null
    }
    val minutes = ((meters ?: 80.0) / 75.0).coerceAtLeast(1.0).roundToInt()
    val meterLabel = when {
        meters == null -> "On this floor"
        meters < 950 -> "${meters.roundToInt()} m"
        else -> "${((meters / 160.9344).roundToInt() / 10.0)} mi"
    }
    val motion = rememberInfiniteTransition(label = "chevron")
    val glide by motion.animateFloat(
        initialValue = 0.08f,
        targetValue = 0.92f,
        animationSpec = infiniteRepeatable(tween(2800, easing = LinearEasing), RepeatMode.Restart),
        label = "glide",
    )
    var pan by remember { mutableStateOf(Offset.Zero) }
    val textMeasurer = rememberTextMeasurer()

    Box(modifier.fillMaxSize().background(Color(0xFFF4F1EB))) {
        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(floorId) {
                    detectTransformGestures { _, drag, _, _ -> pan += drag }
                },
        ) {
            if (rooms.isEmpty()) return@Canvas
            val placed = rooms.filter { Geo.isPlaced(it.latitude, it.longitude) }
            val useGeo = placed.size >= 2
            val spanLat = if (useGeo) placed.maxOf { it.latitude } - placed.minOf { it.latitude } else 0.0
            val spanLng = if (useGeo) placed.maxOf { it.longitude } - placed.minOf { it.longitude } else 0.0
            val swap = useGeo && spanLat > spanLng * 1.25
            val minLng = if (useGeo) placed.minOf { it.longitude } else 0.0
            val maxLng = if (useGeo) placed.maxOf { it.longitude } else 1.0
            val minLat = if (useGeo) placed.minOf { it.latitude } else 0.0
            val maxLat = if (useGeo) placed.maxOf { it.latitude } else 1.0
            val left = 86f
            val top = 86f
            val plotW = (size.width - left - 28f).coerceAtLeast(40f)
            val plotH = (size.height - top - 96f).coerceAtLeast(40f)
            val rows = ((rooms.size + 2) / 3).coerceAtLeast(1)
            data class Spot(val id: String, val name: String, val cx: Float, val cy: Float, val hot: Boolean)
            val spots = rooms.mapIndexed { index, unit ->
                val nx: Float
                val ny: Float
                if (!useGeo || !Geo.isPlaced(unit.latitude, unit.longitude)) {
                    nx = (index % 3) / 2f
                    ny = (index / 3).toFloat() / (rows - 1).coerceAtLeast(1)
                } else {
                    val ax = if (swap) unit.latitude else unit.longitude
                    val ay = if (swap) unit.longitude else unit.latitude
                    val minX = if (swap) minLat else minLng
                    val maxX = if (swap) maxLat else maxLng
                    val minY = if (swap) minLng else minLat
                    val maxY = if (swap) maxLng else maxLat
                    nx = if (maxX == minX) 0.5f else ((ax - minX) / (maxX - minX)).toFloat()
                    ny = if (maxY == minY) 0.5f else ((ay - minY) / (maxY - minY)).toFloat()
                }
                Spot(
                    unit.id,
                    unit.name,
                    left + nx.coerceIn(0f, 1f) * plotW + pan.x,
                    top + ny.coerceIn(0f, 1f) * plotH + pan.y,
                    unit.id == activeUnit?.id,
                )
            }
            spots.forEach { spot ->
                val w = 118f
                val h = 68f
                drawRoundRect(
                    color = if (spot.hot) Color(0xFFE7F0FA) else Color(0xFFFBF9F5),
                    topLeft = Offset(spot.cx - w / 2f, spot.cy - h / 2f),
                    size = Size(w, h),
                    cornerRadius = CornerRadius(18f, 18f),
                )
                drawRoundRect(
                    color = if (spot.hot) Color(0xFF1D4E89) else Color(0xFFD9D3C7),
                    topLeft = Offset(spot.cx - w / 2f, spot.cy - h / 2f),
                    size = Size(w, h),
                    cornerRadius = CornerRadius(18f, 18f),
                    style = Stroke(width = if (spot.hot) 3.5f else 1.6f),
                )
            }
            val ordered = tour.journey.mapNotNull { step ->
                val id = step.stopId ?: return@mapNotNull null
                if (step.phase != "indoor") return@mapNotNull null
                spots.find { it.id == id }
            }
            if (ordered.size >= 2) {
                val path = Path()
                ordered.forEachIndexed { index, spot ->
                    if (index == 0) {
                        path.moveTo(spot.cx, spot.cy)
                    } else {
                        val prev = ordered[index - 1]
                        path.lineTo(spot.cx, prev.cy)
                        path.lineTo(spot.cx, spot.cy)
                    }
                }
                drawPath(
                    path,
                    Color(0xFF2C4A73),
                    style = Stroke(
                        width = 5f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f, 12f), 0f),
                    ),
                )
            }
            val legIndex = ordered.indexOfFirst { it.hot }.let { if (it >= 0) it else 0 }
            val from = ordered.getOrNull(legIndex)
            val toSpot = ordered.getOrNull(legIndex + 1) ?: from
            if (from != null && toSpot != null) {
                val corner = Offset(toSpot.cx, from.cy)
                val firstLen = abs(corner.x - from.cx)
                val secondLen = abs(toSpot.cy - from.cy)
                val total = (firstLen + secondLen).coerceAtLeast(1f)
                val travel = glide * total
                val at = if (travel <= firstLen) {
                    val t = if (firstLen < 1f) 1f else travel / firstLen
                    Offset(from.cx + (corner.x - from.cx) * t, from.cy)
                } else {
                    val t = if (secondLen < 1f) 1f else (travel - firstLen) / secondLen
                    Offset(corner.x, from.cy + (toSpot.cy - from.cy) * t)
                }
                val angle = if (travel <= firstLen) {
                    if (corner.x >= from.cx) 90f else -90f
                } else if (toSpot.cy >= from.cy) {
                    180f
                } else {
                    0f
                }
                rotate(angle, at) {
                    val chevron = Path().apply {
                        moveTo(at.x, at.y - 13f)
                        lineTo(at.x - 8f, at.y + 8f)
                        lineTo(at.x + 8f, at.y + 8f)
                        close()
                    }
                    drawPath(chevron, Color(0xFF1D4E89))
                }
            }
            spots.forEach { spot ->
                val measured = textMeasurer.measure(
                    spot.name,
                    TextStyle(
                        color = Color(0xFF1C2430),
                        fontSize = 12.sp,
                        fontWeight = if (spot.hot) FontWeight.Bold else FontWeight.Medium,
                    ),
                    overflow = TextOverflow.Ellipsis,
                    maxLines = 2,
                )
                drawText(
                    measured,
                    topLeft = Offset(spot.cx - measured.size.width / 2f, spot.cy - measured.size.height / 2f),
                )
            }
        }
        if (rooms.isEmpty()) {
            Text(
                "No places on this floor yet.",
                modifier = Modifier.align(Alignment.Center),
                color = Color(0xFF5C6570),
                fontFamily = Manrope,
            )
        }
        Column(
            Modifier.align(Alignment.CenterStart).padding(start = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            tour.floors.forEach { item ->
                val on = item.id == floorId
                Text(
                    item.label,
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (on) Color(0xFF1D4E89) else Color(0xFFFBF9F5))
                        .border(1.dp, if (on) Color(0xFF1D4E89) else Color(0xFFD9D3C7), RoundedCornerShape(12.dp))
                        .clickable {
                            pinned = item.id
                            onSelectFloor(item.id)
                        }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    color = if (on) Color.White else Color(0xFF1C2430),
                    fontFamily = Manrope,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                )
            }
        }
        Text(
            "Then  $thenLine",
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 58.dp)
                .clip(CircleShape)
                .background(Color(0xF21C2430))
                .padding(horizontal = 14.dp, vertical = 8.dp),
            color = Color.White,
            fontFamily = Manrope,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
        )
        Text(
            "${floor?.label ?: "Floor"} · $minutes min · $meterLabel",
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 12.dp, bottom = 12.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Color(0xF2FBF9F5))
                .border(1.dp, Color(0xFFD9D3C7), RoundedCornerShape(14.dp))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            color = Color(0xFF1C2430),
            fontFamily = Manrope,
            fontWeight = FontWeight.SemiBold,
            fontSize = 12.sp,
        )
        Text(
            "Center",
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(end = 12.dp, bottom = 12.dp)
                .clip(CircleShape)
                .background(Color(0xF2FBF9F5))
                .border(1.dp, Color(0xFFD9D3C7), CircleShape)
                .clickable { pan = Offset.Zero }
                .padding(horizontal = 14.dp, vertical = 8.dp),
            color = Color(0xFF1D4E89),
            fontFamily = Manrope,
            fontWeight = FontWeight.Bold,
            fontSize = 12.sp,
        )
    }
}
