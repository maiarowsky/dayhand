package dev.helm.planner.data

import dev.helm.planner.data.local.Project
import dev.helm.planner.data.local.Task

/** Related rows read under one Room transaction, never two separately observed versions. */
data class PlanSnapshot(val tasks: List<Task>, val projects: List<Project>)
data class PlanSize(val tasks: Int, val pending: Int, val projects: Int)
class RestoreCapacityExceeded : Exception("project capacity exceeded")
