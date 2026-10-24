// `dayhand backlog import` and `dayhand backlog export`: a Backlog.md folder
// (Markdown task files with a YAML header, docs/backlog-md.md) in and out. The
// server reads and writes the format (import_backlog, export_backlog); these
// commands move the files between the folder and the server.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { batches, dependenciesFirst, existing, FILE_CHARS, readFolder, writeFolder, type BacklogFile } from "../backlog/folder.js";
import { usageError } from "../core/exit.js";
import { tool } from "./ops.js";
import type { CommandSpec, RunContext } from "./types.js";

const NEEDS = "Needs backend 0.12.0 or later.";

type Report = {
  format: "backlog-md";
  dryRun: boolean;
  files: number;
  created: number;
  tasks: { ref: number | null; title: string }[];
  skipped: { path: string; reason: string }[];
  failed: { path: string; title: string | null; message: string }[];
  warnings: { path: string | null; message: string }[];
};

type Export = {
  format: "backlog-md";
  prefix: string;
  total: number;
  config: BacklogFile;
  files: (BacklogFile & { id: string; taskId: string; ref: number | null })[];
  notes: string[];
};

/** One call: the tool, or with --dry-run the REST route that asks the server for a dry run (nothing is held back). */
async function importBatch(ctx: RunContext, files: BacklogFile[]): Promise<Report> {
  if (!ctx.dryRun) return tool<Report>(ctx, "import_backlog", { files });
  return (await ctx.client()).request("POST", "/api/v1/import/backlog?dryRun=true", { files });
}

/** The reports of several calls as one; a single call's report stays as the tool gave it. */
export function mergeReports(reports: Report[], sent: number, tooLong: string[]): Report {
  const tooLongSkips = tooLong.map((path) => ({ path, reason: `longer than ${FILE_CHARS} characters` }));
  if (reports.length === 1 && tooLong.length === 0) return reports[0]!;
  return {
    format: "backlog-md",
    dryRun: reports.some((r) => r.dryRun),
    files: sent + tooLong.length,
    created: reports.reduce((n, r) => n + r.created, 0),
    tasks: reports.flatMap((r) => r.tasks),
    skipped: [...reports.flatMap((r) => r.skipped), ...tooLongSkips],
    failed: reports.flatMap((r) => r.failed),
    warnings: reports.flatMap((r) => r.warnings),
  };
}

export function importText(report: Report): string {
  const head = report.dryRun ? "Dry run: nothing was stored. Would import" : "Imported";
  return [
    `${head} ${report.created} task(s) from ${report.files} file(s) (backlog-md).`,
    ...report.tasks.map((t) => `  ${report.dryRun ? "would create" : "created"}: #${t.ref ?? "?"} ${t.title}`),
    ...report.skipped.map((s) => `  skipped: ${s.path} (${s.reason})`),
    ...report.failed.map((f) => `  failed: ${f.path}: ${f.message}`),
    ...report.warnings.map((w) => `  note: ${w.path ? `${w.path}: ` : ""}${w.message}`),
  ].join("\n");
}

const importCommand: CommandSpec = {
  name: "import",
  schema: "backlog-import.schema.json",
  summary: "Import a Backlog.md folder: each task file becomes a task; files imported before are skipped",
  description:
    "Reads the Markdown files below <dir> (and the config.yml with the project's statuses) and sends them, the tasks others depend on first, in calls of up to 200 files. " +
    "Statuses map to the nearest of todo, doing and done; drafts become proposals; docs, decisions and milestones are skipped. " +
    "Each task's source is {kind: backlog-md, ref: <id>}, so importing the folder again brings only new files. " +
    `--dry-run asks the server what would happen without storing anything (a folder sent in several calls cannot see dependencies across calls). ${NEEDS}`,
  args: [{ name: "dir", description: "The backlog folder (backlog/, or one of its folders such as backlog/tasks)", required: true }],
  tools: ["import_backlog"],
  examples: ["dayhand backlog import backlog --dry-run", "dayhand backlog import backlog --json", "dayhand backlog import backlog/completed"],
  run: async (ctx, args) => {
    const dir = args.dir as string;
    const { files, tooLong } = await readFolder(dir).catch(() => {
      throw usageError(`Cannot read the folder ${dir}`);
    });
    if (files.length === 0 && tooLong.length === 0) throw usageError(`No Markdown files below ${dir}`, { hint: "point at the backlog folder, e.g. dayhand backlog import backlog" });
    const reports: Report[] = [];
    for (const batch of batches(dependenciesFirst(files))) reports.push(await importBatch(ctx, batch));
    const value = mergeReports(reports, files.length, tooLong);
    return { value, view: { kind: "text", text: importText(value) } };
  },
};

/** What dayhand backlog export <dir> wrote. */
type Written = { format: "backlog-md"; prefix: string; directory: string; total: number; written: string[]; config: string | null; notes: string[] };

const exportCommand: CommandSpec = {
  name: "export",
  schema: ["backlog-written.schema.json", "backlog-export.schema.json"],
  summary: "Write the plan as Backlog.md task files into a folder (without one, --json prints the files)",
  description:
    "One file per task in tasks/ (proposals in drafts/, archived tasks with --archived in archive/tasks/), and a config.yml with the statuses To Do, In Progress and Done unless one is there. " +
    "Tasks imported from Backlog.md keep their ids; the others get <PREFIX>-<number>. Files that already exist are not overwritten without --force. " +
    `Due dates, repeat rules and reminders have no place in the format and are left out (the notes say how many). ${NEEDS}`,
  args: [{ name: "dir", description: "The folder to write into (made if missing), e.g. backlog" }],
  options: [
    { flags: "--prefix <prefix>", description: "ID prefix of tasks that did not come from Backlog.md (default task: TASK-12)" },
    { flags: "--archived", description: "Also write archived tasks, to archive/tasks/" },
    { flags: "--force", description: "Overwrite files that already exist, config.yml too" },
  ],
  tools: ["export_backlog"],
  dryRun: false,
  examples: ["dayhand backlog export backlog", "dayhand backlog export backlog --prefix shop --archived", "dayhand backlog export --json"],
  run: async (ctx, args, opts) => {
    const value = await tool<Export>(ctx, "export_backlog", {
      ...(opts.prefix !== undefined ? { prefix: opts.prefix } : {}),
      ...(opts.archived ? { includeArchived: true } : {}),
    });
    const dir = args.dir as string | undefined;
    if (dir === undefined) {
      const text = [...value.files.map((f) => f.path), `${value.total} task file(s); pass a folder to write them: dayhand backlog export <dir>`].join("\n");
      return { value, view: { kind: "text", text } };
    }
    const clash = existing(dir, value.files.map((f) => f.path));
    if (clash.length && !opts.force) {
      throw usageError(`${clash.length} file(s) already exist in ${dir}, e.g. ${clash[0]}; nothing was written`, { hint: "pass --force to overwrite them, or choose an empty folder" });
    }
    const writeConfig = Boolean(opts.force) || !existsSync(join(dir, value.config.path));
    await writeFolder(dir, [...(writeConfig ? [value.config] : []), ...value.files]);
    const written: Written = {
      format: "backlog-md",
      prefix: value.prefix,
      directory: dir,
      total: value.total,
      written: value.files.map((f) => f.path),
      config: writeConfig ? value.config.path : null,
      notes: value.notes,
    };
    const text = [`Wrote ${value.total} task file(s) to ${dir}${writeConfig ? " and config.yml" : " (kept its config.yml)"}.`, ...value.notes.map((n) => `  note: ${n}`)].join("\n");
    return { value: written, view: { kind: "text", text } };
  },
};

export const backlogCommands: CommandSpec[] = [
  {
    name: "backlog",
    summary: "Backlog.md folders: import task files as tasks, export the plan as task files",
    description: `Backlog.md (MIT License, by Alex Gavrilescu) keeps tasks as Markdown files in a backlog/ folder; docs/backlog-md.md says what maps to what. ${NEEDS}`,
    tools: [],
    examples: ["dayhand backlog import backlog --dry-run", "dayhand backlog export backlog"],
    subcommands: [importCommand, exportCommand],
  },
];
