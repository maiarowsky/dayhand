plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

// versionCode is the number of commits on HEAD, so every build from a later commit installs over an earlier one.
val commitCount = providers.exec {
    commandLine("git", "rev-list", "--count", "HEAD")
    isIgnoreExitValue = true
}.standardOutput.asText.map { it.trim().toIntOrNull() ?: 1 }

android {
    namespace = "dev.helm.planner"
    compileSdk = 36

    defaultConfig {
        // Working id; change it before any store release (android/README.md).
        applicationId = "dev.helm.planner"
        minSdk = 26
        targetSdk = 36
        versionCode = commitCount.get()
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Phones and Apple Silicon emulators are arm64; x86_64 covers Intel emulators.
        ndk {
            abiFilters += setOf("arm64-v8a", "x86_64")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    androidResources {
        // Per-app language (system settings) from values/ and values-pl/.
        generateLocaleConfig = true
    }

    sourceSets.getByName("androidTest").assets.directories.add("$projectDir/schemas")

    packaging {
        resources {
            excludes += setOf("META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/AL2.0", "META-INF/LGPL2.1")
        }
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.work.runtime)
    implementation(libs.datastore.preferences)
    implementation(libs.tink.android)
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)
    // The client itself needs only JNA and kotlinx-serialization; its AppCompat and Material dependencies are unused.
    implementation(libs.convex.android) {
        artifact { type = "aar" }
        exclude(group = "androidx.appcompat")
        exclude(group = "com.google.android.material")
    }

    testImplementation(libs.junit4)
    testImplementation(libs.coroutines.test)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.androidx.test.espresso)
    androidTestImplementation(libs.coroutines.test)
    androidTestImplementation(libs.work.testing)
    androidTestImplementation(libs.room.runtime)
}
