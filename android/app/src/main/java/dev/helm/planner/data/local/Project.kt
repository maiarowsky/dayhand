package dev.helm.planner.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** A flat project. Local ids remain stable when an offline project receives its server id. */
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
    /** A pending deletion stays addressable until deleteProject is acknowledged. */
    val deletedAt: Long? = null,
) {
    val archived: Boolean get() = archivedAt != null
    val selectable: Boolean get() = !archived && deletedAt == null
}
