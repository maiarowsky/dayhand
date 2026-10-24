// The calls dayhand ui makes, over the same DayhandClient (MCP) as every dayhand command.
// Reads and changes each go through a budget under the server's per-key
// limits; a change carries one clientId through its retries, so a change the
// server applied before the connection dropped is not applied twice.
import { randomUUID } from "node:crypto";
import { CliError } from "../core/exit.js";
import { t } from "../i18n/index.js";
import type { Board, Detail, Task, TodayView } from "../render/model.js";
import type { DayhandClient } from "../transport/client.js";
import { addDays } from "../when/calendar.js";
import { Budget, CHANGES_PER_MINUTE, READS_PER_MINUTE } from "./budget.js";
import type { Agents, Approval, Controls, Health } from "./agents.js";

/** The UI's own limit was reached; nothing was sent. */
export class Throttled extends Error {
  constructor(readonly waitMs: number) {
    super(t("conn.throttled", { seconds: Math.ceil(waitMs / 1000) }));
  }
}

export type Api = {
  settings(): Promise<{ timezone: string }>;
  today(): Promise<TodayView>;
  health(): Promise<Health>;
  agents(): Promise<Agents>;
  board(): Promise<Board>;
  /** Tasks due Monday `start` to Sunday, done ones included. */
  week(start: string): Promise<Task[]>;
  trash(): Promise<Task[]>;
  task(id: string): Promise<Detail>;
  /** A changing tool call, retried on a dropped connection; task changes carry one clientId. */
  change<T = Record<string, unknown>>(tool: string, args: Record<string, unknown>): Promise<T>;
};

const RETRY_DELAYS_MS = [1000, 3000];
const DONE_LIMIT = 30;
const PAGE = 200;
const MAX_PAGES = 5;

/** Seconds from a rate_limited error ("try again in 12 s"), in ms; a minute when not given. */
export function retryAfterMs(error: CliError): number {
  const seconds = /in (\d+) s/.exec(`${error.message} ${error.details.hint ?? ""}`)?.[1];
  return seconds ? Number(seconds) * 1000 : 60_000;
}

export function makeApi(
  client: Pick<DayhandClient, "callTool">,
  options: { reads?: Budget; changes?: Budget; sleep?: (ms: number) => Promise<void> } = {},
): Api {
  const reads = options.reads ?? new Budget(READS_PER_MINUTE);
  const changes = options.changes ?? new Budget(CHANGES_PER_MINUTE);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function call<T>(budget: Budget, tool: string, args: Record<string, unknown>): Promise<T> {
    if (!budget.take()) throw new Throttled(budget.waitMs());
    try {
      return ((await client.callTool(tool, args)).structured ?? {}) as T;
    } catch (error) {
      if (error instanceof CliError && error.code === "rate_limited") budget.pause(retryAfterMs(error));
      throw error;
    }
  }
  const read = <T>(tool: string, args: Record<string, unknown> = {}) => call<T>(reads, tool, args);

  return {
    settings: () => read("get_settings"),
    today: () => read("list_today"),
    health: () => read("plan_health"),
    agents: async () => {
      const [controls, { approvals }, proposals] = await Promise.all([
        read<Controls>("get_agent_controls"),
        read<{ approvals: Approval[] }>("list_approvals", { status: "pending", limit: PAGE }),
        (async () => {
          const tasks: Task[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < MAX_PAGES; page++) {
            const result = await read<{ result: Task[]; nextCursor?: string | null }>("list_all", { proposed: true, limit: PAGE, ...(cursor ? { cursor } : {}) });
            tasks.push(...(result.result ?? []));
            if (!result.nextCursor) break;
            cursor = result.nextCursor;
          }
          return tasks;
        })(),
      ]);
      return { controls, approvals, proposals };
    },
    board: () => read("board", { doneLimit: DONE_LIMIT }),
    trash: async () => (await read<{ result: Task[] }>("list_trash")).result ?? [],
    task: (id) => read("get_task", { taskId: id }),
    week: async (start) => {
      const tasks: Task[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const args = { dueAfter: addDays(start, -1), dueBefore: addDays(start, 7), includeDone: true, limit: PAGE, ...(cursor ? { cursor } : {}) };
        const result = await read<{ result: Task[]; nextCursor?: string | null }>("list_all", args);
        tasks.push(...(result.result ?? []));
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      return tasks;
    },
    change: async <T>(tool: string, args: Record<string, unknown>) => {
      // These owner controls are idempotent and their MCP schemas do not accept clientId.
      const input = tool === "pause_agents" || tool === "decide_approval" ? args : { ...args, clientId: randomUUID() };
      for (let attempt = 0; ; attempt++) {
        try {
          return await call<T>(changes, tool, input);
        } catch (error) {
          const retry = error instanceof CliError && error.code === "unavailable" && attempt < RETRY_DELAYS_MS.length;
          if (!retry) throw error;
          await sleep(RETRY_DELAYS_MS[attempt]!);
        }
      }
    },
  };
}
