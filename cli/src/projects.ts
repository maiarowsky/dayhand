// Project references, display names and the minimum backend shared by CLI and TUI.
import { CliError, usageError } from "./core/exit.js";
import { isCompatible } from "./core/version.js";
import { isTask } from "./render/model.js";
import type { RunContext } from "./registry/types.js";
import type { DayhandClient } from "./transport/client.js";

export const PROJECT_COLORS = ["red", "orange", "amber", "green", "teal", "cyan", "blue", "indigo", "purple", "pink", "brown", "gray"];
export const PROJECT_MIN_SERVER_VERSION = "0.13.0";
export const PROJECT_NEEDS = `Needs backend ${PROJECT_MIN_SERVER_VERSION} or later (dayhand version)`;
export const POSITION_STEP = 1024;

export type Project = {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  note?: string;
  position: number;
  archived: boolean;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
  counts?: { open: number; overdue: number; dueToday: number; done: number };
};
export type ProjectList = { result: Project[]; noProject: { open: number; overdue: number } };

export const projectKey = (name: string) => name.trim().normalize("NFC").toLowerCase();
export const projectToken = (name: string) => name.replace(/\s+/g, "-");
export const findProject = (projects: Project[], ref: string) => projects.find((p) => p.id === ref) ?? projects.find((p) => projectKey(p.name) === projectKey(ref));
/** Quick add accepts a hyphen in place of a space, never creates from an unknown token. */
export function tokenProject(projects: Project[], token: string, includeArchived = false): Project | undefined {
  const exact = findProject(projects, token);
  if (exact) return !exact.archived || includeArchived ? exact : undefined;
  const matches = projects.filter((p) => (!p.archived || includeArchived) && projectKey(projectToken(p.name)) === projectKey(token));
  return matches.length === 1 ? matches[0] : undefined;
}

export async function requireProjects(ctx: RunContext): Promise<void> {
  if (!isCompatible((await (await ctx.client()).initialize()).version, PROJECT_MIN_SERVER_VERSION)) throw usageError(PROJECT_NEEDS);
}

export const unknownProjectTool = (error: unknown) => error instanceof CliError && error.code === "invalid_argument" && /unknown tool/i.test(error.message);

/** Display names are optional on old servers; all other failures remain visible. */
export async function readProjects(client: Pick<DayhandClient, "callTool">): Promise<Project[]> {
  try {
    return ((await client.callTool("list_projects", { includeArchived: true })).structured as ProjectList).result;
  } catch (error) {
    if (unknownProjectTool(error)) return [];
    throw error;
  }
}

/** Immutable decoration for display/explicit --fields project, never default JSON. */
export function withProjectNames<T>(value: T, projects: Project[]): T {
  const names = new Map(projects.map((p) => [p.id, p.name]));
  function visit(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(visit);
    if (isTask(item)) return { ...item, ...(item.projectId && names.has(item.projectId) ? { project: names.get(item.projectId) } : {}) };
    if (typeof item !== "object" || item === null) return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
  }
  return visit(value) as T;
}

/** Whether any task belongs to a project, other than the `known` project ids. */
export function hasProjectTasks(value: unknown, known: ReadonlySet<string> = new Set()): boolean {
  if (isTask(value)) return typeof value.projectId === "string" && !known.has(value.projectId);
  const visit = (item: unknown) => hasProjectTasks(item, known);
  if (Array.isArray(value)) return value.some(visit);
  return typeof value === "object" && value !== null && Object.values(value).some(visit);
}
