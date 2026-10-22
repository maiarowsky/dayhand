// Writes docs/cli.md from the built registry: npm run build && npm run docs
import { writeFileSync } from "node:fs";
import { renderDocs } from "../dist/docs.js";

writeFileSync(new URL("../../docs/cli.md", import.meta.url), renderDocs());
