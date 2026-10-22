plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.ksp) apply false
}

// Every resolved dependency is pinned in a lockfile; regenerate with
// ./gradlew :app:dependencies --write-locks (and buildEnvironment for plugins).
buildscript {
    configurations.classpath {
        resolutionStrategy.activateDependencyLocking()
    }
}

subprojects {
    dependencyLocking {
        lockAllConfigurations()
    }
}
