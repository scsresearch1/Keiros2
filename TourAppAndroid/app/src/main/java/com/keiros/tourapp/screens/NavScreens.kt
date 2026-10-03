package com.keiros.tourapp.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import kotlin.math.cos
import kotlin.math.sin
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.keiros.tourapp.data.PropertyTour
import com.keiros.tourapp.flow.TourMode
import com.keiros.tourapp.flow.TourUiState
import com.keiros.tourapp.flow.TourViewModel
import com.keiros.tourapp.ui.Amber
import com.keiros.tourapp.ui.BackChip
import com.keiros.tourapp.ui.Blue
import com.keiros.tourapp.ui.Border
import com.keiros.tourapp.ui.BorderStrong
import com.keiros.tourapp.ui.Manrope
import com.keiros.tourapp.ui.Navy
import com.keiros.tourapp.ui.PhaseButton
import com.keiros.tourapp.ui.PrimaryButton
import com.keiros.tourapp.ui.Teal
import com.keiros.tourapp.ui.TextMuted
import com.keiros.tourapp.ui.TextPrimary
import com.keiros.tourapp.ui.TextSecondary
import com.keiros.tourapp.ui.Verified

@Composable
fun NavigationScreen(state: TourUiState, vm: TourViewModel) {
    val tour = state.tour
    val step = tour.journey.getOrNull(state.activeStepIndex)
    val phase = step?.phase ?: "drive"
    val indoors = state.insideBuilding || state.forceView == "3d"
    val stop = tour.stops.getOrNull(state.currentStopIndex)
    val stopLabel = when {
        state.tourMode == TourMode.Guided && stop != null && state.insideBuilding ->
            "${stop.floorLabel} · ${state.currentStopIndex + 1}/${tour.stops.size} · ${stop.title}"
        state.tourMode == TourMode.Guided && stop != null -> "Enter building · ${stop.title}"
        else -> state.destination?.name ?: "Destination"
    }
    val atEnd = tour.journey.isNotEmpty() && state.activeStepIndex >= tour.journey.lastIndex
    val nextStop = tour.stops.getOrNull(state.currentStopIndex + 1)
    val arrive = when {
        atEnd && nextStop != null -> "Next: ${nextStop.title}"
        atEnd -> "Finish building tour"
        state.insideBuilding -> "Next place tip"
        else -> "Next"
    }

    Column(Modifier.fillMaxSize().background(Navy)) {
        Box(Modifier.weight(if (state.panelCollapsed) 1f else 1.05f).fillMaxWidth()) {
            if (indoors) {
                IndoorSketch(
                    tour = tour,
                    selectedFloorId = state.selectedFloorId,
                    selectedUnitId = state.destination?.id,
                    activeStopIndex = tour.stops.indexOfFirst { it.id == tour.journey.getOrNull(state.activeStepIndex)?.stopId }
                        .let { if (it >= 0) it else state.currentStopIndex },
                    onSelectFloor = vm::selectFloor,
                    onSelectUnit = { id, floorId -> vm.choosePlace(id, floorId) },
                )
            } else {
                OutdoorMapView(
                    route = tour.outdoor,
                    activeStep = tour.journey.getOrNull(state.activeStepIndex),
                    weather = state.weatherSummary,
                    traffic = state.trafficLevel,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BackChip(vm::goBack)
                Box(Modifier.weight(1f))
                if (!state.insideBuilding) {
                    Row(
                        Modifier
                            .clip(CircleShape)
                            .background(Color(0xD208142A))
                            .border(1.dp, Color(0x477DD3FC), CircleShape)
                            .padding(3.dp),
                    ) {
                        ModePill("Outside", state.forceView == "map") { vm.setForceView("map") }
                        ModePill("Inside", state.forceView == "3d") { vm.setForceView("3d") }
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        ModePill("Floor by floor", true) {}
                        Text(
                            "End tour",
                            modifier = Modifier
                                .padding(start = 8.dp)
                                .clip(CircleShape)
                                .background(Color(0x8C7F1D1D))
                                .border(1.dp, Color(0x73FB7185), CircleShape)
                                .clickable(onClick = vm::endTour)
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            color = Color(0xFFFECDD3),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = Manrope,
                        )
                    }
                }
            }
            if (state.showTrack && !state.trackingEnabled) {
                Row(
                    Modifier
                        .padding(top = 64.dp, start = 12.dp, end = 12.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xF514263F))
                        .border(1.dp, Amber.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Track time at each stop?", color = TextPrimary, fontSize = 13.sp, modifier = Modifier.weight(1f), fontFamily = Manrope)
                    Text(
                        "Enable",
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(Blue)
                            .clickable(onClick = vm::enableTracking)
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        "Later",
                        modifier = Modifier
                            .padding(start = 6.dp)
                            .clip(CircleShape)
                            .border(1.dp, Border, CircleShape)
                            .clickable(onClick = vm::dismissTrack)
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        color = TextSecondary,
                        fontSize = 12.sp,
                    )
                }
            }
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(12.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Brush.linearGradient(listOf(Color(0xF00A1C38), Color(0xF5060E1C))))
                    .border(1.dp, Color(0x477DD3FC), RoundedCornerShape(14.dp))
                    .padding(12.dp),
            ) {
                Text(stopLabel.uppercase(), color = if (indoors) Color(0xFFF9A8D4) else Color(0xFF7DD3FC), fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = Manrope)
                Text(step?.instruction ?: "", color = TextPrimary, fontFamily = Manrope, fontWeight = FontWeight.SemiBold)
                Text(
                    "${(tour.journey.size - state.activeStepIndex) * 90} ft · ~${(tour.journey.size - state.activeStepIndex).coerceAtLeast(1)} min · tip ${state.activeStepIndex + 1}/${tour.journey.size.coerceAtLeast(1)}",
                    color = TextMuted,
                    fontSize = 12.sp,
                    fontFamily = Manrope,
                )
                Box(
                    Modifier
                        .padding(top = 8.dp)
                        .fillMaxWidth()
                        .height(3.dp)
                        .clip(CircleShape)
                        .background(Color(0x26ADC9E8)),
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth((state.activeStepIndex + 1f) / tour.journey.size.coerceAtLeast(1))
                            .height(3.dp)
                            .background(Brush.horizontalGradient(listOf(Teal, Color(0xFF2B7DE9)))),
                    )
                }
            }
        }

        Column(
            Modifier
                .fillMaxWidth()
                .then(if (state.panelCollapsed) Modifier else Modifier.weight(1f))
                .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))
                .background(Brush.verticalGradient(listOf(Color(0xFA0E203E), Color(0xFC060E1C))))
                .border(1.dp, Color(0x387DD3FC), RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp))
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            Box(
                Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(bottom = 8.dp)
                    .height(4.dp)
                    .fillMaxWidth(0.12f)
                    .clip(CircleShape)
                    .background(BorderStrong)
                    .clickable(onClick = vm::togglePanel),
            )
            if (!state.panelCollapsed) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (!state.insideBuilding) {
                            PhaseButton("Arrive", phase == "drive", Color(0xFFF97316), { vm.jumpPhase("drive") }, Modifier.weight(1f))
                            PhaseButton("Walk in", phase == "walk", Color(0xFF38BDF8), { vm.jumpPhase("walk") }, Modifier.weight(1f))
                        }
                        PhaseButton(
                            if (state.insideBuilding) "Places inside" else "Explore",
                            phase == "indoor" || indoors,
                            Color(0xFF22C55E),
                            { vm.jumpPhase("indoor") },
                            Modifier.weight(1f),
                        )
                    }
                    if (state.insideBuilding && nextStop != null) {
                        Column(
                            Modifier
                                .padding(top = 8.dp)
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0x5906281E))
                                .border(1.dp, Verified.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
                                .padding(10.dp),
                        ) {
                            Text("UP NEXT ON YOUR WALK-THROUGH", color = Verified, fontSize = 10.sp, fontWeight = FontWeight.Bold, fontFamily = Manrope)
                            Text(nextStop.title, color = TextPrimary, fontFamily = Manrope, fontWeight = FontWeight.Bold)
                            Text(nextStop.blurb, color = TextMuted, fontSize = 12.sp)
                        }
                    }
                    if (!indoors) {
                        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Meta("WEATHER", state.weatherSummary, Modifier.weight(1f))
                            Meta("TRAFFIC", state.trafficLevel, Modifier.weight(1f))
                            Text(
                                "Refresh",
                                modifier = Modifier
                                    .clip(RoundedCornerShape(12.dp))
                                    .border(1.dp, Border, RoundedCornerShape(12.dp))
                                    .clickable(onClick = vm::refreshConditions)
                                    .padding(horizontal = 10.dp, vertical = 14.dp),
                                color = TextSecondary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    if (indoors) {
                        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(if (state.insideBuilding) "ALL UNITS IN THE BUILDING" else "LOOKING AROUND?", color = Color(0xFFF9A8D4), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                Text(state.destination?.name ?: "Pick a place", color = TextPrimary, fontFamily = Manrope, fontWeight = FontWeight.Bold)
                            }
                            Text(
                                if (state.destOpen) "Hide list" else "Show units",
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .background(Color(0xB314263F))
                                    .border(1.dp, Border, CircleShape)
                                    .clickable(onClick = vm::toggleDest)
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                                color = TextSecondary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                        if (state.destOpen) {
                            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                FloorChip("All", state.showAllFloors) { vm.showAllFloors() }
                                tour.floors.forEach { floor ->
                                    FloorChip(floor.label.replace("Level ", "F").replace("Ground", "G"), !state.showAllFloors && state.selectedFloorId == floor.id) {
                                        vm.selectFloor(floor.id)
                                    }
                                }
                            }
                            val places = tour.units.filter { state.showAllFloors || it.floorId == state.selectedFloorId }
                            places.forEach { place ->
                                val active = state.destination?.id == place.id
                                Row(
                                    Modifier
                                        .padding(top = 6.dp)
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(if (active) Color(0x409D174D) else Color(0x8C07111E))
                                        .border(1.dp, if (active) Color(0x8CF472B6) else Color(0x3394A3B8), RoundedCornerShape(12.dp))
                                        .clickable { vm.choosePlace(place.id, place.floorId) }
                                        .padding(10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(place.name, color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                        Text(place.floorLabel, color = TextMuted, fontSize = 11.sp)
                                    }
                                    Text(if (active) "Current" else "Go", color = Color(0xFF7DD3FC), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                    if (state.trackingEnabled) {
                        val mins = state.liveSec / 60
                        val secs = state.liveSec % 60
                        val here = state.destination?.name ?: "Lobby"
                        Text(
                            "You’re spending time here · $here · ${mins}m ${secs}s",
                            color = Verified,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                    Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            if (state.listOpen) "Hide tips" else "Direction tips",
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(Color(0xB314263F))
                                .border(1.dp, Border, CircleShape)
                                .clickable(onClick = vm::toggleTips)
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                            color = TextSecondary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            "End tour",
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(Color(0x597F1D1D))
                                .clickable(onClick = vm::endTour)
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                            color = Color(0xFFFECDD3),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    if (state.listOpen) {
                        tour.journey.forEachIndexed { index, item ->
                            Text(
                                "${index + 1}  ${item.phase.uppercase()}  ${item.instruction}",
                                modifier = Modifier
                                    .padding(top = 6.dp)
                                    .fillMaxWidth()
                                    .clickable { vm.selectTip(index) }
                                    .padding(6.dp),
                                color = if (index == state.activeStepIndex) TextPrimary else TextMuted,
                                fontSize = 13.sp,
                                fontFamily = Manrope,
                            )
                        }
                    }
                }
                Row(Modifier.padding(top = 8.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) {
                        PrimaryButton("Previous", vm::previousStep, enabled = state.activeStepIndex > 0, variant = "ghost")
                    }
                    Box(Modifier.weight(1f)) {
                        PrimaryButton(arrive, vm::nextStep)
                    }
                }
            }
        }
    }
}

@Composable
private fun ModePill(label: String, active: Boolean, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier
            .clip(CircleShape)
            .background(if (active) Brush.linearGradient(listOf(Color(0xFF38BDF8), Color(0xFF818CF8))) else Brush.linearGradient(listOf(Color.Transparent, Color.Transparent)))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = if (active) Color(0xFF04101F) else TextSecondary,
        fontFamily = Manrope,
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp,
    )
}

@Composable
private fun Meta(label: String, value: String, modifier: Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0x8C08142C))
            .border(1.dp, Border, RoundedCornerShape(12.dp))
            .padding(8.dp),
    ) {
        Text(label, color = Color(0xFF2B7DE9), fontSize = 10.sp, fontWeight = FontWeight.Bold)
        Text(value, color = TextPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun FloorChip(label: String, active: Boolean, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier
            .clip(CircleShape)
            .background(if (active) Color(0x479D174D) else Color(0xA608142A))
            .border(1.dp, if (active) Color(0x8CF472B6) else Color(0x4D94A3B8), CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        color = if (active) Color(0xFFFCE7F3) else TextSecondary,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
    )
}

@Composable
fun OutdoorSketch(indoor: Boolean) {
    Canvas(
        Modifier
            .fillMaxSize()
            .background(
                Brush.radialGradient(
                    listOf(Color(0x332B7DE9), Color(0xFF07111E)),
                ),
            ),
    ) {
        val w = size.width
        val h = size.height
        drawLine(Color(0x3347A3C7), Offset(w * 0.15f, 0f), Offset(w * 0.35f, h), strokeWidth = 28f)
        drawLine(Color(0x3347A3C7), Offset(0f, h * 0.45f), Offset(w, h * 0.62f), strokeWidth = 22f)
        val route = Path().apply {
            moveTo(w * 0.18f, h * 0.78f)
            lineTo(w * 0.42f, h * 0.55f)
            lineTo(w * 0.68f, h * 0.48f)
            lineTo(w * 0.78f, h * 0.28f)
        }
        drawPath(route, if (indoor) Color(0xFF22C55E) else Color(0xFF38BDF8), style = Stroke(width = 8f))
        drawCircle(Color(0xFF38BDF8), 12f, Offset(w * 0.18f, h * 0.78f))
        drawCircle(Color(0xFFA78BFA), 14f, Offset(w * 0.68f, h * 0.48f))
        drawCircle(Color(0xFFFBBF24), 14f, Offset(w * 0.78f, h * 0.28f))
    }
}

private data class Cam(val yaw: Float, val pitch: Float, val zoom: Float)

private fun project(
    x: Float,
    y: Float,
    z: Float,
    ox: Float,
    oy: Float,
    baseScale: Float,
    cam: Cam,
    cx: Float,
    cy: Float,
    cz: Float,
): Offset {
    val lx = x - cx
    val ly = y - cy
    val lz = z - cz
    val cosY = cos(cam.yaw)
    val sinY = sin(cam.yaw)
    val rx = lx * cosY - ly * sinY
    val ry = lx * sinY + ly * cosY
    val cosP = cos(cam.pitch)
    val sinP = sin(cam.pitch)
    val py = ry * cosP - lz * sinP
    val pz = ry * sinP + lz * cosP
    val scale = baseScale * cam.zoom
    return Offset(ox + rx * scale, oy - pz * scale + py * scale * 0.18f)
}

private data class MapHit(val x: Float, val y: Float, val floorId: String?, val unitId: String?)

@Composable
fun IndoorSketch(
    tour: PropertyTour,
    selectedFloorId: String,
    selectedUnitId: String?,
    activeStopIndex: Int,
    onSelectFloor: (String) -> Unit,
    onSelectUnit: (String, String) -> Unit,
) {
    var yaw by remember { mutableFloatStateOf(0.48f) }
    var pitch by remember { mutableFloatStateOf(0.52f) }
    var zoom by remember { mutableFloatStateOf(1.12f) }
    val textMeasurer = rememberTextMeasurer()
    val hits = remember { mutableListOf<MapHit>() }
    Box(Modifier.fillMaxSize()) {
    Canvas(
        Modifier
            .fillMaxSize()
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFF12306A), Color(0xFF0A1A3A), Color(0xFF06101F)),
                ),
            )
            .pointerInput(Unit) {
                detectTransformGestures { _, pan, gestureZoom, _ ->
                    yaw = ((yaw - pan.x * 0.008f) % (Math.PI.toFloat() * 2f) + Math.PI.toFloat() * 2f) % (Math.PI.toFloat() * 2f)
                    pitch = (pitch + pan.y * 0.006f).coerceIn(0.18f, 1.25f)
                    zoom = (zoom * gestureZoom).coerceIn(0.6f, 2.2f)
                }
            }
            .pointerInput(Unit) {
                detectDragGestures { change, drag ->
                    change.consume()
                    yaw = ((yaw - drag.x * 0.01f) % (Math.PI.toFloat() * 2f) + Math.PI.toFloat() * 2f) % (Math.PI.toFloat() * 2f)
                    pitch = (pitch + drag.y * 0.008f).coerceIn(0.18f, 1.25f)
                }
            }
            .pointerInput(Unit) {
                detectTapGestures { tap ->
                    val hit = hits.minByOrNull { h ->
                        val dx = h.x - tap.x
                        val dy = h.y - tap.y
                        dx * dx + dy * dy
                    } ?: return@detectTapGestures
                    val dx = hit.x - tap.x
                    val dy = hit.y - tap.y
                    if (dx * dx + dy * dy > 48f * 48f) return@detectTapGestures
                    if (hit.unitId != null && hit.floorId != null) onSelectUnit(hit.unitId, hit.floorId)
                    else if (hit.floorId != null) onSelectFloor(hit.floorId)
                }
            },
    ) {
        val cam = Cam(yaw, pitch, zoom)
        hits.clear()
        val floors = tour.floors
        val storyCount = floors.size.coerceAtLeast(3)
        val width = 4.8f
        val depth = 3.6f
        val storyH = 0.55f
        val topZ = storyCount * storyH
        val scale = minOf(size.width, size.height) * 0.16f
        val ox = size.width / 2f
        val oy = size.height * 0.46f
        fun p(x: Float, y: Float, z: Float) = project(x, y, z, ox, oy, scale, cam, width / 2f, depth / 2f, topZ / 2f)

        fun face(points: List<Offset>, color: Color, stroke: Color, strokeWidth: Float) {
            val path = Path().apply {
                moveTo(points[0].x, points[0].y)
                points.drop(1).forEach { lineTo(it.x, it.y) }
                close()
            }
            drawPath(path, color)
            drawPath(path, stroke, style = Stroke(width = strokeWidth))
        }

        face(
            listOf(p(0f, 0f, 0f), p(width, 0f, 0f), p(width, depth, 0f), p(0f, depth, 0f)),
            Color(0x73020617),
            Color.Transparent,
            0f,
        )
        face(
            listOf(p(width, 0f, 0f), p(width, depth, 0f), p(width, depth, topZ), p(width, 0f, topZ)),
            Color(0x7338BDF8),
            Color(0xFF7DD3FC),
            2f,
        )
        face(
            listOf(p(0f, 0f, 0f), p(width, 0f, 0f), p(width, 0f, topZ), p(0f, 0f, topZ)),
            Color(0x5938BDF8),
            Color(0xFFE0F2FE),
            2.5f,
        )

        floors.forEachIndexed { index, floor ->
            val z = (index + 1) * storyH
            val active = floor.id == selectedFloorId
            val stroke = if (active) Color(0xFFFBBF24) else Color(0xFF22D3EE)
            val weight = if (active) 4f else 2f
            val slab = listOf(p(0f, 0f, z), p(width, 0f, z), p(width, depth, z), p(0f, depth, z))
            val path = Path().apply {
                moveTo(slab[0].x, slab[0].y)
                slab.drop(1).forEach { lineTo(it.x, it.y) }
                close()
            }
            drawPath(path, stroke, style = Stroke(width = weight))
            if (active) drawPath(path, Color(0x33FBBF24))
            val labelAt = p(width + 0.2f, depth * 0.35f, z)
            hits.add(MapHit(labelAt.x, labelAt.y, floor.id, null))
            val floorLabel = textMeasurer.measure(
                floor.label,
                TextStyle(color = if (active) Color(0xFFFDE68A) else Color(0xFF7DD3FC), fontSize = 11.sp, fontWeight = FontWeight.Bold),
            )
            drawText(floorLabel, topLeft = labelAt)
            val z0 = index * storyH
            for (col in 0 until 4) {
                val x0 = 0.35f + col * (width - 0.6f) / 4f
                val x1 = x0 + 0.45f
                val win = listOf(
                    p(x0, 0f, z0 + storyH * 0.28f),
                    p(x1, 0f, z0 + storyH * 0.28f),
                    p(x1, 0f, z - storyH * 0.18f),
                    p(x0, 0f, z - storyH * 0.18f),
                )
                face(win, Color(0xAAE0F2FE), Color(0x667DD3FC), 1f)
            }
        }

        val roof = topZ + storyH * 0.25f
        val pent = roof + storyH * 0.7f
        face(
            listOf(p(0.2f, 0.2f, roof), p(width - 0.2f, 0.2f, roof), p(width - 0.2f, depth - 0.2f, roof), p(0.2f, depth - 0.2f, roof)),
            Color(0x661E3A8A),
            Color(0xFF67E8F9),
            2f,
        )
        face(
            listOf(p(width * 0.55f, depth * 0.12f, roof), p(width * 0.88f, depth * 0.12f, roof), p(width * 0.88f, depth * 0.12f, pent), p(width * 0.55f, depth * 0.12f, pent)),
            Color(0x666366F1),
            Color(0xFFC4B5FD),
            2f,
        )
        face(
            listOf(p(width * 0.55f, depth * 0.12f, pent), p(width * 0.88f, depth * 0.12f, pent), p(width * 0.88f, depth * 0.42f, pent), p(width * 0.55f, depth * 0.42f, pent)),
            Color(0x996366F1),
            Color(0xFFC4B5FD),
            2f,
        )

        fun unitPoint(unitId: String): Offset? {
            val unit = tour.units.find { it.id == unitId } ?: return null
            val floorIndex = floors.indexOfFirst { it.id == unit.floorId }
            if (floorIndex < 0) return null
            val peers = tour.units.filter { it.floorId == unit.floorId && it.type != "parking" }
            val lngs = peers.map { it.longitude }
            val lats = peers.map { it.latitude }
            val minLng = lngs.minOrNull() ?: 0.0
            val maxLng = lngs.maxOrNull() ?: 0.0
            val minLat = lats.minOrNull() ?: 0.0
            val maxLat = lats.maxOrNull() ?: 0.0
            val u = if (maxLng == minLng) {
                val local = peers.indexOfFirst { it.id == unit.id }.coerceAtLeast(0)
                (local % 4) / 4f
            } else {
                ((unit.longitude - minLng) / (maxLng - minLng)).toFloat()
            }
            val v = if (maxLat == minLat) {
                val local = peers.indexOfFirst { it.id == unit.id }.coerceAtLeast(0)
                (local / 4) / 4f
            } else {
                ((unit.latitude - minLat) / (maxLat - minLat)).toFloat()
            }
            val z = (floorIndex + 1) * storyH + 0.04f
            return p(0.45f + u * (width - 0.9f), 0.4f + v * (depth - 0.8f), z)
        }

        val route = tour.stops.mapNotNull { stop -> unitPoint(stop.id)?.let { stop to it } }
        route.zipWithNext().forEachIndexed { index, (from, to) ->
            val activeSeg = index == activeStopIndex || index + 1 == activeStopIndex
            drawLine(
                color = if (activeSeg) Color(0xFFF472B6) else Color(0xFF22C55E),
                start = from.second,
                end = to.second,
                strokeWidth = if (activeSeg) 7f else 4.5f,
            )
        }
        route.forEachIndexed { index, (stop, at) ->
            val active = index == activeStopIndex
            drawCircle(if (active) Color(0xFFF472B6) else Color(0xFF052E16), if (active) 16f else 11f, at)
            drawCircle(color = if (active) Color(0xFFFCE7F3) else Color(0xFF4ADE80), radius = if (active) 16f else 11f, center = at, style = Stroke(width = 3f))
            val num = textMeasurer.measure(
                "${index + 1}",
                TextStyle(color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold),
            )
            drawText(num, topLeft = Offset(at.x - num.size.width / 2f, at.y - num.size.height / 2f))
            hits.add(MapHit(at.x, at.y, stop.floorId, stop.id))
            val label = textMeasurer.measure(
                stop.title,
                TextStyle(color = if (active) Color(0xFFFCE7F3) else Color(0xFFECFDF5), fontSize = 11.sp, fontWeight = FontWeight.Bold),
            )
            drawText(label, topLeft = Offset(at.x + 18f, at.y - label.size.height / 2f))
        }

        tour.units.filter { it.type != "parking" && (it.floorId == selectedFloorId) }.take(12).forEach { unit ->
            if (route.any { it.first.id == unit.id }) return@forEach
            val at = unitPoint(unit.id) ?: return@forEach
            val hot = unit.id == selectedUnitId
            drawCircle(if (hot) Color(0xFFF472B6) else Color(0xFF34D399), if (hot) 12f else 8f, at)
            drawCircle(color = if (hot) Color(0xFFFCE7F3) else Color(0xFFECFDF5), radius = if (hot) 12f else 8f, center = at, style = Stroke(width = 2f))
            hits.add(MapHit(at.x, at.y, unit.floorId, unit.id))
            val name = textMeasurer.measure(unit.name, TextStyle(color = Color(0xFFECFDF5), fontSize = 10.sp))
            drawText(name, topLeft = Offset(at.x + 14f, at.y - 8f))
        }
    }
    Column(Modifier.align(Alignment.TopEnd).padding(top = 56.dp, end = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        MapCtrl("+") { zoom = (zoom * 1.15f).coerceIn(0.6f, 2.2f) }
        MapCtrl("−") { zoom = (zoom / 1.15f).coerceIn(0.6f, 2.2f) }
        MapCtrl("Reset") {
            yaw = 0.48f
            pitch = 0.52f
            zoom = 1.12f
        }
    }
    val floorName = tour.floors.find { it.id == selectedFloorId }?.label ?: ""
    Text(
        "${tour.buildingName} · ${tour.floors.size} floors · $floorName · stop ${activeStopIndex + 1}/${tour.stops.size.coerceAtLeast(1)}",
        modifier = Modifier.align(Alignment.BottomStart).padding(start = 12.dp, bottom = 118.dp),
        color = TextSecondary,
        fontSize = 11.sp,
        fontFamily = Manrope,
    )
    }
}

@Composable
private fun MapCtrl(label: String, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(Color(0xE60F2850))
            .border(1.dp, Color(0x597DD3FC), RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        color = Color(0xFF7DD3FC),
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp,
    )
}
