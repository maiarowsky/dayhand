// Documentation menu and search. Without this script the menu stays open and the search stays hidden.
// The index (search-index.js, built by scripts/build-docs.mjs) is loaded on first use as a plain script,
// so search also works when the pages are opened from the file system.
(() => {
  const NARROW = window.matchMedia("(width < 60rem)");
  const MAX_RESULTS = 12;
  const SNIPPET_CHARS = 140;

  const menu = document.querySelector(".docs-menu");
  if (menu) {
    if (NARROW.matches) menu.open = false;
    NARROW.addEventListener("change", () => {
      if (!NARROW.matches) menu.open = true;
    });
  }

  const box = document.querySelector(".docs-search");
  const input = document.getElementById("docs-search-input");
  const status = document.getElementById("docs-search-status");
  const results = document.getElementById("docs-search-results");
  if (!box || !input || !status || !results) return;
  box.hidden = false;

  let index = null;
  let loading = null;

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "search-index.js";
        script.onload = () => {
          index = (window.DAYHAND_DOCS_INDEX || []).map((entry) => ({
            ...entry,
            title: entry.t.toLowerCase(),
            page: entry.p.toLowerCase(),
            text: entry.x.toLowerCase(),
          }));
          resolve(index);
        };
        script.onerror = () => {
          loading = null;
          reject(new Error("index"));
        };
        document.head.append(script);
      });
    }
    return loading;
  }

  function score(entry, words) {
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

  function snippet(entry, words) {
    const at = Math.max(0, ...words.map((word) => entry.text.indexOf(word)));
    const start = Math.max(0, at - SNIPPET_CHARS / 3);
    const text = entry.x.slice(start, start + SNIPPET_CHARS).trim();
    return (start > 0 ? "…" : "") + text + (start + SNIPPET_CHARS < entry.x.length ? "…" : "");
  }

  function marked(text, words) {
    const fragment = document.createDocumentFragment();
    const lower = text.toLowerCase();
    let at = 0;
    while (at < text.length) {
      let next = -1;
      let length = 0;
      for (const word of words) {
        const found = lower.indexOf(word, at);
        if (found !== -1 && (next === -1 || found < next)) {
          next = found;
          length = word.length;
        }
      }
      if (next === -1) {
        fragment.append(text.slice(at));
        break;
      }
      fragment.append(text.slice(at, next));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(next, next + length);
      fragment.append(mark);
      at = next + length;
    }
    return fragment;
  }

  // A rough stem, so "pause" also finds "pausing" and "agents" finds "agent".
  const stem = (word) => (word.length > 4 ? word.replace(/(ing|es|ed|s|e)$/, "") : word);

  function show(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean).map(stem);
    results.replaceChildren();
    if (!words.length) {
      status.textContent = "";
      return;
    }
    const found = index
      .map((entry) => ({ entry, points: score(entry, words) }))
      .filter((hit) => hit.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, MAX_RESULTS);
    status.textContent = found.length
      ? `${found.length}${found.length === MAX_RESULTS ? " or more" : ""} result${found.length === 1 ? "" : "s"}`
      : "Nothing found";
    for (const { entry } of found) {
      const link = document.createElement("a");
      link.href = entry.u;
      const title = document.createElement("strong");
      title.append(marked(entry.t, words));
      const page = document.createElement("span");
      page.textContent = entry.t === entry.p ? "Page" : entry.p;
      const text = document.createElement("span");
      text.append(marked(snippet(entry, words), words));
      link.append(title, page, text);
      const item = document.createElement("li");
      item.append(link);
      results.append(item);
    }
  }

  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      loadIndex().then(
        () => show(input.value),
        () => {
          status.textContent = "Search is not available here; use the menu";
        },
      );
    }, 120);
  });
  input.addEventListener("focus", () => {
    loadIndex().catch(() => {});
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      show("");
    } else if (event.key === "Enter") {
      const first = results.querySelector("a");
      if (first) first.click();
    }
  });
})();
