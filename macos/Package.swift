// swift-tools-version:6.2
// Dayhand for macOS: the SwiftUI screens (DayhandUI, started by the Dayhand executable) on a UI-free core
// (DayhandCore) that holds the task model, the date and repeat rules, the local database, the outbox and the server
// protocol. `swift test` runs the core's tests.
import PackageDescription

let package = Package(
    name: "Dayhand",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "Dayhand", targets: ["Dayhand"]),
        .library(name: "DayhandCore", targets: ["DayhandCore"]),
    ],
    dependencies: [
        // Pinned exactly; Package.resolved locks the revisions. Both MIT.
        .package(url: "https://github.com/groue/GRDB.swift", exact: "7.11.1"),
        .package(url: "https://github.com/sindresorhus/KeyboardShortcuts", exact: "3.1.0"),
    ],
    targets: [
        .target(
            name: "DayhandCore",
            dependencies: [.product(name: "GRDB", package: "GRDB.swift")]
        ),
        .target(
            name: "DayhandUI",
            dependencies: [
                "DayhandCore",
                .product(name: "KeyboardShortcuts", package: "KeyboardShortcuts"),
            ]
        ),
        .executableTarget(name: "Dayhand", dependencies: ["DayhandUI"]),
        // Renders the screens to PNG files from synthetic tasks, without a display (docs/macos.md).
        .executableTarget(name: "DayhandSnapshots", dependencies: ["DayhandUI", "DayhandCore"]),
        .testTarget(
            name: "DayhandCoreTests",
            dependencies: ["DayhandCore"]
        ),
    ]
)
