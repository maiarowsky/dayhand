// The OS keychain through @napi-rs/keyring: macOS Keychain, Windows
// Credential Manager, or the Secret Service on Linux (GNOME Keyring, KWallet,
// KeePassXC). On Linux the entry is pinned to the Secret Service: the
// library's silent fallback, the kernel keyring, forgets keys at logout.
import type { Platform } from "../config/paths.js";
import { StoreUnavailable, type Credential, type KeyStore } from "./store.js";

const SERVICE = "hlm";

type Keyring = typeof import("@napi-rs/keyring");

const LOCATIONS: Partial<Record<Platform, string>> = {
  darwin: "macOS Keychain",
  win32: "Windows Credential Manager",
};

export class KeychainStore implements KeyStore {
  readonly name = "keychain";
  private module?: Promise<Keyring>;

  constructor(private readonly platform: Platform = process.platform) {}

  get location(): string {
    return LOCATIONS[this.platform] ?? "Secret Service keyring";
  }

  async get(url: string): Promise<Credential | undefined> {
    const key = await this.call(url, (entry) => entry.getPassword());
    return key ? { key, source: "keychain" } : undefined;
  }

  async set(url: string, key: string): Promise<void> {
    await this.call(url, (entry) => entry.setPassword(key));
  }

  async delete(url: string): Promise<boolean> {
    return this.call(url, (entry) => entry.deleteCredential());
  }

  /** One keychain operation on the entry for this URL; any failure means the keychain is unavailable. */
  private async call<T>(url: string, action: (entry: InstanceType<Keyring["AsyncEntry"]>) => Promise<T>): Promise<T> {
    const keyring = await (this.module ??= import("@napi-rs/keyring").catch((error: unknown) => {
      throw new StoreUnavailable(`no keychain support for this system (${(error as Error).message.split("\n")[0]})`);
    }));
    try {
      const entry = new keyring.AsyncEntry(SERVICE, url, { linux: { store: "secret-service" } });
      return await action(entry);
    } catch (error) {
      throw new StoreUnavailable(`${this.location} is not available (${String((error as Error).message ?? error).split("\n")[0]})`);
    }
  }
}
