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
  // Proxy clones request bodies before route handlers see them. Match the upload cap so videos
  // are not silently truncated at Next's default 10 MiB. Rebuild when raising this env setting.
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
    proxyClientMaxBodySize: Number(process.env.ATTACHMENT_MAX_BYTES) > 0 ? Number(process.env.ATTACHMENT_MAX_BYTES) : 100 * 1024 * 1024,
  },
  // Kokoro (text-to-speech) runs ONNX natively; keep it and its runtime out of the bundle.
  serverExternalPackages: ["kokoro-js", "@huggingface/transformers", "onnxruntime-node", "phonemizer"],
  // Baked in at build time so the UI can show what's deployed without a runtime lookup.
  env: { COMMIT_SHA: commitSha() },
};

export default nextConfig;
