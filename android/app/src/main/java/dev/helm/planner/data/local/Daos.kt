package dev.helm.planner.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface TaskDao {
    @Query("SELECT * FROM tasks")
    fun observeAll(): Flow<List<Task>>

    @Query("SELECT * FROM tasks")
    suspend fun all(): List<Task>

    @Query("SELECT * FROM tasks WHERE localId = :localId")
    suspend fun byLocalId(localId: String): Task?

    @Query("SELECT * FROM tasks WHERE isNow = 1")
    suspend fun nowTasks(): List<Task>

    @Upsert
    suspend fun upsert(tasks: List<Task>)

    @Query("DELETE FROM tasks WHERE localId IN (:localIds)")
    suspend fun delete(localIds: List<String>)

    @Query("UPDATE tasks SET serverId = :serverId WHERE localId = :localId")
    suspend fun setServerId(localId: String, serverId: String)
}

@Dao
interface OutboxDao {
    @Insert
    suspend fun insert(op: OutboxOp): Long

    @Query("SELECT * FROM outbox ORDER BY seq LIMIT 1")
    suspend fun first(): OutboxOp?

    @Query("SELECT * FROM outbox ORDER BY seq")
    suspend fun all(): List<OutboxOp>

    @Query("SELECT COUNT(*) FROM outbox")
    fun observeCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM outbox")
    suspend fun count(): Int

    @Query("DELETE FROM outbox WHERE seq = :seq")
    suspend fun delete(seq: Long)

    @Query("DELETE FROM outbox WHERE taskLocalId = :taskLocalId")
    suspend fun deleteForTask(taskLocalId: String)

    @Query("UPDATE outbox SET attempts = attempts + 1, lastError = :error WHERE seq = :seq")
    suspend fun recordFailure(seq: Long, error: String)
}
