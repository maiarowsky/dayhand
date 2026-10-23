// Fetching a Client ID Metadata Document (draft-ietf-oauth-client-id-metadata-document).
// Only URLs on the allowed origins are fetched (oauthConfig.cimdOrigins), so the
// server never requests an address a stranger chose; redirects are refused and
// the answer is cut off by size and time.
import { cimdOrigins } from "./oauthConfig";
import { checkMetadataDocument, cimdUrlProblem, type ClientCheck } from "./oauthRules";

const MAX_DOCUMENT_BYTES = 16 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

async function readLimited(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** The client behind a URL client_id, or why it cannot be used. Never throws. */
export async function fetchClientMetadata(clientId: string): Promise<ClientCheck> {
  const problem = cimdUrlProblem(clientId, cimdOrigins());
  if (problem) return { ok: false, error: problem };
  let response: Response;
  try {
    response = await fetch(clientId, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "Could not fetch the client metadata" };
  }
  if (response.status !== 200) return { ok: false, error: `Client metadata answered HTTP ${response.status}` };
  const text = await readLimited(response).catch(() => null);
  if (text === null) return { ok: false, error: "Client metadata is too large or unreadable" };
  try {
    return checkMetadataDocument(clientId, JSON.parse(text));
  } catch {
    return { ok: false, error: "Client metadata is not JSON" };
  }
}
