package dev.helm.planner.calendar

import dev.helm.planner.data.remote.ActionRunner
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.QueryRunner
import dev.helm.planner.data.remote.SendResult
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The read-only calendar feed (`docs/calendar.md`): [url] to copy, [webcalUrl] for Apple Calendar and
 * [googleCalendarUrl], Google Calendar's "add by URL" page. The address is a password to read the plan.
 */
data class CalendarFeed(val url: String, val webcalUrl: String, val googleCalendarUrl: String, val createdAt: Long)

sealed interface FeedLoad {
    /** [feed] is null when the feed is off. */
    data class Loaded(val feed: CalendarFeed?) : FeedLoad
    data object Unauthorized : FeedLoad
    data class Failed(val message: String) : FeedLoad
}

/** The app layer's answers about the feed, read without trusting their shape. */
object CalendarFeedJson {
    private const val GOOGLE_PREFIX = "https://calendar.google.com/"

    private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /**
     * The feed in `{url, webcalUrl, googleCalendarUrl, createdAt}`, or null. Each link must have the scheme its use
     * expects, so a wrong answer never opens something else on the phone.
     */
    fun feed(value: JsonElement): CalendarFeed? {
        val o = value as? JsonObject ?: return null
        val url = o.string("url")?.takeIf { it.startsWith("https://") || it.startsWith("http://") } ?: return null
        val webcal = o.string("webcalUrl")?.takeIf { it.startsWith("webcal://") } ?: return null
        val google = o.string("googleCalendarUrl")?.takeIf { it.startsWith(GOOGLE_PREFIX) } ?: return null
        val createdAt = (o["createdAt"] as? JsonPrimitive)?.content?.toDoubleOrNull()?.toLong() ?: 0
        return CalendarFeed(url, webcal, google, createdAt)
    }

    /** `null` (the feed is off) or a feed; anything else is a failure. */
    fun load(value: JsonElement): FeedLoad =
        if (value is JsonNull) FeedLoad.Loaded(null) else feed(value)?.let { FeedLoad.Loaded(it) } ?: FeedLoad.Failed("unexpected answer")
}

/**
 * The feed through the app layer (`app:getCalendarFeed`, `app:createCalendarFeed`, `app:revokeCalendarFeed`),
 * signed in as the paired owner. A new address is drawn in an action, so it needs [actions].
 */
class CalendarFeedApi(
    private val queries: QueryRunner,
    private val mutations: MutationSender,
    private val actions: ActionRunner,
) {
    suspend fun get(): FeedLoad = queries.query(GET, JsonObject(emptyMap())).toLoad()

    /** Turns the feed on (keeping its address), or with [replace] gives it a new address. */
    suspend fun create(replace: Boolean): FeedLoad = when (val result = actions.action(CREATE, buildJsonObject { put("replace", replace) })) {
        is SendResult.Applied -> CalendarFeedJson.feed(result.value)?.let { FeedLoad.Loaded(it) } ?: FeedLoad.Failed("unexpected answer")
        else -> result.toLoad()
    }

    /** True when the feed is off now. */
    suspend fun revoke(): Boolean = when (val result = mutations.send(REVOKE, JsonObject(emptyMap()))) {
        is SendResult.Applied -> (result.value as? JsonObject)?.get("revoked").let { it is JsonPrimitive && it.booleanOrNull != null }
        else -> false
    }

    private fun SendResult.toLoad(): FeedLoad = when (this) {
        is SendResult.Applied -> CalendarFeedJson.load(value)
        SendResult.Unauthorized -> FeedLoad.Unauthorized
        is SendResult.Rejected -> FeedLoad.Failed(message)
        is SendResult.Failed -> FeedLoad.Failed(message)
    }

    companion object {
        const val GET = "app:getCalendarFeed"
        const val CREATE = "app:createCalendarFeed"
        const val REVOKE = "app:revokeCalendarFeed"
    }
}
