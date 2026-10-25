package com.keiros.tourapp.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.keiros.tourapp.flow.PhoneLocation
import com.keiros.tourapp.flow.TourViewModel

@Composable
fun LiveLocationBinding(enabled: Boolean, vm: TourViewModel) {
    val context = LocalContext.current
    DisposableEffect(enabled) {
        if (!enabled) {
            return@DisposableEffect onDispose { }
        }
        val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) {
            return@DisposableEffect onDispose { }
        }
        val phone = PhoneLocation(context)
        phone.start(vm::noteDeviceLocation, vm::noteHeading)
        onDispose { phone.stop() }
    }
}
