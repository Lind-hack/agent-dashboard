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
  // Kokoro and Piper (text-to-speech) run ONNX natively; keep them and their runtimes out of the bundle.
  serverExternalPackages: ["kokoro-js", "@huggingface/transformers", "onnxruntime-node", "phonemizer", "@echogarden/espeak-ng-emscripten", "tsx"],
  // Baked in at build time so the UI can show what's deployed without a runtime lookup.
  env: { COMMIT_SHA: commitSha() },
};

export default nextConfig;
