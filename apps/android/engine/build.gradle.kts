import java.util.Properties

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// The Rust engine (native/engine) compiled with cargo-ndk, plus uniffi-generated Kotlin bindings.
// Every blocking decision Talysman for Android makes comes from this library — the same code the
// desktop daemons run — so there is no Kotlin copy of any policy, schedule or gating logic.
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val repoRoot = rootProject.file("../..")
val rustOut = layout.buildDirectory.dir("rust")

val buildRustEngine by tasks.registering(Exec::class) {
    description = "Builds native/engine-ffi for Android and generates its Kotlin bindings."
    inputs.dir(repoRoot.resolve("native/engine/src"))
    inputs.dir(repoRoot.resolve("native/engine/resources"))
    inputs.file(repoRoot.resolve("native/engine/Cargo.toml"))
    inputs.dir(repoRoot.resolve("native/engine-ffi/src"))
    inputs.file(repoRoot.resolve("native/engine-ffi/Cargo.toml"))
    outputs.dir(rustOut)
    workingDir = repoRoot
    // Optional overrides for toolchains that aren't on PATH (see apps/android/README.md).
    localProperties.getProperty("talysman.cargoBin")?.let { bin ->
        environment("PATH", "$bin:${System.getenv("PATH")}")
    }
    localProperties.getProperty("talysman.ndkHome")?.let { environment("ANDROID_NDK_HOME", it) }
    localProperties.getProperty("sdk.dir")?.let { environment("ANDROID_HOME", it) }
    commandLine("node", "scripts/build-android-engine.mjs", rustOut.get().asFile.absolutePath)
}

android {
    namespace = "app.talysman.engine"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    sourceSets.getByName("main").apply {
        java.srcDir(rustOut.map { it.dir("kotlin") })
        jniLibs.srcDir(rustOut.map { it.dir("jniLibs") })
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

tasks.named("preBuild").configure { dependsOn(buildRustEngine) }

dependencies {
    // uniffi's Kotlin bindings call the .so through JNA.
    api("net.java.dev.jna:jna:5.15.0@aar")
}
