package dev.helm.planner.ui.calendar

import dev.helm.planner.data.local.Task
import dev.helm.planner.domain.CalendarEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DropMathTest {
    /** 96 px an hour: 24 px a quarter. */
    private val hour = 96f

    private fun entry(date: String, time: String?) =
        CalendarEntry(Task(localId = "a", title = "A", dueDate = date, dueTime = time, createdAt = 0, updatedAt = 0), date, time, repeat = false, overdue = false, done = false)

    @Test
    fun aBlockSnapsToTheNearestQuarterOfAnHour() {
        assertEquals(0, DropMath.snap(0f, hour))
        assertEquals(9 * 60, DropMath.snap(9 * hour, hour))
        // 11 px past 09:00 is nearer 09:00, 13 px nearer 09:15.
        assertEquals(9 * 60, DropMath.snap(9 * hour + 11f, hour))
        assertEquals(9 * 60 + 15, DropMath.snap(9 * hour + 13f, hour))
        assertEquals(10 * 60 + 45, DropMath.snap(10.75f * hour, hour))
    }

    @Test
    fun aDropStaysWithinTheDay() {
        assertEquals("above midnight is midnight", 0, DropMath.snap(-40f, hour))
        assertEquals("the last start is 23:45", 23 * 60 + 45, DropMath.snap(24 * hour, hour))
        assertEquals(23 * 60 + 45, DropMath.snap(30 * hour, hour))
    }

    @Test
    fun timesAreTwoDigitHoursAndMinutes() {
        assertEquals("00:00", DropMath.timeOf(0))
        assertEquals("09:15", DropMath.timeOf(9 * 60 + 15))
        assertEquals("23:45", DropMath.timeOf(DropMath.LAST_START))
    }

    @Test
    fun theColumnIsTheDayUnderTheFinger() {
        // Three columns of 100 px, the strip at index 10.
        assertEquals(10, DropMath.column(5f, 100f, 10f, 3))
        assertEquals(11, DropMath.column(150f, 100f, 10f, 3))
        assertEquals(12, DropMath.column(299f, 100f, 10f, 3))
        // Over the hours' labels: the first day in view; past the last column: the last.
        assertEquals(10, DropMath.column(-30f, 100f, 10f, 3))
        assertEquals(12, DropMath.column(340f, 100f, 10f, 3))
        // Halfway through a move to index 11, the left half of the first column is still day 10.
        assertEquals(10, DropMath.column(40f, 100f, 10.5f, 3))
        assertEquals(11, DropMath.column(60f, 100f, 10.5f, 3))
        assertEquals(-3, DropMath.column(50f, 100f, -3f, 3))
    }

    @Test
    fun edgesOfTheView() {
        assertEquals(-1, DropMath.edge(10f, 400f, 32f))
        assertEquals(0, DropMath.edge(200f, 400f, 32f))
        assertEquals(1, DropMath.edge(390f, 400f, 32f))
        assertEquals("past the edge counts too", 1, DropMath.edge(420f, 400f, 32f))
    }

    @Test
    fun theHoursScrollNearTheirTopAndBottomFasterNearerTheEdge() {
        // The hours show from 100 to 900, with 40 px edges.
        assertEquals(0f, DropMath.scrollStep(500f, 100f, 900f, 40f, 10f), 0f)
        assertEquals(-10f, DropMath.scrollStep(100f, 100f, 900f, 40f, 10f), 0.001f)
        assertEquals(-5f, DropMath.scrollStep(120f, 100f, 900f, 40f, 10f), 0.001f)
        assertEquals(5f, DropMath.scrollStep(880f, 100f, 900f, 40f, 10f), 0.001f)
        assertEquals("below the hours, the fastest", 10f, DropMath.scrollStep(990f, 100f, 900f, 40f, 10f), 0.001f)
        assertEquals("above them (the band without a time), still", 0f, DropMath.scrollStep(60f, 100f, 900f, 40f, 10f), 0f)
    }

    @Test
    fun aDropChangesTheDayTheTimeOrBoth() {
        val timed = entry("2026-10-22", "09:00")
        assertEquals(DropTarget("2026-10-23", "09:00"), DropMath.moveOf(timed, DropTarget("2026-10-23", "09:00")))
        assertEquals(DropTarget("2026-10-22", "10:15"), DropMath.moveOf(timed, DropTarget("2026-10-22", "10:15")))
        assertEquals("on the band: no time", DropTarget("2026-10-22", null), DropMath.moveOf(timed, DropTarget("2026-10-22", null)))

        val untimed = entry("2026-10-23", null)
        assertEquals("into the hours: a time", DropTarget("2026-10-23", "14:30"), DropMath.moveOf(untimed, DropTarget("2026-10-23", "14:30")))
        assertEquals(DropTarget("2026-10-25", null), DropMath.moveOf(untimed, DropTarget("2026-10-25", null)))
    }

    @Test
    fun aDropWhereItWasChangesNothing() {
        assertNull(DropMath.moveOf(entry("2026-10-22", "09:00"), DropTarget("2026-10-22", "09:00")))
        assertNull(DropMath.moveOf(entry("2026-10-23", null), DropTarget("2026-10-23", null)))
        assertNull("nowhere to drop", DropMath.moveOf(entry("2026-10-23", null), null))
    }
}
