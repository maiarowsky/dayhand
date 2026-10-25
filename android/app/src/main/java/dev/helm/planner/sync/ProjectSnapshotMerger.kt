package dev.helm.planner.sync

import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.local.Project
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject

data class ProjectMergePlan(val upserts: List<Project>, val deletes: List<String>)

/** Match by id/clientId (never by name during normal reads); pending fields win over a stale feed. */
object ProjectSnapshotMerger {
    fun merge(local: List<Project>, pending: List<OutboxOp>, remote: List<Project>, now: Long): ProjectMergePlan {
        val changes = pending.filter { it.mutation in setOf(Mutations.ADD_PROJECT, Mutations.UPDATE_PROJECT, Mutations.DELETE_PROJECT) }
            .groupBy { it.projectLocalId }
        val seen = mutableSetOf<String>()
        val upserts = remote.mapNotNull { r ->
            val row = local.firstOrNull { it.serverId == r.serverId } ?: local.firstOrNull { it.clientId != null && it.clientId == r.clientId }
            if (row != null) seen += row.localId
            val ops = changes[row?.localId].orEmpty()
            if (row?.deletedAt != null || row?.serverUpdatedAt?.let { r.updatedAt <= it } == true) return@mapNotNull null
            val keys = ops.flatMap { Json.parseToJsonElement(it.argsJson).jsonObject.keys }.toSet()
            r.copy(
                localId = row?.localId ?: r.localId,
                name = if ("name" in keys && row != null) row.name else r.name,
                color = if ("color" in keys && row != null) row.color else r.color,
                icon = if ("icon" in keys && row != null) row.icon else r.icon,
                note = if ("note" in keys && row != null) row.note else r.note,
                position = if ("position" in keys && row != null) row.position else r.position,
                archivedAt = if ("archived" in keys && row != null) row.archivedAt else r.archivedAt,
                updatedAt = maxOf(row?.updatedAt ?: 0, r.updatedAt),
            )
        }
        return ProjectMergePlan(upserts, local.filter {
            it.localId !in seen && it.localId !in changes &&
                (it.serverUpdatedAt != null || now - it.updatedAt > SnapshotMerger.UNSEEN_GRACE_MS)
        }.map { it.localId })
    }
}
