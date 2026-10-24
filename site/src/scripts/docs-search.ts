// The documentation menu and search. Without this script the menu is a plain <details> and the search box
// is hidden by CSS. The index (/docs/search-index.json, written by the build) is fetched the first time
// someone uses the search box.

const INDEX_URL = "/docs/search-index.json";
const NARROW = window.matchMedia("(width < 60rem)");
const MAX_RESULTS = 12;
const SNIPPET_CHARS = 140;
const MIN_QUERY_CHARS = 2;

interface Entry {
  /** Section title, page title, address and text, as the index stores them. */
  t: string;
  p: string;
  u: string;
  x: string;
}

interface Searchable extends Entry {
  title: string;
  page: string;
  text: string;
}

let index: Promise<Searchable[]> | null = null;

function loadIndex(): Promise<Searchable[]> {
  index ??= fetch(INDEX_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`search index: HTTP ${response.status}`);
      return response.json() as Promise<Entry[]>;
    })
    .then((entries) =>
      entries.map((entry) => ({ ...entry, title: entry.t.toLowerCase(), page: entry.p.toLowerCase(), text: entry.x.toLowerCase() })),
    )
    .catch((error: unknown) => {
      index = null;
      throw error;
    });
  return index;
}

/** Every word must appear somewhere; a word in the section title counts most, then the page title. */
function score(entry: Searchable, words: string[]): number {
  let total = 0;
  for (const word of words) {
    const inTitle = entry.title.includes(word);
    const inPage = entry.page.includes(word);
    const inText = entry.text.includes(word);
    if (!inTitle && !inPage && !inText) return 0;
    total += (inTitle ? 10 : 0) + (inPage ? 3 : 0) + (inText ? 1 : 0);
  }
  return total;
}

function snippet(entry: Searchable, words: string[]): string {
  const at = words.map((word) => entry.text.indexOf(word)).find((n) => n >= 0) ?? 0;
  const start = Math.max(0, at - SNIPPET_CHARS / 4);
  const text = entry.x.slice(start, start + SNIPPET_CHARS).replace(/^[\s.,;:)]+/, "").trim();
  return `${start > 0 ? "…" : ""}${text}${start + SNIPPET_CHARS < entry.x.length ? "…" : ""}`;
}

function result(entry: Searchable, words: string[]): HTMLLIElement {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.href = entry.u;
  link.textContent = entry.t === entry.p ? entry.t : `${entry.t} · ${entry.p}`;
  const text = document.createElement("p");
  text.textContent = snippet(entry, words);
  item.append(link, text);
  return item;
}

/** Beside the page the menu is always open; on narrow screens it stays as the reader leaves it. */
function setUpMenu(): void {
  const menu = document.querySelector<HTMLDetailsElement>(".docs-menu");
  if (!menu) return;
  const openWhenWide = () => {
    if (!NARROW.matches) menu.open = true;
  };
  openWhenWide();
  NARROW.addEventListener("change", openWhenWide);
}

function setUpSearch(): void {
  const input = document.querySelector<HTMLInputElement>("#docs-search-input");
  const status = document.querySelector<HTMLElement>("#docs-search-status");
  const list = document.querySelector<HTMLOListElement>("#docs-search-results");
  if (!input || !status || !list) return;

  let latest = 0;
  const update = async () => {
    const query = input.value.trim().toLowerCase();
    const run = ++latest;
    if (query.length < MIN_QUERY_CHARS) {
      list.replaceChildren();
      status.textContent = "";
      return;
    }
    try {
      const entries = await loadIndex();
      if (run !== latest) return;
      const words = query.split(/\s+/);
      const found = entries
        .map((entry) => ({ entry, points: score(entry, words) }))
        .filter((hit) => hit.points > 0)
        .sort((a, b) => b.points - a.points)
        .slice(0, MAX_RESULTS);
      list.replaceChildren(...found.map((hit) => result(hit.entry, words)));
      status.textContent = found.length ? `${found.length === MAX_RESULTS ? "The first " : ""}${found.length} result${found.length === 1 ? "" : "s"}` : "Nothing found";
    } catch {
      if (run === latest) status.textContent = "Search is not available right now; the menu below lists every page.";
    }
  };
  input.addEventListener("input", update);
  input.addEventListener("focus", () => void loadIndex().catch(() => undefined), { once: true });
}

setUpMenu();
setUpSearch();
