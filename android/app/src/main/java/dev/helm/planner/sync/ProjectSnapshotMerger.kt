package dev.helm.planner.sync

import dev.helm.planner.data.local.Project
import dev.helm.planner.sample.SamplePlan

data class ProjectMergePlan(val upserts: List<Project>, val deletes: List<String>)

/** Server ids are canonical. There are no pending project commands or name-based reconciliation. */
object ProjectSnapshotMerger {
    fun merge(local: List<Project>, remote: List<Project>, now: Long): ProjectMergePlan {
        val byId = local.associateBy { it.localId }
        val ids = remote.map { it.localId }.toSet()
        val upserts = remote.filter { r -> byId[r.localId]?.serverUpdatedAt?.let { r.updatedAt >= it } != false }
        val deletes = local.filter {
            !SamplePlan.isSample(it.localId) && it.localId !in ids &&
                now - it.updatedAt > SnapshotMerger.UNSEEN_GRACE_MS
        }.map { it.localId }
        return ProjectMergePlan(upserts, deletes)
    }
}
