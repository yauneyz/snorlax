import groovy.json.JsonSlurper
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

fun buildConfigString(key: String, fallback: String = ""): String =
    "\"${localProp(key, fallback).replace("\\", "\\\\").replace("\"", "\\\"")}\""

// Read the downloaded Firebase Android client directly from the gitignored credentials folder.
// local.properties remains a fallback for builders that provision these public values another
// way, but the normal setup requires no manual JSON-to-properties transcription.
val firebaseClientFile = rootProject.file(
    "../../local-credentials/talysman-insights-google-services.json",
)
val firebaseClientValues: Map<String, String> = if (firebaseClientFile.exists()) {
    @Suppress("UNCHECKED_CAST")
    val document = JsonSlurper().parse(firebaseClientFile) as Map<String, Any?>
    val project = document["project_info"] as Map<*, *>
    val clients = document["client"] as List<*>
    val client = clients
        .map { it as Map<*, *> }
        .firstOrNull {
            val info = it["client_info"] as Map<*, *>
            val android = info["android_client_info"] as Map<*, *>
            android["package_name"] == "app.talysman.insights"
        }
        ?: error("Firebase client file has no app.talysman.insights Android client")
    val clientInfo = client["client_info"] as Map<*, *>
    val apiKeys = client["api_key"] as List<*>
    val apiKey = apiKeys.first() as Map<*, *>
    mapOf(
        "projectId" to project["project_id"].toString(),
        "senderId" to project["project_number"].toString(),
        "applicationId" to clientInfo["mobilesdk_app_id"].toString(),
        "apiKey" to apiKey["current_key"].toString(),
    )
} else {
    emptyMap()
}

fun firebaseBuildConfigString(jsonKey: String, localKey: String): String {
    val value = firebaseClientValues[jsonKey] ?: localProp(localKey)
    return "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""
}

// Android raw-resource names cannot contain hyphens. Keep the user-supplied source audio in the
// shared assets directory and stage it under the stable name the notification channel resolves.
val notificationSoundResDir = layout.buildDirectory.dir("generated/notification-sound/res")
val stageNotificationSound by tasks.registering(Copy::class) {
    from(rootProject.file("../../assets/zelda-secret.mp3"))
    into(notificationSoundResDir.map { it.dir("raw") })
    rename { "conversion_unlocked.mp3" }
}

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
        buildConfigField("String", "INSIGHTS_BASE_URL", buildConfigString("insights.baseUrl", "https://www.talysman.app"))
        buildConfigField("String", "INSIGHTS_API_KEY", buildConfigString("insights.apiKey"))
        // Firebase's Android client values are public identifiers, not service-account secrets.
        // Keeping them in local.properties lets this private sideloaded app build without a
        // google-services.json file or the Google Services Gradle plugin.
        buildConfigField("String", "FCM_PROJECT_ID", firebaseBuildConfigString("projectId", "fcm.projectId"))
        buildConfigField("String", "FCM_APPLICATION_ID", firebaseBuildConfigString("applicationId", "fcm.applicationId"))
        buildConfigField("String", "FCM_API_KEY", firebaseBuildConfigString("apiKey", "fcm.apiKey"))
        buildConfigField("String", "FCM_SENDER_ID", firebaseBuildConfigString("senderId", "fcm.senderId"))
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

    sourceSets.getByName("main").res.srcDir(notificationSoundResDir)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

tasks.named("preBuild").configure {
    dependsOn(stageNotificationSound)
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

    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
