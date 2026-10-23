package dev.helm.planner.data.local

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What the phone stores in Room and what it sends to the server for repeat rules, checklists and reminders. */
class FieldJsonTest {
    private fun json(text: String) = Json.parseToJsonElement(text)

    @Test
    fun `a rule sent to the server keeps interval 1 and leaves unset fields out`() {
        // Plain Json drops values equal to their defaults, and the server requires interval.
        assertEquals(json("""{"every":"day","interval":1}"""), FieldJson.wireRepeat(RepeatRule(RepeatEvery.DAY)))
        val rule = RepeatRule(RepeatEvery.MONTH, 2, from = RepeatFrom.COMPLETION, weekdayOfMonth = WeekdayOfMonth(-1, 5), count = 4)
        assertEquals(
            json("""{"every":"month","interval":2,"from":"completion","weekdayOfMonth":{"nth":-1,"weekday":5},"count":4}"""),
            FieldJson.wireRepeat(rule),
        )
    }

    @Test
    fun `checklists and reminders are sent whole, with every item's state`() {
        assertEquals(
            json("""[{"id":"c1","title":"Milk","done":false},{"id":"c2","title":"Bread","done":true}]"""),
            FieldJson.wireChecklist(listOf(ChecklistItem("c1", "Milk"), ChecklistItem("c2", "Bread", done = true))),
        )
        assertEquals(
            json("""[{"minutesBefore":0},{"time":"18:00","daysBefore":1},{"time":"09:00"}]"""),
            FieldJson.wireReminders(listOf(TaskReminder.before(0), TaskReminder.at("18:00", 1), TaskReminder.at("09:00"))),
        )
    }

    @Test
    fun `stored values read back the same, and a broken one is not a crash`() {
        val rule = RepeatRule(RepeatEvery.MONTH, monthDay = -1, until = "2027-01-01")
        assertEquals(rule, FieldJson.decodeRepeat(FieldJson.encodeRepeat(rule)))
        val items = listOf(ChecklistItem("c1", "Milk", done = true))
        assertEquals(items, FieldJson.decodeChecklist(FieldJson.encodeChecklist(items)))
        val reminders = listOf(TaskReminder.at("18:00", 2))
        assertEquals(reminders, FieldJson.decodeReminders(FieldJson.encodeReminders(reminders)))
        assertEquals(emptyList<ChecklistItem>(), FieldJson.decodeChecklist("not json"))
        assertNull(FieldJson.decodeReminders("not json"))
        // A rule stored by 0.5 (before the new fields) still reads.
        assertEquals(RepeatRule(RepeatEvery.WEEK, 2, listOf(1)), FieldJson.decodeRepeat("""{"every":"week","interval":2,"weekdays":[1]}"""))
    }
}
