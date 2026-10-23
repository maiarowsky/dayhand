package dev.helm.planner.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/**
 * Thin outline icons for list rows (Mussh "SettingsIcon"): drawn with one stroke weight, no fill and no tile, so a
 * group of rows reads as one quiet column. Decoration only; the row's text names it.
 */
enum class LineIcon {
    Contrast, Palette, Font, Globe, Bell, Sun, Clock, Download, Cloud, CloudOff, Link, Unlink, Phone, Document, Code,
    List, Info, Warning, Check, Chevron, Calendar, Copy, Share, Refresh,
}

@Composable
fun LineIconView(icon: LineIcon, color: Color, modifier: Modifier = Modifier, size: Dp = 22.dp) {
    Canvas(modifier.size(size)) { draw(icon, color) }
}

private fun DrawScope.draw(icon: LineIcon, color: Color) {
    val w = size.width
    val stroke = Stroke(w * 0.075f, cap = StrokeCap.Round, join = StrokeJoin.Round)
    fun line(x1: Float, y1: Float, x2: Float, y2: Float) =
        drawLine(color, Offset(x1 * w, y1 * w), Offset(x2 * w, y2 * w), strokeWidth = stroke.width, cap = StrokeCap.Round)
    fun rect(x: Float, y: Float, rw: Float, rh: Float, radius: Float) =
        drawRoundRect(color, Offset(x * w, y * w), Size(rw * w, rh * w), CornerRadius(radius * w), style = stroke)
    fun circle(cx: Float, cy: Float, r: Float, fill: Boolean = false) =
        if (fill) drawCircle(color, r * w, Offset(cx * w, cy * w)) else drawCircle(color, r * w, Offset(cx * w, cy * w), style = stroke)
    fun arc(cx: Float, cy: Float, r: Float, start: Float, sweep: Float) =
        drawArc(color, start, sweep, false, Offset((cx - r) * w, (cy - r) * w), Size(2 * r * w, 2 * r * w), style = stroke)
    fun path(vararg points: Pair<Float, Float>, close: Boolean = false) {
        val p = Path().apply {
            moveTo(points[0].first * w, points[0].second * w)
            points.drop(1).forEach { (x, y) -> lineTo(x * w, y * w) }
            if (close) close()
        }
        drawPath(p, color, style = stroke)
    }
    fun cloud() {
        fun box(cx: Float, cy: Float, r: Float) = Rect((cx - r) * w, (cy - r) * w, (cx + r) * w, (cy + r) * w)
        val p = Path().apply {
            moveTo(0.28f * w, 0.76f * w)
            arcTo(box(0.28f, 0.6f, 0.16f), 90f, 180f, false)
            arcTo(box(0.5f, 0.44f, 0.22f), 180f, 180f, false)
            arcTo(box(0.72f, 0.6f, 0.16f), 270f, 180f, false)
            close()
        }
        drawPath(p, color, style = stroke)
    }
    when (icon) {
        LineIcon.Contrast -> {
            circle(0.5f, 0.5f, 0.38f)
            drawArc(color, -90f, 180f, true, Offset(0.12f * w, 0.12f * w), Size(0.76f * w, 0.76f * w))
        }
        LineIcon.Palette -> {
            arc(0.5f, 0.5f, 0.38f, 40f, 300f)
            line(0.79f, 0.74f, 0.66f, 0.62f)
            circle(0.34f, 0.38f, 0.05f, fill = true)
            circle(0.52f, 0.28f, 0.05f, fill = true)
            circle(0.68f, 0.4f, 0.05f, fill = true)
            circle(0.33f, 0.6f, 0.05f, fill = true)
        }
        LineIcon.Font -> {
            line(0.2f, 0.2f, 0.8f, 0.2f)
            line(0.5f, 0.2f, 0.5f, 0.82f)
            line(0.2f, 0.2f, 0.2f, 0.3f)
            line(0.8f, 0.2f, 0.8f, 0.3f)
            line(0.38f, 0.82f, 0.62f, 0.82f)
        }
        LineIcon.Globe -> {
            circle(0.5f, 0.5f, 0.38f)
            drawOval(color, Offset(0.33f * w, 0.12f * w), Size(0.34f * w, 0.76f * w), style = stroke)
            line(0.12f, 0.5f, 0.88f, 0.5f)
        }
        LineIcon.Bell -> {
            path(0.3f to 0.42f, 0.3f to 0.6f, 0.2f to 0.7f, 0.8f to 0.7f, 0.7f to 0.6f, 0.7f to 0.42f)
            arc(0.5f, 0.42f, 0.2f, 180f, 180f)
            line(0.5f, 0.14f, 0.5f, 0.22f)
            arc(0.5f, 0.76f, 0.08f, 0f, 180f)
        }
        LineIcon.Sun -> {
            circle(0.5f, 0.5f, 0.15f)
            repeat(8) { i ->
                val a = Math.toRadians(i * 45.0)
                val (c, s) = cos(a).toFloat() to sin(a).toFloat()
                line(0.5f + 0.26f * c, 0.5f + 0.26f * s, 0.5f + 0.36f * c, 0.5f + 0.36f * s)
            }
        }
        LineIcon.Clock -> {
            circle(0.5f, 0.5f, 0.38f)
            path(0.5f to 0.28f, 0.5f to 0.5f, 0.66f to 0.6f)
        }
        LineIcon.Download -> {
            line(0.5f, 0.14f, 0.5f, 0.62f)
            path(0.32f to 0.46f, 0.5f to 0.64f, 0.68f to 0.46f)
            line(0.18f, 0.84f, 0.82f, 0.84f)
        }
        LineIcon.Cloud -> cloud()
        LineIcon.CloudOff -> {
            cloud()
            line(0.14f, 0.14f, 0.86f, 0.86f)
        }
        LineIcon.Link -> {
            rect(0.06f, 0.34f, 0.42f, 0.32f, 0.16f)
            rect(0.52f, 0.34f, 0.42f, 0.32f, 0.16f)
            line(0.34f, 0.5f, 0.66f, 0.5f)
        }
        LineIcon.Unlink -> {
            rect(0.04f, 0.34f, 0.36f, 0.32f, 0.16f)
            rect(0.6f, 0.34f, 0.36f, 0.32f, 0.16f)
            line(0.5f, 0.16f, 0.5f, 0.26f)
            line(0.5f, 0.74f, 0.5f, 0.84f)
        }
        LineIcon.Phone -> {
            rect(0.3f, 0.1f, 0.4f, 0.8f, 0.08f)
            line(0.44f, 0.78f, 0.56f, 0.78f)
        }
        LineIcon.Document -> {
            path(0.22f to 0.1f, 0.6f to 0.1f, 0.78f to 0.28f, 0.78f to 0.9f, 0.22f to 0.9f, close = true)
            line(0.34f, 0.46f, 0.66f, 0.46f)
            line(0.34f, 0.6f, 0.66f, 0.6f)
            line(0.34f, 0.74f, 0.54f, 0.74f)
        }
        LineIcon.Code -> {
            path(0.34f to 0.28f, 0.12f to 0.5f, 0.34f to 0.72f)
            path(0.66f to 0.28f, 0.88f to 0.5f, 0.66f to 0.72f)
        }
        LineIcon.List -> for (y in listOf(0.28f, 0.5f, 0.72f)) {
            circle(0.18f, y, 0.045f, fill = true)
            line(0.34f, y, 0.84f, y)
        }
        LineIcon.Info -> {
            circle(0.5f, 0.5f, 0.38f)
            circle(0.5f, 0.33f, 0.04f, fill = true)
            line(0.5f, 0.47f, 0.5f, 0.7f)
        }
        LineIcon.Warning -> {
            path(0.5f to 0.12f, 0.9f to 0.84f, 0.1f to 0.84f, close = true)
            line(0.5f, 0.4f, 0.5f, 0.6f)
            circle(0.5f, 0.72f, 0.04f, fill = true)
        }
        LineIcon.Check -> path(0.2f to 0.52f, 0.42f to 0.72f, 0.8f to 0.3f)
        LineIcon.Chevron -> path(0.38f to 0.2f, 0.66f to 0.5f, 0.38f to 0.8f)
        LineIcon.Calendar -> {
            rect(0.14f, 0.2f, 0.72f, 0.66f, 0.1f)
            line(0.14f, 0.4f, 0.86f, 0.4f)
            line(0.34f, 0.12f, 0.34f, 0.26f)
            line(0.66f, 0.12f, 0.66f, 0.26f)
            circle(0.36f, 0.6f, 0.04f, fill = true)
            circle(0.64f, 0.6f, 0.04f, fill = true)
        }
        LineIcon.Copy -> {
            rect(0.32f, 0.32f, 0.52f, 0.56f, 0.08f)
            path(0.68f to 0.18f, 0.16f to 0.18f, 0.16f to 0.7f)
        }
        LineIcon.Share -> {
            line(0.5f, 0.14f, 0.5f, 0.6f)
            path(0.34f to 0.3f, 0.5f to 0.14f, 0.66f to 0.3f)
            path(0.32f to 0.44f, 0.18f to 0.44f, 0.18f to 0.86f, 0.82f to 0.86f, 0.82f to 0.44f, 0.68f to 0.44f)
        }
        LineIcon.Refresh -> {
            arc(0.5f, 0.5f, 0.32f, -60f, 300f)
            path(0.62f to 0.14f, 0.68f to 0.24f, 0.56f to 0.3f)
        }
    }
}
