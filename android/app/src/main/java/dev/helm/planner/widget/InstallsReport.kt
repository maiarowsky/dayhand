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
 * One number of one app on one store, as of its published day: all installs up to that day (`total`) or the installs on
 * that day (`value`), or why there is no such number. A missing count is never zero.
 */
sealed interface PlatformCount {
    data class Known(val day: LocalDate, val count: Int) : PlatformCount

    data class Missing(val reason: MissingReason) : PlatformCount
}

enum class MissingReason {
    /** The field is `null`: the store's reports gave no number. */
    NO_DATA,

    /** The app has no entry for this store in the file. */
    NOT_IN_FILE,

    /** The entry has no such field, as files written before `total` existed. */
    NO_FIELD,

    /** The entry is there but malformed (a number without a day, a negative number, text instead of a number). */
    INVALID,
}

/** One app's all-time installs per store ([totals], from `total`) and its installs on each store's day ([dayCounts], from `value`). */
data class AppInstalls(
    val name: String,
    val totals: Map<Platform, PlatformCount>,
    val dayCounts: Map<Platform, PlatformCount>,
) {
    fun total(platform: Platform): PlatformCount = totals[platform] ?: PlatformCount.Missing(MissingReason.NOT_IN_FILE)

    fun dayCount(platform: Platform): PlatformCount = dayCounts[platform] ?: PlatformCount.Missing(MissingReason.NOT_IN_FILE)
}

data class InstallsReport(val apps: List<AppInstalls>)

class InvalidInstallsFile(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The installs file the widget reads (docs/android.md#store-installs-widget), schema 1. A broken file as a whole is refused with
 * [InvalidInstallsFile]; one broken number only marks that count [MissingReason.INVALID]. Unknown fields are ignored.
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
        return AppInstalls(
            name,
            totals = Platform.entries.associateWith { count(app[it.key], "total") },
            dayCounts = Platform.entries.associateWith { count(app[it.key], "value") },
        )
    }

    private fun count(element: JsonElement?, key: String): PlatformCount {
        val entry = when (element) {
            null, JsonNull -> return PlatformCount.Missing(MissingReason.NOT_IN_FILE)
            is JsonObject -> element
            else -> return PlatformCount.Missing(MissingReason.INVALID)
        }
        val count = when (val field = entry[key]) {
            null -> return PlatformCount.Missing(MissingReason.NO_FIELD)
            JsonNull -> return PlatformCount.Missing(MissingReason.NO_DATA)
            else -> field.count() ?: return PlatformCount.Missing(MissingReason.INVALID)
        }
        val day = entry.text("day")?.let(::date) ?: return PlatformCount.Missing(MissingReason.INVALID)
        return PlatformCount.Known(day, count)
    }

    private fun JsonElement.count(): Int? = (this as? JsonPrimitive)?.takeUnless { it.isString }?.intOrNull?.takeIf { it >= 0 }

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun date(text: String): LocalDate? = try {
        LocalDate.parse(text)
    } catch (_: DateTimeParseException) {
        null
    }
}
