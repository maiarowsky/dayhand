package dev.helm.planner.sample

import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.CalendarDays
import dev.helm.planner.domain.TaskRules
import dev.helm.planner.domain.todaySections
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SamplePlanTest {
    private val zone = ZoneId.of("Europe/Warsaw")

    /** Friday 23 October 2026, 08:00 in Warsaw. */
    private val today = LocalDate.of(2026, 10, 23)
    private val now = today.atTime(8, 0).atZone(zone).toInstant().toEpochMilli()

    private fun plan(day: LocalDate = today, at: Long = now) = SamplePlan.tasks(day, at, zone) { it.name }

    @Test
    fun everyTaskIsASampleTaskAndPassesTheServersChecks() {
        val tasks = plan()
        assertTrue(tasks.all { SamplePlan.isSample(it.localId) && it.clientId == it.localId })
        assertEquals(tasks.size, tasks.map { it.localId }.distinct().size)
        for (task in tasks) {
            assertNotNull(task.title, TaskRules.title(task.title))
            assertNotNull(task.title, TaskRules.labels(task.labels))
            assertNotNull(task.title, TaskRules.checklist(task.checklist))
            task.repeat?.let { assertTrue(task.title, TaskRules.isValid(it)) }
            task.reminders?.let { assertNotNull(task.title, TaskRules.reminders(it)) }
            assertTrue(task.title, task.links.all { TaskRules.isLinkUrl(it.url) })
        }
    }

    @Test
    fun todayHasOverdueTasksANowTaskTodaysTasksAndSomethingDone() {
        val sections = todaySections(plan(), now, zone.id)
        assertEquals(setOf("REPLY", "BILL"), sections.overdue.map { it.title }.toSet())
        assertEquals("PLAN_WEEK", sections.now?.title)
        assertEquals("PLAN_WEEK_RESUME", sections.now?.resumeNote)
        assertTrue(sections.today.map { it.title }.containsAll(listOf("DENTIST", "STANDUP", "GROCERIES", "PLANTS")))
        assertTrue(sections.done.any { it.title == "RUN" })
    }

    @Test
    fun theBoardHasEveryColumn() {
        val tasks = plan()
        assertEquals(setOf(TaskStatus.TODO, TaskStatus.DOING, TaskStatus.DONE), tasks.map { it.status }.toSet())
        assertEquals(2, tasks.count { it.status == TaskStatus.DOING })
        assertTrue(tasks.any { it.dueDate == null })
    }

    @Test
    fun everyDayOfTheWeekHasATimedTaskAndTheDaysBeforeTodayAreDone() {
        val tasks = plan()
        val monday = LocalDate.of(2026, 10, 19)
        for (offset in 0L..6L) {
            val day = monday.plusDays(offset)
            val timed = tasks.filter { it.dueDate == day.toString() && it.dueTime != null }
            assertTrue("$day has a timed task", timed.isNotEmpty())
            if (day < today) assertTrue("$day is in the past", timed.all { it.status == TaskStatus.DONE && it.completedAt != null })
        }
        // Nothing done in the future.
        assertTrue(tasks.filter { it.status == TaskStatus.DONE }.all { it.completedAt!! <= now })
    }

    @Test
    fun theCalendarShowsLaterDatesOfTheRepeatingTasks() {
        val wednesday = LocalDate.of(2026, 10, 21)
        val tasks = plan(wednesday, wednesday.atTime(8, 0).atZone(zone).toInstant().toEpochMilli())
        val week = CalendarDays.days(tasks, CalendarDays.weekStart(wednesday), 7, wednesday.toString())
        val repeats = week.flatMap { it.untimed + it.timed }.filter { it.repeat }.map { it.task.title to it.date }
        // The stand-up on Thursday and Friday, the plants every other day.
        assertEquals(
            setOf("STANDUP" to "2026-10-22", "STANDUP" to "2026-10-23", "PLANTS" to "2026-10-23", "PLANTS" to "2026-10-25"),
            repeats.toSet(),
        )
    }

    @Test
    fun onASaturdayTheStandUpStartsOnMonday() {
        val saturday = LocalDate.of(2026, 10, 24)
        val standup = plan(saturday, saturday.atTime(9, 0).atZone(zone).toInstant().toEpochMilli()).single { it.title == "STANDUP" }
        assertEquals("2026-10-26", standup.dueDate)
    }

    @Test
    fun theChecklistAndLabelsAreInTheAppsWords() {
        val groceries = plan().single { it.title == "GROCERIES" }
        assertEquals(listOf("MILK", "EGGS", "BREAD", "COFFEE"), groceries.checklist.map { it.title })
        assertEquals(listOf("HOME"), groceries.labels)
        assertEquals(1, groceries.checklist.count { it.done })
    }
}
