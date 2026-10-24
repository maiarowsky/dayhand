/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys from "../apiKeys.js";
import type * as app from "../app.js";
import type * as calendar from "../calendar.js";
import type * as calendarFeeds from "../calendarFeeds.js";
import type * as callLimits from "../callLimits.js";
import type * as connections from "../connections.js";
import type * as crons from "../crons.js";
import type * as devices from "../devices.js";
import type * as http from "../http.js";
import type * as lib_appToken from "../lib/appToken.js";
import type * as lib_args from "../lib/args.js";
import type * as lib_cimd from "../lib/cimd.js";
import type * as lib_core from "../lib/core.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_exportPlan from "../lib/exportPlan.js";
import type * as lib_findTasks from "../lib/findTasks.js";
import type * as lib_guide from "../lib/guide.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_ical from "../lib/ical.js";
import type * as lib_importFormats from "../lib/importFormats.js";
import type * as lib_importOps from "../lib/importOps.js";
import type * as lib_jsonSchema from "../lib/jsonSchema.js";
import type * as lib_limits from "../lib/limits.js";
import type * as lib_mcpContent from "../lib/mcpContent.js";
import type * as lib_mcpProtocol from "../lib/mcpProtocol.js";
import type * as lib_mcpTools from "../lib/mcpTools.js";
import type * as lib_oauthConfig from "../lib/oauthConfig.js";
import type * as lib_oauthPage from "../lib/oauthPage.js";
import type * as lib_oauthRules from "../lib/oauthRules.js";
import type * as lib_openapi from "../lib/openapi.js";
import type * as lib_outputSchemas from "../lib/outputSchemas.js";
import type * as lib_problem from "../lib/problem.js";
import type * as lib_repeat from "../lib/repeat.js";
import type * as lib_restRoutes from "../lib/restRoutes.js";
import type * as lib_rrule from "../lib/rrule.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_settingsOps from "../lib/settingsOps.js";
import type * as lib_taskOps from "../lib/taskOps.js";
import type * as lib_toolResults from "../lib/toolResults.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_views from "../lib/views.js";
import type * as lib_vtimezone from "../lib/vtimezone.js";
import type * as lib_webhookEvents from "../lib/webhookEvents.js";
import type * as lib_webhookSign from "../lib/webhookSign.js";
import type * as lib_webhookTarget from "../lib/webhookTarget.js";
import type * as mcp from "../mcp.js";
import type * as migrations from "../migrations.js";
import type * as oauth from "../oauth.js";
import type * as oauthHttp from "../oauthHttp.js";
import type * as oauthOwner from "../oauthOwner.js";
import type * as ops from "../ops.js";
import type * as pairing from "../pairing.js";
import type * as rest from "../rest.js";
import type * as restAccount from "../restAccount.js";
import type * as restImport from "../restImport.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  app: typeof app;
  calendar: typeof calendar;
  calendarFeeds: typeof calendarFeeds;
  callLimits: typeof callLimits;
  connections: typeof connections;
  crons: typeof crons;
  devices: typeof devices;
  http: typeof http;
  "lib/appToken": typeof lib_appToken;
  "lib/args": typeof lib_args;
  "lib/cimd": typeof lib_cimd;
  "lib/core": typeof lib_core;
  "lib/dates": typeof lib_dates;
  "lib/env": typeof lib_env;
  "lib/exportPlan": typeof lib_exportPlan;
  "lib/findTasks": typeof lib_findTasks;
  "lib/guide": typeof lib_guide;
  "lib/http": typeof lib_http;
  "lib/ical": typeof lib_ical;
  "lib/importFormats": typeof lib_importFormats;
  "lib/importOps": typeof lib_importOps;
  "lib/jsonSchema": typeof lib_jsonSchema;
  "lib/limits": typeof lib_limits;
  "lib/mcpContent": typeof lib_mcpContent;
  "lib/mcpProtocol": typeof lib_mcpProtocol;
  "lib/mcpTools": typeof lib_mcpTools;
  "lib/oauthConfig": typeof lib_oauthConfig;
  "lib/oauthPage": typeof lib_oauthPage;
  "lib/oauthRules": typeof lib_oauthRules;
  "lib/openapi": typeof lib_openapi;
  "lib/outputSchemas": typeof lib_outputSchemas;
  "lib/problem": typeof lib_problem;
  "lib/repeat": typeof lib_repeat;
  "lib/restRoutes": typeof lib_restRoutes;
  "lib/rrule": typeof lib_rrule;
  "lib/secrets": typeof lib_secrets;
  "lib/settingsOps": typeof lib_settingsOps;
  "lib/taskOps": typeof lib_taskOps;
  "lib/toolResults": typeof lib_toolResults;
  "lib/validators": typeof lib_validators;
  "lib/views": typeof lib_views;
  "lib/vtimezone": typeof lib_vtimezone;
  "lib/webhookEvents": typeof lib_webhookEvents;
  "lib/webhookSign": typeof lib_webhookSign;
  "lib/webhookTarget": typeof lib_webhookTarget;
  mcp: typeof mcp;
  migrations: typeof migrations;
  oauth: typeof oauth;
  oauthHttp: typeof oauthHttp;
  oauthOwner: typeof oauthOwner;
  ops: typeof ops;
  pairing: typeof pairing;
  rest: typeof rest;
  restAccount: typeof restAccount;
  restImport: typeof restImport;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
