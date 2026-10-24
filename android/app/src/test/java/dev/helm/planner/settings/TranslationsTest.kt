package dev.helm.planner.settings

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/**
 * Every language of the picker has every English string and nothing more, with the same format placeholders, the
 * plural forms its grammar has (CLDR) and the product and command names left as they are.
 */
class TranslationsTest {
    private val res = listOf(File("src/main/res"), File("app/src/main/res")).first { it.isDirectory }

    /** The resource folder of a language, as Android resolves its tag. */
    private fun folder(language: AppLanguage): String = when (val tag = language.tag) {
        null, "en" -> "values"
        else -> "values-" + tag.replace("-", "-r")
    }

    /** CLDR plural categories of each translation. */
    private val plurals = mapOf(
        AppLanguage.POLISH to setOf("one", "few", "many", "other"),
        AppLanguage.GERMAN to setOf("one", "other"),
        AppLanguage.SPANISH to setOf("one", "many", "other"),
        AppLanguage.FRENCH to setOf("one", "many", "other"),
        AppLanguage.PORTUGUESE_BRAZIL to setOf("one", "many", "other"),
        AppLanguage.JAPANESE to setOf("other"),
        AppLanguage.CHINESE_SIMPLIFIED to setOf("other"),
    )
    private val translations = AppLanguage.entries.filter { it != AppLanguage.SYSTEM && it != AppLanguage.ENGLISH }

    private sealed interface Entry
    private data class Text(val value: String) : Entry
    private data class Plural(val items: Map<String, String>) : Entry
    private data class Items(val items: List<String>) : Entry

    /** The translatable strings of a resource folder, by name, in file order. */
    private fun strings(dir: String): Map<String, Entry> {
        val files = File(res, dir).listFiles { f -> f.name.startsWith("strings") && f.extension == "xml" }.orEmpty().sortedBy { it.name }
        val out = LinkedHashMap<String, Entry>()
        for (file in files) {
            val root = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(file).documentElement
            val nodes = root.childNodes
            for (i in 0 until nodes.length) {
                val e = nodes.item(i) as? Element ?: continue
                if (e.getAttribute("translatable") == "false") continue
                val children = (0 until e.childNodes.length).mapNotNull { e.childNodes.item(it) as? Element }
                val entry = when (e.tagName) {
                    "string" -> Text(e.textContent)
                    "plurals" -> Plural(children.associate { it.getAttribute("quantity") to it.textContent })
                    "string-array" -> Items(children.map { it.textContent })
                    else -> continue
                }
                assertTrue("$dir: ${e.getAttribute("name")} is defined twice", out.put(e.getAttribute("name"), entry) == null)
            }
        }
        return out
    }

    private val english = strings("values")

    private fun placeholders(s: String): List<String> = Regex("""%(\d+\$)?[sdf]""").findAll(s).map { it.value }.sorted().toList()

    @Test
    fun everyLanguageHasAFolderAndEveryFolderALanguage() {
        val folders = File(res, ".").listFiles { f -> f.isDirectory && File(f, "strings.xml").exists() }.orEmpty().map { it.name }.toSet()
        assertEquals(AppLanguage.entries.map(::folder).toSet(), folders)
        assertEquals("unqualifiedResLocale=en", File(res, "resources.properties").readText().trim())
    }

    @Test
    fun noLanguageMissesOrAddsAString() {
        translations.forEach { language ->
            val names = strings(folder(language)).keys
            assertEquals("${language.name}: missing", emptySet<String>(), english.keys - names)
            assertEquals("${language.name}: not in English", emptySet<String>(), names - english.keys)
        }
    }

    @Test
    fun placeholdersMatchEnglish() {
        translations.forEach { language ->
            strings(folder(language)).forEach { (name, entry) ->
                val source = english.getValue(name)
                val where = "${language.name}: $name"
                when (entry) {
                    is Text -> assertEquals(where, placeholders((source as Text).value), placeholders(entry.value))
                    is Plural -> entry.items.forEach { (quantity, text) ->
                        val other = placeholders((source as Plural).items.getValue("other"))
                        // A form for exactly one may leave the number out, where English does ("Every day").
                        val allowed = setOf(other) + listOfNotNull(source.items["one"]?.takeIf { quantity == "one" }?.let(::placeholders))
                        assertTrue("$where[$quantity]: ${placeholders(text)} not in $allowed", placeholders(text) in allowed)
                    }
                    is Items -> assertEquals(where, (source as Items).items.size, entry.items.size)
                }
                assertEquals("$where is a ${entry::class.simpleName}", source::class, entry::class)
            }
        }
    }

    @Test
    fun pluralsHaveTheFormsOfTheirLanguage() {
        english.values.filterIsInstance<Plural>().forEach { assertEquals(setOf("one", "other"), it.items.keys) }
        translations.forEach { language ->
            strings(folder(language)).forEach { (name, entry) ->
                if (entry is Plural) assertEquals("${language.name}: $name", plurals.getValue(language), entry.items.keys)
            }
        }
    }

    @Test
    fun productAndCommandNamesStayAsTheyAre() {
        // The example server's name may be translated ("https://nazwa.convex.site"), its scheme not.
        val fixed = Regex("""Dayhand|dayhand [a-z]+( set)?|https?://|\.convex\.site|[A-Z0-9]{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})?""")
        translations.forEach { language ->
            strings(folder(language)).forEach { (name, entry) ->
                val text = (entry as? Text)?.value ?: return@forEach
                fixed.findAll((english.getValue(name) as Text).value).forEach {
                    assertTrue("${language.name}: $name lost “${it.value}”: $text", it.value in text)
                }
            }
        }
    }

    @Test
    fun eachLanguageSaysTheMainScreensInItsOwnWords() {
        val keys = listOf("today_title", "add_task", "settings_title", "calendar_title", "board_title")
        val seen = mutableSetOf<List<String>>()
        AppLanguage.entries.filter { it != AppLanguage.SYSTEM }.forEach { language ->
            val words = strings(folder(language)).let { s -> keys.map { (s.getValue(it) as Text).value } }
            assertTrue("${language.name} repeats another language: $words", seen.add(words))
            if (language != AppLanguage.ENGLISH) {
                assertNotEquals(language.name, (english.getValue("today_title") as Text).value, words.first())
            }
        }
    }
}
