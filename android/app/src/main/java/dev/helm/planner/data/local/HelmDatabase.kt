package dev.helm.planner.data.local

import android.content.Context
import androidx.room.AutoMigration
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.room.migration.AutoMigrationSpec
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * Version 2 adds repeat, labels, links and the trash to tasks, and the cached change history; version 3 the
 * checklist and the task's own reminders; version 4 the agent work: acceptance criteria, proof and the claim; version 5
 * the task's number, its plan, its dependencies and the blocked reason; version 6 adds projects and server-confirmed task project references.
 */
@Database(
    entities = [Task::class, OutboxOp::class, TaskEvent::class, Project::class],
    version = 6,
    exportSchema = true,
    autoMigrations = [
        AutoMigration(from = 1, to = 2, spec = HelmDatabase.Version2::class),
        AutoMigration(from = 2, to = 3, spec = HelmDatabase.Version3::class),
        AutoMigration(from = 3, to = 4, spec = HelmDatabase.Version4::class),
        AutoMigration(from = 4, to = 5, spec = HelmDatabase.Version5::class),
        AutoMigration(from = 5, to = 6, spec = HelmDatabase.Version6::class),
    ],
)
@TypeConverters(Converters::class)
abstract class HelmDatabase : RoomDatabase() {
    abstract fun tasks(): TaskDao
    abstract fun outbox(): OutboxDao
    abstract fun events(): TaskEventDao
    abstract fun projects(): ProjectDao

    /**
     * Rows from version 1 have empty labels, links and repeat but a known server copy, so a
     * snapshot would skip them as unchanged. Forgetting the server copy makes the next snapshot
     * fill every field in; changes still in the outbox keep their local values as usual.
     */
    class Version2 : AutoMigrationSpec {
        override fun onPostMigrate(db: SupportSQLiteDatabase) {
            db.execSQL("UPDATE tasks SET serverUpdatedAt = NULL")
        }
    }

    /** As [Version2]: rows from version 2 have no checklist and no own reminders, so the next snapshot fills them in. */
    class Version3 : AutoMigrationSpec {
        override fun onPostMigrate(db: SupportSQLiteDatabase) {
            db.execSQL("UPDATE tasks SET serverUpdatedAt = NULL")
        }
    }

    /** As [Version2]: rows from version 3 have no criteria, proof or claim, so the next snapshot fills them in. */
    class Version4 : AutoMigrationSpec {
        override fun onPostMigrate(db: SupportSQLiteDatabase) {
            db.execSQL("UPDATE tasks SET serverUpdatedAt = NULL")
        }
    }

    /** As [Version2]: rows from version 4 have no number, plan, dependencies or blocked reason, so the next snapshot fills them in. */
    class Version5 : AutoMigrationSpec {
        override fun onPostMigrate(db: SupportSQLiteDatabase) {
            db.execSQL("UPDATE tasks SET serverUpdatedAt = NULL")
        }
    }

    /** Re-read projectId even if the server task's updatedAt has not changed since version 5. */
    class Version6 : AutoMigrationSpec {
        override fun onPostMigrate(db: SupportSQLiteDatabase) {
            db.execSQL("UPDATE tasks SET serverUpdatedAt = NULL")
        }
    }

    companion object {
        const val FILE_NAME = "helm.db"

        fun open(context: Context, name: String = FILE_NAME): HelmDatabase =
            Room.databaseBuilder(context.applicationContext, HelmDatabase::class.java, name).build()
    }
}

class Converters {
    @TypeConverter
    fun statusToWire(status: TaskStatus): String = status.wire

    @TypeConverter
    fun statusFromWire(value: String): TaskStatus = TaskStatus.fromWire(value)

    @TypeConverter
    fun labelsToJson(labels: List<String>): String = FieldJson.encodeLabels(labels)

    @TypeConverter
    fun labelsFromJson(value: String): List<String> = FieldJson.decodeLabels(value)

    @TypeConverter
    fun linksToJson(links: List<TaskLink>): String = FieldJson.encodeLinks(links)

    @TypeConverter
    fun linksFromJson(value: String): List<TaskLink> = FieldJson.decodeLinks(value)

    @TypeConverter
    fun checklistToJson(items: List<ChecklistItem>): String = FieldJson.encodeChecklist(items)

    @TypeConverter
    fun checklistFromJson(value: String): List<ChecklistItem> = FieldJson.decodeChecklist(value)

    @TypeConverter
    fun remindersToJson(reminders: List<TaskReminder>?): String? = reminders?.let(FieldJson::encodeReminders)

    @TypeConverter
    fun remindersFromJson(value: String?): List<TaskReminder>? = value?.let(FieldJson::decodeReminders)

    @TypeConverter
    fun acceptanceToJson(items: List<AcceptanceItem>): String = FieldJson.encodeAcceptance(items)

    @TypeConverter
    fun acceptanceFromJson(value: String): List<AcceptanceItem> = FieldJson.decodeAcceptance(value)

    @TypeConverter
    fun proofToJson(proof: TaskProof?): String? = proof?.let(FieldJson::encodeProof)

    @TypeConverter
    fun proofFromJson(value: String?): TaskProof? = value?.let(FieldJson::decodeProof)

    @TypeConverter
    fun repeatToJson(rule: RepeatRule?): String? = rule?.let(FieldJson::encodeRepeat)

    @TypeConverter
    fun repeatFromJson(value: String?): RepeatRule? = value?.let(FieldJson::decodeRepeat)
}
