// App sign-in: a custom JWT (ES256) whose public key is a JWKS data URI in
// deployment environment variables, so no external identity provider is
// needed. `npm run backend:start` generates a local key pair and sets both.
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: "helm",
      issuer: process.env.HELM_JWT_ISSUER!,
      jwks: process.env.HELM_JWKS!,
      algorithm: "ES256",
    },
  ],
};
