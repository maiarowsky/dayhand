package dev.helm.planner.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.remote.RemoteEvent
import dev.helm.planner.settings.SettingsStore
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** A settings change made offline survives snapshots until the server has it. */
@RunWith(AndroidJUnit4::class)
class SettingsSyncTest {
    private lateinit var db: HelmDatabase
    private lateinit var repository: TaskRepository
    private val store = SettingsStore(ApplicationProvider.getApplicationContext())

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        repository = TaskRepository(db)
    }

    @After
    fun tearDown() = db.close()

    @Test
    fun pendingChangeKeepsTheLocalValueThenTheServerValueWins() = runTest {
        store.applyServer(RemoteEvent.Snapshot(emptyList(), "Europe/Warsaw", "05:00", listOf(0)), keepLocalChanges = false)

        store.setSummaryTime("06:15")
        repository.queueSettingsChange(buildJsonObject { put("summaryTime", "06:15") })
        val op = db.outbox().all().single()
        assertEquals(Mutations.UPDATE_SETTINGS, op.mutation)
        assertEquals(null, op.taskLocalId)
        val args = Json.parseToJsonElement(op.argsJson).jsonObject
        assertEquals("06:15", args.getValue("summaryTime").jsonPrimitive.content)
        assertTrue("clientId" in args)

        // An older snapshot arrives while the change waits: the time zone is taken, the summary time is not.
        assertTrue(repository.hasPendingSettingsChange())
        store.applyServer(RemoteEvent.Snapshot(emptyList(), "Europe/London", "05:00", listOf(0)), repository.hasPendingSettingsChange())
        assertEquals("06:15", store.current().summaryTime)
        assertEquals("Europe/London", store.current().serverTimezone)

        // Sent: the next snapshot is the truth again.
        db.outbox().delete(op.seq)
        assertFalse(repository.hasPendingSettingsChange())
        store.applyServer(RemoteEvent.Snapshot(emptyList(), "Europe/Warsaw", "06:15", listOf(10, 0)), repository.hasPendingSettingsChange())
        assertEquals("06:15", store.current().summaryTime)
        assertEquals(listOf(10, 0), store.current().reminderMinutes)
    }

    @Test
    fun withoutAServerTodayAndTheRemindersFollowThePhonesZone() = runTest {
        val phone = store.current().phoneTimezone
        try {
            store.applyServer(RemoteEvent.Snapshot(emptyList(), "Europe/London", "05:00", listOf(0)), keepLocalChanges = false)
            store.setPhoneTimezone("Asia/Tokyo")
            val settings = store.current()
            assertTrue(settings.isLocal)
            assertEquals("Asia/Tokyo", settings.timezone)
            assertEquals("Asia/Tokyo", settings.reminders.timezone)
            assertEquals("Europe/London", settings.serverTimezone)
        } finally {
            store.setPhoneTimezone(phone)
        }
    }

    @Test
    fun withoutAServerSettingsChangesAreKeptOnThePhone() = runTest {
        store.setSummaryTime("07:45")
        store.setReminderMinutes(listOf(10))
        val settings = store.current()
        assertTrue(settings.isLocal)
        assertEquals("07:45", settings.reminders.summaryTime)
        assertEquals(listOf(10), settings.reminders.reminderMinutes)
    }

    @Test
    fun noRemindersIsStoredAsAnEmptyList() = runTest {
        store.setReminderMinutes(emptyList())
        assertEquals(emptyList<Int>(), store.current().reminderMinutes)
        store.setReminderMinutes(listOf(0, 30))
        assertEquals(listOf(0, 30), store.current().reminderMinutes)
    }
}
