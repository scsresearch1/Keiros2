package com.keiros.tourapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

@Composable
fun PrimaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    variant: String = "primary",
) {
    val shape = RoundedCornerShape(999.dp)
    val brush = when (variant) {
        "teal" -> Brush.linearGradient(listOf(Color(0xFF0D9488), Teal))
        "light" -> Brush.linearGradient(listOf(Color.White, Color.White))
        "ghost" -> null
        else -> Brush.linearGradient(listOf(Blue, BlueBright))
    }
    val textColor = when (variant) {
        "teal" -> Color(0xFF042F2E)
        "light" -> Color(0xFF0A1628)
        "ghost" -> TextPrimary
        else -> Color.White
    }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(shape)
            .then(
                if (brush != null) Modifier.background(brush)
                else Modifier
                    .background(Color.Transparent)
                    .border(1.dp, BorderStrong, shape),
            )
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (enabled) textColor else textColor.copy(alpha = 0.45f),
            fontFamily = Manrope,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
        )
    }
}

@Composable
fun BackChip(onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(42.dp)
            .clip(CircleShape)
            .background(Color(0x8C07111E))
            .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text("←", color = Color.White, fontSize = 18.sp)
    }
}

@Composable
fun BottomSheet(
    title: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    val maxHeight = (LocalConfiguration.current.screenHeightDp * 0.72f).dp
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = maxHeight)
            .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
            .background(Brush.verticalGradient(listOf(Color(0xF0101F35), Color(0xFA07111E))))
            .border(1.dp, Border, RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp))
            .padding(horizontal = 18.dp)
            .padding(bottom = 16.dp),
    ) {
        Box(
            modifier = Modifier
                .padding(top = 10.dp, bottom = 8.dp)
                .width(40.dp)
                .height(4.dp)
                .clip(CircleShape)
                .background(BorderStrong)
                .align(Alignment.CenterHorizontally),
        )
        Text(title, fontFamily = Sora, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, color = TextPrimary)
        Text(subtitle, color = TextSecondary, fontFamily = Manrope, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp, bottom = 12.dp))
        Column(Modifier.verticalScroll(rememberScrollState())) {
            content()
        }
    }
}

@Composable
fun BoxScope.HeroBackdrop(url: String, dense: Boolean = false) {
    Box(Modifier.matchParentSize()) {
        AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
        Box(
            Modifier
                .matchParentSize()
                .background(
                    Brush.verticalGradient(
                        if (dense) listOf(Color(0x8C07111E), Color(0xEB07111E))
                        else listOf(Color(0x5907111E), Color(0x8C07111E), Color(0xF007111E)),
                    ),
                ),
        )
    }
}

@Composable
fun Eyebrow(text: String) {
    Text(
        text,
        color = Teal,
        fontFamily = Manrope,
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp,
        letterSpacing = 1.4.sp,
    )
}

@Composable
fun PropertyHeroCard(
    image: String,
    badge: String?,
    title: String,
    meta: String,
    cta: String,
    onCta: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(340.dp)
            .clip(RoundedCornerShape(28.dp)),
    ) {
        AsyncImage(model = image, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
        Box(
            Modifier
                .matchParentSize()
                .background(Brush.verticalGradient(listOf(Color(0x2607111E), Color(0xEB07111E)))),
        )
        if (badge != null) {
            Text(
                badge,
                modifier = Modifier
                    .padding(16.dp)
                    .clip(CircleShape)
                    .background(Teal)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                color = Color(0xFF042F2E),
                fontFamily = Manrope,
                fontWeight = FontWeight.Bold,
                fontSize = 11.sp,
            )
        }
        Column(Modifier.align(Alignment.BottomStart).padding(20.dp)) {
            Text(title, fontFamily = Sora, fontWeight = FontWeight.SemiBold, fontSize = 26.sp, color = Color.White)
            Text(meta, color = Color(0xD1EAF0F8), fontFamily = Manrope, modifier = Modifier.padding(top = 6.dp, bottom = 12.dp))
            Text(
                cta,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(Color.White)
                    .clickable(onClick = onCta)
                    .padding(horizontal = 18.dp, vertical = 10.dp),
                color = Color(0xFF0A1628),
                fontFamily = Manrope,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
fun Chip(label: String, active: Boolean, onClick: () -> Unit) {
    Text(
        label,
        modifier = Modifier
            .clip(CircleShape)
            .background(if (active) Brush.linearGradient(listOf(Blue, BlueBright)) else Brush.linearGradient(listOf(Color(0xB314263F), Color(0xB314263F))))
            .border(1.dp, if (active) Color.Transparent else Border, CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        color = if (active) Color.White else TextSecondary,
        fontFamily = Manrope,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
    )
}

@Composable
fun Stat(value: String, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Color(0xA614263F))
            .border(1.dp, Border, RoundedCornerShape(14.dp))
            .padding(vertical = 10.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, fontFamily = Sora, fontWeight = FontWeight.SemiBold, color = TextPrimary)
        Text(label, color = TextMuted, fontSize = 11.sp, fontFamily = Manrope)
    }
}

@Composable
fun PhaseButton(label: String, active: Boolean, tint: Color, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Text(
        label,
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (active) tint.copy(alpha = 0.15f) else Color(0x8C07122A))
            .border(1.dp, if (active) tint else Border, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        color = if (active) TextPrimary else TextMuted,
        fontFamily = Manrope,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
    )
}
