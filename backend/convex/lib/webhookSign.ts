// Signatures of Standard Webhooks (https://www.standardwebhooks.com, docs/webhooks.md):
// HMAC-SHA256 over "<webhook-id>.<webhook-timestamp>.<body>" with the secret's
// bytes (base64 after "whsec_"), sent as "v1,<base64>" in webhook-signature.
import { bytesToBase64url, randomBase64url } from "./secrets";

export const SECRET_PREFIX = "whsec_";
const SECRET_BYTES = 24;

/** A new signing secret, shown once. Needs a real random source: call it in an action. */
export function newWebhookSecret(): string {
  const base64 = randomBase64url(SECRET_BYTES).replace(/-/g, "+").replace(/_/g, "/");
  return SECRET_PREFIX + base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  return new Uint8Array([...atob(encoded)].map((c) => c.charCodeAt(0)));
}

const toBase64 = (bytes: Uint8Array) => {
  const url = bytesToBase64url(bytes).replace(/-/g, "+").replace(/_/g, "/");
  return url.padEnd(Math.ceil(url.length / 4) * 4, "=");
};

/** The value of the webhook-signature header for one message. */
export async function signWebhook(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${toBase64(new Uint8Array(mac))}`;
}
