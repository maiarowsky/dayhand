// The language of dayhand ui: every catalog has English's keys, the same
// {placeholders} and the plural forms its language needs; the language comes
// from --lang, DAYHAND_LANG or the locale; days, repeats and reminders read
// naturally in each language while English stays exactly as before.
import { afterEach, describe, expect, test } from "vitest";
import { reminderText, relativeDay, repeatText } from "../src/i18n/dates.js";
import { CATALOGS, LANGUAGES, matchLanguage, resolveLanguage, setLanguage, t, tIn, type Key, type Message } from "../src/i18n/index.js";
import type { Repeat } from "../src/render/model.js";

const en = CATALOGS.en;
const forms = (message: Message): string[] => (typeof message === "string" ? [message] : Object.values(message));
const placeholders = (message: Message) => new Set(forms(message).flatMap((form) => [...form.matchAll(/\{(\w+)\}/g)].map((m) => m[1])));

/** The categories whole numbers can select: French and Spanish "many" is only for millions, so it may fall back to other. */
function integerCategories(language: string): Set<string> {
  const rules = new Intl.PluralRules(language);
  return new Set(Array.from({ length: 1001 }, (_, n) => rules.select(n)));
}

afterEach(() => setLanguage("en"));

describe("catalogs", () => {
  test.each(LANGUAGES.filter((language) => language !== "en"))("%s has exactly English's keys, placeholders and plurals", (language) => {
    const catalog = CATALOGS[language];
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
    const needed = integerCategories(language);
    const allowed = new Set(new Intl.PluralRules(language).resolvedOptions().pluralCategories);
    for (const key of Object.keys(en) as Key[]) {
      const source = en[key];
      const message = catalog[key];
      expect(placeholders(message), key).toEqual(placeholders(source));
      if (typeof source === "string") {
        expect(typeof message, key).toBe("string");
        continue;
      }
      expect(typeof message, key).toBe("object");
      const categories = Object.keys(message);
      for (const category of needed) expect(categories, `${key} needs ${category}`).toContain(category);
      for (const category of categories) expect(allowed.has(category as Intl.LDMLPluralRule), `${key} has no ${category} in ${language}`).toBe(true);
      expect(forms(message).join(" "), key).not.toBe("");
    }
  });

  test("no message is left in English by mistake, and Dayhand and its commands stay untranslated", () => {
    const sameAsEnglish = (language: (typeof LANGUAGES)[number]) =>
      (Object.keys(en) as Key[]).filter((key) => typeof en[key] === "string" && en[key] === CATALOGS[language][key] && /[a-z]{4}/i.test(en[key] as string));
    // A handful are the same word in a language ("Filter", "status", "links", "offline"); the rest must differ.
    for (const language of LANGUAGES.filter((l) => l !== "en")) expect(sameAsEnglish(language).length, `${language}: ${sameAsEnglish(language).join(", ")}`).toBeLessThan(8);
    for (const language of LANGUAGES) expect(tIn(language, "conn.login")).toContain("dayhand login");
  });

  test.each([
    ["en", "Agents", "Decision recorded: Deploy now", "Blocked: 3"],
    ["pl", "Agenci", "Zapisano decyzję: Deploy now", "Zablokowane: 3"],
    ["de", "Agenten", "Entscheidung gespeichert: Deploy now", "Blockiert: 3"],
    ["es", "Agentes", "Decisión guardada: Deploy now", "Bloqueadas: 3"],
    ["fr", "Agents", "Décision enregistrée : Deploy now", "Bloquées : 3"],
    ["pt-BR", "Agentes", "Decisão salva: Deploy now", "Bloqueadas: 3"],
    ["ja", "エージェント", "判断を保存しました：Deploy now", "ブロック中：3"],
    ["zh-Hans", "代理", "已保存决定：Deploy now", "已阻塞：3"],
  ] as const)("%s localizes agent views, decisions and health while preserving the chosen label", (language, view, decision, health) => {
    expect(tIn(language, "view.agents")).toBe(view);
    expect(tIn(language, "done.decided", { label: "Deploy now" })).toBe(decision);
    expect(tIn(language, "health.blocked", { count: 3 })).toBe(health);
  });

  test.each(LANGUAGES)("%s task hints advertise the letter x, not a space symbol", (language) => {
    for (const key of ["hints.today", "hints.board", "hints.week", "hints.detail"] as const) {
      const hint = tIn(language, key);
      expect(hint, key).toContain("  x ");
      expect(hint, key).not.toContain("␣");
    }
  });

  test("plurals follow each language's rules", () => {
    expect([1, 2, 5, 22, 25].map((count) => tIn("pl", "week.tasks", { count }))).toEqual([" · 1 zadanie", " · 2 zadania", " · 5 zadań", " · 22 zadania", " · 25 zadań"]);
    expect([1, 2].map((count) => tIn("de", "remind.days", { count }))).toEqual(["1 Tag vorher", "2 Tage vorher"]);
    expect([1, 3].map((count) => tIn("ja", "week.tasks", { count }))).toEqual([" · 1件", " · 3件"]);
    expect(tIn("en", "heading.trash", { count: 1 })).toBe("Trash · 1 task · purged 30 days after they were deleted");
    expect(tIn("fr", "repeat.times", { count: 1 })).toBe("dernière fois");
  });

  test("t follows setLanguage; an unknown placeholder stays visible", () => {
    expect(t("view.today")).toBe("Today");
    setLanguage("zh-Hans");
    expect(t("view.today")).toBe("今天");
    expect(t("conn.since")).toBe(" · 数据来自 {time}");
  });
});

describe("choosing the language", () => {
  test("locale names and language tags", () => {
    expect(["pl_PL.UTF-8", "de_AT", "es-MX", "fr_CA.UTF-8@euro", "pt_PT", "pt-BR", "ja_JP.eucJP", "zh_CN.UTF-8", "zh-Hans-TW", "en_GB"].map(matchLanguage)).toEqual([
      "pl", "de", "es", "fr", "pt-BR", "pt-BR", "ja", "zh-Hans", "zh-Hans", "en",
    ]);
    expect(["C", "C.UTF-8", "POSIX", "zh_TW", "zh-Hant", "it_IT", "", undefined].map(matchLanguage)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  test("--lang, then DAYHAND_LANG, then LC_ALL, LC_MESSAGES and LANG, else English", () => {
    const env = { LANG: "de_DE.UTF-8", LC_MESSAGES: "fr_FR.UTF-8", LC_ALL: "ja_JP.UTF-8", DAYHAND_LANG: "pl" };
    expect(resolveLanguage("es", env)).toBe("es");
    expect(resolveLanguage(undefined, env)).toBe("pl");
    expect(resolveLanguage(undefined, { ...env, DAYHAND_LANG: undefined })).toBe("ja");
    expect(resolveLanguage(undefined, { ...env, DAYHAND_LANG: "", LC_ALL: "" })).toBe("fr");
    expect(resolveLanguage(undefined, { LANG: "pt_BR.UTF-8" })).toBe("pt-BR");
    expect(resolveLanguage(undefined, { LC_ALL: "C.UTF-8", LANG: "pl_PL.UTF-8" })).toBe("en");
    expect(resolveLanguage(undefined, { DAYHAND_LANG: "klingon", LANG: "zh_CN.UTF-8" })).toBe("zh-Hans");
    expect(resolveLanguage(undefined, {})).toBe("en");
  });
});

describe("days, repeats and reminders", () => {
  const weekly: Repeat = { every: "week", interval: 2, weekdays: [1, 4], from: "due" };

  test("English reads exactly as the rest of the CLI", () => {
    expect(relativeDay("2026-10-24", "2026-10-23")).toBe("tomorrow");
    expect(repeatText(weekly)).toBe("every 2 weeks on Mon, Thu");
    expect(reminderText({ minutesBefore: 15 })).toBe("15 min before");
  });

  test("other languages", () => {
    setLanguage("pl");
    expect(relativeDay("2026-10-22", "2026-10-23")).toBe("wczoraj");
    expect(relativeDay("2026-10-30", "2026-10-23")).toBe("pt., 30 paź");
    expect(repeatText(weekly)).toBe("co 2 tygodnie, w dni: pon., czw.");
    expect(repeatText({ every: "month", interval: 1, weekdayOfMonth: { nth: -1, weekday: 5 }, from: "due" })).toBe("co miesiąc, ostatni dzień tygodnia: pt.");
    expect(reminderText({ minutesBefore: 2880 })).toBe("2 dni wcześniej");
    expect(reminderText({ time: "18:00", daysBefore: 1 })).toBe("18:00, 1 dzień wcześniej");
    setLanguage("ja");
    expect(repeatText(weekly)).toBe("2週間ごと、月、木");
    expect(reminderText({ minutesBefore: 0 })).toBe("期限の時刻");
    setLanguage("de");
    expect(repeatText({ every: "day", interval: 1, from: "completion", count: 3 })).toBe("jeden Tag, ab Erledigung, 3-mal");
  });
});
