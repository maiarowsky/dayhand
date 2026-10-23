package dev.helm.planner.ui.calendar

import org.junit.Assert.assertEquals
import org.junit.Test

/** Widths are counted in characters: a line [fits] when it has at most [width] of them. */
class TitleLinesTest {
    private fun lines(text: String, width: Int, maxLines: Int = 2) = wordLines(text, maxLines) { it.length <= width }

    @Test
    fun breaksBetweenWordsOnly() {
        assertEquals(listOf("Zadzwonić do", "dentysty"), lines("Zadzwonić do dentysty", 12))
        assertEquals(listOf("Raport", "kwartalny"), lines("Raport kwartalny", 10))
    }

    @Test
    fun aWordWiderThanTheLineIsShortenedNotSplit() {
        // Android would draw "Zadzw / onić"; here the word ends in "…" and nothing follows it.
        assertEquals(listOf("Zadzw…"), lines("Zadzwonić do dentysty", 6))
        assertEquals(listOf("Raport", "kwart…"), lines("Raport kwartalny", 6))
    }

    @Test
    fun textBeyondTheLastLineEndsItInAnEllipsis() {
        assertEquals(listOf("Spotkanie z", "księgową w…"), lines("Spotkanie z księgową w biurze", 11))
        assertEquals(listOf("Spotkanie…"), lines("Spotkanie z księgową", 11, maxLines = 1))
        // The last line itself is cut when "…" does not fit after it.
        assertEquals(listOf("Przegląd", "tygodni…"), lines("Przegląd tygodnia i plan", 8))
    }

    @Test
    fun shortTitlesAndSpacing() {
        assertEquals(listOf("Basen"), lines("Basen", 10))
        assertEquals(listOf("Kupić chleb"), lines("  Kupić \n chleb ", 12))
        assertEquals(emptyList<String>(), lines("   ", 10))
    }

    @Test
    fun aNoBreakSpaceKeepsTheMarkWithItsWord() {
        assertEquals(listOf("! Podlać", "kwiaty"), lines("! Podlać kwiaty", 8))
    }

    @Test
    fun graphemesAreNotCutInHalf() {
        // "😀" is two chars (a surrogate pair): it stays whole or goes.
        assertEquals(listOf("ab…"), lines("ab😀cdef", 4, maxLines = 1))
        assertEquals(listOf("ab😀…"), lines("ab😀cdef", 5, maxLines = 1))
    }

    @Test
    fun nothingFitsButTheEllipsis() {
        assertEquals(listOf("…"), lines("Zadzwonić", 1))
    }
}
