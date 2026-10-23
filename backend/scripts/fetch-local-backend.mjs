#!/usr/bin/env node
// Downloads the Convex local backend binary (source-available under
// FSL-1.1-Apache-2.0; pinned release, SHA-256 verified) into
// backend/.local-backend/. No Convex account needed.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE = "precompiled-2026-10-10-72ce13c";

// Digests published by GitHub for the release assets above.
const ASSETS = {
  "darwin-arm64": {
    name: "convex-local-backend-aarch64-apple-darwin.zip",
    sha256: "fbaf2dcff35c57a16f1f6a804fd505ba562fcc7f6898c170b4e0f7f0c46c0881",
  },
  "darwin-x64": {
    name: "convex-local-backend-x86_64-apple-darwin.zip",
    sha256: "a621a16688bad0a5f06726956e67c58af574e82ed98ab83d4889fd8cd6b2bc94",
  },
  "linux-arm64": {
    name: "convex-local-backend-aarch64-unknown-linux-gnu.zip",
    sha256: "9464be0dc11826a37b5c29b380166ac4912997fb73e2bff596ea40d05c3313f8",
  },
  "linux-x64": {
    name: "convex-local-backend-x86_64-unknown-linux-gnu.zip",
    sha256: "fcc51faa1168011819eec9aba85bf6959a6a7ce3929381cdc21c7da29f4bf3d5",
  },
};

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BIN_DIR = join(backendDir, ".local-backend", "bin");
export const BIN_PATH = join(BIN_DIR, "convex-local-backend");

export async function fetchLocalBackend() {
  if (existsSync(BIN_PATH)) return BIN_PATH;
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) {
    throw new Error(
      `No pinned local backend for ${process.platform}-${process.arch}; use Docker (see README).`,
    );
  }
  const url = `https://github.com/get-convex/convex-backend/releases/download/${RELEASE}/${asset.name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.name}: got ${digest}`);
  }
  mkdirSync(BIN_DIR, { recursive: true });
  const zipPath = join(BIN_DIR, asset.name);
  writeFileSync(zipPath, bytes);
  try {
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", BIN_DIR]);
  } finally {
    rmSync(zipPath, { force: true });
  }
  chmodSync(BIN_PATH, 0o755);
  return BIN_PATH;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fetchLocalBackend()
    .then((path) => console.log(`Convex local backend ready: ${path}`))
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
