import DayhandCore
import SwiftUI

/// Connect to a server with a one-time code from `hlm pair` (or a `helm://pair` / `dayhand://pair` link).
struct ConnectView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var address = ""
    @State private var code = ""
    @State private var working = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Connect to your server").font(.title2).bold()
            Text("On a computer signed in to your server, run `hlm pair` and type the code it shows, or open the link it prints. The code works once, for 10 minutes.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Form {
                TextField("Server address", text: $address, prompt: Text("https://<name>.convex.site"))
                TextField("Pairing code", text: $code, prompt: Text("XXXX-XXXX-XXXX"))
                    .onSubmit(connect)
            }
            .formStyle(.grouped)
            if let error {
                Label(error, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(Color.overdue)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Button("Not Now, Use Dayhand Offline") {
                    model.useOffline = true
                    dismiss()
                }
                Spacer()
                if working { ProgressView().controlSize(.small) }
                Button("Connect", action: connect)
                    .keyboardShortcut(.defaultAction)
                    .disabled(working || address.isEmpty || code.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 520)
        .onAppear {
            address = model.connectPrefill?.serverUrl ?? model.lastServerUrl ?? ""
            code = model.connectPrefill?.code ?? ""
        }
    }

    private func connect() {
        guard !working else { return }
        working = true
        error = nil
        Task {
            let failure = await model.connect(address: address, code: code)
            working = false
            error = failure.map(Self.message)
        }
    }

    /// The reasons in words, as the Android Connect screen says them.
    static func message(_ error: ConnectError) -> String {
        switch error {
        case .badAddress: return "That is not a server address. It looks like https://<name>.convex.site."
        case .badCode: return "A pairing code has 12 letters and digits, like E6M8-FE02-XSNT."
        case .invalidCode: return "The code is wrong, used or expired. Run hlm pair again for a new one."
        case .rateLimited(let seconds):
            let wait = seconds.map { $0 >= 60 ? "\(($0 + 59) / 60) min" : "\($0) s" } ?? "a few minutes"
            return "Too many wrong codes on this server. Try again in \(wait)."
        case .unreachable: return "The server cannot be reached. Check the address and the network."
        case .notHelm: return "Something answered at that address, but it is not a Dayhand server."
        case .serverError: return "The server has a problem. Try again later."
        case .storage: return "The sign-in could not be saved in the Keychain."
        }
    }
}
