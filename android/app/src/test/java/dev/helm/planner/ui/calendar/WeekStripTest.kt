package dev.helm.planner.ui.calendar

import androidx.compose.ui.unit.dp
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class WeekStripTest {
    private val monday = LocalDate.parse("2026-10-19")
    private val thursday = LocalDate.parse("2026-10-22")

    @Test
    fun aPhoneShowsThreeDaysATabletAWeek() {
        assertEquals(3, visibleDays(411.dp, 48.dp, 1f))
        // A larger font needs wider columns; a phone never drops below three.
        assertEquals(3, visibleDays(411.dp, 62.dp, 1.3f))
        assertEquals(3, visibleDays(320.dp, 48.dp, 2f))
        assertEquals(4, visibleDays(480.dp, 48.dp, 1f))
        assertEquals(7, visibleDays(800.dp, 48.dp, 1f))
        assertEquals(7, visibleDays(1280.dp, 48.dp, 1f))
    }

    @Test
    fun aWeekOfColumnsStepsByWeeksFewerByDays() {
        assertEquals(7, stepOf(7))
        assertEquals(1, stepOf(3))
        assertEquals(1, stepOf(6))
    }

    @Test
    fun homeIsTodayOrItsWeek() {
        val state = WeekStripState(monday.toEpochDay(), 0f)
        assertEquals(3, state.home(thursday, 3))
        assertEquals(0, state.home(thursday, 7))
        assertEquals(thursday, state.date(3))
        assertEquals(-4, state.indexOf(LocalDate.parse("2026-10-15")))
    }

    @Test
    fun aWeekOfColumnsStartsOnMonday() {
        val state = WeekStripState(monday.toEpochDay(), 0f)
        assertEquals(3, state.startOfStep(3, 3))
        assertEquals(0, state.startOfStep(3, 7))
        assertEquals(7, state.startOfStep(13, 7))
        // Before the anchor: the Monday of that week, not the next one.
        assertEquals(-7, state.startOfStep(-3, 7))
    }

    @Test
    fun theFirstDayIsTheNearestWholeOne() {
        val state = WeekStripState(monday.toEpochDay(), 2.6f)
        assertEquals(3, state.firstDay)
        state.snapTo(-1)
        assertEquals(-1, state.firstDay)
    }
}
