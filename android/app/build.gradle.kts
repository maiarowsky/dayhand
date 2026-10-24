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

// The server the Connect screen offers first (HTTP actions URL), -Pdayhand.serverUrl=…; empty by default, so a
// public build starts with an empty address and the offline choice. -Phelm.serverUrl, the name before the
// rename, still works.
val defaultServerUrl = providers.gradleProperty("dayhand.serverUrl")
    .orElse(providers.gradleProperty("helm.serverUrl"))
    .orElse("")

// DAYHAND_<name>, else HELM_<name> from before the rename (with a warning in the build output).
fun releaseVariable(name: String): String? =
    providers.environmentVariable("DAYHAND_$name").orNull
        ?: providers.environmentVariable("HELM_$name").orNull?.also {
            logger.warn("HELM_$name is deprecated; set DAYHAND_$name instead")
        }

// Release signing from a keystore kept outside the repository: DAYHAND_RELEASE_KEYSTORE (PKCS12),
// DAYHAND_RELEASE_PASSWORD_FILE (one line; store and key password) and DAYHAND_RELEASE_KEY_ALIAS (default
// helm, the alias of the key made before the rename). Without DAYHAND_RELEASE_KEYSTORE the release build stays
// unsigned; debug builds never use it.
val releaseKeystore = releaseVariable("RELEASE_KEYSTORE")?.let(::File)
val releasePassword = releaseVariable("RELEASE_PASSWORD_FILE")
    ?.let { path -> providers.fileContents(layout.projectDirectory.file(path)).asText.map { it.trim() } }

android {
    namespace = "dev.helm.planner"
    compileSdk = 36

    defaultConfig {
        // The code keeps the dev.helm.planner namespace; the installed app is this id.
        applicationId = "io.github.maiarowsky.dayhand"
        minSdk = 26
        targetSdk = 36
        versionCode = commitCount.get()
        versionName = "0.10.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"${defaultServerUrl.get()}\"")

        // Phones and Apple Silicon emulators are arm64; x86_64 covers Intel emulators.
        ndk {
            abiFilters += setOf("arm64-v8a", "x86_64")
        }
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                require(releaseKeystore.isFile) { "DAYHAND_RELEASE_KEYSTORE is not a file: $releaseKeystore" }
                val password = requireNotNull(releasePassword) { "DAYHAND_RELEASE_PASSWORD_FILE is not set" }.get()
                storeFile = releaseKeystore
                storeType = "PKCS12"
                storePassword = password
                keyAlias = releaseVariable("RELEASE_KEY_ALIAS") ?: "helm"
                keyPassword = password
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
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
    androidTestImplementation(libs.room.testing)
}
