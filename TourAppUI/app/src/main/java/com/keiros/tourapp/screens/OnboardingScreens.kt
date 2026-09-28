package com.keiros.tourapp.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.keiros.tourapp.data.Photos
import com.keiros.tourapp.flow.TourUiState
import com.keiros.tourapp.flow.TourViewModel
import com.keiros.tourapp.ui.BackChip
import com.keiros.tourapp.ui.BorderStrong
import com.keiros.tourapp.ui.BottomSheet
import com.keiros.tourapp.ui.Eyebrow
import com.keiros.tourapp.ui.HeroBackdrop
import com.keiros.tourapp.ui.Manrope
import com.keiros.tourapp.ui.PrimaryButton
import com.keiros.tourapp.ui.Sora
import com.keiros.tourapp.ui.Teal
import com.keiros.tourapp.ui.TextMuted
import com.keiros.tourapp.ui.TextPrimary
import com.keiros.tourapp.ui.TextSecondary
import com.keiros.tourapp.ui.Verified

@Composable
fun SplashScreen(onBegin: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        HeroBackdrop(Photos.splash)
        Column(
            Modifier
                .align(Alignment.BottomStart)
                .padding(horizontal = 20.dp, vertical = 28.dp),
        ) {
            Eyebrow("SELF-GUIDED PROPERTY TOUR")
            Text(
                "Keiros",
                modifier = Modifier.padding(vertical = 6.dp),
                style = TextStyle(
                    brush = Brush.linearGradient(listOf(Color(0xFFEAF0F8), Color(0xFF7DD3FC), Teal)),
                    fontFamily = Sora,
                    fontWeight = FontWeight.Bold,
                    fontSize = 58.sp,
                    letterSpacing = (-1.5).sp,
                ),
            )
            Text(
                "Explore the whole community at your pace — lobby, amenities, and model homes.",
                color = Color(0xD1EAF0F8),
                fontFamily = Manrope,
                fontSize = 17.sp,
                modifier = Modifier.padding(bottom = 28.dp),
            )
            PrimaryButton("Begin my tour", onBegin, variant = "light")
        }
    }
}

@Composable
fun PermissionsScreen(onBack: () -> Unit, onContinue: () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        HeroBackdrop(Photos.night)
        Box(Modifier.padding(14.dp)) { BackChip(onBack) }
        Column(Modifier.align(Alignment.BottomCenter)) {
            BottomSheet("Help us guide you", "Only used while you’re on this self-guided tour.") {
                listOf(
                    "Location" to "Show where you are on the property",
                    "Directions" to "Guide you from stop to stop",
                    "Visit timing" to "Optional — you can turn this on later",
                ).forEach { (title, body) ->
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 8.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(Color(0xA614263F))
                            .border(1.dp, com.keiros.tourapp.ui.Border, RoundedCornerShape(16.dp))
                            .padding(14.dp),
                    ) {
                        Text(title, fontFamily = Manrope, fontWeight = FontWeight.Bold, color = TextPrimary)
                        Text(body, color = TextMuted, fontSize = 13.sp, fontFamily = Manrope)
                    }
                }
                PrimaryButton("Continue", onContinue)
                Text(
                    "Continue without location",
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = onContinue)
                        .padding(top = 12.dp),
                    color = TextSecondary,
                    fontFamily = Manrope,
                    fontSize = 14.sp,
                )
            }
        }
    }
}

@Composable
fun PropertyCodeScreen(state: TourUiState, vm: TourViewModel) {
    var scanning by remember { mutableStateOf(false) }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scanning = true
    }
    if (scanning) {
        QrScanScreen(
            onCancel = { scanning = false },
            onScanned = { raw ->
                scanning = false
                vm.onQrScanned(raw)
            },
        )
        return
    }
    Box(Modifier.fillMaxSize()) {
        HeroBackdrop(Photos.campus)
        Box(Modifier.padding(14.dp)) { BackChip(vm::goBack) }
        Column(Modifier.align(Alignment.BottomCenter)) {
            BottomSheet(
                "Join this property tour",
                "Scan the code at the lobby, leasing desk, or model unit door.",
            ) {
                Text("Tour access code", color = TextSecondary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, fontFamily = Manrope)
                BasicTextField(
                    value = state.code,
                    onValueChange = vm::setCode,
                    textStyle = TextStyle(color = TextPrimary, fontFamily = Manrope, fontSize = 16.sp),
                    cursorBrush = SolidColor(Teal),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp, bottom = 8.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Color(0xA607111E))
                        .border(1.dp, BorderStrong, RoundedCornerShape(16.dp))
                        .padding(horizontal = 14.dp, vertical = 14.dp),
                    decorationBox = { inner ->
                        if (state.code.isEmpty()) {
                            Text("OC-CHI-2026", color = TextMuted, fontFamily = Manrope)
                        }
                        inner()
                    },
                )
                Text("Scan the lobby QR. The app reads the property ID from it.", color = TextMuted, fontSize = 12.sp, fontFamily = Manrope)
                if (state.scannedPropertyId.isNotBlank()) {
                    Text("Property ID · ${state.scannedPropertyId}", color = Teal, fontSize = 13.sp, fontFamily = Manrope, modifier = Modifier.padding(top = 6.dp))
                }
                if (state.codeError != null) {
                    Text(state.codeError, color = Color(0xFFFECACA), fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
                }
                Spacer(Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("Scan QR code", { cameraPermission.launch(android.Manifest.permission.CAMERA) }, variant = "ghost")
                    PrimaryButton("Use demo scan", vm::useDemoScan, variant = "ghost")
                    PrimaryButton(
                        if (state.busy) "Opening tour…" else "Start with this code",
                        vm::validateCode,
                        enabled = state.code.isNotBlank() && !state.busy,
                    )
                }
            }
        }
    }
}

@Composable
fun ValidatingScreen(state: TourUiState, onReady: () -> Unit) {
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(1400)
        onReady()
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        HeroBackdrop(Photos.lobby, dense = true)
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
            Box(
                Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(Verified.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Text("✓", color = Verified, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            }
            Eyebrow("YOU’RE IN")
            Text(state.property?.name ?: "", fontFamily = Sora, fontSize = 26.sp, color = TextPrimary, modifier = Modifier.padding(top = 6.dp))
            Text(state.property?.address ?: "", color = TextSecondary, fontFamily = Manrope)
            if (!state.property?.propertyId.isNullOrBlank()) {
                Text("Property ID · ${state.property?.propertyId}", color = Teal, fontFamily = Manrope, modifier = Modifier.padding(top = 8.dp))
            }
            if (state.firebaseNote.isNotBlank()) {
                Text(state.firebaseNote, color = TextSecondary, fontFamily = Manrope, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
            }
            Text("Preparing your self-guided tour…", color = TextSecondary, fontFamily = Manrope, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable
fun DownloadScreen(state: TourUiState, vm: TourViewModel) {
    LaunchedEffect(Unit) { vm.runDownload() }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        HeroBackdrop(Photos.lobby, dense = true)
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
            Eyebrow("GETTING READY")
            Text(state.property?.name ?: "Your tour", fontFamily = Sora, fontSize = 28.sp, color = TextPrimary)
            val city = listOfNotNull(state.property?.city, state.property?.state).joinToString(", ")
            Text(city, color = TextSecondary, fontFamily = Manrope)
            Box(
                Modifier
                    .padding(top = 22.dp, bottom = 12.dp)
                    .fillMaxWidth(0.8f)
                    .height(8.dp)
                    .clip(CircleShape)
                    .background(Color(0x24ADC9E8)),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(state.downloadPct / 100f)
                        .height(8.dp)
                        .background(Brush.horizontalGradient(listOf(com.keiros.tourapp.ui.Blue, Teal))),
                )
            }
            Text(state.downloadLabel, color = TextSecondary, fontFamily = Manrope)
        }
    }
}
