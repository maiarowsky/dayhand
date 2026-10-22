// Where the API key comes from. Batch 1 reads only the environment; the OS
// keychain (batch 2, `hlm login`) becomes another CredentialStore in front of
// or behind it without touching the commands.
import { readEnv, type Env, type Warning } from "../config/env.js";

export type Credential = { key: string; source: string };

export interface CredentialStore {
  /** Shown by a future `hlm whoami` as where the key came from. */
  readonly name: string;
  /** The key for this deployment URL, or undefined when this store has none. */
  get(url: string): Promise<Credential | undefined>;
}

export class EnvCredentialStore implements CredentialStore {
  readonly name = "environment";

  constructor(
    private readonly env: Env,
    private readonly warn: (warning: Warning) => void,
  ) {}

  async get(): Promise<Credential | undefined> {
    const { value, warning } = readEnv(this.env, "HLM_API_KEY");
    if (warning) this.warn(warning);
    return value ? { key: value, source: warning ? "HELM_API_KEY" : "HLM_API_KEY" } : undefined;
  }
}

/** The first store that has a key wins. */
export async function findCredential(stores: CredentialStore[], url: string): Promise<Credential | undefined> {
  for (const store of stores) {
    const found = await store.get(url);
    if (found) return found;
  }
  return undefined;
}
