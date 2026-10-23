package dev.helm.planner.ui.calendar

import androidx.compose.ui.unit.dp
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WeekStripTest {
    private val monday = LocalDate.parse("2026-10-19")
    private val thursday = LocalDate.parse("2026-10-22")

    @Test
    fun aPhoneHeldUprightShowsBarsOnItsSideTitles() {
        // Phones upright: 360 to 430 dp, about 45 to 55 dp a day.
        assertTrue(barsOnly(360.dp, 48.dp))
        assertTrue(barsOnly(411.dp, 48.dp))
        assertTrue(barsOnly(430.dp, 62.dp))
        // A small tablet just below 80 dp a day.
        assertTrue(barsOnly(600.dp, 48.dp))
        // On its side (640 to 930 dp) and tablets: titles, also with the larger font's wider hours.
        assertFalse(barsOnly(640.dp, 48.dp))
        assertFalse(barsOnly(914.dp, 62.dp))
        assertFalse(barsOnly(914.dp, 96.dp))
        assertFalse(barsOnly(800.dp, 48.dp))
        assertFalse(barsOnly(1280.dp, 48.dp))
    }

    @Test
    fun homeIsTheWeekOfToday() {
        val state = WeekStripState(monday.toEpochDay(), 0f)
        assertEquals(0, state.home(thursday))
        assertEquals(7, state.home(LocalDate.parse("2026-10-27")))
        assertEquals(7, state.home(LocalDate.parse("2026-11-01")))
        assertEquals(thursday, state.date(3))
        assertEquals(-4, state.indexOf(LocalDate.parse("2026-10-15")))
    }

    @Test
    fun aDayBelongsToTheWeekOfItsMonday() {
        val state = WeekStripState(monday.toEpochDay(), 0f)
        assertEquals(0, state.weekOf(3))
        assertEquals(0, state.weekOf(6))
        assertEquals(7, state.weekOf(13))
        // Before the anchor: the Monday of that week, not the next one.
        assertEquals(-7, state.weekOf(-3))
    }

    @Test
    fun theFirstDayIsTheNearestWholeOne() {
        val state = WeekStripState(monday.toEpochDay(), 2.6f)
        assertEquals(3, state.firstDay)
        state.snapTo(-7)
        assertEquals(-7, state.firstDay)
    }
}
