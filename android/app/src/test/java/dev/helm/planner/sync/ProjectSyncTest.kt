package dev.helm.planner.sync

import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.local.Project
import dev.helm.planner.data.remote.RemoteJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class ProjectSyncTest {
    private val confirmed = Project("server", serverId = "server", name = "New", position = 1.0, createdAt = 1, updatedAt = 3, serverUpdatedAt = 3)

    @Test fun newerConfirmedMetadataWinsOverStaleFeedWithoutPendingProjectCommands() {
        val old = confirmed.copy(name = "Old", updatedAt = 2, serverUpdatedAt = 2)
        val merge = ProjectSnapshotMerger.merge(listOf(confirmed), listOf(old), 4)
        assertTrue(merge.upserts.isEmpty())
        assertTrue(merge.deletes.isEmpty())
        val fresh = ProjectSnapshotMerger.merge(listOf(confirmed), listOf(old.copy(updatedAt = 4)), 5)
        assertEquals("Old", fresh.upserts.single().name)
    }

    @Test fun taskReferencesAreCanonicalAndAPendingTaskAssignmentWins() {
        val remote = RemoteJson.task(Json.parseToJsonElement("""{"id":"task","title":"Task","status":"todo","projectId":"server-project","createdAt":1,"updatedAt":2}""").jsonObject)
        val task = SnapshotMerger.merge(emptyList(), emptyList(), listOf(remote), 3).upserts.single()
        assertEquals("server-project", task.projectId)
        val pending = OutboxOp(opId = "op", mutation = Mutations.UPDATE, argsJson = """{"projectId":"another-confirmed-project"}""",
            taskLocalId = "task", clientId = "op", createdAt = 3)
        val edited = task.copy(projectId = "another-confirmed-project", serverUpdatedAt = null)
        val merged = SnapshotMerger.merge(listOf(edited), listOf(pending), listOf(remote), 4).upserts.single()
        assertEquals("another-confirmed-project", merged.projectId)
        assertEquals("Task", merged.title)
    }

    @Test fun removedProjectIsNotKeptByTaskReferencesOrReconciledByName() {
        val sameName = confirmed.copy(localId = "other", serverId = "other")
        val merge = ProjectSnapshotMerger.merge(listOf(confirmed), listOf(sameName), 999999)
        assertEquals(listOf("server"), merge.deletes)
        assertEquals("other", merge.upserts.single().localId)
        val absent = ProjectSnapshotMerger.merge(listOf(confirmed), emptyList(), 999999)
        assertEquals(listOf("server"), absent.deletes)
    }
}
