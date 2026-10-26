import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Gate 1 (missão v0.11.0): política anti-indexação no nível HTTP — vale para
  // TODA resposta: páginas, rotas de API, exportações (PDF/Excel/CSV), arquivos
  // estáticos de public/, respostas de erro (4xx/5xx) e a própria robots.txt.
  // A desindexação não depende só do robots.txt: X-Robots-Tag é respeitado
  // inclusive para URLs já conhecidas pelos buscadores.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
