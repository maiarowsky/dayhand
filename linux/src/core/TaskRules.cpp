#include "TaskRules.h"

#include "CivilDate.h"

#include <QSet>
#include <QUrl>

#include <algorithm>

namespace dayhand::TaskRules {

std::optional<QString> title(const QString &input)
{
    const QString clean = input.trimmed();
    if (clean.isEmpty() || clean.size() > maxTitle)
        return std::nullopt;
    return clean;
}

bool isLinkURL(const QString &url)
{
    if (url.isEmpty() || url.size() > maxURL || url != url.trimmed())
        return false;
    const QUrl parsed(url, QUrl::StrictMode);
    const QString scheme = parsed.scheme().toLower();
    return parsed.isValid() && (scheme == u"http" || scheme == u"https") && !parsed.host().isEmpty();
}

std::optional<TaskLink> link(const QString &url, const std::optional<QString> &title)
{
    const QString cleanUrl = url.trimmed();
    if (!isLinkURL(cleanUrl))
        return std::nullopt;
    const QString cleanTitle = title ? title->trimmed() : QString();
    return TaskLink{cleanUrl, cleanTitle.isEmpty() ? std::nullopt : std::optional<QString>(cleanTitle)};
}

namespace {

bool validWeekdays(const RepeatRule &rule)
{
    if (!rule.weekdays)
        return true;
    const QList<int> &days = *rule.weekdays;
    const QSet<int> unique(days.begin(), days.end());
    const bool outOfRange = std::any_of(days.begin(), days.end(), [](int day) { return day < 1 || day > 7; });
    return rule.every == RepeatEvery::Week && !days.isEmpty() && unique.size() == days.size() && !outOfRange;
}

bool validMonthPattern(const RepeatRule &rule)
{
    if (rule.monthDay) {
        const int day = *rule.monthDay;
        if (rule.every != RepeatEvery::Month || (day != -1 && (day < 1 || day > 31)))
            return false;
    }
    if (rule.weekdayOfMonth) {
        const auto &w = *rule.weekdayOfMonth;
        if (rule.every != RepeatEvery::Month || rule.monthDay || w.nth == 0 || w.nth < -5 || w.nth > 5 || w.weekday < 1
            || w.weekday > 7)
            return false;
    }
    return true;
}

} // namespace

bool isValid(const RepeatRule &rule)
{
    if (rule.interval < 1 || rule.interval > maxRepeatInterval || !validWeekdays(rule) || !validMonthPattern(rule))
        return false;
    if (rule.until && (rule.count || !CivilDate::parse(*rule.until)))
        return false;
    if (rule.count)
        return *rule.count >= 1 && *rule.count <= maxRepeatCount;
    return true;
}

std::optional<QList<TaskReminder>> reminders(const QList<TaskReminder> &input)
{
    QList<TaskReminder> cleaned;
    for (const auto &reminder : input) {
        if (!cleaned.contains(reminder))
            cleaned.append(reminder);
    }
    const bool allValid = std::all_of(cleaned.begin(), cleaned.end(), [](const TaskReminder &r) { return isValid(r); });
    if (cleaned.size() > maxReminders || !allValid)
        return std::nullopt;
    return cleaned;
}

bool isValid(const TaskReminder &reminder)
{
    if (reminder.minutesBefore) {
        const int minutes = *reminder.minutesBefore;
        return !reminder.time && !reminder.daysBefore && minutes >= 0 && minutes <= maxReminderMinutes;
    }
    if (!reminder.time)
        return false;
    if (reminder.daysBefore && (*reminder.daysBefore < 1 || *reminder.daysBefore > maxReminderDays))
        return false;
    return ClockTime::parse(*reminder.time).has_value();
}

std::optional<QList<ChecklistItem>> checklist(const QList<ChecklistItem> &items)
{
    QList<ChecklistItem> cleaned;
    QSet<QString> ids;
    for (const auto &item : items) {
        const QString clean = item.title.trimmed();
        if (clean.isEmpty())
            continue;
        if (clean.size() > maxTitle)
            return std::nullopt;
        cleaned.append({item.id, clean, item.done});
        ids.insert(item.id);
    }
    if (cleaned.size() > maxChecklist || ids.size() != cleaned.size())
        return std::nullopt;
    return cleaned;
}

} // namespace dayhand::TaskRules
