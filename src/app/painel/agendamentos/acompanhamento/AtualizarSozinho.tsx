"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Recarrega os dados da tela a cada minuto (o atraso muda com o relógio). Pausa com a aba escondida. */
export default function AtualizarSozinho({ segundos = 60 }: { segundos?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, segundos * 1000);
    return () => window.clearInterval(t);
  }, [router, segundos]);
  return null;
}
