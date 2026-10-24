// Runs the Astro CLI with Astro's telemetry off, so a build sends nothing about this machine anywhere and writes no
// global Astro settings. `npm run build` and `npm run dev` call this file; arguments pass through unchanged.
process.env.ASTRO_TELEMETRY_DISABLED = "1";
await import("../node_modules/astro/bin/astro.mjs");
