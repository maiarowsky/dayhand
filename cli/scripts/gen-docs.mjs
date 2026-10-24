// Writes docs/cli.md, man/dayhand.1 (and man/dh.1, which points to it) and
// docs/skills/dayhand/SKILL.md from the built
// registry: npm run build && npm run docs
import { mkdirSync, writeFileSync } from "node:fs";
import { renderDocs } from "../dist/docs.js";
import { renderMan } from "../dist/man.js";
import { renderSkill } from "../dist/skill.js";

const write = (path, text) => {
  const url = new URL(path, import.meta.url);
  mkdirSync(new URL(".", url), { recursive: true });
  writeFileSync(url, text);
};

write("../../docs/cli.md", renderDocs());
write("../../man/dayhand.1", renderMan());
write("../../man/dh.1", ".so man1/dayhand.1\n");
write("../../docs/skills/dayhand/SKILL.md", renderSkill());
