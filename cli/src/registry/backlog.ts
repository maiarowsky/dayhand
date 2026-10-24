// `dayhand backlog import` and `dayhand backlog export`: a Backlog.md folder
// (Markdown task files with a YAML header, docs/backlog-md.md) in and out. The
// server reads and writes the format (import_backlog, export_backlog); these
// commands move the files between the folder and the server.
import { createHash } from "node:crypto";
import { batches, dependenciesFirst, FILE_CHARS, readFolder, writeFolder, type BacklogFile } from "../backlog/folder.js";
import { CliError, usageError } from "../core/exit.js";
import { tool } from "./ops.js";
import type { CommandSpec, RunContext } from "./types.js";

const NEEDS = "Needs backend 0.12.0 or later.";
const MAX_IMPORT_BATCHES = 256;
type ImportRun = { batches: { hash: string; files: number }[] };

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
async function importBatch(ctx: RunContext, files: BacklogFile[], run?: ImportRun): Promise<Report> {
  const input = { files, ...(run ? { run } : {}) };
  if (!ctx.dryRun) return tool<Report>(ctx, "import_backlog", input);
  return (await ctx.client()).request("POST", "/api/v1/import/backlog?dryRun=true", input);
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
    "Under an ask policy, one approval covers the whole import and its file count; retry the unchanged folder with --approval after the owner allows it. " +
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
    const calls = batches(dependenciesFirst(files));
    if (calls.length > MAX_IMPORT_BATCHES) throw usageError(`An import supports at most ${MAX_IMPORT_BATCHES} batches; split the folder`);
    const run: ImportRun | undefined = calls.length > 1 ? {
      batches: calls.map((batch) => ({ hash: createHash("sha256").update(JSON.stringify(batch)).digest("hex"), files: batch.length })),
    } : undefined;
    const reports: Report[] = [];
    for (const batch of calls) reports.push(await importBatch(ctx, batch, run));
    const value = mergeReports(reports, files.length, tooLong);
    return { value, view: { kind: "text", text: importText(value) } };
  },
};

/** What dayhand backlog export <dir> wrote. */
type Written = { format: "backlog-md"; prefix: string; directory: string; total: number; written: string[]; config: string; notes: string[] };

const exportCommand: CommandSpec = {
  name: "export",
  schema: ["backlog-written.schema.json", "backlog-export.schema.json"],
  summary: "Write the plan as Backlog.md task files into a folder (without one, --json prints the files)",
  description:
    "One file per task in tasks/ (proposals in drafts/, archived tasks with --archived in archive/tasks/), and a config.yml with the statuses To Do, In Progress and Done. " +
    "Tasks imported from Backlog.md keep their ids; the others get <PREFIX>-<number>. The destination must be missing or empty unless --force explicitly confirms writing into an existing folder and replacing exported files, including config.yml. Symlink destinations, task directories and files are refused. " +
    `Due dates, repeat rules and reminders have no place in the format and are left out (the notes say how many). ${NEEDS}`,
  args: [{ name: "dir", description: "The folder to write into (made if missing), e.g. backlog" }],
  options: [
    { flags: "--prefix <prefix>", description: "ID prefix of tasks that did not come from Backlog.md (default task: TASK-12)" },
    { flags: "--archived", description: "Also write archived tasks, to archive/tasks/" },
    { flags: "--force", description: "Confirm writing into a non-empty folder and replacing exported files, config.yml too" },
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
    await writeFolder(dir, [value.config, ...value.files], Boolean(opts.force)).catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : `Cannot write the folder ${dir}`;
      throw new CliError("usage", message, { hint: "choose a fresh folder, or pass --force to confirm replacement in an existing folder" }, { cause });
    });
    const written: Written = {
      format: "backlog-md",
      prefix: value.prefix,
      directory: dir,
      total: value.total,
      written: value.files.map((f) => f.path),
      config: value.config.path,
      notes: value.notes,
    };
    const text = [`Wrote ${value.total} task file(s) to ${dir} and config.yml.`, ...value.notes.map((n) => `  note: ${n}`)].join("\n");
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
