#pragma once

#include "TaskItem.h"

#include <QList>
#include <QString>
#include <QStringList>

#include <optional>

namespace dayhand {

/**
 * The backend's input checks (`backend/convex/lib/core.ts`, `repeat.ts`), applied before a change enters the
 * outbox, as the Android app's `TaskRules` and the macOS app's `TaskRules.swift`: a change the server would refuse
 * is never queued, so the user sees the problem at once instead of the change silently disappearing later.
 * Lengths are QString lengths, which are UTF-16 code units, as JavaScript's `length` on the server.
 */
namespace TaskRules {

constexpr int maxTitle = 500;
constexpr int maxNote = 20'000;
constexpr int maxResumeNote = 2'000;
constexpr int maxLinks = 20;
constexpr int maxURL = 2'048;
constexpr int maxRepeatInterval = 366;
constexpr int maxRepeatCount = 1000;
constexpr int maxChecklist = 100;
constexpr int maxReminders = 5;
constexpr int maxReminderMinutes = 7 * 24 * 60;
constexpr int maxReminderDays = 30;

/// A trimmed, non-empty title within the limit, or nothing.
std::optional<QString> title(const QString &input);
/// True for an absolute http(s) address the backend accepts.
bool isLinkURL(const QString &url);
/// The link as the backend stores it (blank title dropped), or nothing when the address is not accepted.
std::optional<TaskLink> link(const QString &url, const std::optional<QString> &title);
/// The backend's `validateRepeat`.
bool isValid(const RepeatRule &rule);
/// Reminders as the backend keeps them (checked, without duplicates); nothing when one is invalid or too many.
std::optional<QList<TaskReminder>> reminders(const QList<TaskReminder> &input);
bool isValid(const TaskReminder &reminder);
/// The checklist as the backend stores it: trimmed titles, blank items dropped; nothing when over a limit.
std::optional<QList<ChecklistItem>> checklist(const QList<ChecklistItem> &items);

} // namespace TaskRules
} // namespace dayhand
