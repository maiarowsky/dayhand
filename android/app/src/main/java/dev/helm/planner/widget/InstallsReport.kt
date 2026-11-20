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

/**
 * One app on one store: all installs up to a published day and the installs on that day ([dayInstalls], null when the
 * file has no valid `value`), or why there is no such number. A missing count is never zero.
 */
sealed interface PlatformCount {
    data class Known(val day: LocalDate, val total: Int, val dayInstalls: Int?) : PlatformCount

    data class Missing(val reason: MissingReason) : PlatformCount
}

enum class MissingReason {
    /** `total` is `null`: the store's reports gave no number. */
    NO_DATA,

    /** The app has no entry for this store in the file. */
    NOT_IN_FILE,

    /** The entry has no `total` field, as files written before the field existed. */
    NO_TOTAL,

    /** The entry is there but malformed (a total without a day, a negative total, text instead of a number). */
    INVALID,
}

data class AppInstalls(val name: String, val counts: Map<Platform, PlatformCount>) {
    fun count(platform: Platform): PlatformCount = counts[platform] ?: PlatformCount.Missing(MissingReason.NOT_IN_FILE)
}

data class InstallsReport(val apps: List<AppInstalls>)

class InvalidInstallsFile(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The installs file the widget reads (docs/android.md#store-installs-widget), schema 1. A broken file as a whole is refused with
 * [InvalidInstallsFile]; one broken entry only marks that count [MissingReason.INVALID]. Unknown fields are ignored.
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
            null, JsonNull -> return PlatformCount.Missing(MissingReason.NOT_IN_FILE)
            is JsonObject -> element
            else -> return PlatformCount.Missing(MissingReason.INVALID)
        }
        val total = when (val field = entry["total"]) {
            null -> return PlatformCount.Missing(MissingReason.NO_TOTAL)
            JsonNull -> return PlatformCount.Missing(MissingReason.NO_DATA)
            else -> field.count() ?: return PlatformCount.Missing(MissingReason.INVALID)
        }
        val day = entry.text("day")?.let(::date) ?: return PlatformCount.Missing(MissingReason.INVALID)
        return PlatformCount.Known(day, total, entry["value"]?.count())
    }

    private fun JsonElement.count(): Int? = (this as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull?.takeIf { it >= 0 }

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun date(text: String): LocalDate? = try {
        LocalDate.parse(text)
    } catch (_: DateTimeParseException) {
        null
    }
}
