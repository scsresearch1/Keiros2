package com.keiros.tourapp.screens

import kotlin.math.roundToInt

object VoiceGuide {
    fun cue(current: String, distanceMeters: Double?, upcoming: String?): String {
        val now = soften(current)
        if (now.isBlank()) return ""
        val next = upcoming?.let { soften(it) }.orEmpty()
        val arriving = Regex(
            "reached the parking|you're at|you're inside|you've arrived|park here",
            RegexOption.IGNORE_CASE,
        ).containsMatchIn(now)
        val span = if (arriving) "" else distancePhrase(distanceMeters ?: 0.0)
        val finished = finish(now)
        return when {
            next.isNotBlank() && span.isNotBlank() -> "$finished Follow this for $span. Then, ${lowerFirst(next)}."
            next.isNotBlank() -> "$finished Then, ${lowerFirst(next)}."
            else -> finished
        }
    }

    private fun soften(raw: String): String {
        var line = raw.trim()
        val swaps = listOf(
            "Start driving toward" to "Let's head toward",
            "Head toward parking" to "Let's head toward the nearest parking",
            "Let's head toward parking" to "Let's head toward the nearest parking",
            "Drive to the nearest parking and leave the car" to "Let's head toward the nearest parking",
            "Drive to parking" to "Let's head toward the nearest parking",
            "visitor parking" to "the visitor parking",
            "garage parking" to "the visitor parking",
            "Arrive at nearest parking" to "You've reached the parking. You can leave the car here",
            "Arrive at the nearest parking" to "You've reached the parking. You can leave the car here",
            "Leave the car and walk" to "Leave the car, and walk over",
            "Walk from parking" to "Leave the car, and walk",
            "Enter building" to "You're inside. Head",
            "Take vertical access" to "Take the stairs or elevator",
            "Go to" to "Continue to",
            "Arrive at" to "You've arrived at",
        )
        swaps.forEach { (from, to) ->
            line = line.replace(from, to, ignoreCase = true)
        }
        return line
    }

    private fun distancePhrase(meters: Double): String {
        if (meters < 80) return ""
        if (meters < 950) {
            val rounded = ((meters / 50.0).roundToInt() * 50).coerceAtLeast(50)
            return "about $rounded meters"
        }
        val miles = meters / 1609.344
        val shown = ((miles * 10).roundToInt() / 10.0)
        val label = if (shown == 1.0) "mile" else "miles"
        return "about $shown $label"
    }

    private fun finish(line: String): String {
        val trimmed = line.trim().trimEnd('.', ' ')
        return if (trimmed.isEmpty()) "" else "$trimmed."
    }

    private fun lowerFirst(line: String): String {
        val trimmed = line.trim().trimEnd('.')
        if (trimmed.isEmpty()) return ""
        return trimmed.replaceFirstChar { it.lowercase() }
    }
}
