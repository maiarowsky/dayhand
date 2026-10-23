import { httpRouter } from "convex/server";
import { enableFeed, feed, getFeed, revokeFeed, rotateFeed } from "./calendar";
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

// Convex routes only GET, POST, PUT, DELETE, OPTIONS and PATCH, so the feed is
// a plain iCalendar file, not CalDAV (docs/calendar.md).
http.route({ pathPrefix: "/cal/", method: "GET", handler: feed });
http.route({ path: "/calendar/feed", method: "GET", handler: getFeed });
http.route({ path: "/calendar/feed", method: "POST", handler: enableFeed });
http.route({ path: "/calendar/feed/rotate", method: "POST", handler: rotateFeed });
http.route({ path: "/calendar/feed/revoke", method: "POST", handler: revokeFeed });

export default http;
