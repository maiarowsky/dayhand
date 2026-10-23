package dev.helm.planner.ui.calendar

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextDecoration
import java.text.BreakIterator

private const val ELLIPSIS = "…"
private val SPACES = Regex("[ \\t\\r\\n]+")

/**
 * Lays [text] out in at most [maxLines] lines that each [fits], breaking only between words (a no-break space keeps
 * two words together). When the text does not fit, or a word is wider than a line on its own, the last line shown
 * ends in "…": a word may be shortened, but it is never split over two lines ("Zadzw / onić").
 */
fun wordLines(text: String, maxLines: Int, fits: (String) -> Boolean): List<String> {
    val words = text.trim().split(SPACES).filter { it.isNotEmpty() }
    val lines = mutableListOf<String>()
    var line = ""
    for (word in words) {
        val joined = if (line.isEmpty()) word else "$line $word"
        if (fits(joined)) {
            line = joined
            continue
        }
        if (line.isNotEmpty()) {
            if (lines.size == maxLines.coerceAtLeast(1) - 1) return lines + shortened(line, fits)
            lines += line
        }
        if (!fits(word)) return lines + shortened(word, fits)
        line = word
    }
    if (line.isNotEmpty()) lines += line
    return lines
}

/** [text] and "…", cut back character by character (whole graphemes, never half an emoji) until it fits. */
private fun shortened(text: String, fits: (String) -> Boolean): String {
    val whole = "$text$ELLIPSIS"
    if (fits(whole)) return whole
    val breaks = BreakIterator.getCharacterInstance().apply { setText(text) }
    breaks.last()
    while (true) {
        // DONE (-1) or the start: not even one character fits.
        val end = breaks.previous()
        if (end <= 0) break
        val cut = text.substring(0, end).trimEnd() + ELLIPSIS
        if (fits(cut)) return cut
    }
    return ELLIPSIS
}

/**
 * A task title in a calendar block: as many whole-word lines as fit the block's width and height, up to [maxLines]
 * (see [wordLines]). Android's own line breaking splits a word that is wider than the line, which in a narrow day
 * column happens to most words.
 */
@Composable
fun WordTitle(
    text: String,
    style: TextStyle,
    color: Color,
    maxLines: Int,
    modifier: Modifier = Modifier,
    textDecoration: TextDecoration? = null,
) {
    val measurer = rememberTextMeasurer()
    BoxWithConstraints(modifier) {
        val width = constraints.maxWidth
        val maxHeight = constraints.maxHeight
        // As many lines as fit the block's height whole (measured together: n lines are not n times one line).
        val room = remember(style, maxHeight, maxLines) {
            if (!constraints.hasBoundedHeight) {
                maxLines
            } else {
                (maxLines downTo 2).firstOrNull { n -> measurer.measure(List(n) { "Ag" }.joinToString("\n"), style).size.height <= maxHeight } ?: 1
            }
        }
        val lines = remember(text, style, width, room) {
            wordLines(text, room) { measurer.measure(it, style, softWrap = false, maxLines = 1).size.width <= width }
        }
        Text(lines.joinToString("\n"), style = style, color = color, softWrap = false, maxLines = room, textDecoration = textDecoration)
    }
}
