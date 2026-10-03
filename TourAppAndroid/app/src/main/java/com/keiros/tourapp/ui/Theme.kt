package com.keiros.tourapp.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.keiros.tourapp.R

val Navy = Color(0xFF07111E)
val NavySoft = Color(0xFF0C1A2E)
val Panel = Color(0xFF101F35)
val Panel2 = Color(0xFF14263F)
val Blue = Color(0xFF1A5FBF)
val BlueBright = Color(0xFF2B7DE9)
val Teal = Color(0xFF14B8A6)
val Amber = Color(0xFFF59E0B)
val TextPrimary = Color(0xFFEAF0F8)
val TextSecondary = Color(0xFF9CB3CC)
val TextMuted = Color(0xFF6F849D)
val Verified = Color(0xFF34D399)
val Danger = Color(0xFFF87171)
val Border = Color(0x29ADC9E8)
val BorderStrong = Color(0x47ADC9E8)

val Manrope = FontFamily(
    Font(R.font.manrope_regular, FontWeight.Normal),
    Font(R.font.manrope_medium, FontWeight.Medium),
    Font(R.font.manrope_semibold, FontWeight.SemiBold),
    Font(R.font.manrope_bold, FontWeight.Bold),
)

val Sora = FontFamily(
    Font(R.font.sora_regular, FontWeight.Normal),
    Font(R.font.sora_semibold, FontWeight.SemiBold),
    Font(R.font.sora_bold, FontWeight.Bold),
)

private val Colors = darkColorScheme(
    primary = BlueBright,
    onPrimary = Color.White,
    background = Navy,
    surface = Panel,
    onBackground = TextPrimary,
    onSurface = TextPrimary,
)

private val Type = Typography(
    bodyLarge = TextStyle(fontFamily = Manrope, fontSize = 16.sp, color = TextPrimary),
    bodyMedium = TextStyle(fontFamily = Manrope, fontSize = 14.sp, color = TextPrimary),
    titleLarge = TextStyle(fontFamily = Sora, fontSize = 22.sp, fontWeight = FontWeight.SemiBold),
    labelLarge = TextStyle(fontFamily = Manrope, fontSize = 14.sp, fontWeight = FontWeight.Bold),
)

@Composable
fun KeirosTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = Colors,
        typography = Type,
        shapes = Shapes(
            small = RoundedCornerShape(8.dp),
            medium = RoundedCornerShape(16.dp),
            large = RoundedCornerShape(28.dp),
        ),
        content = content,
    )
}
