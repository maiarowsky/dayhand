package dev.helm.planner.data.local

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/** How list and object fields of a task are stored in Room columns: JSON, as the backend sends them. */
internal object FieldJson {
    private val json = Json { ignoreUnknownKeys = true }
    private val stringList: KSerializer<List<String>> = ListSerializer(String.serializer())
    private val linkList: KSerializer<List<TaskLink>> = ListSerializer(TaskLink.serializer())
    private val checklistList: KSerializer<List<ChecklistItem>> = ListSerializer(ChecklistItem.serializer())
    private val reminderList: KSerializer<List<TaskReminder>> = ListSerializer(TaskReminder.serializer())
    private val acceptanceList: KSerializer<List<AcceptanceItem>> = ListSerializer(AcceptanceItem.serializer())

    fun encodeStrings(values: List<String>): String = json.encodeToString(stringList, values)

    fun decodeStrings(value: String): List<String> = decode(value, stringList) ?: emptyList()

    fun encodeLinks(links: List<TaskLink>): String = json.encodeToString(linkList, links)

    fun decodeLinks(value: String): List<TaskLink> = decode(value, linkList) ?: emptyList()

    fun encodeChecklist(items: List<ChecklistItem>): String = json.encodeToString(checklistList, items)

    fun decodeChecklist(value: String): List<ChecklistItem> = decode(value, checklistList) ?: emptyList()

    fun encodeReminders(reminders: List<TaskReminder>): String = json.encodeToString(reminderList, reminders)

    fun decodeReminders(value: String): List<TaskReminder>? = decode(value, reminderList)

    fun encodeAcceptance(items: List<AcceptanceItem>): String = json.encodeToString(acceptanceList, items)

    fun decodeAcceptance(value: String): List<AcceptanceItem> = decode(value, acceptanceList) ?: emptyList()

    fun encodeProof(proof: TaskProof): String = json.encodeToString(TaskProof.serializer(), proof)

    fun decodeProof(value: String): TaskProof? = decode(value, TaskProof.serializer())

    fun encodeRepeat(rule: RepeatRule): String = json.encodeToString(RepeatRule.serializer(), rule)

    fun decodeRepeat(value: String): RepeatRule? = decode(value, RepeatRule.serializer())

    /**
     * Mutation arguments: every field the backend requires is written even when it has its Kotlin default
     * (`interval: 1`, `done: false`), and unset optional fields are left out instead of sent as null.
     */
    private val wire = Json { encodeDefaults = true; explicitNulls = false }

    fun wireRepeat(rule: RepeatRule): JsonElement = wire.encodeToJsonElement(RepeatRule.serializer(), rule)

    fun wireChecklist(items: List<ChecklistItem>): JsonElement = wire.encodeToJsonElement(checklistList, items)

    fun wireReminders(reminders: List<TaskReminder>): JsonArray = wire.encodeToJsonElement(reminderList, reminders) as JsonArray

    private fun <T> decode(value: String, serializer: KSerializer<T>): T? = try {
        json.decodeFromString(serializer, value)
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }
}
