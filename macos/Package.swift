// swift-tools-version:6.2
// Dayhand for macOS: the SwiftUI screens (DayhandUI, started by the Dayhand executable) on a UI-free core
// (DayhandCore) that holds the task model, the date and repeat rules, the local database, the outbox and the server
// protocol, and the app updates on Sparkle (DayhandUpdates). `swift test` runs the core's and the updates' tests.
import PackageDescription

let package = Package(
    name: "Dayhand",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "Dayhand", targets: ["Dayhand"]),
        .library(name: "DayhandCore", targets: ["DayhandCore"]),
    ],
    dependencies: [
        // Pinned exactly; Package.resolved locks the revisions. GRDB and KeyboardShortcuts are MIT, Sparkle MIT-style.
        .package(url: "https://github.com/groue/GRDB.swift", exact: "7.11.1"),
        .package(url: "https://github.com/sindresorhus/KeyboardShortcuts", exact: "3.1.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.0"),
    ],
    targets: [
        .target(
            name: "DayhandCore",
            dependencies: [.product(name: "GRDB", package: "GRDB.swift")]
        ),
        // macOS only, so the core stays free of it for an iOS app later.
        .target(
            name: "DayhandUpdates",
            dependencies: [.product(name: "Sparkle", package: "Sparkle")]
        ),
        .target(
            name: "DayhandUI",
            dependencies: [
                "DayhandCore",
                "DayhandUpdates",
                .product(name: "KeyboardShortcuts", package: "KeyboardShortcuts"),
            ]
        ),
        .executableTarget(
            name: "Dayhand",
            dependencies: ["DayhandUI"],
            // Sparkle.framework sits in Dayhand.app/Contents/Frameworks (scripts/build-app.sh).
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
        ),
        // Renders the screens to PNG files from synthetic tasks, without a display (docs/macos.md).
        .executableTarget(name: "DayhandSnapshots", dependencies: ["DayhandUI", "DayhandCore"]),
        .testTarget(
            name: "DayhandCoreTests",
            dependencies: ["DayhandCore"]
        ),
        .testTarget(
            name: "DayhandUpdatesTests",
            dependencies: ["DayhandUpdates", .product(name: "Sparkle", package: "Sparkle")]
        ),
    ]
)
