plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val firebaseEnv = rootProject.file("../ERP_Full/.env.local")
fun firebaseValue(key: String): String {
    if (!firebaseEnv.exists()) return ""
    val line = firebaseEnv.readLines().firstOrNull { it.startsWith("$key=") } ?: return ""
    return line.substringAfter("=").trim().trim('"').replace("\\", "\\\\").replace("\"", "\\\"")
}

android {
    namespace = "com.keiros.tourapp"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.keiros.tourapp"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "FIREBASE_API_KEY", "\"${firebaseValue("VITE_FIREBASE_API_KEY")}\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"${firebaseValue("VITE_FIREBASE_PROJECT_ID")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("org.osmdroid:osmdroid-android:6.1.20")
    implementation("androidx.camera:camera-camera2:1.4.0")
    implementation("androidx.camera:camera-lifecycle:1.4.0")
    implementation("androidx.camera:camera-view:1.4.0")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
