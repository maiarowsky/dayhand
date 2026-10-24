import DayhandCore
import DayhandLocalization
import SwiftUI

/**
 * The details' Repeat section, the Android app's `RepeatDialog` in place: no repeat, or every N days, weeks (on the
 * weekdays picked), months (on the due date's day, the last day or an nth weekday) or years; counted from the due date
 * or from completion; ending never, on a day or after a number of times. The choices stay a draft until
 * **Save Repeat**, which only a rule the backend accepts enables (`RepeatDraft.isValid`), so a refused rule is never
 * queued. A task without a day counts from today.
 */
struct RepeatEditor: View {
    @EnvironmentObject private var model: AppModel
    let task: TaskItem
    let today: String

    @State private var draft: RepeatDraft

    init(task: TaskItem, today: String) {
        self.task = task
        self.today = today
        _draft = State(initialValue: RepeatDraft(task.repeat))
    }

    private var todayDate: CivilDate { CivilDate(today) ?? CivilDate(dayNumber: 0) }
    private var due: CivilDate { task.dueDate.flatMap(CivilDate.init) ?? todayDate }
    private var changed: Bool { draft.rule != task.repeat }

    var body: some View {
        Section(tr("Repeat")) {
            Picker(tr("Frequency"), selection: $draft.every) {
                Text(tr("Does not repeat")).tag(RepeatEvery?.none)
                Text(tr("Daily")).tag(RepeatEvery?.some(.day))
                Text(tr("Weekly")).tag(RepeatEvery?.some(.week))
                Text(tr("Monthly")).tag(RepeatEvery?.some(.month))
                Text(tr("Yearly")).tag(RepeatEvery?.some(.year))
            }
            // On a row, not the section: a modified section no longer reads as its own section in a form.
            .onChange(of: task.repeat) { draft = RepeatDraft($0) }
            .onChange(of: task.localId) { _ in draft = RepeatDraft(task.repeat) }
            if let every = draft.every {
                NumberRow(text: Self.everyText(every, draft.interval), label: tr("Every how many"), value: $draft.interval, range: 1...TaskRules.maxRepeatInterval)
                if every == .week { weekdays }
                if every == .month {
                    Picker(tr("Day of the month"), selection: $draft.monthDay) {
                        ForEach(RepeatDraft.monthDays(due: due, current: task.repeat), id: \.self) { choice in
                            Text(Self.monthText(choice, due: due, fromCompletion: draft.fromCompletion)).tag(choice)
                        }
                    }
                }
                Picker(tr("Count the next date from"), selection: $draft.fromCompletion) {
                    Text(tr("The due date")).tag(false)
                    Text(tr("The day I complete it")).tag(true)
                }
                ends
                if draft.intervalInvalid || draft.countInvalid {
                    let limit = draft.intervalInvalid ? TaskRules.maxRepeatInterval : TaskRules.maxRepeatCount
                    Text(tr("Enter a number from 1 to \(limit).")).font(.caption).foregroundStyle(Color.overdue)
                }
            }
            HStack {
                Text(draft.rule.map(Formatting.repeatRule) ?? tr("Does not repeat"))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(tr("Revert")) { draft = RepeatDraft(task.repeat) }
                    .disabled(!changed)
                Button(tr("Save Repeat")) { model.setRepeat(task.localId, draft.rule) }
                    .disabled(!changed || !draft.isValid)
            }
        }
    }

    @ViewBuilder private var weekdays: some View {
        LabeledContent(tr("On these days")) {
            HStack(spacing: 4) {
                ForEach(1...7, id: \.self) { day in
                    let picked = draft.weekdays.contains(day)
                    Button {
                        if picked { draft.weekdays.remove(day) } else { draft.weekdays.insert(day) }
                    } label: {
                        Text(DateText.shortWeekday(day) ?? "\(day)")
                            .frame(minWidth: 30)
                            .padding(.vertical, 3)
                            .padding(.horizontal, 5)
                            .foregroundStyle(picked ? Color.white : Color.primary)
                            .background(picked ? Color.accentColor : Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 5))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(picked ? .isSelected : [])
                }
            }
        }
        if draft.weekdays.isEmpty {
            Text(Self.weekdayHint(fromCompletion: draft.fromCompletion)).font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var ends: some View {
        Picker(tr("Ends"), selection: Binding(get: { draft.end }, set: { end in
            draft.end = end
            if end == .until, draft.until == nil { draft.until = RepeatDraft.defaultUntil(due: due, today: todayDate) }
        })) {
            Text(tr("Never")).tag(RepeatDraft.End.never)
            Text(tr("On a day")).tag(RepeatDraft.End.until)
            Text(tr("After a number of times")).tag(RepeatDraft.End.count)
        }
        if draft.end == .until {
            DatePicker(tr("Last date"), selection: Binding(
                get: { PickerDates.date(draft.until ?? today) },
                set: { draft.until = PickerDates.day($0) }
            ), displayedComponents: .date)
            .environment(\.timeZone, PickerDates.zone)
            .environment(\.locale, Localization.current.locale)
        }
        if draft.end == .count {
            NumberRow(text: tr("\(draft.count) times, this one included"), label: tr("How many times"), value: $draft.count, range: 1...TaskRules.maxRepeatCount)
        }
    }

    /// "Every 2 weeks" for the interval row (the plural forms say "Every 1 week" too).
    static func everyText(_ every: RepeatEvery, _ n: Int) -> String {
        switch every {
        case .day: return tr("Every \(n) days")
        case .week: return tr("Every \(n) weeks")
        case .month: return tr("Every \(n) months")
        case .year: return tr("Every \(n) years")
        }
    }

    static func weekdayHint(fromCompletion: Bool) -> String {
        fromCompletion ? tr("No day picked: the completion day's weekday.") : tr("No day picked: the due date's weekday.")
    }

    static func monthText(_ choice: RepeatDraft.MonthDay, due: CivilDate, fromCompletion: Bool) -> String {
        switch choice {
        case .sameDay: return fromCompletion ? tr("The day I complete it") : tr("Day \(due.day)")
        case .lastDay: return tr("The last day of the month")
        case .day(let day): return capitalizedFirst(tr("on day \(day)"))
        case .weekday(let w): return capitalizedFirst(Formatting.weekdayOfMonth(nth: w.nth, weekday: w.weekday))
        }
    }

    static func capitalizedFirst(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }
}

/// A number with its meaning in words, typed or stepped: "Every 2 weeks [2] [−|+]".
struct NumberRow: View {
    let text: String
    let label: String
    @Binding var value: Int
    let range: ClosedRange<Int>

    var body: some View {
        HStack {
            Text(text)
            Spacer()
            TextField(label, value: $value, format: .number)
                .labelsHidden()
                .multilineTextAlignment(.trailing)
                .frame(width: 56)
            Stepper(label, value: $value, in: range)
                .labelsHidden()
        }
    }
}
