import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun localProp(key: String, fallback: String = ""): String =
    (localProperties.getProperty(key) ?: fallback)

android {
    namespace = "app.talysman.insights"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.talysman.insights"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        // Baked into the sideloaded APK on purpose: this is a single-user, single-device
        // companion app, and the token is scoped to a read-only aggregate endpoint (see
        // analytics-arch.md §12.4) rather than a DB-level credential.
        // The apex domain 308-redirects to www, and OkHttp strips Authorization on a
        // cross-host redirect — point at the canonical host directly so the bearer token
        // survives the request.
        buildConfigField("String", "INSIGHTS_BASE_URL", "\"${localProp("insights.baseUrl", "https://www.talysman.app")}\"")
        buildConfigField("String", "INSIGHTS_API_KEY", "\"${localProp("insights.apiKey")}\"")
    }

    signingConfigs {
        getByName("debug") {
            // Stock AGP debug keystore; fine for a sideloaded personal app.
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")

    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.glance:glance-material3:1.1.1")

    implementation("androidx.work:work-runtime-ktx:2.10.0")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
