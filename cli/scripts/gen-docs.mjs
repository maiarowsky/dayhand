// Writes docs/cli.md, man/hlm.1 and docs/skills/hlm/SKILL.md from the built
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
write("../../man/hlm.1", renderMan());
write("../../docs/skills/hlm/SKILL.md", renderSkill());
