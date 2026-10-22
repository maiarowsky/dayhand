// The fallback key store: credentials.json next to config.toml, readable only
// by the user (mode 0600 on macOS and Linux; on Windows the folder under
// %APPDATA% is already private to the user). Used when no keychain is
// available, or when HLM_CREDENTIAL_STORE=file asks for it.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Warning } from "../config/env.js";
import { StoreUnavailable, type Credential, type KeyStore } from "./store.js";

type Contents = { keys: Record<string, string> };

export class FileStore implements KeyStore {
  readonly name = "file";
  readonly location: string;

  constructor(
    configDir: string,
    private readonly warn: (warning: Warning) => void = () => {},
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    this.location = path.join(configDir, "credentials.json");
  }

  async get(url: string): Promise<Credential | undefined> {
    const key = this.read().keys[url];
    return key ? { key, source: "file" } : undefined;
  }

  async set(url: string, key: string): Promise<void> {
    const contents = this.read();
    this.write({ keys: { ...contents.keys, [url]: key } });
  }

  async delete(url: string): Promise<boolean> {
    const contents = this.read();
    if (!(url in contents.keys)) return false;
    const { [url]: _removed, ...keys } = contents.keys;
    if (Object.keys(keys).length === 0) rmSync(this.location, { force: true });
    else this.write({ keys });
    return true;
  }

  private read(): Contents {
    if (!existsSync(this.location)) return { keys: {} };
    if (this.platform !== "win32" && (statSync(this.location).mode & 0o077) !== 0) {
      this.warn({ code: "credentials_mode", message: `${this.location} can be read by other users; run chmod 600 on it` });
    }
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(this.location, "utf8"));
    } catch {
      throw new StoreUnavailable(`${this.location} is not valid JSON; delete it and run hlm login`);
    }
    const keys = (data as Partial<Contents>)?.keys;
    if (typeof keys !== "object" || keys === null || Object.values(keys).some((k) => typeof k !== "string")) {
      throw new StoreUnavailable(`${this.location} has an unexpected shape; delete it and run hlm login`);
    }
    return { keys: keys as Record<string, string> };
  }

  /** Written to a temporary file with mode 0600 first, then renamed: never briefly readable or half-written. */
  private write(contents: Contents): void {
    mkdirSync(path.dirname(this.location), { recursive: true, mode: 0o700 });
    const temporary = `${this.location}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(contents, null, 2) + "\n", { mode: 0o600 });
    if (this.platform !== "win32") chmodSync(temporary, 0o600);
    renameSync(temporary, this.location);
  }
}
