package dev.helm.planner.data

import android.app.Application
import android.content.Context
import android.database.sqlite.SQLiteDatabase
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
    private val context = ApplicationProvider.getApplicationContext<Context>()

    /** Creates [name] from the exported schema of [version] through plain SQLite, then lets [fill] add rows to it. */
    private fun createAt(name: String, version: Int, fill: (SQLiteDatabase) -> Unit) {
        context.deleteDatabase(name)
        val schema = Json.parseToJsonElement(requireNotNull(javaClass.getResource("/dev.helm.planner.data.local.HelmDatabase/$version.json")).readText())
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
            fill(old)
            old.version = version
        }
    }

    @Test fun autoMigrationFromFivePreservesAllTaskFieldsAndOutboxOrder() = runBlocking {
        val name = "t4-migration.db"
        // Execute the exported v5 schema through SQLite, then let the real Room opener migrate and validate it.
        createAt(name, 5) { old ->
            old.execSQL("""INSERT INTO tasks (localId,serverId,title,status,isNow,createdAt,updatedAt,serverUpdatedAt,labels,links,checklist,acceptance,dependsOn,plan,blockedReason,ref)
                VALUES ('task','server','Keep me','doing',1,1,2,2,'["tag"]','[]','[{"id":"a","title":"Item","done":true}]','[]','["dep"]','Plan','Blocked',42)""")
            old.execSQL("""INSERT INTO outbox (opId,mutation,argsJson,taskLocalId,clientId,createdAt,attempts) VALUES ('one','app:update','{"note":"pending"}','task','one',3,0)""")
            old.execSQL("""INSERT INTO outbox (opId,mutation,argsJson,taskLocalId,clientId,createdAt,attempts) VALUES ('two','app:complete','{}','task','two',4,0)""")
        }
        val db = Room.databaseBuilder(context, HelmDatabase::class.java, name).build()
        try {
            val task = requireNotNull(db.tasks().byLocalId("task"))
            assertEquals("Keep me", task.title)
            assertEquals(TaskStatus.DOING, task.status)
            assertTrue(task.isNow)
            assertTrue(task.checklist.single().done)
            assertEquals(listOf("dep"), task.dependsOn)
            assertEquals("Plan", task.plan)
            assertEquals("Blocked", task.blockedReason)
            assertEquals(42L, task.ref)
            assertNull(task.projectId)
            assertNull(task.serverUpdatedAt)
            assertTrue(db.projects().all().isEmpty())
            assertEquals(listOf("one", "two"), db.outbox().all().map { it.opId })
            assertEquals(listOf("app:update", "app:complete"), db.outbox().all().map { it.mutation })
            val project = dev.helm.planner.data.local.Project("server-project", serverId = "server-project", name = "After upgrade", position = 0.0, createdAt = 1, updatedAt = 1)
            db.projects().upsert(listOf(project))
            assertEquals("After upgrade", db.projects().byLocalId(project.localId)?.name)
        } finally { db.close(); context.deleteDatabase(name) }
    }

    @Test fun versionSevenDropsLabelsWithTheirDataAndKeepsEverythingElse() = runBlocking {
        val name = "labels-migration.db"
        createAt(name, 6) { old ->
            old.execSQL("""INSERT INTO tasks (localId,serverId,title,status,isNow,createdAt,updatedAt,serverUpdatedAt,labels,links,checklist,acceptance,dependsOn,projectId)
                VALUES ('task','server','Keep me','todo',0,1,2,2,'["home","work"]','[{"url":"https://example.com"}]','[]','[]','["dep"]','project')""")
            val ops = listOf(
                "only" to """{"labels":["home"],"clientId":"only"}""",
                "mixed" to """{"labels":["home"],"note":"pending","clientId":"mixed"}""",
                "add" to """{"title":"New","labels":["home"],"clientId":"add"}""",
                "plain" to """{"note":"kept","clientId":"plain"}""",
            )
            ops.forEachIndexed { index, (id, args) ->
                val mutation = if (id == "add") "app:add" else "app:update"
                old.execSQL("INSERT INTO outbox (opId,mutation,argsJson,taskLocalId,clientId,createdAt,attempts) VALUES (?,?,?,?,?,?,0)",
                    arrayOf<Any>(id, mutation, args, "task", id, index.toLong()))
            }
        }
        val db = Room.databaseBuilder(context, HelmDatabase::class.java, name).build()
        try {
            val task = requireNotNull(db.tasks().byLocalId("task"))
            assertEquals("Keep me", task.title)
            assertEquals("project", task.projectId)
            assertEquals(listOf("dep"), task.dependsOn)
            assertEquals("https://example.com", task.links.single().url)
            val columns = db.openHelper.readableDatabase.query("PRAGMA table_info(tasks)").use { c ->
                generateSequence { if (c.moveToNext()) c.getString(c.getColumnIndexOrThrow("name")) else null }.toList()
            }
            assertFalse("labels" in columns)
            // An update of the labels alone has nothing left to send; the others lose only their labels, in order.
            val outbox = db.outbox().all()
            assertEquals(listOf("mixed", "add", "plain"), outbox.map { it.opId })
            outbox.forEach { assertFalse(it.opId, "labels" in Json.parseToJsonElement(it.argsJson).jsonObject) }
            assertEquals("pending", Json.parseToJsonElement(outbox.first().argsJson).jsonObject.getValue("note").jsonPrimitive.content)
        } finally { db.close(); context.deleteDatabase(name) }
    }
}
