#!/usr/bin/env node
// The old name of the `dayhand` binary: the same command, with a warning on
// every run, until 1.0 removes it (docs/cli.md).
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  process.stderr.write(`hlm: Node.js 22.12 or newer is required (this is ${process.versions.node})\n`);
  process.exit(1);
}
const { main, OLD_COMMAND } = await import("../main.js");
const { processIo } = await import("../core/io.js");
process.exitCode = await main(process.argv.slice(2), processIo(), process.argv[2] === "__complete" ? [] : [OLD_COMMAND]);
