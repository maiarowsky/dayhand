// The deployment's DAYHAND_* environment variables. Deployments set up before
// the rename to Dayhand have them as HELM_*: those are still read, with one
// warning per variable in the deployment's logs, until DAYHAND_* is set
// (docs/deploy.md#renamed-variables).

const warned = new Set<string>();

/** DAYHAND_<name>, else the deprecated HELM_<name>; empty values count as unset. */
export function serverEnv(name: string): string | undefined {
  const value = process.env[`DAYHAND_${name}`];
  if (value) return value;
  const old = process.env[`HELM_${name}`];
  if (!old) return undefined;
  if (!warned.has(name)) {
    warned.add(name);
    console.warn(`HELM_${name} is deprecated; set DAYHAND_${name} to the same value (docs/deploy.md#renamed-variables)`);
  }
  return old;
}
