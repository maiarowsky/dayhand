#!/usr/bin/env node
// helm: a thin command line client. Every command is one MCP tools/call on
// the same /mcp endpoint the agent uses, authenticated with HELM_API_KEY.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const USAGE = `Usage: helm <command> [options]

Commands:
  today                              Overdue, today and done today
  add <title...> [--date D] [--time HH:MM] [--label L]... [--note TEXT] [--no-date]
                                     Add a task (default date: today)
  done <taskId>                      Mark a task done
  move <taskId> <date> [--time HH:MM]
                                     Reschedule (date: YYYY-MM-DD, today, tomorrow)
  now <taskId> [--note TEXT]         Make it the "now" task, with a resume note
  now --clear                        Clear the "now" task
  list [--label L]... [--done]       All open tasks (with --done also done ones)
  export [--format md|json]          Print the whole plan

Options:
  --json     Print the raw JSON result
  --help     Show this help

Environment:
  HELM_URL       Deployment HTTP actions URL, e.g. http://127.0.0.1:3211
  HELM_API_KEY   Personal API key`;

const EXIT = { ok: 0, failed: 1, usage: 2, auth: 3 };

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function endpoint() {
  const base = process.env.HELM_URL;
  if (!base) throw new CliError("HELM_URL is not set", EXIT.usage);
  if (!process.env.HELM_API_KEY) throw new CliError("HELM_API_KEY is not set", EXIT.usage);
  return base.replace(/\/+$/, "").replace(/\/mcp$/, "") + "/mcp";
}

async function callTool(name, args = {}) {
  let response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${process.env.HELM_API_KEY}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
  } catch (error) {
    throw new CliError(`Cannot reach ${process.env.HELM_URL}: ${error.cause?.code ?? error.message}`, EXIT.failed);
  }
  if (response.status === 401) throw new CliError("HELM_API_KEY was rejected (wrong or revoked)", EXIT.auth);
  if (!response.ok) throw new CliError(`Server answered HTTP ${response.status}`, EXIT.failed);
  const message = await response.json();
  if (message.error) throw new CliError(message.error.message, EXIT.failed);
  const text = message.result.content?.[0]?.text ?? "";
  if (message.result.isError) throw new CliError(text, EXIT.failed);
  // The text block carries the result as JSON (Markdown for a Markdown export).
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---- Output ----

function line(task) {
  const box = task.status === "done" ? "[x]" : task.status === "doing" ? "[~]" : "[ ]";
  const when = [task.dueDate, task.dueTime].filter(Boolean).join(" ");
  const labels = task.labels.map((l) => `#${l}`).join(" ");
  return ["  " + box, when, task.title, labels, `(${task.id})`].filter(Boolean).join(" ");
}

function printToday(view) {
  const out = [`Today, ${view.date} (${view.timezone})`];
  if (view.now) {
    out.push(`NOW  ${view.now.title} (${view.now.id})`);
    if (view.now.resumeNote) out.push(`     next: ${view.now.resumeNote}`);
  }
  if (view.overdue.length) out.push(`OVERDUE (${view.overdue.length})`, ...view.overdue.map(line));
  out.push("TODAY", ...(view.today.length ? view.today.map(line) : ["  (nothing planned)"]));
  if (view.doneToday.length) out.push(`DONE (${view.doneToday.length})`, ...view.doneToday.map(line));
  console.log(out.join("\n"));
}

// ---- Commands ----

function need(value, what) {
  if (!value) throw new CliError(`Missing ${what}\n\n${USAGE}`, EXIT.usage);
  return value;
}

async function run(command, positionals, options) {
  const show = (result, pretty) => (options.json ? console.log(JSON.stringify(result, null, 2)) : pretty(result));
  switch (command) {
    case "today":
      return show(await callTool("list_today"), printToday);
    case "add": {
      const title = need(positionals.join(" ").trim(), "title");
      const args = { title, clientId: randomUUID() };
      if (!options["no-date"]) args.dueDate = options.date ?? "today";
      if (options.time) args.dueTime = options.time;
      if (options.label) args.labels = options.label;
      if (options.note) args.note = options.note;
      return show(await callTool("add_task", args), (t) => console.log(`Added:\n${line(t)}`));
    }
    case "done": {
      const result = await callTool("complete_task", { taskId: need(positionals[0], "taskId"), clientId: randomUUID() });
      return show(result, ({ task, next }) =>
        console.log(`Done:\n${line(task)}` + (next ? `\nNext occurrence:\n${line(next)}` : "")),
      );
    }
    case "move": {
      const args = { taskId: need(positionals[0], "taskId"), dueDate: need(positionals[1], "date"), clientId: randomUUID() };
      if (options.time) args.dueTime = options.time;
      return show(await callTool("reschedule_task", args), (t) => console.log(`Moved:\n${line(t)}`));
    }
    case "now": {
      if (options.clear) return show(await callTool("set_now", { taskId: null }), () => console.log("Now task cleared"));
      const args = { taskId: need(positionals[0], "taskId"), clientId: randomUUID() };
      if (options.note) args.resumeNote = options.note;
      return show(await callTool("set_now", args), (t) => console.log(`Now:\n${line(t)}`));
    }
    case "list": {
      const args = { includeDone: Boolean(options.done) };
      if (options.label) args.labels = options.label;
      return show(await callTool("list_all", args), (tasks) =>
        console.log(tasks.length ? tasks.map(line).join("\n") : "(no tasks)"),
      );
    }
    case "export": {
      const format = options.format === "json" ? "json" : "markdown";
      if (options.format && !["md", "markdown", "json"].includes(options.format)) {
        throw new CliError("--format must be md or json", EXIT.usage);
      }
      const result = await callTool("export_plan", { format });
      return console.log(format === "json" ? JSON.stringify(result.content, null, 2) : result);
    }
    default:
      throw new CliError(command ? `Unknown command: ${command}\n\n${USAGE}` : USAGE, EXIT.usage);
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        help: { type: "boolean" },
        date: { type: "string" },
        time: { type: "string" },
        label: { type: "string", multiple: true },
        note: { type: "string" },
        "no-date": { type: "boolean" },
        done: { type: "boolean" },
        clear: { type: "boolean" },
        format: { type: "string" },
      },
    });
  } catch (error) {
    throw new CliError(`${error.message}\n\n${USAGE}`, EXIT.usage);
  }
  const [command, ...rest] = parsed.positionals;
  if (parsed.values.help) return console.log(USAGE);
  await run(command, rest, parsed.values);
}

main().catch((error) => {
  console.error(error instanceof CliError ? error.message : `Unexpected error: ${error.message}`);
  process.exit(error instanceof CliError ? error.code : EXIT.failed);
});
