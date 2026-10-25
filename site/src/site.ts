// Addresses the pages link to, kept in one place.

export const SITE_URL = "https://dayhand.dev";
export const DOCS_PATH = "/docs/";
export const REPO_URL = "https://github.com/maiarowsky/dayhand";

/**
 * Where people ask for their waitlist address to be removed, shown under the Dayhand Cloud waitlist form. Cloudflare
 * Email Routing forwards it to the owner (CONTRIBUTING.md); `npm run deploy` refuses to publish the site without a
 * valid address here (scripts/check-release.mjs).
 */
export const CONTACT_EMAIL = "hello@dayhand.dev";

/** A file in the repository on GitHub, such as `LICENSE` or `docs/deploy.md`. */
export const repoFile = (path: string): string => `${REPO_URL}/blob/main/${path}`;
