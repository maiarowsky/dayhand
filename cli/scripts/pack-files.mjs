// prepack: copies man/hlm.1 and LICENSE from the repository root into the
// package; the man page installs as `man hlm` (package.json "man"). The copies
// are not committed.
import { copyFileSync, mkdirSync } from "node:fs";

const root = (path) => new URL(`../../${path}`, import.meta.url);
const here = (path) => new URL(`../${path}`, import.meta.url);

mkdirSync(here("man/"), { recursive: true });
copyFileSync(root("man/hlm.1"), here("man/hlm.1"));
copyFileSync(root("LICENSE"), here("LICENSE"));
