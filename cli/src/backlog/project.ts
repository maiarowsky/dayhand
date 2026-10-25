// A Backlog folder names a project, but only an explicit --project assigns it.
import { findProject, projectKey, readProjects, requireProjects, type Project } from "../projects.js";
import type { RunContext } from "../registry/types.js";

export async function backlogProject(ctx: RunContext, name: string): Promise<{ projectId?: string; preview?: string }> {
  await requireProjects(ctx);
  if (projectKey(name) === "none") return { projectId: "none" };
  const client = await ctx.client();
  const existing = findProject(await readProjects(client), name);
  if (existing) return { projectId: existing.id };
  const input = { name, clientId: `${ctx.clientId()}:project` };
  if (ctx.dryRun) {
    // Separate transactions cannot reference a preview id. Validate both operations without
    // writing either: project via REST dryRun, files via import_backlog without that id.
    await client.request("POST", "/api/v1/projects?dryRun=true", input);
    return { preview: name };
  }
  const value = (await client.callTool("add_project", input)).structured as { project: Project };
  return { projectId: value.project.id };
}
