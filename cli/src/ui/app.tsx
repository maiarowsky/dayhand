// The Ink side of hlm ui: paints the controller's frame row by row, passes
// keys, pastes, clicks and the terminal size to it, and lends it the terminal
// for $EDITOR. Everything else lives in the controller.
import { Box, Text, useApp, useInput, usePaste, useStdin, useWindowSize, type Key } from "ink";
import { useEffect, useSyncExternalStore } from "react";
import type { Controller, Mouse } from "./controller.js";
import { chunkKeys, keyName } from "./keys.js";
import type { Row, Seg } from "./text.js";

/** SGR mouse reports ("ESC[<0;12;5M" press, "…m" release); coordinates from 1. */
const MOUSE = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** The mouse reports in a chunk of raw input, with coordinates from 0 and the modifier bits dropped. */
export function parseMouse(chunk: string): Mouse[] {
  return [...chunk.matchAll(MOUSE)].map((m) => ({ button: Number(m[1]) & ~(4 | 8 | 16), x: Number(m[2]) - 1, y: Number(m[3]) - 1, release: m[4] === "m" }));
}

function Segment({ seg, color }: { seg: Seg; color: boolean }) {
  return (
    <Text
      color={color ? seg.color : undefined}
      bold={seg.bold}
      dimColor={color ? seg.dim : undefined}
      inverse={seg.inverse}
      strikethrough={seg.strike}
      underline={seg.underline}
    >
      {seg.text}
    </Text>
  );
}

function Line({ row, color }: { row: Row; color: boolean }) {
  return (
    <Text wrap="truncate">
      {row.length === 0 ? " " : row.map((seg, i) => <Segment key={i} seg={seg} color={color} />)}
    </Text>
  );
}

export function App({ controller, color }: { controller: Controller; color: boolean }) {
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  const { columns, rows } = useWindowSize();
  const { exit, suspendTerminal } = useApp();

  useEffect(() => controller.resize(columns, rows), [controller, columns, rows]);
  useEffect(() => {
    void controller.start();
    return () => controller.stop();
  }, [controller]);
  useEffect(() => controller.onQuit(exit), [controller, exit]);
  useEffect(() => controller.lendTerminal((run) => suspendTerminal(run)), [controller, suspendTerminal]);

  useInput((input: string, key: Key) => {
    // Esc and a key typed quickly after it arrive as Alt+key: both are meant.
    if (key.meta && !key.escape && [...input].length === 1) {
      controller.key("esc");
      return controller.key(keyName(input, { ...key, meta: false }));
    }
    const name = keyName(input, key);
    // Fast typing arrives as one chunk ("aCall mom"): each character is a key, so `a` opens the prompt first.
    if (name === input && [...input].length > 1) for (const each of chunkKeys(input)) controller.key(each);
    else controller.key(name);
  });
  usePaste((text: string) => controller.paste(text));

  // Ink drops mouse reports, so they are read from the raw chunks: with Ink's
  // 'readable' listener in place (useInput above), 'data' only observes what Ink reads.
  const { stdin } = useStdin();
  useEffect(() => {
    const onData = (chunk: Buffer | string) => {
      for (const event of parseMouse(chunk.toString())) controller.mouse(event);
    };
    const listen = () => void stdin.on("data", onData);
    const stop = () => void stdin.off("data", onData);
    listen();
    controller.lendInput({ pause: stop, resume: listen });
    return stop;
  }, [controller, stdin]);

  const screen = controller.frame();
  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {screen.rows.map((row, i) => (
        <Line key={i} row={row} color={color} />
      ))}
    </Box>
  );
}
