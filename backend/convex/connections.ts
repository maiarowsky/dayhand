// Agent connections (OAuth, docs/oauth.md) managed with a personal API key:
//   GET  /connections         list connections   (hlm connection list)
//   POST /connections/revoke  revoke one          (hlm connection revoke)
// Like /devices, these accept only API keys: an OAuth token cannot manage connections.
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { errorResponse, json, readJsonBody } from "./lib/http";
import { accountOwner, domainError, keyIdentity } from "./pairing";

export const listConnections = httpAction(async (ctx, request) => {
  const owner = await accountOwner(ctx, request);
  if (owner instanceof Response) return owner;
  return json({ connections: await ctx.runQuery(internal.oauthOwner.list, keyIdentity(owner)) });
});

export const revokeConnection = httpAction(async (ctx, request) => {
  const owner = await accountOwner(ctx, request);
  if (owner instanceof Response) return owner;
  const body = await readJsonBody(request);
  if (!body || typeof body.connectionId !== "string") {
    return errorResponse(400, "invalid_request", "Body must be JSON with a string `connectionId`");
  }
  try {
    return json(await ctx.runMutation(internal.oauthOwner.revoke, { ...keyIdentity(owner), id: body.connectionId }));
  } catch (error) {
    return domainError(error);
  }
});
