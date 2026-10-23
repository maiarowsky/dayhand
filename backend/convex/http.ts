import { httpRouter } from "convex/server";
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

export default http;
