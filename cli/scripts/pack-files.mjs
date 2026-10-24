// prepack: copies man/dayhand.1, man/dh.1 and LICENSE from the repository
// root into the package; the man pages install as `man dayhand` and `man dh`
// (package.json "man"). Also copies what the backend's setup script needs into
// backend/, so that `dayhand server start` works without a clone of the repository:
// package.json, package-lock.json, tsconfig.json, convex/ (with convex/_generated) and
// scripts/. Not tests/, node_modules/, .local-backend/ or the vitest config. The
// copies are not committed.
import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";

const root = (path) => new URL(`../../${path}`, import.meta.url);
const here = (path) => new URL(`../${path}`, import.meta.url);

mkdirSync(here("man/"), { recursive: true });
for (const page of ["man/dayhand.1", "man/dh.1"]) copyFileSync(root(page), here(page));
copyFileSync(root("LICENSE"), here("LICENSE"));

rmSync(here("backend/"), { recursive: true, force: true });
mkdirSync(here("backend/"), { recursive: true });
for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) copyFileSync(root(`backend/${file}`), here(`backend/${file}`));
for (const dir of ["convex", "scripts"]) cpSync(root(`backend/${dir}/`), here(`backend/${dir}/`), { recursive: true });
