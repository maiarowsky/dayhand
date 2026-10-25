package dev.helm.planner.sync

import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task
import dev.helm.planner.data.remote.RemoteJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class ProjectSyncTest {
    private val local = Project("local", clientId = "local", name = "New name", color = "red", position = 1.0, createdAt = 1, updatedAt = 3)
    private fun op(mutation: String, args: String, task: String? = null, project: String? = "local") =
        OutboxOp(opId = "op", mutation = mutation, argsJson = args, taskLocalId = task, projectLocalId = project, clientId = "op", createdAt = 3)

    @Test fun projectsMatchClientIdsAndKeepOnlyPendingFields() {
        val remote = local.copy(localId = "server", serverId = "server", name = "Old name", color = "blue", updatedAt = 2, serverUpdatedAt = 2)
        val merge = ProjectSnapshotMerger.merge(listOf(local), listOf(op(Mutations.UPDATE_PROJECT, """{"name":"New name"}""")), listOf(remote), 4)
        val row = merge.upserts.single()
        assertEquals("local", row.localId)
        assertEquals("server", row.serverId)
        assertEquals("New name", row.name)
        assertEquals("blue", row.color)
        assertTrue(merge.deletes.isEmpty())
    }

    @Test fun projectReferencesUseTheLocalIdAndAPendingAssignmentWins() {
        val remote = RemoteJson.task(Json.parseToJsonElement("""{"id":"task","title":"Task","status":"todo","projectId":"server-project","createdAt":1,"updatedAt":2}""").jsonObject)
        val mapping = mapOf("server-project" to "local-project")
        val task = SnapshotMerger.merge(emptyList(), emptyList(), listOf(remote), 3, mapping).upserts.single()
        assertEquals("local-project", task.projectLocalId)
        val pending = op(Mutations.UPDATE, "{}", "task", "offline-project")
        val edited = task.copy(projectLocalId = "offline-project", serverUpdatedAt = null)
        val merged = SnapshotMerger.merge(listOf(edited), listOf(pending), listOf(remote), 4, mapping).upserts.single()
        assertEquals("offline-project", merged.projectLocalId)
        assertEquals("Task", merged.title)
    }

    @Test fun pendingDeletionIsNotResurrectedAndUnseenOfflineCreationsStay() {
        val deleted = local.copy(serverId = "server", deletedAt = 4)
        val merge = ProjectSnapshotMerger.merge(listOf(deleted), listOf(op(Mutations.DELETE_PROJECT, "{}")), listOf(deleted.copy(deletedAt = null)), 5)
        assertTrue(merge.upserts.isEmpty())
        assertTrue(merge.deletes.isEmpty())
        val unseen = ProjectSnapshotMerger.merge(listOf(local), listOf(op(Mutations.ADD_PROJECT, "{}")), emptyList(), 999999)
        assertTrue(unseen.deletes.isEmpty())
    }
}
