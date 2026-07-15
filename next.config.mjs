/** @type {import('next').NextConfig} */
import { fileURLToPath } from "node:url";

// Static export (GitHub Pages) is toggled via STATIC_EXPORT=true.
// basePath/assetPrefix come from env so project-subpath hosting works.
const isStatic = process.env.STATIC_EXPORT === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
  // The FROZEN benchmark-registry hash module imports node:crypto (build/offline checksums). The
  // /advisor page pulls the approved recommendation layer (and thus that module) into the CLIENT
  // bundle, where webpack cannot resolve the node: scheme. Replace it — client bundles only — with a
  // test-verified sha256 shim (lib/browser-shims/node-crypto.ts; byte-identical to node:crypto,
  // proven against the real pinned snapshot checksums). Server/SSR/tests keep real node:crypto.
  // The frozen registry itself is untouched.
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:crypto$/,
          fileURLToPath(new URL("./lib/browser-shims/node-crypto.ts", import.meta.url))
        )
      );
    }
    return config;
  },
  // In static mode we emit a fully static bundle to ./out. The /api route is
  // guarded (runtime-only) so the static build never depends on it.
  ...(isStatic
    ? {
        output: "export",
        images: { unoptimized: true },
        basePath: basePath || undefined,
        assetPrefix: basePath ? `${basePath}/` : undefined,
      }
    : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_STATIC_EXPORT: isStatic ? "true" : "false",
  },
};

export default nextConfig;
