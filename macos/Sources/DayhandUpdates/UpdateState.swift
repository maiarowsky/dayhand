import Foundation

/// A newer version found in the appcast.
public struct UpdateOffer: Equatable, Sendable {
    /// What the user sees ("0.2.0"), `sparkle:shortVersionString`.
    public var version: String
    /// What Sparkle compares, `sparkle:version` (the build number).
    public var build: String
    /// Short release notes as plain text, when the appcast has them.
    public var notes: String?
    /// From the preview channel rather than the stable one.
    public var isPreview: Bool

    public init(version: String, build: String, notes: String? = nil, isPreview: Bool = false) {
        self.version = version
        self.build = build
        self.notes = notes
        self.isPreview = isPreview
    }
}

/// What the updater is doing, for the update window and Settings.
public enum UpdateActivity: Equatable, Sendable {
    /// This build cannot update itself; the reason is shown instead of the controls.
    case unavailable(UpdateConfiguration.Unavailable)
    case idle
    case checking
    /// The check the user asked for found nothing newer.
    case upToDate
    /// A newer version waits for the user's word.
    case available
    case downloading(received: UInt64, expected: UInt64?)
    /// Unpacking the download and checking its signature.
    case extracting(progress: Double?)
    case readyToInstall
    case installing
    case failed(UpdateFailure)
}

/// What Sparkle tells the app, in the order an update goes through.
public enum UpdateEvent: Equatable, Sendable {
    case checkStarted
    case found(UpdateOffer)
    case notFound(userInitiated: Bool)
    case notesLoaded(String)
    case downloadStarted
    case expectedLength(UInt64)
    case received(UInt64)
    case extracting(Double?)
    case readyToInstall
    case installing
    case failed(UpdateFailure)
    /// Sparkle closed its update session (cancelled, dismissed, or done after an error or a check).
    case sessionEnded
    /// The user closed the update window after reading a result.
    case acknowledged
}

/**
 * The updater's state as a value: the newer version known (which shows the update button) and what is happening now.
 * Every Sparkle callback becomes one `UpdateEvent`; `apply` is the whole state machine, so it is tested without Sparkle.
 */
public struct UpdateState: Equatable, Sendable {
    public private(set) var activity: UpdateActivity
    public private(set) var offer: UpdateOffer?

    public init(activity: UpdateActivity = .idle, offer: UpdateOffer? = nil) {
        self.activity = activity
        self.offer = offer
    }

    /// The round button in the main window shows only while a newer version is known.
    public var hasUpdate: Bool { offer != nil }

    /// Between "Update and Relaunch" and the relaunch: the controls that start another step are off.
    public var isWorking: Bool {
        switch activity {
        case .checking, .downloading, .extracting, .readyToInstall, .installing: return true
        default: return false
        }
    }

    /// The download as a fraction from 0 to 1, when its size is known.
    public var downloadProgress: Double? {
        guard case .downloading(let received, let expected?) = activity, expected > 0 else { return nil }
        return min(1, Double(received) / Double(expected))
    }

    public mutating func apply(_ event: UpdateEvent) {
        if case .unavailable = activity { return }
        switch event {
        case .checkStarted:
            activity = .checking
        case .found(let found):
            offer = found
            activity = .available
        case .notFound(let userInitiated):
            offer = nil
            activity = userInitiated ? .upToDate : .idle
        case .notesLoaded(let notes):
            offer?.notes = notes
        case .downloadStarted:
            activity = .downloading(received: 0, expected: nil)
        case .expectedLength(let length):
            if case .downloading(let received, _) = activity {
                activity = .downloading(received: received, expected: length > 0 ? length : nil)
            }
        case .received(let length):
            if case .downloading(let received, let expected) = activity {
                activity = .downloading(received: received + length, expected: expected)
            }
        case .extracting(let progress):
            activity = .extracting(progress: progress)
        case .readyToInstall:
            activity = .readyToInstall
        case .installing:
            activity = .installing
        case .failed(let failure):
            activity = .failed(failure)
        case .sessionEnded:
            if isWorking { activity = restingActivity }
        case .acknowledged:
            switch activity {
            case .upToDate, .failed: activity = restingActivity
            default: break
            }
        }
    }

    /// Where the state settles when nothing is happening: the offer still waits, or there is nothing to show.
    private var restingActivity: UpdateActivity { offer == nil ? .idle : .available }
}

/// Why an update did not go through, in words for the user; the technical error stays in the log.
public struct UpdateFailure: Equatable, Sendable {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    /// Sparkle's error domain and the codes this app tells apart (`SUErrors.h`).
    public static let sparkleDomain = "SUSparkleErrorDomain"
    enum SparkleCode {
        static let appcastParse = 1000
        static let appcast = 1002
        static let runningFromDiskImage = 1003
        static let download = 2001
        static let unarchiving = 3000
        static let signature = 3001
        static let validation = 3002
        static let installation = 4005
        static let downgrade = 4006
        static let installationCanceled = 4007
        static let writeNoPermission = 4012
    }

    public static let offline = UpdateFailure("Dayhand could not reach the update server. Check the connection and try again.")
    public static let unreadable = UpdateFailure("The list of new versions could not be read. Try again later.")
    public static let download = UpdateFailure("The update could not be downloaded. Check the connection and try again.")
    public static let untrusted = UpdateFailure("The downloaded update did not pass its signature check, so it was not installed.")
    public static let install = UpdateFailure("The update could not be installed. Make sure Dayhand is in Applications, then try again.")
    public static let other = UpdateFailure("The update did not finish. Try again later.")

    /// `downloading`: the error came while fetching the update archive rather than the appcast (Sparkle gives both
    /// the same code).
    public static func from(_ error: Error, downloading: Bool = false) -> UpdateFailure {
        let error = error as NSError
        if causedByNetwork(error) { return .offline }
        guard error.domain == sparkleDomain else { return .other }
        switch error.code {
        case SparkleCode.appcastParse, SparkleCode.appcast:
            return .unreadable
        case SparkleCode.download:
            return downloading ? .download : .unreadable
        case SparkleCode.unarchiving, SparkleCode.signature, SparkleCode.validation:
            return .untrusted
        case SparkleCode.runningFromDiskImage:
            return UpdateFailure("Dayhand is running from the disk image. Move it to Applications, open it from there and update again.")
        case SparkleCode.writeNoPermission:
            return UpdateFailure("Dayhand can’t replace itself in this folder. Move it to Applications and try again.")
        case SparkleCode.downgrade:
            return UpdateFailure("That version is older than this one, so it was not installed.")
        case SparkleCode.installationCanceled:
            return UpdateFailure("The update was canceled.")
        case SparkleCode.installation:
            return .install
        default:
            return .other
        }
    }

    /// A network error anywhere in the chain of causes (Sparkle wraps the URL error once or twice).
    private static func causedByNetwork(_ error: NSError) -> Bool {
        var current: NSError? = error
        while let next = current {
            if next.domain == NSURLErrorDomain { return true }
            current = next.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return false
    }
}
