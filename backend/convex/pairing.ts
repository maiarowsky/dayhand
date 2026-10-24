// HTTP endpoints of phone pairing (protocol: docs/pairing.md).
//   POST /auth/pair            pairing code -> device token (unauthenticated, rate limited)
//   POST /auth/token           device token -> app JWT, ES256, one hour
//   POST /devices/pairing-code create a pairing code   (personal API key)
//   GET  /devices              list paired devices     (personal API key)
//   POST /devices/revoke       revoke a device         (personal API key)
// Failures never say whether a code or token existed, was used, expired or revoked.
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { hashKey } from "./apiKeys";
import { checkDeviceName, PAIRING_CODE_TTL_MS } from "./devices";
import { APP_TOKEN_TTL_SECONDS, appSubject, signAppToken, signingConfig, SigningConfigError } from "./lib/appToken";
import { bearerToken, errorResponse, json, readJsonBody } from "./lib/http";
import type { KeyScope } from "./lib/validators";
import { newDeviceToken, parseDeviceToken, parsePairingCode, sha256Hex } from "./lib/secrets";

const DEFAULT_DEVICE_NAME = "Phone";
const noStore = { "Cache-Control": "no-store" };

const invalidGrant = () => errorResponse(401, "invalid_grant", "The code or token is not valid", noStore);
const notConfigured = () => errorResponse(503, "not_configured", "App sign-in is not configured on this deployment");

export const pair = httpAction(async (ctx, request) => {
  const body = await readJsonBody(request);
  if (!body || typeof body.code !== "string") return errorResponse(400, "invalid_request", "Body must be JSON with a string `code`");
  const rawName = body.deviceName ?? DEFAULT_DEVICE_NAME;
  let deviceName: string;
  try {
    if (typeof rawName !== "string") throw new Error();
    deviceName = checkDeviceName(rawName);
  } catch {
    return errorResponse(400, "invalid_request", "deviceName must be a string of 1 to 100 characters");
  }
  // A malformed code is checked like a wrong one, so it counts as a failed attempt.
  const code = parsePairingCode(body.code) ?? { selector: "", secret: body.code };
  const device = newDeviceToken();
  const result = await ctx.runMutation(internal.devices.redeemCode, {
    selector: code.selector,
    secretHash: await sha256Hex(code.secret),
    deviceName,
    deviceSelector: device.selector,
    deviceSecretHash: await sha256Hex(device.secret),
  });
  if (!result.ok && result.reason === "rate_limited") {
    return errorResponse(429, "rate_limited", "Too many failed attempts; try again later", {
      "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
    });
  }
  if (!result.ok) return invalidGrant();
  return json(
    { deviceId: result.deviceId, deviceName, deviceToken: device.token, convexUrl: process.env.CONVEX_CLOUD_URL ?? null },
    200,
    noStore,
  );
});

export const token = httpAction(async (ctx, request) => {
  let config;
  try {
    config = signingConfig();
  } catch (error) {
    if (error instanceof SigningConfigError) {
      console.error(`App sign-in is not configured: ${error.message}`);
      return notConfigured();
    }
    throw error;
  }
  const body = await readJsonBody(request);
  if (!body || typeof body.deviceToken !== "string") {
    return errorResponse(400, "invalid_request", "Body must be JSON with a string `deviceToken`");
  }
  const parsed = parseDeviceToken(body.deviceToken);
  if (!parsed) return invalidGrant();
  const device = await ctx.runMutation(internal.devices.useToken, {
    selector: parsed.selector,
    secretHash: await sha256Hex(parsed.secret),
  });
  if (!device) return invalidGrant();
  const subject = appSubject(device.userId, config.issuer);
  if (!subject) {
    console.error(`Device ${device.deviceId} belongs to ${device.userId}, which is not an app user of ${config.issuer}`);
    return notConfigured();
  }
  const signed = await signAppToken(config, subject);
  return json(
    { token: signed.token, tokenType: "Bearer", expiresIn: APP_TOKEN_TTL_SECONDS, expiresAt: signed.expiresAt },
    200,
    noStore,
  );
});

// ---- Device management with a personal API key (dayhand pair / devices / revoke) ----
// accountOwner, keyIdentity and unauthorized serve the calendar feed and
// connection endpoints too (calendar.ts, connections.ts).

export type KeyOwner = {
  userId: string;
  keyId: Id<"apiKeys">;
  name: string;
  kind: "cli" | "agent";
  scope: KeyScope;
  expiresAt: number | null;
};

/** The owner of the working personal API key in the request; OAuth access tokens are not accepted here. */
export async function keyOwner(ctx: ActionCtx, request: Request): Promise<KeyOwner | null> {
  const key = bearerToken(request);
  return key ? ctx.runQuery(internal.apiKeys.verify, { hash: await hashKey(key), now: Date.now() }) : null;
}

/**
 * The owner of a full key, or the answer that refuses the request: managing
 * the account (devices, connections, the calendar feed) needs scope full.
 */
export async function accountOwner(ctx: ActionCtx, request: Request): Promise<KeyOwner | Response> {
  const owner = await keyOwner(ctx, request);
  if (!owner) return unauthorized();
  if (owner.scope !== "full") {
    return errorResponse(403, "insufficient_scope", `This needs an API key with scope full; this key has scope ${owner.scope}`);
  }
  return owner;
}

/** The key's identity for the domain: its owner, its kind as the actor, and the key itself. */
export const keyIdentity = (owner: KeyOwner) => ({
  userId: owner.userId,
  actor: owner.kind,
  keyId: owner.keyId,
  actorName: owner.name,
});

export const unauthorized = () =>
  errorResponse(401, "invalid_token", "Missing, invalid or revoked API key", { "WWW-Authenticate": 'Bearer realm="dayhand"' });

/** Domain errors as 400/404 with their message; anything else is rethrown. */
export function domainError(error: unknown) {
  if (!(error instanceof ConvexError)) throw error;
  const { code, message } = error.data as { code: string; message: string };
  return errorResponse(code === "not_found" ? 404 : 400, code, message);
}

export const createCode = httpAction(async (ctx, request) => {
  const owner = await accountOwner(ctx, request);
  if (owner instanceof Response) return owner;
  try {
    const created = await ctx.runAction(internal.devices.createPairingCode, {
      ...keyIdentity(owner),
      createdBy: `API key "${owner.name}"`,
    });
    return json({ ...created, expiresIn: PAIRING_CODE_TTL_MS / 1000 }, 201, noStore);
  } catch (error) {
    return domainError(error);
  }
});

export const listDevices = httpAction(async (ctx, request) => {
  const owner = await accountOwner(ctx, request);
  if (owner instanceof Response) return owner;
  return json({ devices: await ctx.runQuery(internal.devices.list, keyIdentity(owner)) });
});

export const revokeDevice = httpAction(async (ctx, request) => {
  const owner = await accountOwner(ctx, request);
  if (owner instanceof Response) return owner;
  const body = await readJsonBody(request);
  if (!body || typeof body.deviceId !== "string") {
    return errorResponse(400, "invalid_request", "Body must be JSON with a string `deviceId`");
  }
  try {
    return json(
      await ctx.runMutation(internal.devices.revoke, { ...keyIdentity(owner), deviceId: body.deviceId }),
    );
  } catch (error) {
    return domainError(error);
  }
});
