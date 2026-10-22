package dev.helm.planner.sync

import dev.helm.planner.data.local.Mutations
import dev.helm.planner.data.local.OutboxOp
import dev.helm.planner.data.remote.MutationSender
import dev.helm.planner.data.remote.SendResult
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** A server that, like the backend, applies an operation with a known clientId only once. */
private class FakeServer : MutationSender {
    val tasks = linkedMapOf<String, String>() // server id -> title
    val applied = mutableListOf<String>() // mutation names in the order they took effect
    val received = mutableListOf<String>() // every request, including repeats
    private val seenClientIds = mutableMapOf<String, JsonElement>()
    val script = ArrayDeque<String>() // "fail", "lose", "reject", "unauthorized"; then normal

    override suspend fun send(mutation: String, args: JsonObject): SendResult {
        received += mutation
        when (script.removeFirstOrNull()) {
            "fail" -> return SendResult.Failed("timeout")
            "reject" -> return SendResult.Rejected("invalid_argument")
            "unauthorized" -> return SendResult.Unauthorized
            "lose" -> {
                apply(mutation, args)
                return SendResult.Failed("answer lost")
            }
        }
        return SendResult.Applied(apply(mutation, args))
    }

    private fun apply(mutation: String, args: JsonObject): JsonElement {
        val clientId = args.getValue("clientId").jsonPrimitive.content
        seenClientIds[clientId]?.let { return it }
        applied += mutation
        val result = if (mutation == Mutations.ADD) {
            val id = "srv${tasks.size + 1}"
            tasks[id] = args.getValue("title").jsonPrimitive.content
            buildJsonObject { put("id", id) }
        } else {
            JsonObject(mapOf("id" to (args["taskId"] ?: JsonNull)))
        }
        seenClientIds[clientId] = result
        return result
    }
}

private class FakeStore : OutboxStore {
    val ops = mutableListOf<OutboxOp>()
    val serverIds = mutableMapOf<String, String>()
    val rejected = mutableListOf<String>()
    private var seq = 0L

    fun add(localId: String, title: String) = enqueue(Mutations.ADD, localId, buildJsonObject { put("title", title); put("clientId", localId) })

    fun change(mutation: String, localId: String) =
        enqueue(mutation, localId, buildJsonObject { put("clientId", "op${seq + 1}") })

    private fun enqueue(mutation: String, localId: String, args: JsonObject) {
        seq++
        ops += OutboxOp(seq, "op$seq", mutation, args.toString(), localId, args.getValue("clientId").jsonPrimitive.content, 0)
    }

    override suspend fun next() = ops.firstOrNull()
    override suspend fun serverIdOf(taskLocalId: String) = serverIds[taskLocalId]
    override suspend fun acknowledge(op: OutboxOp, value: JsonElement) {
        ops.remove(op)
        if (op.mutation == Mutations.ADD) serverIds[op.taskLocalId!!] = (value as JsonObject).getValue("id").jsonPrimitive.content
    }
    override suspend fun reject(op: OutboxOp, reason: String) {
        ops.remove(op)
        rejected += op.mutation
        if (op.mutation == Mutations.ADD) ops.removeAll { it.taskLocalId == op.taskLocalId }
    }
    override suspend fun recordFailure(op: OutboxOp, reason: String) {
        ops[ops.indexOf(op)] = op.copy(attempts = op.attempts + 1, lastError = reason)
    }
}

class OutboxProcessorTest {
    private val server = FakeServer()
    private val store = FakeStore()
    private val processor = OutboxProcessor(store, server)

    @Test
    fun `sends changes in the order they were made and empties the queue`() = runTest {
        store.add("a", "First")
        store.change(Mutations.COMPLETE, "a")
        store.add("b", "Second")
        store.change(Mutations.ARCHIVE, "b")

        assertEquals(DrainResult.DONE, processor.drain())
        assertEquals(listOf(Mutations.ADD, Mutations.COMPLETE, Mutations.ADD, Mutations.ARCHIVE), server.applied)
        assertTrue(store.ops.isEmpty())
    }

    @Test
    fun `a change to a task created offline gets the server id from the add before it`() = runTest {
        store.add("local-1", "Offline task")
        store.change(Mutations.RESCHEDULE, "local-1")
        val sent = mutableListOf<JsonObject>()
        val recording = MutationSender { mutation, args -> sent += args; server.send(mutation, args) }

        OutboxProcessor(store, recording).drain()

        assertEquals(JsonPrimitive("srv1"), sent[1]["taskId"])
    }

    @Test
    fun `stops at the first failure so nothing overtakes it, then retries in order`() = runTest {
        store.add("a", "First")
        store.add("b", "Second")
        server.script += "fail"

        assertEquals(DrainResult.RETRY_LATER, processor.drain())
        assertEquals(listOf(Mutations.ADD), server.received)
        assertEquals(2, store.ops.size)
        assertEquals(1, store.ops.first().attempts)

        assertEquals(DrainResult.DONE, processor.drain())
        assertEquals(listOf("First", "Second"), server.tasks.values.toList())
    }

    @Test
    fun `a lost answer is resent and the server applies it once`() = runTest {
        store.add("a", "Buy milk")
        store.change(Mutations.COMPLETE, "a")
        server.script += "lose" // add applied, answer lost

        assertEquals(DrainResult.RETRY_LATER, processor.drain())
        assertEquals(DrainResult.DONE, processor.drain())

        assertEquals(listOf(Mutations.ADD, Mutations.ADD, Mutations.COMPLETE), server.received)
        assertEquals(listOf(Mutations.ADD, Mutations.COMPLETE), server.applied)
        assertEquals(1, server.tasks.size)
        assertEquals("srv1", store.serverIds["a"])
    }

    @Test
    fun `a refused change is dropped and the rest still go out`() = runTest {
        store.add("a", "First")
        store.change(Mutations.COMPLETE, "a")
        store.add("b", "Second")
        server.script += listOf("normal", "reject")

        assertEquals(DrainResult.DONE, processor.drain())
        assertEquals(listOf(Mutations.COMPLETE), store.rejected)
        assertEquals(listOf(Mutations.ADD, Mutations.ADD), server.applied)
    }

    @Test
    fun `changes to a task whose add was refused are dropped too`() = runTest {
        store.add("a", "Too long")
        store.change(Mutations.COMPLETE, "a")
        store.add("b", "Fine")
        server.script += "reject"

        assertEquals(DrainResult.DONE, processor.drain())
        assertEquals(listOf("Fine"), server.tasks.values.toList())
        assertEquals(listOf(Mutations.ADD), server.applied)
    }

    @Test
    fun `an unauthorized answer keeps the change for later`() = runTest {
        store.add("a", "First")
        server.script += "unauthorized"

        assertEquals(DrainResult.UNAUTHORIZED, processor.drain())
        assertEquals(1, store.ops.size)
        assertEquals("unauthorized", store.ops.first().lastError)
    }

    @Test
    fun `a long queue is sent in bounded runs`() = runTest {
        repeat(5) { store.add("t$it", "Task $it") }
        val small = OutboxProcessor(store, server, maxOpsPerRun = 2)

        assertEquals(DrainResult.MORE_LEFT, small.drain())
        assertEquals(DrainResult.MORE_LEFT, small.drain())
        assertEquals(DrainResult.DONE, small.drain())
        assertEquals(5, server.tasks.size)
    }
}
