// prepack: copies man/dayhand.1, man/dh.1 and LICENSE from the repository
// root into the package; the man pages install as `man dayhand` and `man dh`
// (package.json "man"). The copies are not committed.
import { copyFileSync, mkdirSync } from "node:fs";

const root = (path) => new URL(`../../${path}`, import.meta.url);
const here = (path) => new URL(`../${path}`, import.meta.url);

mkdirSync(here("man/"), { recursive: true });
for (const page of ["man/dayhand.1", "man/dh.1"]) copyFileSync(root(page), here(page));
copyFileSync(root("LICENSE"), here("LICENSE"));
