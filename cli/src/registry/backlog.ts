// `dayhand backlog import` and `dayhand backlog export`: a Backlog.md folder
// (Markdown task files with a YAML header, docs/backlog-md.md) in and out. The
// server reads and writes the format (import_backlog, export_backlog); these
// commands move the files between the folder and the server.
import { dependenciesFirst, FILE_CHARS, IMPORT_BYTES, IMPORT_FILES, readFolder, writeFolder, type BacklogFile } from "../backlog/folder.js";
import { CliError, usageError } from "../core/exit.js";
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
async function importFiles(ctx: RunContext, files: BacklogFile[]): Promise<Report> {
  if (!ctx.dryRun) return tool<Report>(ctx, "import_backlog", { files });
  return (await ctx.client()).request("POST", "/api/v1/import/backlog?dryRun=true", { files });
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
    "Reads the Markdown files below <dir> (and the config.yml with the project's statuses) and sends one call, the tasks others depend on first. At most 200 files and 200 KiB of file JSON per invocation; a larger folder is refused before sending anything: import it by subdirectories. " +
    "A selected directory with its own config is the root; otherwise root discovery walks up reserved folder names only, stopping at the first non-reserved directory and using only its config. Statuses map to the nearest of todo, doing and done; unrecognized embedded or negated status words stay todo with a warning. Drafts become proposals; docs, decisions and milestones are skipped. " +
    "Each task's source is {kind: backlog-md, ref: <id>}, so importing the folder again brings only new files. " +
    "Files without an id are skipped. Under an ask policy, one approval allows exactly this one call, as for other tools; repeat the unchanged folder with --approval after the owner allows it. " +
    `--dry-run asks the server what would happen without storing anything. ${NEEDS}`,
  args: [{ name: "dir", description: "The backlog folder (backlog/, or one of its folders such as backlog/tasks)", required: true }],
  tools: ["import_backlog"],
  examples: ["dayhand backlog import backlog --dry-run", "dayhand backlog import backlog --json", "dayhand backlog import backlog/completed"],
  run: async (ctx, args) => {
    const dir = args.dir as string;
    const files = await readFolder(dir).catch((cause: unknown) => {
      throw new CliError("usage", `Cannot read the folder ${dir}`, {}, { cause });
    });
    if (files.length === 0) throw usageError(`No Markdown files below ${dir}`, { hint: "point at the backlog folder, e.g. dayhand backlog import backlog" });
    if (files.length > IMPORT_FILES || Buffer.byteLength(JSON.stringify({ files })) > IMPORT_BYTES) {
      throw usageError(`The folder exceeds one import call (${IMPORT_FILES} files or ${IMPORT_BYTES / 1024} KiB of file JSON); import it by subdirectories`);
    }
    const tooLong = files.find((file) => file.content.length > FILE_CHARS);
    if (tooLong) throw usageError(`${tooLong.path} is longer than ${FILE_CHARS} characters; shorten the file before importing`);
    const value = await importFiles(ctx, dependenciesFirst(files));
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
    "One file per task in tasks/ (proposals in drafts/; with --archived, archived tasks in archive/tasks/ and archived proposals in archive/drafts/), and a config.yml with the statuses To Do, In Progress and Done. " +
    "Tasks imported from Backlog.md keep their ids; the others get <PREFIX>-<number>. The destination must be missing or empty unless --force explicitly confirms writing into an existing folder and replacing exported files, including config.yml. Symlink destinations, task directories and files are refused. " +
    `Due dates, repeat rules and reminders have no place in the format and are left out (the notes say how many). Notes also identify tasks or config.yml whose exported text exceeds Dayhand import limits, including the 100,000-character file limit; text is not truncated. ${NEEDS}`,
  args: [{ name: "dir", description: "The folder to write into (made if missing), e.g. backlog" }],
  options: [
    { flags: "--prefix <prefix>", description: "ID prefix of tasks that did not come from Backlog.md (default task: TASK-12)" },
    { flags: "--archived", description: "Also write archived tasks to archive/tasks/ and archived proposals to archive/drafts/" },
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
      const text = [...value.files.map((f) => f.path), `${value.total} task file(s); pass a folder to write them: dayhand backlog export <dir>`, ...value.notes.map((n) => `  note: ${n}`)].join("\n");
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
