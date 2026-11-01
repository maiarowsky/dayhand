// The running dayhand ui without the terminal: it loads what the current view
// needs, polls it, turns keys and clicks into state and server calls, and
// keeps the last data on screen when the server cannot be reached, so the
// screen never waits on the network. Ink only paints `frame()` (app.tsx).
import { CliError, toCliError } from "../core/exit.js";
import { t } from "../i18n/index.js";
import type { Task } from "../render/model.js";
import { hasProjectTasks, withProjectNames } from "../projects.js";
import { isoWeekday, localAt } from "../when/calendar.js";
import { Throttled, type Api } from "./api.js";
import { agentId } from "./agents.js";
import { ClipboardError, copyText, taskText, type ClipboardMethod } from "./clipboard.js";
import { runChange, type EffectContext } from "./effects.js";
import { frame, scrollLimits } from "./frame.js";
import { handleKey, type Effect } from "./handle.js";
import { weekStart } from "./lists.js";
import { derive, type Conn, type Data, type Flash, type Snapshot } from "./model.js";
import type { Screen } from "./screens/screen.js";
import { initialState, keepRow, reanchor, selectedAgent, selectedTask, VIEWS, type UiState, type ViewName } from "./state.js";

export const DEFAULT_INTERVAL_S = 60;
const MAX_INTERVAL_S = 300;
const UNCHANGED_POLLS = 3;
const HEALTH_POLLS = 5;
const FLASH_MS = { ok: 5000, info: 5000, error: 10_000 };

export type ControllerOptions = {
  api: Api;
  view: ViewName;
  /** Base seconds between refreshes; idle polling backs off to 300 seconds. */
  interval?: number;
  now?: () => number;
  columns?: number;
  rows?: number;
  /** Runs $VISUAL/$EDITOR on the text and returns what was saved (core/editor.ts). */
  editText?: (text: string, fileName: string) => string;
  /** Copies plain text without a server call. */
  copyText?: (text: string) => Promise<ClipboardMethod>;
  /** Called around the editor: mouse reporting off before, on after. */
  beforeEditor?: () => void;
  afterEditor?: () => void;
};

type Suspend = (run: () => Promise<void>) => Promise<void>;

export type Mouse = { button: number; x: number; y: number; release: boolean };

export class Controller {
  private ui: UiState;
  private data: Data = {};
  private conn: Conn = { state: "connecting" };
  private flash?: Flash;
  private busy = 0;
  private columns: number;
  private rows: number;
  private timezone?: string;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private readonly inflight = new Map<string, Promise<void>>();
  private changes: Promise<void> = Promise.resolve();
  private copies: Promise<void> = Promise.resolve();
  private completingTaskId?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private pollingEnabled = false;
  private polling = false;
  private pollInterval: number;
  private unchangedPolls = 0;
  private todayPolls = 0;
  private activity = 0;
  private flashTimer?: ReturnType<typeof setTimeout>;
  private version = 0;
  private cached?: { version: number; screen: Screen };
  private stopped = false;
  private quitHandler?: () => void;
  private suspend?: Suspend;
  private input?: { pause: () => void; resume: () => void };

  constructor(private readonly options: ControllerOptions) {
    this.pollInterval = options.interval ?? DEFAULT_INTERVAL_S;
    this.now = options.now ?? Date.now;
    this.columns = options.columns ?? 80;
    this.rows = options.rows ?? 24;
    const today = localAt(this.now(), "UTC").date;
    const ui = initialState(options.view, weekStart(today));
    this.ui = { ...ui, cursor: { ...ui.cursor, weekDay: isoWeekday(today) - 1 } };
  }

  // React's useSyncExternalStore reads these.
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  /** Ink's exit, called on q. */
  onQuit(handler: () => void): () => void {
    this.quitHandler = handler;
    return () => {
      if (this.quitHandler === handler) this.quitHandler = undefined;
    };
  }

  /** Ink's suspendTerminal: the editor gets the terminal, then Ink repaints. */
  lendTerminal(suspend: Suspend): void {
    this.suspend = suspend;
  }

  /** The raw input listener (mouse reports): off while the editor has the terminal. */
  lendInput(input: { pause: () => void; resume: () => void }): void {
    this.input = input;
  }

  private async editText(text: string, fileName: string): Promise<string> {
    const edit = this.options.editText;
    if (!edit) throw new CliError("usage", t("error.noEditor"));
    let saved = text;
    const run = async () => {
      saved = edit(text, fileName);
    };
    // Before Ink lets go of stdin, or a 'data' listener would start reading the editor's keys.
    this.options.beforeEditor?.();
    this.input?.pause();
    try {
      await (this.suspend ? this.suspend(run) : run());
    } finally {
      this.input?.resume();
      this.options.afterEditor?.();
    }
    return saved;
  }

  snapshot(): Snapshot {
    return { ui: this.ui, data: withProjectNames(this.data, this.data.projects ?? []), conn: this.conn, flash: this.flash, busy: this.busy, columns: this.columns, rows: this.rows, timezone: this.timezone, today: this.today(), now: this.now(), interval: this.pollInterval };
  }

  frame(): Screen {
    if (this.cached?.version !== this.version) this.cached = { version: this.version, screen: frame(this.snapshot()) };
    return this.cached.screen;
  }

  private today(): string {
    return this.data.today?.date ?? localAt(this.now(), this.timezone ?? "UTC").date;
  }

  /** Loads the first view, then polls only what is on screen, less often when idle. */
  async start(): Promise<void> {
    await this.refresh();
    this.pollingEnabled = true;
    this.schedulePoll();
  }

  private schedulePoll(): void {
    clearTimeout(this.timer);
    if (this.pollingEnabled && !this.stopped && !this.polling) {
      this.timer = setTimeout(() => void this.poll(), this.pollInterval * 1000);
    }
  }

  private resetPolling(): void {
    this.activity++;
    this.unchangedPolls = 0;
    const base = this.options.interval ?? DEFAULT_INTERVAL_S;
    const changed = this.pollInterval !== base;
    this.pollInterval = base;
    this.schedulePoll();
    if (changed) this.emit();
  }

  private async poll(): Promise<void> {
    this.polling = true;
    const activity = this.activity;
    if (this.ui.view === "today") this.todayPolls++;
    try {
      await this.refresh(false, false);
      if (activity === this.activity && ++this.unchangedPolls >= UNCHANGED_POLLS) {
        this.unchangedPolls = 0;
        this.pollInterval = Math.min(this.pollInterval * 2, MAX_INTERVAL_S);
        this.emit();
      }
    } finally {
      this.polling = false;
      this.schedulePoll();
    }
  }

  /** Compare view data, not connection timestamps, flash messages or the clock. */
  private screenData(): string {
    return JSON.stringify([this.data.projects, ...this.shown()]);
  }

  private shown(): unknown[] {
    return [this.data[this.ui.view], this.ui.view === "today" ? this.data.health : undefined, this.ui.detail ? this.data.detail : undefined];
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.flashTimer);
  }

  resize(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return;
    this.columns = columns;
    this.rows = rows;
    this.emit();
  }

  /** User refreshes include projects and health; ticks only load the view and open task.
   * `fresh` reads after any read already running, so a mutation never shows stale data. */
  async refresh(fresh = false, ancillary = true): Promise<void> {
    if (this.stopped || this.conn.state === "rejected") return;
    if (ancillary) {
      this.todayPolls = 0;
      this.resetPolling();
    }
    const before = this.screenData();
    if (!this.timezone) {
      await this.load("settings", () => this.options.api.settings(), (s) => this.setZone(s.timezone));
      if (!this.timezone) return;
    }
    const jobs = [this.loadView(this.ui.view, fresh, ancillary || !this.data.today || this.todayPolls % HEALTH_POLLS === 0)];
    // Retry an initial load that failed offline; once cached, projects are read only for a task naming an unknown one.
    if (ancillary || !this.data.projects) jobs.push(this.loadProjects(fresh));
    if (this.ui.detail) {
      const id = this.ui.detail.taskId;
      jobs.push(this.load(`task:${id}`, () => this.options.api.task(id), (detail) => (this.data = { ...this.data, detail }), fresh));
    }
    await Promise.all(jobs);
    const known = this.data.projects;
    if (known && hasProjectTasks(this.shown(), new Set(known.map((p) => p.id)))) await this.loadProjects(fresh);
    if (before !== this.screenData()) this.resetPolling();
  }

  private loadProjects(fresh: boolean): Promise<void> {
    return this.load("projects", () => this.options.api.projects(), (projects) => (this.data = { ...this.data, projects }), fresh);
  }

  /** The user's zone; the week moves to its today unless keys moved it while the settings loaded. */
  private setZone(timezone: string) {
    const utc = localAt(this.now(), "UTC").date;
    const untouched = !this.timezone && this.ui.weekStart === weekStart(utc) && this.ui.cursor.weekDay === isoWeekday(utc) - 1;
    this.timezone = timezone;
    if (!untouched) return;
    const today = localAt(this.now(), timezone).date;
    this.ui = { ...this.ui, weekStart: weekStart(today), cursor: { ...this.ui.cursor, weekDay: isoWeekday(today) - 1 } };
  }

  private loadView(view: ViewName, fresh: boolean, readHealth: boolean): Promise<void> {
    const { api } = this.options;
    switch (view) {
      case "today":
        return this.load("today", async () => {
          const [today, health] = await Promise.all([api.today(), readHealth ? api.health().catch(() => undefined) : this.data.health]);
          return { today, health };
        }, (value) => (this.data = { ...this.data, ...value }), fresh);
      case "agents":
        return this.load("agents", () => api.agents(), (agents) => (this.data = { ...this.data, agents }), fresh);
      case "board":
        return this.load("board", () => api.board(), (board) => (this.data = { ...this.data, board }), fresh);
      case "week": {
        const start = this.ui.weekStart;
        return this.load(`week:${start}`, () => api.week(start), (tasks) => (this.data = { ...this.data, week: { start, tasks } }), fresh);
      }
      case "trash":
        return this.load("trash", () => api.trash(), (trash) => (this.data = { ...this.data, trash }), fresh);
    }
  }

  /** One read, never two of the same at once (a fresh one reads again after it); the cursor follows its task unless completing it. */
  private load<T>(key: string, get: () => Promise<T>, put: (value: T) => void, fresh = false): Promise<void> {
    const running = this.inflight.get(key);
    if (running) return fresh ? running.then(() => this.load(key, get, put)) : running;
    const job = (async () => {
      try {
        const value = await get();
        if (this.stopped) return;
        const before = this.selectedId();
        put(value);
        const lists = derive(this.snapshot()).lists;
        // Completing a task keeps its list position instead of following it to Done.
        this.ui = before && before === this.completingTaskId ? keepRow(this.ui, lists) : reanchor(this.ui, before, lists);
        this.conn = { state: "online", at: this.now() };
      } catch (error) {
        this.failed(error);
      } finally {
        this.inflight.delete(key);
        this.emit();
      }
    })();
    this.inflight.set(key, job);
    return job;
  }

  private selectedId(): string | undefined {
    const lists = derive(this.snapshot()).lists;
    if (this.ui.view === "agents" && !this.ui.detail) {
      const item = selectedAgent(this.ui, lists);
      return item && agentId(item);
    }
    return selectedTask(this.ui, lists)?.id;
  }

  private lastAt(): number | undefined {
    return "at" in this.conn ? this.conn.at : undefined;
  }

  /** A failed read: the data stays, the status line says why. */
  private failed(error: unknown) {
    if (error instanceof Throttled) {
      this.conn = { state: "throttled", message: error.message, at: this.lastAt() };
      return;
    }
    const failure = toCliError(error);
    if (failure.code === "unauthenticated") this.conn = { state: "rejected", message: failure.message };
    else if (failure.code === "rate_limited") this.conn = { state: "throttled", message: failure.message, at: this.lastAt() };
    else this.conn = { state: "offline", message: failure.message, at: this.lastAt() };
  }

  private say(text: string, tone: Flash["tone"]) {
    this.flash = { text, tone };
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flash = undefined;
      this.emit();
    }, FLASH_MS[tone]);
    this.flashTimer.unref?.();
  }

  key(name: string): void {
    this.resetPolling();
    if (name === "R" && this.conn.state === "rejected") this.conn = { state: "connecting" };
    const lists = derive(this.snapshot()).lists;
    const before = this.ui.mode;
    const { state, effect } = handleKey(this.ui, name, lists);
    this.ui = this.clampScroll(state);
    this.emit();
    if (effect) this.run(effect, lists, before);
  }

  /** Text pasted into a prompt or field arrives as one key. */
  paste(text: string): void {
    if (this.ui.mode.kind === "prompt" || this.ui.mode.kind === "edit") this.key(text.replace(/\s+/g, " "));
  }

  /** A click selects (a second click on the selected task opens it), the wheel moves the cursor. */
  mouse(event: Mouse): void {
    if (event.release) return;
    this.resetPolling();
    if (event.button === 64 || event.button === 65) {
      const key = event.button === 64 ? "k" : "j";
      for (let i = 0; i < 3; i++) this.key(key);
      return;
    }
    if (event.button !== 0 || this.ui.mode.kind !== "normal") return;
    const hit = this.frame().hits.find((h) => h.y === event.y && event.x >= h.x0 && event.x < h.x1);
    if (!hit) return;
    const target = hit.target;
    if (target.kind === "tab") return this.key(String(VIEWS.indexOf(target.view) + 1));
    const before = this.selectedId();
    const c = this.ui.cursor;
    if (target.kind === "day") this.ui = { ...this.ui, cursor: { ...c, weekDay: target.day, weekRow: 0 } };
    else if (target.kind === "agent") this.ui = { ...this.ui, cursor: { ...c, agents: target.index } };
    else if (this.ui.view === "board" && target.column !== undefined) {
      const board = [...c.board] as UiState["cursor"]["board"];
      board[target.column] = target.index;
      this.ui = { ...this.ui, cursor: { ...c, boardColumn: target.column, board } };
    } else if (this.ui.view === "week" && target.day !== undefined) this.ui = { ...this.ui, cursor: { ...c, weekDay: target.day, weekRow: target.index } };
    else if (this.ui.view === "today") this.ui = { ...this.ui, cursor: { ...c, today: target.index } };
    else if (this.ui.view === "trash") this.ui = { ...this.ui, cursor: { ...c, trash: target.index } };
    if ((target.kind === "task" || target.kind === "agent") && before !== undefined && before === this.selectedId()) return this.key("enter");
    this.emit();
  }

  /** Details and help scroll no further than their last row, so k works at once after G. */
  private clampScroll(state: UiState): UiState {
    const limits = scrollLimits({ ...this.snapshot(), ui: state });
    const detail = state.detail && state.detail.scroll > limits.detail ? { ...state.detail, scroll: limits.detail } : state.detail;
    const mode = state.mode.kind === "help" && state.mode.scroll > limits.help ? { ...state.mode, scroll: limits.help }
      : state.mode.kind === "approval" && state.mode.scroll > limits.approval ? { ...state.mode, scroll: limits.approval } : state.mode;
    return detail === state.detail && mode === state.mode ? state : { ...state, detail, mode };
  }

  private run(effect: Effect, lists: ReturnType<typeof derive>["lists"], before: UiState["mode"]): void {
    switch (effect.kind) {
      case "quit":
        this.stop();
        this.quitHandler?.();
        return;
      case "refresh":
        void this.refresh();
        return;
      case "detail":
        this.data = { ...this.data, detail: this.data.detail?.task.id === effect.taskId ? this.data.detail : undefined };
        void this.refresh();
        return;
      case "copy":
        this.copy(effect.task);
        return;
      case "flash":
        this.say(effect.text, "info");
        this.emit();
        return;
      default:
        // A form whose values the server or the date grammar refuses opens again as it was typed.
        this.change(effect, lists.date, before.kind === "edit" || (before.kind === "prompt" && before.prompt === "reject") ? before : undefined);
    }
  }

  /** Copy the captured selection, even if the cursor moves while the clipboard is busy. */
  private copy(task: Task): void {
    const text = taskText(task);
    this.copies = this.copies.then(async () => {
      try {
        const method = await (this.options.copyText ?? copyText)(text);
        this.say(t(method === "osc52" ? "done.clipboardTerminal" : "done.copied"), "ok");
      } catch (error) {
        this.say(t(error instanceof ClipboardError && error.reason === "unavailable" ? "error.clipboardUnavailable" : "error.clipboard"), "error");
      }
      this.emit();
    });
  }

  /** Changes run one after another; each ends with a refresh of what is on screen. */
  private change(effect: Exclude<Effect, { kind: "quit" | "refresh" | "detail" | "flash" | "copy" }>, today: string, form?: UiState["mode"]): void {
    if (!this.timezone) {
      this.say(t("conn.notYet"), "error");
      this.emit();
      return;
    }
    const context: EffectContext = {
      api: this.options.api,
      projects: this.data.projects,
      timezone: this.timezone,
      now: this.now,
      today,
      editText: (text, fileName) => this.editText(text, fileName),
    };
    this.busy++;
    this.emit();
    this.changes = this.changes.then(async () => {
      this.completingTaskId = effect.kind === "complete" ? effect.task.id : undefined;
      try {
        const done = await runChange(effect, context);
        // The message comes with the refreshed screen, so a key pressed on seeing it acts on what it says.
        await this.refresh(true);
        if (done.select && effect.kind !== "complete") this.select(done.select);
        this.say(done.text, "ok");
      } catch (error) {
        const failure = error instanceof Throttled ? error : toCliError(error);
        this.say(failure instanceof Throttled ? failure.message : changeError(failure), "error");
        const refused = failure instanceof CliError && (failure.code === "usage" || failure.code === "invalid_argument");
        if (form && refused && this.ui.mode.kind === "normal") this.ui = { ...this.ui, mode: form };
      } finally {
        this.completingTaskId = undefined;
        this.busy--;
        this.emit();
      }
    });
  }

  private select(id: string) {
    this.ui = reanchor(this.ui, id, derive(this.snapshot()).lists);
  }

  /** Resolves when every queued change, copy and read is answered (tests). */
  idle(): Promise<void> {
    return Promise.all([this.changes, this.copies]).then(() => Promise.all([...this.inflight.values()])).then(() => undefined);
  }

  /** The task the cursor is on (tests). */
  selected(): Task | undefined {
    return selectedTask(this.ui, derive(this.snapshot()).lists);
  }
}

function changeError(error: CliError): string {
  if (error.code === "unavailable") return t("error.notSaved", { message: error.message });
  return error.message;
}
