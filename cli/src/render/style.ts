// Colors through util.styleText, decided once per run: --color/--no-color,
// then [ui] color in config.toml, then NO_COLOR / FORCE_COLOR, then whether
// stdout is a terminal. Only the human format is ever colored.
import { styleText } from "node:util";
import type { Env } from "../config/env.js";
import type { ColorMode } from "../config/file.js";

type Paint = (text: string) => string;

export type Style = {
  enabled: boolean;
  bold: Paint;
  dim: Paint;
  red: Paint;
  green: Paint;
  yellow: Paint;
  cyan: Paint;
  magenta: Paint;
};

const FORMATS = ["bold", "dim", "red", "green", "yellow", "cyan", "magenta"] as const;

export function makeStyle(enabled: boolean): Style {
  const paint = (format: (typeof FORMATS)[number]): Paint =>
    enabled ? (text) => (text === "" ? text : styleText(format, text, { validateStream: false })) : (text) => text;
  return Object.fromEntries([["enabled", enabled], ...FORMATS.map((f) => [f, paint(f)])]) as Style;
}

export const PLAIN_STYLE = makeStyle(false);

export function colorEnabled(input: { flag?: ColorMode | false; config?: ColorMode; env: Env; isTTY?: boolean }): boolean {
  const mode = input.flag === false ? "never" : input.flag && input.flag !== "auto" ? input.flag : input.config;
  if (mode === "always") return true;
  if (mode === "never") return false;
  if (input.env.NO_COLOR) return false;
  if (input.env.FORCE_COLOR && input.env.FORCE_COLOR !== "0") return true;
  if (input.env.TERM === "dumb") return false;
  return Boolean(input.isTTY);
}
