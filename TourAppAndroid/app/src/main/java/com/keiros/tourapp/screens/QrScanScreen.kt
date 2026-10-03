package com.keiros.tourapp.screens

import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.keiros.tourapp.ui.Manrope
import com.keiros.tourapp.ui.PrimaryButton
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
fun QrScanScreen(onCancel: () -> Unit, onScanned: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val handled = AtomicBoolean(false)
    val executor = Executors.newSingleThreadExecutor()
    val scanner = BarcodeScanning.getClient()

    DisposableEffect(Unit) {
        onDispose {
            executor.shutdown()
            scanner.close()
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val future = ProcessCameraProvider.getInstance(ctx)
                future.addListener({
                    val provider = future.get()
                    val preview = Preview.Builder().build().also {
                        it.surfaceProvider = previewView.surfaceProvider
                    }
                    val analysis = ImageAnalysis.Builder()
                        .setTargetResolution(Size(1280, 720))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(executor) { imageProxy ->
                        val media = imageProxy.image
                        if (media == null) {
                            imageProxy.close()
                            return@setAnalyzer
                        }
                        val input = InputImage.fromMediaImage(media, imageProxy.imageInfo.rotationDegrees)
                        scanner.process(input)
                            .addOnSuccessListener { barcodes ->
                                val raw = barcodes.firstOrNull { !it.rawValue.isNullOrBlank() }?.rawValue
                                if (raw != null && handled.compareAndSet(false, true)) {
                                    onScanned(raw)
                                }
                            }
                            .addOnCompleteListener { imageProxy.close() }
                    }
                    provider.unbindAll()
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                }, ContextCompat.getMainExecutor(ctx))
                previewView
            },
        )
        Text(
            "Point the camera at the property QR",
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 28.dp),
            color = Color.White,
            fontFamily = Manrope,
            fontSize = 16.sp,
        )
        Box(Modifier.align(Alignment.BottomCenter).padding(20.dp)) {
            PrimaryButton("Cancel", onCancel, variant = "light")
        }
    }
}
