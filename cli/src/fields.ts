// --fields: narrows task objects anywhere in a result (or the settings keys)
// and picks the columns of the text output.
import { usageError } from "./core/exit.js";
import { isTask, SETTINGS_FIELDS, TASK_FIELDS } from "./render/model.js";
import type { FieldsKind } from "./registry/types.js";

const VALID: Record<FieldsKind, readonly string[]> = { task: TASK_FIELDS, settings: SETTINGS_FIELDS };

export function parseFields(raw: string | undefined, kind: FieldsKind | undefined, command: string): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!kind) throw usageError(`--fields is not supported by hlm ${command}`);
  const fields = raw.split(",").map((f) => f.trim()).filter(Boolean);
  const unknown = fields.filter((f) => !VALID[kind].includes(f));
  if (fields.length === 0 || unknown.length) throw usageError("Unknown or missing field names in --fields", { valid: [...VALID[kind]] });
  return fields;
}

const pick = (value: Record<string, unknown>, fields: string[]) =>
  Object.fromEntries(fields.filter((f) => f in value).map((f) => [f, value[f]]));

/** Keys whose values hold tasks in the tool results (task, {task,next}, Today, lists, board, detail). */
const TASK_KEYS = ["task", "next", "now", "overdue", "today", "doneToday", "result", "results", "todo", "doing", "done"];

export function projectFields(value: unknown, kind: FieldsKind, fields: string[]): unknown {
  if (kind === "settings") return pick(value as Record<string, unknown>, fields);
  return projectTasks(value, fields);
}

function projectTasks(value: unknown, fields: string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => projectTasks(v, fields));
  if (isTask(value)) return pick(value, fields);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, TASK_KEYS.includes(k) ? projectTasks(v, fields) : v]),
  );
}
