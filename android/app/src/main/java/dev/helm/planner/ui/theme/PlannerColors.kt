package dev.helm.planner.ui.theme

import androidx.compose.ui.graphics.Color
import dev.helm.planner.data.local.TaskStatus

/** Task status colours shared by calendar blocks and board markers; projects retain their own dot. */
object PlannerColors {
    val ink = Color(0xFF21291A)
    val lime = Color(0xFFCEDC85)
    val darkLime = Color(0xFFB8CB69)
    val olive = Color(0xFF626D28)
    val graphite = Color(0xFF292D29)
    val darkGraphite = Color(0xFF414741)

    fun today(palette: Palette): Color = if (palette.light) Color(0xFF1766D2) else Color(0xFF8BB8FF)
    fun onToday(palette: Palette): Color = if (palette.light) Color.White else Color(0xFF112B50)

    fun background(status: TaskStatus, palette: Palette): Color = when (status) {
        TaskStatus.TODO -> if (palette.light) lime else darkLime
        TaskStatus.DOING -> olive
        TaskStatus.DONE -> if (palette.light) graphite else darkGraphite
    }

    fun text(status: TaskStatus): Color = if (status == TaskStatus.TODO) ink else Color.White
}
