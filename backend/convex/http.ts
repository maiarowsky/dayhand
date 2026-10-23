import { httpRouter } from "convex/server";
import { enableFeed, feed, getFeed, revokeFeed, rotateFeed } from "./calendar";
import { listConnections, revokeConnection } from "./connections";
import { handleOther, handlePost } from "./mcp";
import {
  authorizationServerMetadata,
  authorize,
  authorizeContinue,
  authorizeStatus,
  protectedResourceMetadata,
  register,
  revoke,
  token as oauthToken,
} from "./oauthHttp";
import { createCode, listDevices, pair, revokeDevice, token } from "./pairing";
import { handle as handleRest } from "./rest";

const http = httpRouter();

http.route({ path: "/mcp", method: "POST", handler: handlePost });
http.route({ path: "/mcp", method: "GET", handler: handleOther });
http.route({ path: "/mcp", method: "DELETE", handler: handleOther });

http.route({ path: "/auth/pair", method: "POST", handler: pair });
http.route({ path: "/auth/token", method: "POST", handler: token });
http.route({ path: "/devices/pairing-code", method: "POST", handler: createCode });
http.route({ path: "/devices", method: "GET", handler: listDevices });
http.route({ path: "/devices/revoke", method: "POST", handler: revokeDevice });

// OAuth 2.1 for MCP clients such as the Claude apps (docs/oauth.md).
http.route({ path: "/.well-known/oauth-protected-resource", method: "GET", handler: protectedResourceMetadata });
http.route({ path: "/.well-known/oauth-protected-resource/mcp", method: "GET", handler: protectedResourceMetadata });
http.route({ path: "/.well-known/oauth-authorization-server", method: "GET", handler: authorizationServerMetadata });
http.route({ path: "/oauth/authorize", method: "GET", handler: authorize });
http.route({ path: "/oauth/authorize/status", method: "POST", handler: authorizeStatus });
http.route({ path: "/oauth/authorize/continue", method: "POST", handler: authorizeContinue });
http.route({ path: "/oauth/token", method: "POST", handler: oauthToken });
http.route({ path: "/oauth/register", method: "POST", handler: register });
http.route({ path: "/oauth/revoke", method: "POST", handler: revoke });
http.route({ path: "/connections", method: "GET", handler: listConnections });
http.route({ path: "/connections/revoke", method: "POST", handler: revokeConnection });

// Convex routes only GET, POST, PUT, DELETE, OPTIONS and PATCH, so the feed is
// a plain iCalendar file, not CalDAV (docs/calendar.md).
http.route({ pathPrefix: "/cal/", method: "GET", handler: feed });
http.route({ path: "/calendar/feed", method: "GET", handler: getFeed });
http.route({ path: "/calendar/feed", method: "POST", handler: enableFeed });
http.route({ path: "/calendar/feed/rotate", method: "POST", handler: rotateFeed });
http.route({ path: "/calendar/feed/revoke", method: "POST", handler: revokeFeed });

// The REST API for integrations (docs/api.md); rest.ts routes below the prefix.
for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
  http.route({ pathPrefix: "/api/v1/", method, handler: handleRest });
}

export default http;
