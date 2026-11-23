import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "@xenova/transformers", "onnxruntime-node", "sharp"],
  // Project lives under ~/Desktop; pin Turbopack's root so it doesn't walk up
  // into directories the sandbox can't read.
  turbopack: {
    root: path.join(__dirname),
  },
  // Ship the vault export (the only graph source) with the serverless routes.
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/vault/graph.json", "./data/vault/references.json"],
  },
  experimental: {
    // TypeScript 7 doesn't expose the compiler API Next expects yet.
    useTypeScriptCli: true,
  },
};

export default nextConfig;
