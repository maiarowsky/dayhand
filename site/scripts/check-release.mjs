// Stops `npm run deploy` while the site is not ready to publish: the waitlist form promises a way to have an
// address removed, so CONTACT_EMAIL in src/site.ts must name the address the page gives for it.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/site.ts", import.meta.url), "utf8");
const match = source.match(/^export const CONTACT_EMAIL = "([^"]*)";$/m);
if (!match) {
  console.error("check-release: CONTACT_EMAIL is missing from src/site.ts");
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(match[1])) {
  console.error(
    "check-release: set CONTACT_EMAIL in src/site.ts to the address where people ask for their waitlist address " +
      "to be removed, then deploy again",
  );
  process.exit(1);
}
