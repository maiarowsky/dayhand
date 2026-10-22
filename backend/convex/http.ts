import { httpRouter } from "convex/server";
import { handleOther, handlePost } from "./mcp";
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

export default http;
