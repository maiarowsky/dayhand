#!/usr/bin/env node
// Entry point of the `dayhand` binary and its short name `dh`.
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  process.stderr.write(`dayhand: Node.js 22.12 or newer is required (this is ${process.versions.node})\n`);
  process.exit(1);
}
const { main } = await import("../main.js");
process.exitCode = await main(process.argv.slice(2));
