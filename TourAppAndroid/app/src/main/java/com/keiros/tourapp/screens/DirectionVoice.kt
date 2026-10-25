package com.keiros.tourapp.screens

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.staticCompositionLocalOf
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max
import kotlin.math.min

val LocalDirectionVoice = staticCompositionLocalOf<DirectionVoice?> { null }

class DirectionVoice(context: Context) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(AudioManager::class.java)
    private val worker = Executors.newSingleThreadExecutor()
    private val generation = AtomicInteger(0)
    val engineState = mutableStateOf("starting")
    private var tts: OfflineTts? = null
    private var track: AudioTrack? = null
    private var closed = false
    private var pending: String? = null
    private var lastText = ""
    private var lastAt = 0L

    init {
        worker.execute {
            if (closed) return@execute
            try {
                System.loadLibrary("onnxruntime")
                System.loadLibrary("sherpa-onnx-c-api")
                System.loadLibrary("sherpa-onnx-cxx-api")
                System.loadLibrary("sherpa-onnx-jni")
                val speechData = copySpeechData()
                val config = OfflineTtsConfig(
                    model = OfflineTtsModelConfig(
                        vits = OfflineTtsVitsModelConfig(
                            model = "vits-piper-en_US-amy-low/en_US-amy-low.onnx",
                            tokens = "vits-piper-en_US-amy-low/tokens.txt",
                            dataDir = speechData,
                        ),
                        numThreads = 2,
                    ),
                )
                val engine = OfflineTts(appContext.assets, config)
                if (closed) {
                    engine.release()
                    return@execute
                }
                tts = engine
                engineState.value = "ready"
                pending?.let { say(it) }
                pending = null
            } catch (_: Throwable) {
                engineState.value = "missing"
            }
        }
    }

    fun speak(text: String, force: Boolean = false) {
        val line = text.trim()
        if (line.isBlank() || closed) return
        val now = System.currentTimeMillis()
        if (!force && line == lastText && now - lastAt < 2500) return
        lastText = line
        lastAt = now
        val token = generation.incrementAndGet()
        worker.execute {
            if (closed || token != generation.get()) return@execute
            if (tts == null) {
                pending = line
                return@execute
            }
            say(line, token)
        }
    }

    fun stop() {
        generation.incrementAndGet()
        pending = null
        lastText = ""
        stopTrack()
    }

    private fun copySpeechData(): String {
        val assetRoot = "vits-piper-en_US-amy-low/espeak-ng-data"
        val target = File(appContext.filesDir, assetRoot)
        if (!File(target, "phondata").exists()) {
            copyAssetDir(assetRoot, target)
        }
        return target.absolutePath
    }

    private fun copyAssetDir(assetPath: String, target: File) {
        val children = appContext.assets.list(assetPath).orEmpty()
        if (children.isEmpty()) {
            target.parentFile?.mkdirs()
            appContext.assets.open(assetPath).use { input ->
                FileOutputStream(target).use { output -> input.copyTo(output) }
            }
            return
        }
        target.mkdirs()
        children.forEach { child ->
            copyAssetDir("$assetPath/$child", File(target, child))
        }
    }

    fun shutdown() {
        closed = true
        generation.incrementAndGet()
        pending = null
        stopTrack()
        worker.shutdownNow()
        tts?.release()
        tts = null
    }

    private fun say(line: String, token: Int = generation.get()) {
        val engine = tts ?: return
        makeAudible()
        val spoken = engine.generate(line, 0, 0.96f)
        if (closed || token != generation.get()) return
        play(spoken.samples, spoken.sampleRate, token)
    }

    private fun play(samples: FloatArray, sampleRate: Int, token: Int) {
        stopTrack()
        if (samples.isEmpty() || closed || token != generation.get()) return
        val minBuffer = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val playing = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(max(minBuffer, sampleRate * 2))
            .build()
        track = playing
        playing.play()
        val chunk = ShortArray(2048)
        var index = 0
        while (index < samples.size && token == generation.get() && !closed) {
            val count = min(chunk.size, samples.size - index)
            for (offset in 0 until count) {
                val sample = samples[index + offset].coerceIn(-1f, 1f)
                chunk[offset] = (sample * 32767f).toInt().toShort()
            }
            playing.write(chunk, 0, count)
            index += count
        }
        if (token == generation.get()) playing.stop()
        playing.release()
        if (track == playing) track = null
    }

    private fun stopTrack() {
        val playing = track ?: return
        track = null
        playing.runCatching {
            pause()
            flush()
            release()
        }
    }

    private fun makeAudible() {
        val manager = audioManager ?: return
        try {
            val maxVolume = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            val now = manager.getStreamVolume(AudioManager.STREAM_MUSIC)
            if (maxVolume > 0 && now <= 0) {
                manager.setStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    (maxVolume * 0.6f).toInt().coerceAtLeast(1),
                    AudioManager.FLAG_SHOW_UI,
                )
            }
        } catch (_: SecurityException) {
        }
    }
}

@Composable
fun SpeakCue(line: String, next: String, meters: Double?, enabled: Boolean) {
    val voice = LocalDirectionVoice.current ?: return
    LaunchedEffect(line, next, enabled, voice) {
        if (!enabled) {
            voice.stop()
            return@LaunchedEffect
        }
        if (line.isBlank()) return@LaunchedEffect
        voice.speak(VoiceGuide.cue(line, meters, next))
    }
}
