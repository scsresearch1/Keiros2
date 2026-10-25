package com.keiros.tourapp.flow

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper

class PhoneLocation(context: Context) {
    private val manager = context.applicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val sensors = context.applicationContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private var onLocation: ((Location) -> Unit)? = null
    private var onHeading: ((Double) -> Unit)? = null
    private val rotation = FloatArray(9)
    private val orientation = FloatArray(3)

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            onLocation?.invoke(location)
        }

        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

        override fun onProviderEnabled(provider: String) = Unit

        override fun onProviderDisabled(provider: String) = Unit
    }

    private val headingListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return
            SensorManager.getRotationMatrixFromVector(rotation, event.values)
            SensorManager.getOrientation(rotation, orientation)
            val degrees = Math.toDegrees(orientation[0].toDouble())
            onHeading?.invoke((degrees + 360.0) % 360.0)
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }

    @SuppressLint("MissingPermission")
    fun start(onLocation: (Location) -> Unit, onHeading: (Double) -> Unit) {
        this.onLocation = onLocation
        this.onHeading = onHeading
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
        providers.forEach { provider ->
            runCatching { manager.getLastKnownLocation(provider) }.getOrNull()?.let(onLocation)
            runCatching {
                manager.requestLocationUpdates(provider, 1000L, 1f, locationListener, Looper.getMainLooper())
            }
        }
        sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let { sensor ->
            sensors.registerListener(headingListener, sensor, SensorManager.SENSOR_DELAY_UI)
        }
    }

    fun stop() {
        runCatching { manager.removeUpdates(locationListener) }
        sensors.unregisterListener(headingListener)
        onLocation = null
        onHeading = null
    }
}
