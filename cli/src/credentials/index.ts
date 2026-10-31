// The stores in reading order and the store `dayhand login` writes to.
// DAYHAND_CREDENTIAL_STORE=keychain|file pins one (file: headless machines and tests).
import { usageError } from "../core/exit.js";
import type { Env, Warning } from "../config/env.js";
import type { Platform } from "../config/paths.js";
import { FileStore } from "./file.js";
import { KeychainStore } from "./keychain.js";
import { EnvCredentialStore, type CredentialStore, type KeyStore } from "./store.js";

export type StoreChoice = "keychain" | "file";
export const STORE_CHOICES: StoreChoice[] = ["keychain", "file"];

export function storeChoice(env: Env): StoreChoice | undefined {
  const raw = env.DAYHAND_CREDENTIAL_STORE?.trim().toLowerCase();
  if (!raw) return undefined;
  if ((STORE_CHOICES as string[]).includes(raw)) return raw as StoreChoice;
  throw usageError(`DAYHAND_CREDENTIAL_STORE must be one of ${STORE_CHOICES.join(", ")}`, { valid: STORE_CHOICES });
}

/** Key stores (not the environment) in the order they are read. */
export function keyStores(env: Env, configDir: string, _warn: (w: Warning) => void, platform: Platform = process.platform): KeyStore[] {
  const choice = storeChoice(env);
  const keychain = new KeychainStore(platform);
  const file = new FileStore(configDir, platform);
  if (choice === "keychain") return [keychain];
  if (choice === "file") return [file];
  return [keychain, file];
}

export function credentialStores(env: Env, configDir: string, warn: (w: Warning) => void): CredentialStore[] {
  return [new EnvCredentialStore(env, warn), ...keyStores(env, configDir, warn)];
}
