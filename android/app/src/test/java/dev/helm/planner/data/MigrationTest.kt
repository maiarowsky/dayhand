package dev.helm.planner.data

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.TaskStatus
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class MigrationTest {
    @Test fun autoMigrationFromFivePreservesAllTaskFieldsAndOutboxOrder() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "t4-migration.db"
        context.deleteDatabase(name)
        // Execute the exported v5 schema through SQLite, then let the real Room opener migrate and validate it.
        val schema = Json.parseToJsonElement(requireNotNull(javaClass.getResource("/dev.helm.planner.data.local.HelmDatabase/5.json")).readText())
            .jsonObject.getValue("database").jsonObject
        context.openOrCreateDatabase(name, Context.MODE_PRIVATE, null).use { old ->
            schema.getValue("entities").jsonArray.forEach { entry ->
                val entity = entry.jsonObject
                val table = entity.getValue("tableName").jsonPrimitive.content
                old.execSQL(entity.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", table))
                entity.getValue("indices").jsonArray.forEach { index ->
                    old.execSQL(index.jsonObject.getValue("createSql").jsonPrimitive.content.replace("\${TABLE_NAME}", table))
                }
            }
            schema.getValue("setupQueries").jsonArray.forEach { old.execSQL(it.jsonPrimitive.content) }
            old.execSQL("""INSERT INTO tasks (localId,serverId,title,status,isNow,createdAt,updatedAt,serverUpdatedAt,labels,links,checklist,acceptance,dependsOn,plan,blockedReason,ref)
                VALUES ('task','server','Keep me','doing',1,1,2,2,'["tag"]','[]','[{"id":"a","title":"Item","done":true}]','[]','["dep"]','Plan','Blocked',42)""")
            old.execSQL("""INSERT INTO outbox (opId,mutation,argsJson,taskLocalId,clientId,createdAt,attempts) VALUES ('one','app:update','{"note":"pending"}','task','one',3,0)""")
            old.execSQL("""INSERT INTO outbox (opId,mutation,argsJson,taskLocalId,clientId,createdAt,attempts) VALUES ('two','app:complete','{}','task','two',4,0)""")
            old.version = 5
        }
        val db = Room.databaseBuilder(context, HelmDatabase::class.java, name).build()
        try {
            val task = requireNotNull(db.tasks().byLocalId("task"))
            assertEquals("Keep me", task.title)
            assertEquals(TaskStatus.DOING, task.status)
            assertTrue(task.isNow)
            assertEquals(listOf("tag"), task.labels)
            assertTrue(task.checklist.single().done)
            assertEquals(listOf("dep"), task.dependsOn)
            assertEquals("Plan", task.plan)
            assertEquals("Blocked", task.blockedReason)
            assertEquals(42L, task.ref)
            assertNull(task.projectLocalId)
            assertNull(task.serverUpdatedAt)
            assertTrue(db.projects().all().isEmpty())
            assertEquals(listOf("one", "two"), db.outbox().all().map { it.opId })
            assertTrue(db.outbox().all().all { it.projectLocalId == null })
            val project = TaskRepository(db).projectStore.add("After upgrade")
            assertEquals("After upgrade", db.projects().byLocalId(project.localId)?.name)
        } finally { db.close(); context.deleteDatabase(name) }
    }
}
