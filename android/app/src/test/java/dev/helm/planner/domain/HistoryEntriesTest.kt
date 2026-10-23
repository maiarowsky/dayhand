package dev.helm.planner.domain

import dev.helm.planner.data.local.TaskEvent
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryEntriesTest {
    private fun event(actor: String, action: String, before: String?, after: String?) =
        TaskEvent(taskServerId = "s1", at = 5, actor = actor, action = action, beforeJson = before, afterJson = after)

    @Test
    fun `an agent's edit lists the changed fields with before and after`() {
        val entry = historyEntry(event("agent", "update", """{"title":"A","dueDate":null}""", """{"title":"B","dueDate":"2026-10-23"}"""))
        assertEquals(Actor.AGENT, entry.actor)
        assertEquals(listOf(HistoryField.TITLE, HistoryField.DUE_DATE), entry.changes.map { it.field })
        assertEquals(JsonPrimitive("B"), entry.changes.first().after)
        assertEquals(JsonNull, entry.changes.last().before)
    }

    @Test
    fun `checklist and reminder changes keep the whole list before and after`() {
        val entry = historyEntry(
            event(
                "cli", "update",
                """{"checklist":[{"id":"c1","title":"Milk","done":false}]}""",
                """{"checklist":[{"id":"c1","title":"Milk","done":true}],"reminders":[{"minutesBefore":15}]}""",
            ),
        )
        assertEquals(listOf(HistoryField.CHECKLIST, HistoryField.REMINDERS), entry.changes.map { it.field })
        assertEquals("true", entry.changes.first().after.toString().substringAfter("\"done\":").substringBefore("}"))
        assertEquals(JsonNull, entry.changes.last().before)
    }

    @Test
    fun `creation shows the fields it set and timestamps are left out`() {
        val entry = historyEntry(event("app", "create", null, """{"title":"A","labels":["home"],"isNow":false,"deletedAt":7}"""))
        assertEquals(Actor.APP, entry.actor)
        assertEquals(listOf(HistoryField.TITLE, HistoryField.LABELS), entry.changes.map { it.field })
    }

    @Test
    fun `changes from the hlm CLI and from unknown sources are never shown as the app's`() {
        assertEquals(Actor.CLI, historyEntry(event("cli", "update", null, null)).actor)
        assertEquals(Actor.AGENT, historyEntry(event("something-new", "update", null, null)).actor)
        assertEquals(Actor.APP, historyEntry(event("app", "update", null, null)).actor)
    }

    @Test
    fun `a trash entry has no field changes and unreadable json is ignored`() {
        assertTrue(historyEntry(event("agent", "delete", """{"deletedAt":null}""", """{"deletedAt":9}""")).changes.isEmpty())
        assertTrue(historyEntry(event("app", "update", "not json", "[1]")).changes.isEmpty())
    }
}
