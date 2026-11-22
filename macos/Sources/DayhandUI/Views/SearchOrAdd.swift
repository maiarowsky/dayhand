import DayhandCore
import DayhandLocalization
import SwiftUI

/// The toolbar's field (⌘K): what is typed narrows every list, as a search, and Return adds it as a task in the
/// current place, with quick add's date phrases; Escape clears it.
struct SearchOrAddField: View {
    @EnvironmentObject private var model: AppModel
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField(tr("Search, or add a task"), text: $model.search)
                .textFieldStyle(.plain)
                .focused($focused)
                .onSubmit { model.addFromSearch() }
                .onExitCommand {
                    model.search = ""
                    focused = false
                }
            if model.search.isEmpty {
                Text(verbatim: "⌘K")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Color.secondary.opacity(0.35)))
                    .accessibilityHidden(true)
            } else {
                Button { model.search = "" } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(tr("Clear"))
            }
        }
        .padding(.horizontal, 8)
        .frame(minWidth: 160, idealWidth: 260, maxWidth: 420, minHeight: 28)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
        .help(tr("Search, or press Return to add a task (⌘K)"))
        .onChange(of: model.searchFocusRequest) { _ in focused = true }
    }
}

/// Under the toolbar while something is typed in its field: what Return will add, and where.
struct SearchAddHint: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        if model.isSearching,
           let preview = QuickAddPreview.of(model.search, readPhrase: true, model: model, place: model.searchAddPlace) {
            HStack(spacing: 8) {
                Image(systemName: "return").foregroundStyle(.secondary).accessibilityHidden(true)
                Text(tr("Return adds “\(preview.title)”: \(preview.summary)"))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, 6)
            .background(.quaternary.opacity(0.5))
        }
    }
}
