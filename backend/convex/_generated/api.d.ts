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
import type * as crons from "../crons.js";
import type * as devices from "../devices.js";
import type * as http from "../http.js";
import type * as lib_appToken from "../lib/appToken.js";
import type * as lib_args from "../lib/args.js";
import type * as lib_core from "../lib/core.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_exportPlan from "../lib/exportPlan.js";
import type * as lib_http from "../lib/http.js";
import type * as lib_jsonSchema from "../lib/jsonSchema.js";
import type * as lib_repeat from "../lib/repeat.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_settingsOps from "../lib/settingsOps.js";
import type * as lib_taskOps from "../lib/taskOps.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_views from "../lib/views.js";
import type * as mcp from "../mcp.js";
import type * as migrations from "../migrations.js";
import type * as ops from "../ops.js";
import type * as pairing from "../pairing.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  app: typeof app;
  crons: typeof crons;
  devices: typeof devices;
  http: typeof http;
  "lib/appToken": typeof lib_appToken;
  "lib/args": typeof lib_args;
  "lib/core": typeof lib_core;
  "lib/dates": typeof lib_dates;
  "lib/exportPlan": typeof lib_exportPlan;
  "lib/http": typeof lib_http;
  "lib/jsonSchema": typeof lib_jsonSchema;
  "lib/repeat": typeof lib_repeat;
  "lib/secrets": typeof lib_secrets;
  "lib/settingsOps": typeof lib_settingsOps;
  "lib/taskOps": typeof lib_taskOps;
  "lib/validators": typeof lib_validators;
  "lib/views": typeof lib_views;
  mcp: typeof mcp;
  migrations: typeof migrations;
  ops: typeof ops;
  pairing: typeof pairing;
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
