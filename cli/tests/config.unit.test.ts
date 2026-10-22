// Folders per system, config.toml checks and precedence, aliases, the
// credentials file and the color decision. No backend.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { expandAlias, splitWords } from "../src/config/aliases.js";
import { emptyConfig, loadConfig, saveProfileUrl } from "../src/config/file.js";
import { resolvePaths } from "../src/config/paths.js";
import { resolveTarget } from "../src/config/resolve.js";
import { CliError } from "../src/core/exit.js";
import { FileStore } from "../src/credentials/file.js";
import { VALUE_OPTIONS } from "../src/globals.js";
import { commandNames } from "../src/registry/index.js";
import { colorEnabled } from "../src/render/style.js";

const dir = mkdtempSync(join(process.env.HLM_TEST_TMPDIR ?? tmpdir(), "hlm-config-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let fileCount = 0;
function configFile(text: string): string {
  const file = join(dir, `config-${++fileCount}.toml`);
  writeFileSync(file, text);
  return file;
}
const load = (text: string) => loadConfig(configFile(text), commandNames());
const failure = (text: string) => {
  try {
    load(text);
  } catch (error) {
    return error as CliError;
  }
  throw new Error("expected the config to be rejected");
};

describe("folders follow each system's convention", () => {
  test("Linux: XDG, with ~/.config and ~/.cache as defaults; relative XDG paths are ignored", () => {
    expect(resolvePaths({}, "linux", "/home/ann")).toEqual({
      configDir: "/home/ann/.config/hlm",
      cacheDir: "/home/ann/.cache/hlm",
      configFile: "/home/ann/.config/hlm/config.toml",
    });
    const xdg = resolvePaths({ XDG_CONFIG_HOME: "/x/conf", XDG_CACHE_HOME: "/x/cache" }, "linux", "/home/ann");
    expect([xdg.configDir, xdg.cacheDir]).toEqual(["/x/conf/hlm", "/x/cache/hlm"]);
    expect(resolvePaths({ XDG_CONFIG_HOME: "relative" }, "linux", "/home/ann").configDir).toBe("/home/ann/.config/hlm");
  });

  test("macOS: Application Support and Caches", () => {
    const paths = resolvePaths({}, "darwin", "/Users/ann");
    expect(paths.configFile).toBe("/Users/ann/Library/Application Support/hlm/config.toml");
    expect(paths.cacheDir).toBe("/Users/ann/Library/Caches/hlm");
  });

  test("Windows: APPDATA and LOCALAPPDATA, with backslashes", () => {
    const paths = resolvePaths({ APPDATA: "C:\\Users\\ann\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\ann\\AppData\\Local" }, "win32", "C:\\Users\\ann");
    expect(paths.configFile).toBe("C:\\Users\\ann\\AppData\\Roaming\\hlm\\config.toml");
    expect(paths.cacheDir).toBe("C:\\Users\\ann\\AppData\\Local\\hlm\\Cache");
    expect(resolvePaths({}, "win32", "C:\\Users\\ann").configDir).toBe("C:\\Users\\ann\\AppData\\Roaming\\hlm");
  });

  test("HLM_CONFIG_DIR and HLM_CACHE_DIR win everywhere", () => {
    const paths = resolvePaths({ HLM_CONFIG_DIR: "/c", HLM_CACHE_DIR: "/k" }, "darwin", "/Users/ann");
    expect(paths).toEqual({ configDir: "/c", cacheDir: "/k", configFile: "/c/config.toml" });
  });
});

describe("config.toml", () => {
  test("a full file", () => {
    const config = load(`
url = "https://top.convex.site/"
default_profile = "personal"
[profiles.personal]
url = "https://personal.convex.site/mcp"
[profiles.work]
url = "https://work.convex.site"
[aliases]
home = "list -l home --status todo,doing"
[ui]
color = "never"
`);
    expect(config).toMatchObject({
      exists: true,
      url: "https://top.convex.site",
      defaultProfile: "personal",
      profiles: { personal: { url: "https://personal.convex.site" }, work: { url: "https://work.convex.site" } },
      aliases: { home: "list -l home --status todo,doing" },
      color: "never",
    });
  });

  test("a missing file is an empty configuration", () => {
    expect(loadConfig(join(dir, "none.toml"), commandNames())).toEqual(emptyConfig(join(dir, "none.toml")));
  });

  test.each<[string, RegExp]>([
    ['colour = "red"', /: colour: unknown key/],
    ['url = "ftp://x"', /: url: must be an https:\/\/ or http:\/\/ URL/],
    ['url = 3', /: url: must be a non-empty string/],
    ['api_key = "helm_secret"', /: api_key: API keys do not belong in config\.toml/],
    ['[profiles.work]\ntoken = "helm_secret"', /: profiles\.work\.token: API keys do not belong/],
    ['[profiles.work]\nurl = "https://w.convex.site"\nname = "x"', /: profiles\.work\.name: unknown key \(valid: url\)/],
    ['default_profile = "nope"', /: default_profile: names a profile that is not defined/],
    ['[aliases]\nlist = "list --done"', /: aliases\.list: would hide the built-in command/],
    ['[aliases]\nHome = "list"', /: aliases\.Home: alias names use lower-case/],
    ['[ui]\ncolor = "sometimes"', /: ui\.color: must be one of auto, always, never/],
  ])("%j is rejected naming the file and the key", (text, message) => {
    const error = failure(text);
    expect(error).toBeInstanceOf(CliError);
    expect(error.code).toBe("config");
    expect(error.exitCode).toBe(2);
    expect(error.message).toMatch(/config-\d+\.toml/);
    expect(error.message).toMatch(message);
    expect(error.message).not.toContain("helm_secret");
  });

  test("a TOML syntax error gives the line, not the file's contents", () => {
    const error = failure('url = "https://x.convex.site"\napi_key = "helm_secret\n');
    expect(error.message).toMatch(/config-\d+\.toml: line 2, column \d+: not valid TOML/);
    expect(error.message).not.toContain("helm_secret");
  });

  test("hlm login creates the file with a profile, appends a missing one, never rewrites", () => {
    const file = join(dir, "login", "config.toml");
    expect(saveProfileUrl(emptyConfig(file), "default", "https://a.convex.site")).toBe("created");
    const created = loadConfig(file, commandNames());
    expect(created).toMatchObject({ defaultProfile: "default", profiles: { default: { url: "https://a.convex.site" } } });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(saveProfileUrl(created, "work", "https://b.convex.site")).toBe("added");
    expect(saveProfileUrl(loadConfig(file, commandNames()), "work", "https://c.convex.site")).toBe("unchanged");
    expect(loadConfig(file, commandNames()).profiles).toEqual({ default: { url: "https://a.convex.site" }, work: { url: "https://b.convex.site" } });
  });
});

describe("URL precedence: --url, --profile, HLM_URL, HLM_PROFILE/default_profile, top-level url", () => {
  const config = load(`
url = "https://top.convex.site"
default_profile = "home"
[profiles.home]
url = "https://home.convex.site"
[profiles.work]
url = "https://work.convex.site"
`);
  const target = (flags: { url?: string; profile?: string }, env: Record<string, string> = {}) => {
    const t = resolveTarget(flags, env, config, () => {});
    return `${t.url} ${t.urlSource}`;
  };

  test("each level", () => {
    expect(target({ url: "https://flag.convex.site", profile: "work" }, { HLM_URL: "https://env.convex.site" })).toBe("https://flag.convex.site --url");
    expect(target({ profile: "work" }, { HLM_URL: "https://env.convex.site" })).toBe("https://work.convex.site --profile work");
    expect(target({}, { HLM_URL: "https://env.convex.site", HLM_PROFILE: "work" })).toBe("https://env.convex.site HLM_URL");
    expect(target({}, { HLM_PROFILE: "work" })).toBe("https://work.convex.site profile work");
    expect(target({})).toBe("https://home.convex.site profile home");
    const noProfiles = load('url = "https://top.convex.site"');
    expect(resolveTarget({}, {}, noProfiles, () => {}).url).toBe("https://top.convex.site");
  });

  test("an unknown profile lists the valid ones", () => {
    expect(() => target({ profile: "nope" })).toThrow(/Unknown profile/);
    try {
      target({}, { HLM_PROFILE: "nope" });
    } catch (error) {
      expect((error as CliError).details.valid).toEqual(["home", "work"]);
    }
  });

  test("no URL anywhere is a usage error that points at hlm login", () => {
    expect(() => resolveTarget({}, {}, emptyConfig("x"), () => {})).toThrow(/No Helm URL/);
  });
});

describe("aliases", () => {
  test("words split without a shell", () => {
    expect(splitWords(`list -l "my home"  --search 'it''s'`)).toEqual(["list", "-l", "my home", "--search", "its"]);
    expect(splitWords('add ""')).toEqual(["add", ""]);
    expect(() => splitWords('list "open')).toThrow(/Unclosed quote/);
  });

  test("the first command word expands once; global options before it are kept", () => {
    const aliases = { home: "list -l home", deep: "home --done" };
    expect(expandAlias(["home", "--json"], aliases, VALUE_OPTIONS)).toEqual(["list", "-l", "home", "--json"]);
    expect(expandAlias(["--profile", "home", "home"], aliases, VALUE_OPTIONS)).toEqual(["--profile", "home", "list", "-l", "home"]);
    expect(expandAlias(["deep"], aliases, VALUE_OPTIONS)).toEqual(["home", "--done"]);
    expect(expandAlias(["list", "home"], aliases, VALUE_OPTIONS)).toEqual(["list", "home"]);
    expect(expandAlias(["toString"], aliases, VALUE_OPTIONS)).toEqual(["toString"]);
  });
});

describe("credentials file", () => {
  test("keys per URL, mode 0600, removed with the last key", async () => {
    const warnings: string[] = [];
    const store = new FileStore(join(dir, "creds"), (w) => warnings.push(w.code));
    await store.set("https://a.convex.site", "helm_aaa");
    await store.set("https://b.convex.site", "helm_bbb");
    expect(await store.get("https://a.convex.site")).toEqual({ key: "helm_aaa", source: "file" });
    if (process.platform !== "win32") expect(statSync(store.location).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(store.location, "utf8"))).toEqual({ keys: { "https://a.convex.site": "helm_aaa", "https://b.convex.site": "helm_bbb" } });
    expect(await store.delete("https://a.convex.site")).toBe(true);
    expect(await store.delete("https://a.convex.site")).toBe(false);
    expect(await store.delete("https://b.convex.site")).toBe(true);
    expect(() => statSync(store.location)).toThrow();
    expect(warnings).toEqual([]);
  });

  test("a file others can read is used, with a warning (macOS and Linux)", async () => {
    if (process.platform === "win32") return;
    const warnings: string[] = [];
    const store = new FileStore(join(dir, "loose"), (w) => warnings.push(w.code));
    await store.set("https://a.convex.site", "helm_aaa");
    const { chmodSync } = await import("node:fs");
    chmodSync(store.location, 0o644);
    expect((await store.get("https://a.convex.site"))?.key).toBe("helm_aaa");
    expect(warnings).toEqual(["credentials_mode"]);
  });
});

test("colors: flag, then config, then NO_COLOR/FORCE_COLOR, then the terminal", () => {
  expect(colorEnabled({ env: {}, isTTY: true })).toBe(true);
  expect(colorEnabled({ env: {}, isTTY: false })).toBe(false);
  expect(colorEnabled({ env: { NO_COLOR: "1" }, isTTY: true })).toBe(false);
  expect(colorEnabled({ env: { FORCE_COLOR: "1" }, isTTY: false })).toBe(true);
  expect(colorEnabled({ env: { TERM: "dumb" }, isTTY: true })).toBe(false);
  expect(colorEnabled({ config: "always", env: { NO_COLOR: "1" }, isTTY: false })).toBe(true);
  expect(colorEnabled({ flag: "never", config: "always", env: {}, isTTY: true })).toBe(false);
  expect(colorEnabled({ flag: false, env: { FORCE_COLOR: "1" }, isTTY: true })).toBe(false);
  expect(colorEnabled({ flag: "always", env: { NO_COLOR: "1" }, isTTY: false })).toBe(true);
  expect(colorEnabled({ flag: "auto", config: "never", env: {}, isTTY: true })).toBe(false);
});
