// The running dayhand ui without the terminal: it loads what the current view
// needs, polls it, turns keys and clicks into state and server calls, and
// keeps the last data on screen when the server cannot be reached, so the
// screen never waits on the network. Ink only paints `frame()` (app.tsx).
import { CliError, toCliError } from "../core/exit.js";
import { t } from "../i18n/index.js";
import type { Task } from "../render/model.js";
import { isoWeekday, localAt } from "../when/calendar.js";
import { Throttled, type Api } from "./api.js";
import { runChange, type EffectContext } from "./effects.js";
import { frame, scrollLimits } from "./frame.js";
import { handleKey, type Effect } from "./handle.js";
import { weekStart } from "./lists.js";
import { derive, type Conn, type Data, type Flash, type Snapshot } from "./model.js";
import type { Screen } from "./screens/screen.js";
import { initialState, reanchor, selectedTask, VIEWS, type UiState, type ViewName } from "./state.js";

export const DEFAULT_INTERVAL_S = 12;
const FLASH_MS = { ok: 5000, info: 5000, error: 10_000 };

export type ControllerOptions = {
  api: Api;
  view: ViewName;
  /** Seconds between refreshes of what is on screen. */
  interval?: number;
  now?: () => number;
  columns?: number;
  rows?: number;
  /** Runs $VISUAL/$EDITOR on the text and returns what was saved (core/editor.ts). */
  editText?: (text: string, fileName: string) => string;
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
  private timer?: ReturnType<typeof setInterval>;
  private flashTimer?: ReturnType<typeof setTimeout>;
  private version = 0;
  private cached?: { version: number; screen: Screen };
  private stopped = false;
  private quitHandler?: () => void;
  private suspend?: Suspend;
  private input?: { pause: () => void; resume: () => void };

  constructor(private readonly options: ControllerOptions) {
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
    return { ui: this.ui, data: this.data, conn: this.conn, flash: this.flash, busy: this.busy, columns: this.columns, rows: this.rows, timezone: this.timezone, today: this.today(), now: this.now(), interval: this.options.interval ?? DEFAULT_INTERVAL_S };
  }

  frame(): Screen {
    if (this.cached?.version !== this.version) this.cached = { version: this.version, screen: frame(this.snapshot()) };
    return this.cached.screen;
  }

  private today(): string {
    return this.data.today?.date ?? localAt(this.now(), this.timezone ?? "UTC").date;
  }

  /** Loads the settings and the first view, then refreshes every `interval` seconds. */
  async start(): Promise<void> {
    this.timer = setInterval(() => void this.refresh(), (this.options.interval ?? DEFAULT_INTERVAL_S) * 1000);
    await this.refresh();
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.flashTimer);
  }

  resize(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return;
    this.columns = columns;
    this.rows = rows;
    this.emit();
  }

  /** What is on screen, again: the settings until they are known, the view, the open task. */
  async refresh(): Promise<void> {
    if (this.stopped || this.conn.state === "rejected") return;
    if (!this.timezone) {
      await this.load("settings", () => this.options.api.settings(), (s) => this.setZone(s.timezone));
      if (!this.timezone) return;
    }
    const jobs = [this.loadView(this.ui.view)];
    if (this.ui.detail) {
      const id = this.ui.detail.taskId;
      jobs.push(this.load(`task:${id}`, () => this.options.api.task(id), (detail) => (this.data = { ...this.data, detail })));
    }
    await Promise.all(jobs);
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

  private loadView(view: ViewName): Promise<void> {
    const { api } = this.options;
    switch (view) {
      case "today":
        return this.load("today", () => api.today(), (today) => (this.data = { ...this.data, today }));
      case "board":
        return this.load("board", () => api.board(), (board) => (this.data = { ...this.data, board }));
      case "week": {
        const start = this.ui.weekStart;
        return this.load(`week:${start}`, () => api.week(start), (tasks) => (this.data = { ...this.data, week: { start, tasks } }));
      }
      case "trash":
        return this.load("trash", () => api.trash(), (trash) => (this.data = { ...this.data, trash }));
    }
  }

  /** One read, never two of the same at once; the cursor stays on its task. */
  private load<T>(key: string, get: () => Promise<T>, put: (value: T) => void): Promise<void> {
    const running = this.inflight.get(key);
    if (running) return running;
    const job = (async () => {
      try {
        const value = await get();
        if (this.stopped) return;
        const before = this.selectedId();
        put(value);
        this.ui = reanchor(this.ui, before, derive(this.snapshot()).lists);
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
    return selectedTask(this.ui, derive(this.snapshot()).lists)?.id;
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
    else if (this.ui.view === "board" && target.column !== undefined) {
      const board = [...c.board] as UiState["cursor"]["board"];
      board[target.column] = target.index;
      this.ui = { ...this.ui, cursor: { ...c, boardColumn: target.column, board } };
    } else if (this.ui.view === "week" && target.day !== undefined) this.ui = { ...this.ui, cursor: { ...c, weekDay: target.day, weekRow: target.index } };
    else if (this.ui.view === "today") this.ui = { ...this.ui, cursor: { ...c, today: target.index } };
    else if (this.ui.view === "trash") this.ui = { ...this.ui, cursor: { ...c, trash: target.index } };
    if (target.kind === "task" && before !== undefined && before === this.selectedId()) return this.key("enter");
    this.emit();
  }

  /** Details and help scroll no further than their last row, so k works at once after G. */
  private clampScroll(state: UiState): UiState {
    const limits = scrollLimits({ ...this.snapshot(), ui: state });
    const detail = state.detail && state.detail.scroll > limits.detail ? { ...state.detail, scroll: limits.detail } : state.detail;
    const mode = state.mode.kind === "help" && state.mode.scroll > limits.help ? { ...state.mode, scroll: limits.help } : state.mode;
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
      case "flash":
        this.say(effect.text, "info");
        this.emit();
        return;
      default:
        // A form whose values the server or the date grammar refuses opens again as it was typed.
        this.change(effect, lists.date, before.kind === "edit" ? before : undefined);
    }
  }

  /** Changes run one after another; each ends with a refresh of what is on screen. */
  private change(effect: Exclude<Effect, { kind: "quit" | "refresh" | "detail" | "flash" }>, today: string, form?: UiState["mode"]): void {
    if (!this.timezone) {
      this.say(t("conn.notYet"), "error");
      this.emit();
      return;
    }
    const context: EffectContext = {
      api: this.options.api,
      timezone: this.timezone,
      now: this.now,
      today,
      editText: (text, fileName) => this.editText(text, fileName),
    };
    this.busy++;
    this.emit();
    this.changes = this.changes.then(async () => {
      try {
        const done = await runChange(effect, context);
        this.say(done.text, "ok");
        await this.refresh();
        if (done.select) this.select(done.select);
      } catch (error) {
        const failure = error instanceof Throttled ? error : toCliError(error);
        this.say(failure instanceof Throttled ? failure.message : changeError(failure), "error");
        const refused = failure instanceof CliError && (failure.code === "usage" || failure.code === "invalid_argument");
        if (form && refused && this.ui.mode.kind === "normal") this.ui = { ...this.ui, mode: form };
      } finally {
        this.busy--;
        this.emit();
      }
    });
  }

  private select(id: string) {
    this.ui = reanchor(this.ui, id, derive(this.snapshot()).lists);
  }

  /** Resolves when every queued change is answered (tests). */
  idle(): Promise<void> {
    return this.changes.then(() => Promise.all([...this.inflight.values()])).then(() => undefined);
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
