// Small helpers shared by the HTTP actions (MCP and pairing).

const MAX_JSON_BODY_BYTES = 4 * 1024;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** OAuth-style error body: `{ error, error_description }`. */
export const errorResponse = (status: number, error: string, description: string, headers: Record<string, string> = {}) =>
  json({ error, error_description: description }, status, headers);

export function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("Authorization") ?? "");
  return match ? match[1] : null;
}

/** A small JSON object body, or null when it is too large, not JSON or not an object. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_JSON_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
