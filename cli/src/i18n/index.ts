// The language of dayhand ui: its screens, keys help and status messages.
// Everything else the CLI prints stays English, and so does every contract
// agents and scripts read: --json, field names, error codes and exit codes.
//
// Messages are keyed by name; English (en.ts) is the source and every other
// catalog must have exactly its keys (the type checks that, a test checks the
// {placeholders} and plural forms). A plural message has one form per CLDR
// category of its language, chosen by its {count}.
import { de } from "./de.js";
import { en } from "./en.js";
import { es } from "./es.js";
import { fr } from "./fr.js";
import { ja } from "./ja.js";
import { pl } from "./pl.js";
import { ptBR } from "./pt-BR.js";
import { zhHans } from "./zh-Hans.js";

export const LANGUAGES = ["en", "pl", "de", "es", "fr", "pt-BR", "ja", "zh-Hans"] as const;
export type Language = (typeof LANGUAGES)[number];

export type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | Plural;
export type Key = keyof typeof en;
export type Catalog = Record<Key, Message>;
export type Params = Record<string, string | number>;

export const CATALOGS: Record<Language, Catalog> = { en, pl, de, es, fr, "pt-BR": ptBR, ja, "zh-Hans": zhHans };

let current: Language = "en";

/** The language until setLanguage: English, so tests and every other command read the same text everywhere. */
export const getLanguage = (): Language => current;

export function setLanguage(language: Language): void {
  current = language;
}

/** The message `key` in the current language, with its {placeholders} filled in. */
export const t = (key: Key, params: Params = {}): string => tIn(current, key, params);

/** The message `key` in `language` (`dayhand help ui` stays English whatever the terminal speaks). */
export function tIn(language: Language, key: Key, params: Params = {}): string {
  const message = CATALOGS[language][key];
  const text = typeof message === "string" ? message : pluralForm(language, message, Number(params.count ?? 0));
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

function pluralForm(language: Language, message: Plural, count: number): string {
  return message[new Intl.PluralRules(language).select(count)] ?? message.other;
}

/**
 * The supported language of a locale name or language tag, or undefined:
 * "pl_PL.UTF-8" and "pl" are Polish, any Portuguese is Brazilian, "zh_CN" and
 * "zh-Hans" Simplified Chinese (Traditional Chinese is not), "C" and "POSIX" none.
 */
export function matchLanguage(name: string | undefined): Language | undefined {
  const tag = name?.trim().split(/[.@]/)[0]?.replace(/_/g, "-").toLowerCase();
  if (!tag || tag === "c" || tag === "posix") return undefined;
  const [code, ...rest] = tag.split("-");
  if (code === "pt") return "pt-BR";
  if (code === "zh") {
    const traditional = rest.includes("hant") || (!rest.includes("hans") && rest.some((r) => ["tw", "hk", "mo"].includes(r)));
    return traditional ? undefined : "zh-Hans";
  }
  return LANGUAGES.find((language) => language === code);
}

/**
 * The language for dayhand ui: --lang, then DAYHAND_LANG, then the locale
 * (LC_ALL, LC_MESSAGES, LANG, the first one set), else English. A --lang
 * Dayhand does not speak is an error for the caller; the others fall through.
 */
export function resolveLanguage(flag: string | undefined, env: Readonly<Record<string, string | undefined>>): Language {
  if (flag !== undefined) return matchLanguage(flag) ?? "en";
  const named = matchLanguage(env.DAYHAND_LANG);
  if (named) return named;
  const locale = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find((value) => value && value.trim());
  return matchLanguage(locale) ?? "en";
}
