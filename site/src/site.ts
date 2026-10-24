// Addresses the pages link to, kept in one place.

export const SITE_URL = "https://dayhand.dev";
export const DOCS_PATH = "/docs/";
export const REPO_URL = "https://github.com/maiarowsky/dayhand";

/** A file in the repository on GitHub, such as `LICENSE` or `docs/deploy.md`. */
export const repoFile = (path: string): string => `${REPO_URL}/blob/main/${path}`;
