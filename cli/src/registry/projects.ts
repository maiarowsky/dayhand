// Project commands call the merged backend tools; tasks still have independent labels.
import { CliError, usageError } from "../core/exit.js";
import { findProject, POSITION_STEP, PROJECT_COLORS, PROJECT_NEEDS, requireProjects, unknownProjectTool, type Project, type ProjectList } from "../projects.js";
import { tsv } from "../render/format.js";
import type { Task } from "../render/model.js";
import { eachRef, oneOrMany, tool } from "./ops.js";
import type { CommandSpec, Opts, Outcome, RunContext } from "./types.js";

export const PROJECT_OPTION = { flags: "-p, --project <project>", description: "Project name or id (none: without a project); backend 0.13.0" };
const PROJECT = { name: "project", description: "Project name or id", required: true };
const PROJECTS = { name: "projects", description: "Project names or ids", required: true, variadic: true };

function line(project: Project): string {
  const counts = project.counts ? `  ${project.counts.open} open, ${project.counts.overdue} overdue` : "";
  return `${project.icon ? `${project.icon} ` : ""}+${project.name}${project.archived ? " (archived)" : ""}${counts}`;
}

async function list(ctx: RunContext, _args: unknown, opts: Opts): Promise<Outcome> {
  const value = await tool<ProjectList>(ctx, "list_projects", { includeArchived: Boolean(opts.archived) });
  const text = ctx.format === "plain"
    ? tsv(value.result.map((p) => [p.id, p.name, p.archived ? "archived" : "active", String(p.counts!.open), String(p.counts!.overdue)]))
    : [...value.result.map(line), `Without a project: ${value.noProject.open} open, ${value.noProject.overdue} overdue`].join("\n");
  return { value, view: { kind: "text", text } };
}

/** --before/--after use the middle between neighbours; first/last leave a normal step. */
async function position(ctx: RunContext, ref: string, opts: Opts): Promise<number | undefined> {
  const projects = (await tool<ProjectList>(ctx, "list_projects", { includeArchived: true })).result;
  const current = findProject(projects, ref);
  if (!current) return undefined;
  const others = projects.filter((p) => p.id !== current.id);
  if (opts.first) return others.length ? others[0]!.position - POSITION_STEP : 0;
  if (opts.last) return others.length ? others.at(-1)!.position + POSITION_STEP : 0;
  const targetRef = (opts.before ?? opts.after) as string;
  const target = findProject(projects, targetRef);
  if (!target) throw new CliError("not_found", `Project "${targetRef}" not found`);
  if (target.id === current.id) throw usageError("Cannot move a project relative to itself");
  const index = others.findIndex((p) => p.id === target.id);
  const neighbour = others[index + (opts.before ? -1 : 1)];
  const placed = neighbour ? target.position / 2 + neighbour.position / 2 : target.position + (opts.before ? -POSITION_STEP : POSITION_STEP);
  if (neighbour && (placed <= Math.min(target.position, neighbour.position) || placed >= Math.max(target.position, neighbour.position))) {
    throw usageError("Cannot reorder projects: no representable position remains between these neighbours");
  }
  return placed;
}

function metadata(opts: Opts): Record<string, unknown> {
  return Object.fromEntries(["name", "color", "icon", "note"].flatMap((key) => {
    const clear = opts[`clear${key[0]!.toUpperCase()}${key.slice(1)}`];
    if (clear && opts[key] !== undefined) throw usageError(`--${key} cannot be combined with --clear-${key}`);
    return clear ? [[key, null]] : opts[key] !== undefined ? [[key, opts[key]]] : [];
  }));
}

function archive(name: "archive" | "unarchive"): CommandSpec {
  return {
    name, schema: ["project.schema.json", "results.schema.json"], summary: name === "archive" ? "Archive projects; their tasks stay where they are" : "Restore archived projects", args: [PROJECTS], tools: ["update_project"],
    examples: [`dayhand project ${name} Home`],
    run: async (ctx, args) => {
      const refs = args.projects as string[];
      const base = ctx.clientId();
      const results: Project[] = [];
      for (const [i, projectId] of refs.entries()) {
        results.push(await tool<Project>(ctx, "update_project", { projectId, archived: name === "archive", clientId: refs.length === 1 ? base : `${base}:${i + 1}` }));
      }
      return { value: oneOrMany(results), view: { kind: "text", text: results.map(line).join("\n") } };
    },
  };
}

const commands: CommandSpec[] = [
  { name: "list", schema: "project-list.schema.json", summary: "Projects in menu order with open and overdue counts", options: [{ flags: "--archived", description: "Include archived projects" }], tools: ["list_projects"], examples: ["dayhand project list --archived --json"], run: list },
  {
    name: "add", schema: "project-added.schema.json", summary: "Create a project, optionally moving tasks from a label",
    description: "Here --color is the project's token; put terminal --color auto|always|never before project. --no-color still controls terminal output.",
    args: [{ name: "name", description: "Project name (1–50 characters, unique in any case)", required: true, variadic: true }],
    options: [
      { flags: "--color <token>", description: "Project color", choices: PROJECT_COLORS },
      { flags: "--icon <emoji>", description: "One emoji" }, { flags: "--note <text>", description: "Project context (up to 2000 characters)" },
      { flags: "--from-label <label>", description: "Move tasks with this label and no project; report skipped tasks" },
      { flags: "--remove-label", description: "Remove the label from moved tasks (requires --from-label)" },
    ], tools: ["add_project"],
    examples: ['dayhand project add "Strona piekarni" --color amber --icon 🥐 --note "Strona i menu dla piekarni"', "dayhand project add Dom --from-label dom --dry-run"],
    run: async (ctx, args, opts) => {
      const value = await tool<{ project: Project; moved: unknown[]; skipped: unknown[] }>(ctx, "add_project", {
        ...metadata(opts), name: (args.name as string[]).join(" "), clientId: ctx.clientId(),
        ...(opts.fromLabel !== undefined ? { fromLabel: opts.fromLabel } : {}), ...(opts.removeLabel ? { removeLabel: true } : {}),
      });
      return { value, view: { kind: "text", text: `Added ${line(value.project)}\nMoved ${value.moved.length}; skipped ${value.skipped.length}` } };
    },
  },
  {
    name: "edit", schema: "project.schema.json", summary: "Change project metadata or menu order", args: [PROJECT],
    description: "Here --color is the project's token; put terminal --color auto|always|never before project. --no-color still controls terminal output.",
    options: [
      { flags: "--name <name>", description: "New name" }, { flags: "--color <token>", description: "Project color", choices: PROJECT_COLORS },
      { flags: "--clear-color", description: "Remove the color" }, { flags: "--icon <emoji>", description: "One emoji" }, { flags: "--clear-icon", description: "Remove the icon" },
      { flags: "--note <text>", description: "Project context" }, { flags: "--clear-note", description: "Remove the note" },
      { flags: "--before <project>", description: "Move before this project" }, { flags: "--after <project>", description: "Move after this project" },
      { flags: "--first", description: "Move to the start" }, { flags: "--last", description: "Move to the end" },
    ], tools: ["update_project", "list_projects"], examples: ["dayhand project edit Home --first", 'dayhand project edit Home --name "New home" --clear-icon'],
    run: async (ctx, args, opts) => {
      const input = metadata(opts);
      const selected = ["before", "after", "first", "last"].filter((key) => opts[key] !== undefined);
      if (selected.length > 1) throw usageError("Use only one of --before, --after, --first or --last");
      if (!Object.keys(input).length && !selected.length) throw usageError("Nothing to change: give at least one option");
      const placed = selected.length ? await position(ctx, args.project as string, opts) : undefined;
      if (placed !== undefined) input.position = placed;
      const value = await tool<Project>(ctx, "update_project", { projectId: args.project, ...input, clientId: ctx.clientId() });
      return { value, view: { kind: "text", text: `Updated ${line(value)}` } };
    },
  },
  archive("archive"), archive("unarchive"),
  {
    name: "rm", schema: "project-delete.schema.json", summary: "Delete a project (owner only); move all its tasks explicitly", args: [PROJECT],
    options: [{ flags: "--move-tasks-to <project|none>", description: "Destination for every task, including trash; required if the project has tasks" }],
    tools: ["delete_project"], examples: ["dayhand project rm Zdrowie --move-tasks-to none"],
    run: async (ctx, args, opts) => {
      const value = await tool<{ project: Project; moved: unknown[] }>(ctx, "delete_project", { projectId: args.project, ...(opts.moveTasksTo !== undefined ? { moveTasksTo: opts.moveTasksTo } : {}), clientId: ctx.clientId() }).catch((error: unknown) => {
        if (error instanceof CliError && error.code === "precondition_failed") throw error.with({ hint: "dayhand project rm <project> --move-tasks-to <project|none>" });
        throw error;
      });
      return { value, view: { kind: "text", text: `Deleted ${line(value.project)}; moved ${value.moved.length} task(s)` } };
    },
  },
  {
    name: "assign", schema: ["task.schema.json", "results.schema.json"], summary: "Move tasks to a project (none clears it); several tasks require --yes or confirmation",
    args: [{ ...PROJECT, description: "Project name, id or none" }, { name: "refs", description: "Task numbers, now or ids", required: true, variadic: true }],
    tools: ["update_task"], fields: "task", examples: ["dayhand project assign Dom 41 42 -y", "dayhand project assign none 41"],
    run: async (ctx, args) => {
      const refs = args.refs as string[];
      if (refs.length > 1 && !ctx.yes) {
        if (!ctx.interactive) throw usageError("Refusing to assign several tasks without --yes", { hint: "dayhand project assign <project|none> <refs...> --yes" });
        if (!(await ctx.confirm(`Assign ${refs.length} tasks to ${args.project}?`))) throw usageError("Cancelled; nothing was changed");
      }
      const results = await eachRef({ ...ctx, yes: true }, refs, "assign", (taskId, clientId) => tool<Task>(ctx, "update_task", { taskId, projectId: args.project, clientId }));
      return { value: oneOrMany(results), view: { kind: "tasks", verb: "Assigned", tasks: results } };
    },
  },
];

/** Even assign/clear, which use existing task tools, must reject pre-project backends. */
function guarded(spec: CommandSpec): CommandSpec {
  const run = spec.run!;
  return { ...spec, run: async (ctx, args, opts) => {
    await requireProjects(ctx);
    try { return await run(ctx, args, opts); }
    catch (error) {
      if (unknownProjectTool(error)) throw new CliError("usage", PROJECT_NEEDS, {}, { cause: error });
      throw error;
    }
  } };
}

export const projectCommands: CommandSpec[] = [guarded({
  name: "project", schema: "project-list.schema.json", summary: "Projects and their task counts (same as project list)", description: PROJECT_NEEDS,
  options: [{ flags: "--archived", description: "Include archived projects" }], tools: ["list_projects"], examples: ["dayhand project", "dayhand project list --json"], run: list,
  subcommands: commands.map(guarded),
})];
