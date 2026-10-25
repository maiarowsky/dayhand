package dev.helm.planner.data

import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import dev.helm.planner.data.local.HelmDatabase
import dev.helm.planner.data.local.RepeatEvery
import dev.helm.planner.data.local.RepeatRule
import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.sync.OutboxProcessor
import dev.helm.planner.sync.RoomOutboxStore
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A reconnect must not remove an occurrence the phone already created in an archived project. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ArchivedProjectRepeatTest {
    @Test fun inheritedArchivedProjectReconnectsWithoutLosingTheNextOccurrence() = runBlocking {
        val url = System.getenv("DAYHAND_ANDROID_TEST_URL")
        val token = System.getenv("DAYHAND_ANDROID_TEST_TOKEN")
        assumeTrue("Requires the task's local backend", url != null && token != null)
        require(requireNotNull(url).startsWith("http://127.0.0.1:"))
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), HelmDatabase::class.java).build()
        try {
            val today = LocalDate.now().toString()
            val repo = TaskRepository(db, repeatsOnPhone = { today })
            val name = "Archived ${UUID.randomUUID().toString().take(8)}"
            val p = repo.projectStore.add(name)
            val t = repo.add(name, today, null, null, p.localId)
            repo.setRepeat(t.localId, RepeatRule(RepeatEvery.DAY))
            repo.projectStore.archive(p.localId, true)
            repo.complete(t.localId)
            assertEquals("The next occurrence exists on the phone", 2, db.tasks().all().size)
            val remote = HttpTaskRemote(url, requireNotNull(token))
            OutboxProcessor(RoomOutboxStore(db), remote).drain()
            assertEquals("The next occurrence must not disappear while reconnecting", 2, db.tasks().all().size)
        } finally { db.close() }
    }
}
