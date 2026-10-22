package dev.helm.planner.data.local

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** How list and object fields of a task are stored in Room columns: JSON, as the backend sends them. */
internal object FieldJson {
    private val json = Json { ignoreUnknownKeys = true }
    private val labelList: KSerializer<List<String>> = ListSerializer(String.serializer())
    private val linkList: KSerializer<List<TaskLink>> = ListSerializer(TaskLink.serializer())

    fun encodeLabels(labels: List<String>): String = json.encodeToString(labelList, labels)

    fun decodeLabels(value: String): List<String> = decode(value, labelList) ?: emptyList()

    fun encodeLinks(links: List<TaskLink>): String = json.encodeToString(linkList, links)

    fun decodeLinks(value: String): List<TaskLink> = decode(value, linkList) ?: emptyList()

    fun encodeRepeat(rule: RepeatRule): String = json.encodeToString(RepeatRule.serializer(), rule)

    fun decodeRepeat(value: String): RepeatRule? = decode(value, RepeatRule.serializer())

    private fun <T> decode(value: String, serializer: KSerializer<T>): T? = try {
        json.decodeFromString(serializer, value)
    } catch (_: SerializationException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }
}
