package dev.helm.planner.widget

import java.time.LocalDate
import java.time.format.DateTimeParseException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

enum class Platform(val key: String) { IOS("ios"), ANDROID("android") }

/** One app on one store: a published day's count, or why there is none. A missing count is never zero. */
sealed interface PlatformCount {
    data class Known(val day: LocalDate, val value: Int, val last7: Int?) : PlatformCount

    data class Missing(val reason: MissingReason) : PlatformCount
}

sealed interface MissingReason {
    /** The generator's own words, such as "Apple has not published the report yet". */
    data class Stated(val note: String) : MissingReason

    data object NotGiven : MissingReason

    /** The app has no entry for this store in the file. */
    data object NotInFile : MissingReason

    /** The entry is there but malformed (a count without a day, a negative count, text instead of a number). */
    data object Invalid : MissingReason
}

data class AppInstalls(val name: String, val counts: Map<Platform, PlatformCount>) {
    fun count(platform: Platform): PlatformCount = counts[platform] ?: PlatformCount.Missing(MissingReason.NotInFile)
}

data class InstallsReport(val apps: List<AppInstalls>)

class InvalidInstallsFile(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The installs file the widget reads (docs/android.md#store-installs-widget), schema 1. A broken file as a whole is refused with
 * [InvalidInstallsFile]; one broken entry only marks that count [MissingReason.Invalid]. Unknown fields are ignored.
 */
object InstallsJson {
    const val SCHEMA = 1

    fun parse(text: String): InstallsReport {
        val root = try {
            Json.parseToJsonElement(text)
        } catch (e: SerializationException) {
            throw InvalidInstallsFile("not JSON", e)
        } as? JsonObject ?: throw InvalidInstallsFile("not a JSON object")
        val schema = (root["schema"] as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull
        if (schema != SCHEMA) throw InvalidInstallsFile("schema ${root["schema"]} is not $SCHEMA")
        val apps = root["apps"] as? JsonArray ?: throw InvalidInstallsFile("no apps")
        return InstallsReport(apps.map(::app))
    }

    private fun app(element: JsonElement): AppInstalls {
        val app = element as? JsonObject ?: throw InvalidInstallsFile("an app is not an object")
        val name = app.text("name")?.trim()?.takeIf { it.isNotEmpty() } ?: throw InvalidInstallsFile("an app has no name")
        return AppInstalls(name, Platform.entries.associateWith { count(app[it.key]) })
    }

    private fun count(element: JsonElement?): PlatformCount {
        val entry = when (element) {
            null, JsonNull -> return PlatformCount.Missing(MissingReason.NotInFile)
            is JsonObject -> element
            else -> return PlatformCount.Missing(MissingReason.Invalid)
        }
        val value = entry["value"]
        if (value == null || value == JsonNull) {
            val note = entry.text("note")?.trim()?.takeIf { it.isNotEmpty() }
            return PlatformCount.Missing(note?.let(MissingReason::Stated) ?: MissingReason.NotGiven)
        }
        val count = value.count() ?: return PlatformCount.Missing(MissingReason.Invalid)
        val day = entry.text("day")?.let(::date) ?: return PlatformCount.Missing(MissingReason.Invalid)
        val last7 = when (val week = entry["last7"]) {
            null, JsonNull -> null
            else -> week.count() ?: return PlatformCount.Missing(MissingReason.Invalid)
        }
        return PlatformCount.Known(day, count, last7)
    }

    private fun JsonElement.count(): Int? = (this as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull?.takeIf { it >= 0 }

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun date(text: String): LocalDate? = try {
        LocalDate.parse(text)
    } catch (_: DateTimeParseException) {
        null
    }
}
