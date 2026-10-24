// The two HTML pages of the authorization endpoint: "approve on your phone"
// (with the code to type there) and an error page. Dayhand has no web app, so
// these are plain HTML from an HTTP action: no external resources, a strict
// Content-Security-Policy, one inline script with a nonce, every value escaped.
import { randomBase64url } from "./secrets";

export type Lang = "en" | "pl";

const TEXT = {
  en: {
    title: "Connect to Dayhand",
    asks: (client: string) => `${client} asks for access to your Dayhand plan.`,
    steps: [
      "Open the Dayhand app on your paired phone.",
      "Go to Settings → Agent connections → Approve a connection.",
      "Type this code and choose what to allow:",
    ],
    scopes: { "tasks:read": "Read your tasks and settings", "tasks:write": "Change your tasks and settings" },
    returnsTo: (host: string) => `After you approve, you go back to ${host}.`,
    loopback: "This goes back to a program on this computer (Claude Code). Approve only if you started it yourself just now.",
    expires: "The code is valid for 10 minutes.",
    waiting: "Waiting for your phone…",
    notYet: "Not approved yet. Approve on your phone, then continue.",
    continue: "Continue",
    errorTitle: "Cannot connect to Dayhand",
  },
  pl: {
    title: "Połącz z Dayhand",
    asks: (client: string) => `${client} prosi o dostęp do Twojego planu w aplikacji Dayhand.`,
    steps: [
      "Otwórz aplikację Dayhand na sparowanym telefonie.",
      "Wejdź w Ustawienia → Połączenia agentów → Zatwierdź połączenie.",
      "Wpisz ten kod i wybierz, na co pozwalasz:",
    ],
    scopes: { "tasks:read": "Odczyt zadań i ustawień", "tasks:write": "Zmiany w zadaniach i ustawieniach" },
    returnsTo: (host: string) => `Po zatwierdzeniu wrócisz do ${host}.`,
    loopback: "Odpowiedź trafi do programu na tym komputerze (Claude Code). Zatwierdź tylko, jeśli to Ty go przed chwilą uruchomiłeś.",
    expires: "Kod jest ważny 10 minut.",
    waiting: "Czekam na telefon…",
    notYet: "Jeszcze nie zatwierdzono. Zatwierdź na telefonie, potem kontynuuj.",
    continue: "Kontynuuj",
    errorTitle: "Nie można połączyć z Dayhand",
  },
};

export function pageLang(request: Request): Lang {
  return /^\s*pl\b/i.test(request.headers.get("Accept-Language") ?? "") ? "pl" : "en";
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const STYLE = `
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#f6f5f2;color:#1d1c1a}
main{max-width:30rem;margin:0 auto;padding:2rem 1rem}
h1{font-size:1.4rem;margin:0 0 1rem}
.code{font:600 2.2rem/1.2 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-align:center;
  background:#fff;border:1px solid #d8d4cc;border-radius:12px;padding:1rem;margin:1rem 0}
ul,ol{padding-left:1.25rem}.muted{color:#6b665d}.warn{color:#9a3412}
button{font:inherit;font-weight:600;width:100%;padding:.8rem;border-radius:10px;border:0;background:#1d1c1a;color:#fff}
@media (prefers-color-scheme:dark){body{background:#151413;color:#ece9e3}.code{background:#1f1e1c;border-color:#3a3833}
  .muted{color:#a29d93}.warn{color:#fdba74}button{background:#ece9e3;color:#151413}}`;

function headers(nonce: string | null, formTargets: string): Record<string, string> {
  const script = nonce ? `script-src 'nonce-${nonce}'; connect-src 'self';` : "";
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; ${script} form-action 'self' ${formTargets}; frame-ancestors 'none'; base-uri 'none'`,
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function document(lang: Lang, title: string, body: string, nonce: string | null = null, script = "") {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main>
${nonce ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
}

export type WaitingPage = {
  lang: Lang;
  clientName: string;
  userCode: string;
  scopes: ("tasks:read" | "tasks:write")[];
  redirectHost: string;
  redirectOrigin: string;
  loopback: boolean;
  handle: string;
  notYet?: boolean;
};

/** "Approve on your phone": the code, what is asked, and a form that continues once approved. */
export function waitingPage(page: WaitingPage, status = 200): Response {
  const t = TEXT[page.lang];
  const nonce = randomBase64url(16);
  const body = `<h1>${escapeHtml(t.title)}</h1>
<p>${escapeHtml(t.asks(page.clientName))}</p>
<ol>${t.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
<div class="code" aria-label="code">${escapeHtml(page.userCode)}</div>
<ul>${page.scopes.map((s) => `<li>${escapeHtml(t.scopes[s])}</li>`).join("")}</ul>
<p class="muted">${escapeHtml(t.returnsTo(page.redirectHost))} ${escapeHtml(t.expires)}</p>
${page.loopback ? `<p class="warn">${escapeHtml(t.loopback)}</p>` : ""}
<p id="status" class="muted" role="status">${escapeHtml(page.notYet ? t.notYet : t.waiting)}</p>
<form id="continue" method="post" action="/oauth/authorize/continue">
<input type="hidden" name="request" value="${escapeHtml(page.handle)}">
<input type="hidden" name="code" value="${escapeHtml(page.userCode)}">
<button type="submit">${escapeHtml(t.continue)}</button></form>`;
  // Polls the request's status and continues on its own once the phone has decided.
  const script = `(function(){var f=document.getElementById("continue");var b=new URLSearchParams(new FormData(f));
var tick=function(){fetch("/oauth/authorize/status",{method:"POST",body:b}).then(function(r){return r.json()})
.then(function(j){if(j.status==="pending"){setTimeout(tick,2000)}else{f.submit()}}).catch(function(){setTimeout(tick,5000)})};
setTimeout(tick,2000)})();`;
  return new Response(document(page.lang, t.title, body, nonce, script), { status, headers: headers(nonce, page.redirectOrigin) });
}

/** An error the browser cannot be sent back with (unknown client, bad redirect URI, expired request). */
export function errorPage(lang: Lang, message: string, status = 400): Response {
  const t = TEXT[lang];
  const body = `<h1>${escapeHtml(t.errorTitle)}</h1><p>${escapeHtml(message)}</p>`;
  return new Response(document(lang, t.errorTitle, body), { status, headers: headers(null, "") });
}
