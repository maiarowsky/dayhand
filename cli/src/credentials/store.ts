// Where the API key comes from, in order: DAYHAND_API_KEY (agents, CI), then the
// key `dayhand login` stored for the deployment URL in the OS keychain or, when
// no keychain is available, in a 0600 file next to config.toml.
import { readEnv, type Env, type Warning } from "../config/env.js";

export type Credential = { key: string; source: string };

export interface CredentialStore {
  /** "environment", "keychain" or "file"; `dayhand whoami` reports it. */
  readonly name: string;
  /** The key for this deployment URL, or undefined when this store has none. */
  get(url: string): Promise<Credential | undefined>;
}

/** A store `dayhand login` can write to. */
export interface KeyStore extends CredentialStore {
  readonly name: "keychain" | "file";
  /** Where the key lives, for messages: "macOS Keychain", a file path, … */
  readonly location: string;
  set(url: string, key: string): Promise<void>;
  /** True when a key was removed. */
  delete(url: string): Promise<boolean>;
}

/** The store cannot be used here (no keychain service, locked, unsupported system). */
export class StoreUnavailable extends Error {}

export class EnvCredentialStore implements CredentialStore {
  readonly name = "environment";

  constructor(
    private readonly env: Env,
    private readonly warn: (warning: Warning) => void,
  ) {}

  async get(): Promise<Credential | undefined> {
    const { value, source, warning } = readEnv(this.env, "DAYHAND_API_KEY");
    if (warning) this.warn(warning);
    return value ? { key: value, source: source! } : undefined;
  }
}

export type Lookup = { credential?: Credential; unavailable: string[] };

/** The first store that has a key wins; stores that cannot be read are reported, not fatal. */
export async function findCredential(stores: CredentialStore[], url: string): Promise<Lookup> {
  const unavailable: string[] = [];
  for (const store of stores) {
    try {
      const credential = await store.get(url);
      if (credential) return { credential, unavailable };
    } catch (error) {
      if (!(error instanceof StoreUnavailable)) throw error;
      unavailable.push(`${store.name}: ${error.message}`);
    }
  }
  return { unavailable };
}
