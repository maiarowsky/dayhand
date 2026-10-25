// Checks POST /api/waitlist against a local `wrangler dev` (CONTRIBUTING.md): a good address, a bad one, the same
// address twice, the hidden field, a form sent too quickly, a wrong content type, another site's origin and the
// per-address rate limit. Each case sends its own CF-Connecting-IP, which `wrangler dev` passes through and
// Cloudflare overwrites in production, so the cases do not share a rate limit.
//
//   node scripts/check-waitlist.mjs http://localhost:8787
//
// Afterwards, the stored rows: wrangler d1 execute dayhand-waitlist --local --command "SELECT * FROM waitlist"

const base = process.argv[2];
if (!base) {
  console.error("usage: node scripts/check-waitlist.mjs <base url of wrangler dev>");
  process.exit(2);
}
const url = new URL("/api/waitlist", base).href;
const run = Date.now().toString(36);
let failures = 0;

async function post(ip, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function form(email, extra = {}) {
  return { email, website: "", elapsedMs: 5000, source: "home", ...extra };
}

function expect(name, actual, status, ok) {
  const pass = actual.status === status && actual.body.ok === ok && typeof actual.body.message === "string";
  if (!pass) failures += 1;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}: ${actual.status} ${JSON.stringify(actual.body)}`);
}

const email = `check-${run}@example.com`;
expect("good address", await post(`10.0.0.1`, form(`  ${email.toUpperCase()} `)), 200, true);
expect("same address again", await post(`10.0.0.2`, form(email)), 200, true);
expect("not an address", await post(`10.0.0.3`, form("not-an-email")), 400, false);
expect("address too long", await post(`10.0.0.3`, form(`${"a".repeat(250)}@example.com`)), 400, false);
expect("hidden field filled", await post(`10.0.0.4`, form(`bot-${run}@example.com`, { website: "spam" })), 200, true);
expect("sent too quickly", await post(`10.0.0.5`, form(`fast-${run}@example.com`, { elapsedMs: 300 })), 400, false);
expect("unknown source", await post(`10.0.0.5`, form(`src-${run}@example.com`, { source: "elsewhere" })), 400, false);
expect("not JSON", await post(`10.0.0.6`, "email=a@example.com", { "content-type": "application/x-www-form-urlencoded" }), 415, false);
expect("other site", await post(`10.0.0.6`, form(`origin-${run}@example.com`), { origin: "https://example.com" }), 403, false);
expect("body too large", await post(`10.0.0.6`, form(`big-${run}@example.com`, { pad: "x".repeat(4096) })), 413, false);

const limited = `10.0.1.${Math.floor(Math.random() * 250) + 1}`;
const answers = [];
for (let attempt = 0; attempt < 6; attempt += 1) answers.push(await post(limited, form(`rate-${attempt}-${run}@example.com`)));
expect("five tries from one address", answers[4], 200, true);
expect("sixth try from one address", answers[5], 429, false);

const get = await fetch(url);
const getPass = get.status === 405 && get.headers.get("allow") === "POST";
if (!getPass) failures += 1;
console.log(`${getPass ? "ok  " : "FAIL"} GET: ${get.status}`);

console.log(failures === 0 ? "check-waitlist: all cases pass" : `check-waitlist: ${failures} case(s) failed`);
console.log(`stored: ${email}, rate-0…4-${run}@example.com; not stored: bot-${run}, fast-${run}, rate-5-${run}`);
process.exit(failures === 0 ? 0 : 1);
