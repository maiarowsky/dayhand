// POST /api/v1/import (docs/api.md#import): reads the file in the request
// (lib/importFormats.ts) and stores its tasks through the domain operation
// importTasks (lib/importOps.ts), at most IMPORT_BATCH per call. Each task's
// key is a hash of the format and its place in the file, so a repeated import
// skips what it already brought in. With ?dryRun=true nothing is stored.
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { ownerOnly } from "./lib/core";
import { DEPRECATED_FORMATS, IMPORT_FORMATS, ImportFormatError, KEY_NAME, detectFormat, readContext, readPlan, type ImportFormat } from "./lib/importFormats";
import { IMPORT_BATCH, type ImportTask } from "./lib/importOps";
import { RestInputError } from "./lib/restRoutes";
import { sha256Hex } from "./lib/secrets";
import { dryRunResult } from "./lib/toolResults";
import type { RestHandler } from "./rest";

/** Most tasks one import may bring. */
export const MAX_IMPORT = 2000;
const KEY_LENGTH = 40;

type BatchOutcome = { created: Record<string, unknown>[]; skipped: { title: string; reason: string }[]; failed: { title: string; message: string; projectKey?: string }[] };

export const importPlan: RestHandler = async (ctx, { identity, body, dryRun }) => {
  ownerOnly(identity, "import a plan");
  const extra = Object.keys(body).filter((name) => name !== "content" && name !== "format" && name !== "projectId");
  if (extra.length) throw new RestInputError(`Unknown field ${extra.join(", ")}; send { "content": "<file>", "format": "auto" }`);
  if (typeof body.content !== "string" || body.content.trim() === "") throw new RestInputError("content must be the file's text");
  // Since 0.13.0: the project (id or name) of every task the file puts in none.
  if (body.projectId !== undefined && typeof body.projectId !== "string") throw new RestInputError("projectId must be a project id or name");
  const projectId = body.projectId as string | undefined;
  const requested: string = DEPRECATED_FORMATS[body.format as string] ?? body.format ?? "auto";
  if (requested !== "auto" && !IMPORT_FORMATS.includes(requested as ImportFormat)) {
    throw new RestInputError(`format must be auto, ${IMPORT_FORMATS.join(", ")}`);
  }
  const settings = await ctx.runQuery(internal.ops.getSettings, identity);
  let format: ImportFormat;
  let parsed;
  try {
    format = requested === "auto" ? detectFormat(body.content) : (requested as ImportFormat);
    parsed = readPlan(format, body.content, readContext(settings.timezone, Date.now()));
  } catch (error) {
    if (error instanceof ImportFormatError) throw new RestInputError(error.message);
    throw error;
  }
  if (parsed.items.length > MAX_IMPORT) throw new RestInputError(`The file has ${parsed.items.length} tasks; at most ${MAX_IMPORT} per import`);

  // Numbers from an export are kept only when they rise, so the lowest go first.
  const ordered = [...parsed.items].sort((a, b) => (a.ref ?? Infinity) - (b.ref ?? Infinity));
  const items: ImportTask[] = await Promise.all(
    ordered.map(async ({ source, ...task }) => ({ ...task, key: (await sha256Hex(`${KEY_NAME[format]}:${source}`)).slice(0, KEY_LENGTH) })),
  );
  const total: BatchOutcome = { created: [], skipped: [], failed: [] };
  const failedProjects = new Set<string>();
  for (let start = 0; start < Math.max(items.length, 1); start += IMPORT_BATCH) {
    const batch = items.slice(start, start + IMPORT_BATCH);
    let outcome: BatchOutcome;
    try {
      outcome = await ctx.runMutation(internal.ops.importTasks as FunctionReference<"mutation", "internal">, {
        ...identity,
        items: batch,
        ...((start === 0 || dryRun) && parsed.projects ? { projects: parsed.projects } : {}),
        ...(projectId === undefined ? {} : { projectId }),
        dryRun,
      });
    } catch (error) {
      const preview = dryRunResult(error);
      if (!preview) throw error;
      outcome = preview.result as BatchOutcome;
    }
    total.created.push(...outcome.created);
    total.skipped.push(...outcome.skipped);
    for (const { projectKey, ...failure } of outcome.failed) {
      if (projectKey === undefined || !failedProjects.has(projectKey)) total.failed.push(failure);
      if (projectKey !== undefined) failedProjects.add(projectKey);
    }
  }
  return {
    body: {
      format,
      dryRun,
      total: items.length,
      created: total.created.length,
      skipped: total.skipped,
      failed: total.failed,
      warnings: parsed.warnings,
      tasks: total.created,
    },
  };
};
