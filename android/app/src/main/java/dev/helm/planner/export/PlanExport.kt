package dev.helm.planner.export

import dev.helm.planner.data.remote.HttpTaskRemote
import dev.helm.planner.data.remote.SendResult
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The two export formats of the plan (`app:exportPlan`): Markdown to read, JSON as a full copy. */
enum class ExportFormat(val wire: String, val mimeType: String, val extension: String) {
    MARKDOWN("markdown", "text/markdown", "md"),
    JSON("json", "application/json", "json"),
}

sealed interface ExportResult {
    data class Ready(val format: ExportFormat, val fileName: String, val content: String) : ExportResult
    data object Unauthorized : ExportResult
    data class Failed(val message: String) : ExportResult
}

/**
 * Asks the server for the whole plan. The export is made on the server because only the
 * server has the full history of changes that the JSON copy carries.
 */
class PlanExporter(private val remote: HttpTaskRemote) {
    suspend fun export(format: ExportFormat, at: Long, today: String): ExportResult =
        when (val result = remote.exportPlan(format.wire, at)) {
            is SendResult.Applied -> PlanExport.content(format, result.value)
                ?.let { ExportResult.Ready(format, PlanExport.fileName(format, today), it) }
                ?: ExportResult.Failed("unexpected answer")
            SendResult.Unauthorized -> ExportResult.Unauthorized
            is SendResult.Rejected -> ExportResult.Failed(result.message)
            is SendResult.Failed -> ExportResult.Failed(result.message)
        }
}

object PlanExport {
    private val pretty = Json { prettyPrint = true }

    /** `helm-plan-2026-10-22.md`: the name offered in the system save dialog. */
    fun fileName(format: ExportFormat, today: String) = "helm-plan-$today.${format.extension}"

    /** The file content from the answer `{format, content}`: the Markdown text, or the JSON copy indented. */
    fun content(format: ExportFormat, value: JsonElement): String? {
        val content = (value as? JsonObject)?.get("content") ?: return null
        return when (format) {
            ExportFormat.MARKDOWN -> (content as? JsonPrimitive)?.takeIf { it.isString }?.content
            ExportFormat.JSON -> (content as? JsonObject)?.let { pretty.encodeToString(JsonElement.serializer(), it) + "\n" }
        }
    }
}
