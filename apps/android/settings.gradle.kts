pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "talysman-android"
// Talysman Insights: the internal analytics companion (app.talysman.insights).
include(":app")
// Talysman for Android: the blocker (app.talysman.android).
include(":blocker")
// The Rust engine (native/engine) as an Android library: uniffi Kotlin bindings + .so per ABI.
include(":engine")
