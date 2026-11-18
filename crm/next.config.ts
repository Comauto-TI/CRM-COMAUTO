import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite carrega arquivos .wasm em tempo de execução; não deve ser empacotado.
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
