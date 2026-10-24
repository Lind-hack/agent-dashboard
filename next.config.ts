import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Voice notes are posted as multipart bodies; a minute of opus/mp4 stays well under this.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
