package dev.helm.planner.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** A cached server-confirmed project. localId equals serverId, except in the local demo plan. */
@Entity(tableName = "projects", indices = [Index(value = ["serverId"], unique = true), Index(value = ["clientId"])])
data class Project(
    @PrimaryKey val localId: String,
    val serverId: String? = null,
    val clientId: String? = null,
    val name: String,
    val color: String? = null,
    val icon: String? = null,
    val note: String? = null,
    val position: Double,
    val archivedAt: Long? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val serverUpdatedAt: Long? = null,
    /** Reserved for cached/imported data; project deletions are applied directly on the server. */
    val deletedAt: Long? = null,
) {
    val archived: Boolean get() = archivedAt != null
    val selectable: Boolean get() = !archived && deletedAt == null
    val assignable: Boolean get() = selectable && serverId != null
}
