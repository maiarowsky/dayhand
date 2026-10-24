import DayhandUI
import Foundation

// Renders Dayhand's main screens from synthetic tasks into the folder given (default: ./snapshots), in the language
// given (default: English).
let arguments = CommandLine.arguments.dropFirst()
let folder = arguments.first ?? "snapshots"
let language = arguments.dropFirst().first ?? "en"
MainActor.assumeIsolated {
    ScreenSnapshots.run(outputDirectory: URL(fileURLWithPath: folder, isDirectory: true), language: language)
}
