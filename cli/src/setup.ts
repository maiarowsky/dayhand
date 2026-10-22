// What every run needs before parsing: the folders and config.toml (whose
// aliases can change the command line itself).
import { emptyConfig, loadConfig, type Config } from "./config/file.js";
import { resolvePaths, type Paths } from "./config/paths.js";
import type { Io } from "./core/io.js";
import { commandNames } from "./registry/index.js";

export type Setup = { paths: Paths; aliases: Record<string, string>; config(): Config };

/** Paths and config.toml. A broken config file is reported by the first command that needs it. */
export function loadSetup(io: Io): Setup {
  const paths = resolvePaths(io.env);
  let config: Config | undefined;
  let failure: unknown;
  try {
    config = loadConfig(paths.configFile, commandNames());
  } catch (error) {
    failure = error;
  }
  return {
    paths,
    aliases: config?.aliases ?? {},
    config: () => {
      if (failure) throw failure;
      return config ?? emptyConfig(paths.configFile);
    },
  };
}
