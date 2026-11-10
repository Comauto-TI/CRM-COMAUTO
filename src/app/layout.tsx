import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Comauto — Painel do Assistente",
  description: "Painel de controle do assistente de WhatsApp da Comauto",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
