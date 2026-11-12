import type { MetadataRoute } from "next";

/**
 * Manifesto PWA (F0-5): deixa o painel instalável como app no Edge/Chrome dos PCs da empresa.
 * Servido em /manifest.webmanifest; o Next injeta o <link rel="manifest"> sozinho.
 * Sem service worker: o Chromium no desktop instala só com manifesto válido + HTTPS,
 * e não queremos cache de dados do painel no navegador.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/painel",
    name: "WAGconnect CRM",
    short_name: "WAGconnect",
    description: "WAGconnect CRM — sistema da Comauto: atendimento, vendas, oficina e peças.",
    lang: "pt-BR",
    start_url: "/painel",
    scope: "/",
    display: "standalone",
    background_color: "#041831",
    theme_color: "#041831",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
