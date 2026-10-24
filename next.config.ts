import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function commitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  // Voice notes are posted as multipart bodies; a minute of opus/mp4 stays well under this.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  // Baked in at build time so the UI can show what's deployed without a runtime lookup.
  env: { COMMIT_SHA: commitSha() },
};

export default nextConfig;
