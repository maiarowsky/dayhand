package dev.helm.planner.domain

import dev.helm.planner.data.local.Task
import dev.helm.planner.data.local.TaskStatus
import dev.helm.planner.domain.Threads.Field
import dev.helm.planner.domain.Threads.Group
import org.junit.Assert.*
import org.junit.Test

class ThreadsTest {
    private fun task(id: String, title: String, note: String? = null, labels: List<String> = listOf("wątek"), updatedAt: Long = 0) =
        Task(id, title = title, note = note, labels = labels, createdAt = 0, updatedAt = updatedAt)

    private val fourLines = """
        Stan teraz: Czekamy na odpowiedź drukarni. Potem wysyłka.
        Co zrobiono: Wysłano pliki do druku.
        Co od Ciebie: Zatwierdź kolory na próbce.
        Jak sprawdzić: Otwórz https://example.com/proof.pdf, strona 2.
    """.trimIndent()

    @Test fun titlePrefixesAreRemovedInAnyCaseAndOrder() {
        assertEquals("Ulotki dla piekarni", Threads.topic("Wątek: Ulotki dla piekarni"))
        assertEquals("Ulotki dla piekarni", Threads.topic("DO POTWIERDZENIA: Ulotki dla piekarni"))
        assertEquals("Ulotki", Threads.topic("  do potwierdzenia:   Wątek:Ulotki "))
        assertEquals("Ulotki", Threads.topic("WĄTEK: Ulotki"))
        // Decomposed "ą" (a + combining ogonek), as some keyboards send it.
        assertEquals("Ulotki", Threads.topic("Wątek: Ulotki"))
        assertEquals("Ulotki bez prefiksu", Threads.topic("Ulotki bez prefiksu"))
        assertEquals("Wątek:", Threads.topic("Wątek:"))
        assertTrue(Threads.toConfirm("DO POTWIERDZENIA: x"))
        assertTrue(Threads.toConfirm(" Do potwierdzenia: x"))
        assertFalse(Threads.toConfirm("Wątek: DO POTWIERDZENIA później"))
    }

    @Test fun theFourLinesBecomeSections() {
        val note = Threads.parseNote(fourLines)!!
        assertNull(note.intro)
        assertEquals(listOf(Field.STATE, Field.DONE, Field.ASK, Field.CHECK), note.fields.keys.toList())
        assertEquals("Czekamy na odpowiedź drukarni. Potem wysyłka.", note[Field.STATE])
        assertEquals("Zatwierdź kolory na próbce.", note[Field.ASK])
        assertEquals("Otwórz https://example.com/proof.pdf, strona 2.", note[Field.CHECK])
    }

    @Test fun missingLinesAreAbsentAndEmptyLinesAreEmpty() {
        val note = Threads.parseNote("Stan teraz: W toku\nCo od Ciebie:\n")!!
        assertEquals("W toku", note[Field.STATE])
        assertEquals("", note[Field.ASK])
        assertNull(note[Field.DONE])
        assertNull(note[Field.CHECK])
        assertFalse(Threads.asksOwner(note))
    }

    @Test fun polishLettersAndCaseAreMatched() {
        val note = Threads.parseNote("STAN TERAZ: gotowe\nJAK SPRAWDZIĆ: zajrzyj\njak sprawdzić: i tutaj\nPODSUMOWANIE: Zrobione.")!!
        assertEquals("gotowe", note[Field.STATE])
        assertEquals("zajrzyj\ni tutaj", note[Field.CHECK])
        assertEquals("Zrobione.", note[Field.SUMMARY])
        // NFD "ć" in the key.
        assertEquals("ok", Threads.parseNote("Jak sprawdzić: ok")!![Field.CHECK])
    }

    @Test fun multiLineValuesListMarkersAndBoldKeepTheirText() {
        val note = Threads.parseNote("""
            Wstęp od asystenta.
            - **Stan teraz:** Pierwsza linia.
              druga linia
            **Co zrobiono**: punkt 1

            punkt 2
            Podsumowanie: Jedno. Dwa. Trzy.
        """.trimIndent())!!
        assertEquals("Wstęp od asystenta.", note.intro)
        assertEquals("Pierwsza linia.\n  druga linia", note[Field.STATE])
        assertEquals("punkt 1\n\npunkt 2", note[Field.DONE])
        assertEquals("Jedno. Dwa. Trzy.", note[Field.SUMMARY])
    }

    @Test fun aNoteWithoutTheFormatIsNotParsed() {
        assertNull(Threads.parseNote("Zwykła notatka bez sekcji.\nStan: nie ten klucz"))
        assertNull(Threads.parseNote("W notatce jest Stan teraz: ale nie na początku linii"))
        assertNull(Threads.parseNote(""))
        assertNull(Threads.parseNote(null))
        val thread = Threads.thread(task("a", "Wątek: Coś", "Luźny tekst. Dalej."))
        assertNull(thread.note)
        assertEquals(Group.IN_PROGRESS, thread.group)
        assertEquals("Luźny tekst.", thread.headline)
    }

    @Test fun askLineDecidesWaitingUnlessItSaysNothing() {
        assertEquals(Group.WAITING, Threads.thread(task("a", "Wątek: A", fourLines)).group)
        listOf("nic", "Nic, wszystko po mojej stronie.", "NIC", " — ", "-").forEach {
            assertEquals(it, Group.IN_PROGRESS, Threads.thread(task("a", "Wątek: A", "Stan teraz: x\nCo od Ciebie: $it")).group)
        }
        assertEquals(Group.IN_PROGRESS, Threads.thread(task("a", "Wątek: A", "Stan teraz: x")).group)
        // The title wins: a finished thread is to confirm even when it still asks for something.
        assertEquals(Group.TO_CONFIRM, Threads.thread(task("a", "DO POTWIERDZENIA: A", fourLines)).group)
    }

    @Test fun headlineIsTheFirstSentenceOfStateOrSummary() {
        assertEquals("Czekamy na odpowiedź drukarni.", Threads.thread(task("a", "Wątek: A", fourLines)).headline)
        val done = Threads.thread(task("a", "DO POTWIERDZENIA: A", "$fourLines\nPodsumowanie: Ulotki wydrukowane! Odbiór jutro."))
        assertEquals("Ulotki wydrukowane!", done.headline)
        assertEquals("Czekamy na odpowiedź drukarni.", Threads.thread(task("a", "DO POTWIERDZENIA: A", fourLines)).headline)
        assertEquals("Zobacz https://example.com/a.b i dalej", Threads.firstSentence("Zobacz https://example.com/a.b i dalej\nnowa linia"))
        assertNull(Threads.firstSentence("  \n "))
    }

    @Test fun groupsKeepOnlyOpenLabelledTasksInOrderLatestFirst() {
        val tasks = listOf(
            task("progress", "Wątek: C", "Stan teraz: x\nCo od Ciebie: nic", updatedAt = 5),
            task("wait-old", "Wątek: B", fourLines, updatedAt = 1),
            task("wait-new", "Wątek: B2", fourLines, updatedAt = 9),
            task("confirm", "DO POTWIERDZENIA: A", fourLines, labels = listOf("Wątek"), updatedAt = 2),
            task("other", "Wątek: not a thread", fourLines, labels = listOf("praca")),
            task("done", "DO POTWIERDZENIA: D", fourLines).copy(status = TaskStatus.DONE),
            task("trash", "Wątek: E", fourLines).copy(deletedAt = 1),
            task("archived", "Wątek: F", fourLines).copy(archivedAt = 1),
        )
        val groups = Threads.groups(tasks)
        assertEquals(listOf("confirm"), groups.toConfirm.map { it.task.localId })
        assertEquals(listOf("wait-new", "wait-old"), groups.waiting.map { it.task.localId })
        assertEquals(listOf("progress"), groups.inProgress.map { it.task.localId })
        assertEquals(3, groups.attention)
        assertTrue(Threads.groups(listOf(tasks[4])).isEmpty())
    }

    @Test fun linksStopBeforeSentencePunctuationAndClosingBrackets() {
        fun found(text: String) = Threads.links(text).map { text.substring(it) }
        assertEquals(listOf("https://example.com/proof.pdf"), found("Otwórz https://example.com/proof.pdf, strona 2."))
        assertEquals(listOf("https://example.com/x"), found("[raport](https://example.com/x)."))
        assertEquals(listOf("https://en.wikipedia.org/wiki/Foo_(bar)"), found("Zob. https://en.wikipedia.org/wiki/Foo_(bar)"))
        assertEquals(listOf("http://a.example", "https://b.example/ścieżka?q=1"), found("http://a.example i https://b.example/ścieżka?q=1"))
        assertEquals(emptyList<String>(), found("bez linków, ftp://nie"))
    }

    @Test fun ageRoundsDown() {
        val minute = 60_000L
        assertEquals(Threads.Age.Now, Threads.age(0, 59_000))
        assertEquals(Threads.Age.Now, Threads.age(10 * minute, 0))
        assertEquals(Threads.Age.Minutes(59), Threads.age(0, 59 * minute + 59_000))
        assertEquals(Threads.Age.Hours(23), Threads.age(0, 24 * 60 * minute - 1))
        assertEquals(Threads.Age.Days(2), Threads.age(0, 2 * 24 * 60 * minute))
    }
}
