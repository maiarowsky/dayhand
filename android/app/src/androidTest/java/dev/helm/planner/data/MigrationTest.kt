package dev.helm.planner.data

import androidx.room.Room
import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.local.TaskStatus
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** An app updated from 0.1 or 0.5 keeps its tasks and its waiting changes. */
@RunWith(AndroidJUnit4::class)
class MigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), HelmDatabase::class.java)

    @Test
    fun version1TasksAndOutboxSurviveTheUpgrade() {
        helper.createDatabase(DB, 1).apply {
            execSQL(
                "INSERT INTO tasks (localId, serverId, clientId, title, dueDate, status, isNow, resumeNote, createdAt, updatedAt, serverUpdatedAt) " +
                    "VALUES ('a', 's1', 'a', 'Call the accountant', '2026-10-22', 'doing', 1, 'page 3', 1, 2, 2)",
            )
            execSQL(
                "INSERT INTO outbox (opId, mutation, argsJson, taskLocalId, clientId, createdAt, attempts) " +
                    "VALUES ('o1', 'app:complete', '{\"clientId\":\"c1\"}', 'a', 'c1', 3, 0)",
            )
            close()
        }
        helper.runMigrationsAndValidate(DB, 2, true).close()

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, HelmDatabase::class.java, DB).build()
        try {
            runBlocking {
                val task = db.tasks().byLocalId("a")!!
                assertEquals("Call the accountant", task.title)
                assertEquals(TaskStatus.DOING, task.status)
                assertEquals("page 3", task.resumeNote)
                assertTrue(task.labels.isEmpty())
                assertTrue(task.links.isEmpty())
                assertNull(task.repeat)
                assertNull(task.deletedAt)
                assertNull("the next snapshot must fill in labels, links and repeat", task.serverUpdatedAt)
                assertEquals("app:complete", db.outbox().all().single().mutation)
            }
        } finally {
            db.close()
        }
    }

    @Test
    fun version2TasksGetAnEmptyChecklistAndTheDefaultReminders() {
        helper.createDatabase(DB, 2).apply {
            execSQL(
                "INSERT INTO tasks (localId, serverId, clientId, title, dueDate, status, isNow, createdAt, updatedAt, serverUpdatedAt, repeat, labels, links) " +
                    "VALUES ('a', 's1', 'a', 'Pay rent', '2026-10-31', 'todo', 0, 1, 2, 2, '{\"every\":\"month\",\"interval\":1}', '[\"home\"]', '[]')",
            )
            close()
        }
        helper.runMigrationsAndValidate(DB, 3, true).close()

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, HelmDatabase::class.java, DB).build()
        try {
            runBlocking {
                val task = db.tasks().byLocalId("a")!!
                assertEquals("Pay rent", task.title)
                assertEquals(RepeatRule(RepeatEvery.MONTH), task.repeat)
                assertEquals(listOf("home"), task.labels)
                assertTrue(task.checklist.isEmpty())
                assertNull("no own reminders: the defaults from Settings", task.reminders)
                assertNull("the next snapshot must fill in the checklist and reminders", task.serverUpdatedAt)
            }
        } finally {
            db.close()
        }
    }

    @Test
    fun version3TasksGetNoCriteriaProofOrClaim() {
        helper.createDatabase(DB, 3).apply {
            execSQL(
                "INSERT INTO tasks (localId, serverId, clientId, title, dueDate, status, isNow, createdAt, updatedAt, serverUpdatedAt, labels, links, checklist) " +
                    "VALUES ('a', 's1', 'a', 'Ship the export', '2026-10-31', 'doing', 0, 1, 2, 2, '[]', '[]', '[{\"id\":\"c1\",\"title\":\"CSV\",\"done\":true}]')",
            )
            close()
        }
        helper.runMigrationsAndValidate(DB, 4, true).close()

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, HelmDatabase::class.java, DB).build()
        try {
            runBlocking {
                val task = db.tasks().byLocalId("a")!!
                assertEquals("Ship the export", task.title)
                assertEquals(1, task.checklist.size)
                assertTrue(task.acceptance.isEmpty())
                assertNull(task.proof)
                assertNull(task.claimName)
                assertNull(task.claimExpiresAt)
                assertNull("the next snapshot must fill in the agent work", task.serverUpdatedAt)
            }
        } finally {
            db.close()
        }
    }

    @Test
    fun version4TasksKeepTheirClaimAndGetNoPlanOrDependencies() {
        helper.createDatabase(DB, 4).apply {
            execSQL(
                "INSERT INTO tasks (localId, serverId, clientId, title, status, isNow, createdAt, updatedAt, serverUpdatedAt, labels, links, checklist, acceptance, claimName, claimExpiresAt) " +
                    "VALUES ('a', 's1', 'a', 'Send the invoice', 'todo', 0, 1, 2, 2, '[]', '[]', '[]', '[{\"id\":\"a1\",\"text\":\"PDF sent\",\"met\":false}]', 'claude-code', 9)",
            )
            execSQL(
                "INSERT INTO outbox (opId, mutation, argsJson, taskLocalId, clientId, createdAt, attempts) " +
                    "VALUES ('o1', 'app:release', '{\"clientId\":\"c1\"}', 'a', 'c1', 3, 0)",
            )
            close()
        }
        helper.runMigrationsAndValidate(DB, 5, true).close()

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val db = Room.databaseBuilder(context, HelmDatabase::class.java, DB).build()
        try {
            runBlocking {
                val task = db.tasks().byLocalId("a")!!
                assertEquals("Send the invoice", task.title)
                assertEquals(1, task.acceptance.size)
                assertEquals("claude-code", task.claimName)
                assertNull(task.ref)
                assertNull(task.plan)
                assertTrue(task.dependsOn.isEmpty())
                assertNull(task.blockedReason)
                assertNull("the next snapshot must fill in the plan and the dependencies", task.serverUpdatedAt)
                assertEquals(listOf("app:release"), db.outbox().all().map { it.mutation })
            }
        } finally {
            db.close()
        }
    }

    private companion object {
        const val DB = "migration-test.db"
    }
}
