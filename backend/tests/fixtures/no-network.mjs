// Preloaded with `node --import` by tests/setup.test.ts: any network
// connection or child process makes the run fail, so a --dry-run that
// passes provably did neither.
import childProcess from "node:child_process";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

const refuse = (what) => () => {
  throw new Error(`no-network: ${what} is not allowed in this run`);
};
globalThis.fetch = refuse("fetch");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = refuse(name);
for (const [module, names] of [[net, ["connect", "createConnection"]], [tls, ["connect"]], [http, ["request", "get"]], [https, ["request", "get"]], [dns, ["lookup", "resolve"]]]) {
  for (const name of names) module[name] = refuse(name);
}
syncBuiltinESMExports();
