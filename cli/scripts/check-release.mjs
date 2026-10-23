// Run by .github/workflows/publish-npm.yml before `npm publish`: refuses to
// publish until the package is meant to be public and matches the tag.
//   node scripts/check-release.mjs <tag> [npm version]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** npm 11.5.1 is the first with trusted publishing (OIDC). */
const MIN_NPM = [11, 5, 1];

const older = (version, min) => {
  const parts = version.split(".").map(Number);
  for (let i = 0; i < min.length; i++) if ((parts[i] ?? 0) !== min[i]) return (parts[i] ?? 0) < min[i];
  return false;
};

/** What stops this package from being published from this tag; empty when nothing does. */
export function releaseProblems(pkg, tag, npmVersion) {
  const problems = [];
  if (pkg.private) problems.push('package.json has "private": true (remove it on the maintainer\'s word: docs/release.md)');
  if (tag !== `hlm-v${pkg.version}`) problems.push(`tag ${tag} does not match the package version (expected hlm-v${pkg.version})`);
  const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  if (!repo || repo.includes("<")) problems.push("package.json needs repository.url of the public GitHub repository (provenance checks it)");
  if (npmVersion && older(npmVersion, MIN_NPM)) problems.push(`npm ${npmVersion} cannot use trusted publishing; ${MIN_NPM.join(".")} or newer is needed`);
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const problems = releaseProblems(pkg, process.argv[2] ?? "", process.argv[3]);
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(problems.length ? 1 : 0);
}
