import { httpRouter } from "convex/server";
import { handleOther, handlePost } from "./mcp";

const http = httpRouter();

http.route({ path: "/mcp", method: "POST", handler: handlePost });
http.route({ path: "/mcp", method: "GET", handler: handleOther });
http.route({ path: "/mcp", method: "DELETE", handler: handleOther });

export default http;
