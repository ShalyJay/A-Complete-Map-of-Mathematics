import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "unpdf",
    "@xenova/transformers",
    "onnxruntime-node",
    "sharp",
  ],
  // Project lives under ~/Desktop; pin Turbopack's root so it doesn't walk up
  // into directories the sandbox can't read.
  turbopack: {
    root: path.join(__dirname),
  },
  // Ship the static graph export with serverless routes (Vercel has no PGlite).
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/static-graph.json"],
  },
  experimental: {
    // TypeScript 7 doesn't expose the compiler API Next expects yet.
    useTypeScriptCli: true,
  },
};

export default nextConfig;
