package dev.helm.planner.sample

import dev.helm.planner.data.local.ChecklistItem
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskLink
import dev.helm.planner.data.local.TaskReminder
import dev.helm.planner.data.local.TaskStatus
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/** The words of the sample plan; the app reads them from its strings, so the plan follows the app language. */
enum class SampleText {
    PLAN_WEEK, PLAN_WEEK_RESUME, BILL, REPLY, DENTIST, STANDUP, GROCERIES, MILK, EGGS, BREAD, COFFEE, PLANTS, RUN,
    PROPOSAL, PROPOSAL_NOTE, LINK_TITLE, HOLIDAY, HOLIDAY_NOTE,
    MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY,
    HOME, WORK, HEALTH,
}

/**
 * A plan to try Dayhand with, for the first minute and for screenshots: two overdue tasks, the "now" task, today's
 * tasks (with a checklist, a repeating stand-up and a task of its own reminders), something done, one timed task on
 * every other day of this week (done before today), a task in progress with a link and one without a day. Sample
 * tasks are only on the phone: their ids start with [ID_PREFIX], the outbox never sends them, and they go with one
 * tap or when the phone connects to a server.
 */
object SamplePlan {
    const val ID_PREFIX = "sample-"
    const val LINK = "https://github.com/maiarowsky/helm"

    fun isSample(localId: String) = localId.startsWith(ID_PREFIX)

    /** One timed task per day of the week, Monday first. */
    private val WEEK = listOf(
        Triple(SampleText.MONDAY, "08:30", SampleText.WORK),
        Triple(SampleText.TUESDAY, "14:00", SampleText.HOME),
        Triple(SampleText.WEDNESDAY, "12:30", null),
        Triple(SampleText.THURSDAY, "18:00", SampleText.HEALTH),
        Triple(SampleText.FRIDAY, "16:00", SampleText.WORK),
        Triple(SampleText.SATURDAY, "11:00", SampleText.HOME),
        Triple(SampleText.SUNDAY, "19:00", null),
    )

    fun tasks(today: LocalDate, now: Long, zone: ZoneId, text: (SampleText) -> String): List<Task> {
        var n = 0
        fun task(title: SampleText, day: LocalDate?, time: String? = null, vararg labels: SampleText): Task {
            val id = ID_PREFIX + ++n
            return Task(
                localId = id,
                clientId = id,
                title = text(title),
                dueDate = day?.toString(),
                dueTime = time,
                labels = labels.map(text),
                createdAt = now - (20 - n) * MINUTE,
                updatedAt = now,
            )
        }
        fun Task.done(): Task {
            val day = dueDate?.let(LocalDate::parse) ?: today
            val at = day.atTime(dueTime?.let(LocalTime::parse) ?: LocalTime.NOON).atZone(zone).toInstant().toEpochMilli()
            return copy(status = TaskStatus.DONE, completedAt = minOf(now, at + HOUR))
        }

        val monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val week = WEEK.mapIndexedNotNull { index, (title, time, label) ->
            val day = monday.plusDays(index.toLong())
            when {
                day == today -> null
                day < today -> task(title, day, time, *listOfNotNull(label).toTypedArray()).done()
                else -> task(title, day, time, *listOfNotNull(label).toTypedArray())
            }
        }
        val weekday = today.dayOfWeek.value <= 5
        val standupDay = if (weekday) today else today.with(TemporalAdjusters.next(DayOfWeek.MONDAY))
        return listOf(
            task(SampleText.BILL, today.minusDays(1), null, SampleText.HOME),
            task(SampleText.REPLY, today.minusDays(2)),
            task(SampleText.PLAN_WEEK, today, null, SampleText.WORK)
                .copy(status = TaskStatus.DOING, isNow = true, resumeNote = text(SampleText.PLAN_WEEK_RESUME)),
            task(SampleText.DENTIST, today, "09:30", SampleText.HEALTH).copy(reminders = listOf(TaskReminder.before(15))),
            task(SampleText.STANDUP, standupDay, "10:00", SampleText.WORK)
                .copy(repeat = RepeatRule(RepeatEvery.WEEK, weekdays = listOf(1, 2, 3, 4, 5))),
            task(SampleText.GROCERIES, today, null, SampleText.HOME).let { t ->
                val items = listOf(SampleText.MILK, SampleText.EGGS, SampleText.BREAD, SampleText.COFFEE)
                t.copy(checklist = items.mapIndexed { i, item -> ChecklistItem("${t.localId}-$i", text(item), done = item == SampleText.BREAD) })
            },
            task(SampleText.PLANTS, today, null, SampleText.HOME).copy(repeat = RepeatRule(RepeatEvery.DAY, interval = 2)),
            task(SampleText.RUN, today, "07:00", SampleText.HEALTH).done(),
            task(SampleText.PROPOSAL, today.plusDays(2), null, SampleText.WORK).copy(
                status = TaskStatus.DOING,
                note = text(SampleText.PROPOSAL_NOTE),
                links = listOf(TaskLink(LINK, text(SampleText.LINK_TITLE))),
            ),
            task(SampleText.HOLIDAY, null).copy(note = text(SampleText.HOLIDAY_NOTE)),
        ) + week
    }

    private const val MINUTE = 60_000L
    private const val HOUR = 60 * MINUTE
}
