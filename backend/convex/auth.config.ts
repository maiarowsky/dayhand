// App sign-in: a custom JWT (ES256) whose public key is a JWKS data URI in
// deployment environment variables, so no external identity provider is
// needed. `npm run backend:start` generates a local key pair and sets both.
// Deployments from before the rename have them as HELM_* (lib/env.ts). Convex
// refuses a push when this file reads a variable the deployment does not have,
// so the old name is read only when the new one is missing. The audience
// stays "helm": tokens already on phones carry it.
function variable(name: string): string {
  try {
    const value = process.env[`DAYHAND_${name}`];
    if (value) return value;
  } catch {
    // The deployment has no DAYHAND_<name>.
  }
  return process.env[`HELM_${name}`]!;
}

export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "helm",
      issuer: variable("JWT_ISSUER"),
      jwks: variable("JWKS"),
      algorithm: "ES256",
    },
  ],
};
