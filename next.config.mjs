/** @type {import('next').NextConfig} */

// Static export (GitHub Pages) is toggled via STATIC_EXPORT=true.
// basePath/assetPrefix come from env so project-subpath hosting works.
const isStatic = process.env.STATIC_EXPORT === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
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
