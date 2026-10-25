package dev.helm.planner.ui.projects

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.helm.planner.R
import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task
import dev.helm.planner.ui.theme.ProjectColors
import dev.helm.planner.ui.theme.helmType
import dev.helm.planner.ui.theme.palette

@Composable
fun ProjectMark(project: Project?, modifier: Modifier = Modifier) {
    val color = ProjectColors.color(project?.color.takeUnless { project?.archived == true }, palette)
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Canvas(Modifier.size(12.dp).then(Modifier.testTag("project-dot-${project?.localId ?: "none"}"))) {
            if (project?.color == null || project.archived) drawCircle(color, style = Stroke(2.dp.toPx())) else drawCircle(color)
        }
        project?.icon?.let { Text(it, style = helmType.body) }
    }
}

@Composable
fun ProjectBadge(task: Task) {
    val project = LocalProjects.current.projects.firstOrNull { it.localId == task.projectId } ?: return
    val name = if (project.archived) stringResource(R.string.project_archived_name, project.name) else project.name
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = name }) {
        ProjectMark(project)
        Text(name, style = helmType.small, color = palette.textMuted)
    }
}
