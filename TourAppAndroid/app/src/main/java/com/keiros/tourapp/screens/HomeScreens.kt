package com.keiros.tourapp.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.keiros.tourapp.data.Photos
import com.keiros.tourapp.data.TourStop
import com.keiros.tourapp.data.TourUnit
import com.keiros.tourapp.flow.TourMode
import com.keiros.tourapp.flow.TourUiState
import com.keiros.tourapp.flow.TourViewModel
import com.keiros.tourapp.ui.Amber
import com.keiros.tourapp.ui.BackChip
import com.keiros.tourapp.ui.Border
import com.keiros.tourapp.ui.BorderStrong
import com.keiros.tourapp.ui.BottomSheet
import com.keiros.tourapp.ui.Chip
import com.keiros.tourapp.ui.Eyebrow
import com.keiros.tourapp.ui.HeroBackdrop
import com.keiros.tourapp.ui.Manrope
import com.keiros.tourapp.ui.Navy
import com.keiros.tourapp.ui.PrimaryButton
import com.keiros.tourapp.ui.PropertyHeroCard
import com.keiros.tourapp.ui.Sora
import com.keiros.tourapp.ui.Stat
import com.keiros.tourapp.ui.Teal
import com.keiros.tourapp.ui.TextMuted
import com.keiros.tourapp.ui.TextPrimary
import com.keiros.tourapp.ui.TextSecondary
import com.keiros.tourapp.ui.Verified

@Composable
fun OverviewScreen(state: TourUiState, vm: TourViewModel) {
    val property = state.property
    val places = state.tour.stops.size
    Box(Modifier.fillMaxSize()) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Navy)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp)
            .padding(top = 12.dp, bottom = 120.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 12.dp)) {
            BackChip(vm::goBack)
            Text("Keiros Tour", color = Teal, fontFamily = Sora, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 12.dp))
        }
        Eyebrow("WELCOME")
        Text(
            "Tour ${property?.name ?: "the property"}",
            fontFamily = Sora,
            fontWeight = FontWeight.SemiBold,
            fontSize = 30.sp,
            color = TextPrimary,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        Text(
            "No guide needed. Follow a curated walkthrough of highlights, or wander freely — you’re in control.",
            color = TextSecondary,
            fontFamily = Manrope,
            modifier = Modifier.padding(bottom = 16.dp),
        )
        PropertyHeroCard(
            image = Photos.campus,
            badge = property?.code,
            title = property?.name ?: "Property",
            meta = listOfNotNull(
                property?.city,
                "${property?.buildings ?: 2} buildings",
                "$places+ places",
            ).joinToString(" · "),
            cta = "Start self-guided tour",
            onCta = vm::startGuidedTour,
        )
        Spacer(Modifier.height(16.dp))
        listOf(
            "Enter once" to "Get inside the building first",
            "Lowest floor first" to "Visit every unit on a floor, then move up",
            "End anytime" to "Leave the tour whenever you’re ready",
        ).forEach { (title, body) ->
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(Color(0x7308142A))
                    .border(1.dp, Color(0x2E7DD3FC), RoundedCornerShape(14.dp))
                    .padding(12.dp),
            ) {
                Text(title, fontFamily = Manrope, fontWeight = FontWeight.Bold, color = TextPrimary)
                Text(body, color = TextMuted, fontSize = 13.sp, fontFamily = Manrope)
            }
        }
    }
    Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
        Column(
            Modifier
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xF207111E))))
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            PrimaryButton("Start self-guided tour", vm::startGuidedTour)
            Text(
                "Browse places instead",
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = vm::startBrowseTour)
                    .padding(vertical = 6.dp),
                color = TextSecondary,
                fontFamily = Manrope,
            )
        }
    }
    }
}

@Composable
fun SearchScreen(state: TourUiState, vm: TourViewModel) {
    val showTour = state.searchTab == "tour" && state.tourMode == TourMode.Guided
    val tour = state.tour
    val stop = tour.stops.getOrNull(state.currentStopIndex)
    Box(Modifier.fillMaxSize().background(Navy)) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp)
                .padding(top = 12.dp, bottom = 110.dp),
        ) {
            BackChip(vm::goBack)
            if (state.tourMode == TourMode.Guided) {
                Row(
                    Modifier
                        .padding(top = 12.dp, bottom = 12.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(Color(0x8C08142A))
                        .border(1.dp, Color(0x407DD3FC), RoundedCornerShape(99.dp))
                        .padding(3.dp),
                ) {
                    TabPill("My tour", state.searchTab == "tour") { vm.setSearchTab("tour") }
                    TabPill("Explore map", state.searchTab == "browse") { vm.setSearchTab("browse") }
                }
            }
            if (showTour) {
                Eyebrow("SELF-GUIDED · ~${tour.estimateMinutes()} MIN")
                Text("Floor by floor", fontFamily = Sora, fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                Text(
                    "Start on the lowest floor, visit every unit there, then move up one floor at a time. You can end the tour anytime once you’re inside.",
                    color = TextSecondary,
                    fontFamily = Manrope,
                    modifier = Modifier.padding(bottom = 12.dp),
                )
                tour.floors.forEachIndexed { index, floor ->
                    val group = tour.stops.filter { it.floorId == floor.id }
                    if (group.isEmpty()) return@forEachIndexed
                    Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("FLOOR ${index + 1}", color = Color(0xFF7DD3FC), fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = Manrope)
                        Text(floor.label, color = TextPrimary, fontFamily = Sora, modifier = Modifier.padding(start = 8.dp))
                        Spacer(Modifier.weight(1f))
                        Text("${group.size} stops", color = TextMuted, fontSize = 12.sp)
                    }
                    group.forEach { item -> StopCard(item, state, vm) }
                    Spacer(Modifier.height(10.dp))
                }
            } else {
                Eyebrow("EXPLORE")
                Text("Places to see", fontFamily = Sora, fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                Text("Pick anything on the property — we’ll take you there.", color = TextSecondary, fontFamily = Manrope)
                BasicTextField(
                    value = state.searchQuery,
                    onValueChange = vm::setSearchQuery,
                    textStyle = TextStyle(color = TextPrimary, fontFamily = Manrope),
                    cursorBrush = SolidColor(Teal),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(Color(0xD9101F35))
                        .border(1.dp, BorderStrong, RoundedCornerShape(99.dp))
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    decorationBox = { inner ->
                        if (state.searchQuery.isEmpty()) Text("Search homes or amenities", color = TextMuted, fontFamily = Manrope)
                        inner()
                    },
                )
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    tour.filters.forEach { (id, label) ->
                        Chip(label, state.filter == id) { vm.setFilter(id) }
                    }
                }
                Spacer(Modifier.height(12.dp))
                val results = filteredUnits(state)
                if (results.isEmpty()) {
                    Text("No matches — try another filter.", color = TextMuted, fontFamily = Manrope)
                }
                results.forEach { unit ->
                    UnitCard(unit, state.destination?.id == unit.id) { vm.selectUnit(unit) }
                }
            }
        }
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xF207111E))))
                .padding(18.dp),
        ) {
            val label = when {
                state.navigateLoading -> "Getting directions…"
                showTour && stop != null -> "Head to ${stop.title}"
                state.destination != null -> "Head to ${state.destination.name}"
                else -> "Choose a stop"
            }
            PrimaryButton(label, vm::runNavigate, enabled = state.destination != null && !state.navigateLoading)
        }
    }
}

@Composable
private fun TabPill(label: String, active: Boolean, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier
            .clip(RoundedCornerShape(99.dp))
            .background(if (active) Brush.linearGradient(listOf(Color(0xFF38BDF8), Color(0xFF818CF8))) else Brush.linearGradient(listOf(Color.Transparent, Color.Transparent)))
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 10.dp),
        color = if (active) Color(0xFF04101F) else TextSecondary,
        fontFamily = Manrope,
        fontWeight = FontWeight.Bold,
        fontSize = 13.sp,
    )
}

@Composable
private fun StopCard(stop: TourStop, state: TourUiState, vm: TourViewModel) {
    val index = state.tour.stops.indexOfFirst { it.id == stop.id }
    val current = index == state.currentStopIndex
    val visited = stop.id in state.visitedStopIds
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color(0x8C08142A))
            .border(1.dp, if (current) Color(0x8C38BDF8) else Color(0x38A3B8C8), RoundedCornerShape(16.dp))
            .clickable {
                vm.selectStop(index)
            }
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = Photos.forType(stop.unit.type, stop.unit.name),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(88.dp).clip(RoundedCornerShape(18.dp)),
        )
        Column(Modifier.padding(start = 12.dp)) {
            val tag = when {
                stop.role == "entry" -> "Enter here"
                else -> "Stop ${stop.order}"
            } + when {
                visited -> " · Seen"
                current -> " · Up next"
                else -> ""
            }
            Text(tag, color = Color(0xFF7DD3FC), fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = Manrope)
            Text(stop.title, color = TextPrimary, fontFamily = Manrope, fontWeight = FontWeight.Bold)
            Text(stop.blurb, color = TextMuted, fontSize = 12.sp, fontFamily = Manrope)
        }
    }
}

@Composable
private fun UnitCard(unit: TourUnit, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 10.dp)
            .clip(RoundedCornerShape(22.dp))
            .background(Color(0xB8101F35))
            .border(1.dp, if (selected) Color(0x8C2B7DE9) else Border, RoundedCornerShape(22.dp))
            .clickable(onClick = onClick)
            .padding(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = Photos.forType(unit.type, unit.name),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(88.dp).clip(RoundedCornerShape(18.dp)),
        )
        Column(Modifier.padding(start = 12.dp)) {
            Text(unit.name, color = TextPrimary, fontFamily = Manrope, fontWeight = FontWeight.Bold)
            Text("${unit.buildingName} · ${unit.floorLabel}", color = TextMuted, fontSize = 13.sp, fontFamily = Manrope)
        }
    }
}

private fun filteredUnits(state: TourUiState): List<TourUnit> {
    val q = state.searchQuery.trim().lowercase()
    return state.tour.units.filter { unit ->
        val hay = "${unit.type} ${unit.name}".lowercase()
        val filterOk = when (state.filter) {
            "all" -> true
            "unit" -> "unit" in hay || "home" in hay || "apt" in hay
            "park" -> "park" in hay
            else -> state.filter in hay
        }
        val queryOk = q.isEmpty() || hay.contains(q) || unit.buildingName.lowercase().contains(q)
        filterOk && queryOk
    }
}

@Composable
fun RoutePreviewScreen(state: TourUiState, vm: TourViewModel) {
    val tour = state.tour
    val stop = tour.stops.getOrNull(state.currentStopIndex)
    val title = stop?.title ?: state.destination?.name ?: "Next stop"
    Column(Modifier.fillMaxSize().background(Navy)) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            OutdoorMapView(
                route = state.tour.outdoor,
                activeStep = state.tour.journey.firstOrNull(),
                weather = state.weatherSummary,
                traffic = state.trafficLevel,
                modifier = Modifier.fillMaxSize(),
            )
            Box(Modifier.padding(14.dp)) { BackChip(vm::goBack) }
        }
        Column(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .background(Brush.verticalGradient(listOf(Color(0xF80C1A2E), Color(0xFC07111E))))
                .border(1.dp, Border, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Eyebrow(
                if (state.tourMode == TourMode.Guided && state.currentStopIndex == 0) "STEP 1 · GET INSIDE"
                else if (state.tourMode == TourMode.Guided) "INSIDE · PLACE ${state.currentStopIndex + 1} OF ${state.tour.stops.size}"
                else "NEXT ON YOUR TOUR",
            )
            Text(title, fontFamily = Sora, fontSize = 22.sp, color = TextPrimary, modifier = Modifier.padding(vertical = 6.dp))
            if (stop != null) Text(stop.blurb, color = TextSecondary, fontFamily = Manrope)
            Row(Modifier.padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (state.currentStopIndex == 0) {
                    MiniPhase("Arrive", false, Color(0xFFF97316), Modifier.weight(1f))
                    MiniPhase("Walk in", false, Color(0xFF38BDF8), Modifier.weight(1f))
                    MiniPhase("Enter", true, Color(0xFF22C55E), Modifier.weight(1f))
                } else {
                    MiniPhase("Already inside", true, Color(0xFF22C55E), Modifier.weight(1f))
                    MiniPhase("Walk to place", false, Color(0xFF38BDF8), Modifier.weight(1f))
                    MiniPhase("Explore", false, Color(0xFFF97316), Modifier.weight(1f))
                }
            }
            val indoorStops = state.tour.journey.count { it.phase == "indoor" }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Stat("6m", "To parking", Modifier.weight(1f))
                Stat("3m", "To entrance", Modifier.weight(1f))
                Stat("${indoorStops}m", "Inside", Modifier.weight(1f))
            }
            Text("${state.weatherSummary} · $indoorStops indoor checkpoints", color = TextMuted, fontSize = 12.sp, fontFamily = Manrope, modifier = Modifier.padding(vertical = 10.dp))
            PrimaryButton("Continue to this stop", vm::openNavigation)
        }
    }
}

@Composable
private fun MiniPhase(label: String, active: Boolean, tint: Color, modifier: Modifier) {
    Text(
        label,
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (active) tint.copy(alpha = 0.15f) else Color(0x8C07122A))
            .border(1.dp, if (active) tint else Border, RoundedCornerShape(12.dp))
            .padding(vertical = 8.dp),
        color = if (active) TextPrimary else TextMuted,
        fontSize = 11.sp,
        fontFamily = Manrope,
        fontWeight = FontWeight.SemiBold,
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
    )
}

@Composable
fun DoorAccessScreen(state: TourUiState, vm: TourViewModel) {
    val seen = state.visitedStopIds.size
    Box(Modifier.fillMaxSize()) {
        HeroBackdrop(Photos.lobby)
        Box(Modifier.padding(14.dp)) { BackChip(vm::goBack) }
        Column(Modifier.align(Alignment.BottomCenter)) {
            BottomSheet(
                "Almost done",
                if (seen > 0) "Nice — you visited $seen tour stop${if (seen == 1) "" else "s"}. Unlock amenities if you need access."
                else "Optional door unlocks for guest amenities.",
            ) {
                state.tour.facilities.forEach { facility ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(facility.name, color = TextPrimary, fontFamily = Manrope, fontWeight = FontWeight.Bold)
                            Text("Guest access", color = TextMuted, fontSize = 12.sp)
                        }
                        Box(Modifier.weight(0.7f)) {
                            PrimaryButton(
                                if (state.doorBusyId == facility.id) "…" else "Unlock",
                                { vm.unlock(facility.id) },
                                enabled = state.doorBusyId != facility.id,
                                variant = "teal",
                            )
                        }
                    }
                }
                state.doorResult?.let { result ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 10.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (result.granted) Verified.copy(alpha = 0.1f) else Color(0x1AF87171))
                            .border(1.dp, if (result.granted) Verified.copy(alpha = 0.4f) else Color(0x66F87171), RoundedCornerShape(14.dp))
                            .padding(12.dp),
                    ) {
                        Text(
                            "${result.facilityName}: ${if (result.granted) "Unlocked" else "Unavailable"}",
                            color = TextPrimary,
                            fontFamily = Manrope,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(result.message, color = TextSecondary, fontSize = 13.sp)
                    }
                }
                PrimaryButton("Wrap up my tour", vm::goNext)
            }
        }
    }
}

@Composable
fun CompleteScreen(state: TourUiState, vm: TourViewModel) {
    Box(Modifier.fillMaxSize()) {
        HeroBackdrop(Photos.unit)
        Column(Modifier.align(Alignment.BottomCenter)) {
            BottomSheet(
                if (state.feedbackDone) "Thanks for visiting" else "Tour complete",
                if (state.feedbackDone) "We saved your feedback."
                else "${state.property?.name ?: "Property"}",
            ) {
                if (!state.feedbackDone) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
                        Stat("${state.visitedStopIds.size}", "Stops seen", Modifier.weight(1f))
                        Stat("${state.tour.stops.size}", "On your list", Modifier.weight(1f))
                        Stat("18m", "Tour time", Modifier.weight(1f))
                    }
                    if (state.visitedStopIds.isNotEmpty()) {
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .padding(bottom = 10.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0x6608142A))
                                .border(1.dp, Color(0x2E7DD3FC), RoundedCornerShape(12.dp))
                                .padding(10.dp),
                        ) {
                            state.tour.stops.forEach { stop ->
                                val seen = stop.id in state.visitedStopIds
                                Text(
                                    "${if (seen) "✓" else "○"} ${stop.title}",
                                    color = if (seen) Color(0xFF6EE7B7) else TextSecondary,
                                    fontFamily = Manrope,
                                    fontSize = 14.sp,
                                )
                            }
                        }
                    }
                    Text("How was this self-guided tour?", color = TextSecondary, fontFamily = Manrope)
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center) {
                        (1..5).forEach { n ->
                            Text(
                                "★",
                                modifier = Modifier.clickable { vm.setRating(n) }.padding(horizontal = 4.dp),
                                color = if (n <= state.rating) Amber else BorderStrong,
                                fontSize = 28.sp,
                            )
                        }
                    }
                    PrimaryButton(if (state.busy) "Saving…" else "Submit & finish", vm::submitFeedback, enabled = !state.busy)
                } else {
                    PrimaryButton("Tour another property", vm::resetTour)
                }
            }
        }
    }
}
