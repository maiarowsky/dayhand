package dev.helm.planner.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters

@Database(entities = [Task::class, OutboxOp::class], version = 1, exportSchema = true)
@TypeConverters(Converters::class)
abstract class HelmDatabase : RoomDatabase() {
    abstract fun tasks(): TaskDao
    abstract fun outbox(): OutboxDao

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
}
