import DayhandUI
import Foundation

// Renders Dayhand's main screens from synthetic tasks into the folder given (default: ./snapshots).
let folder = CommandLine.arguments.dropFirst().first ?? "snapshots"
MainActor.assumeIsolated {
    ScreenSnapshots.run(outputDirectory: URL(fileURLWithPath: folder, isDirectory: true))
}
