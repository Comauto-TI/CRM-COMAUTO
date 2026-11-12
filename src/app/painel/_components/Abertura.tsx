"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";

/**
 * Abertura WAGconnect (repasse do Codex, aprovado pelo Simão): logo parada enquanto o painel prepara;
 * quando a página está PRONTA de verdade, a roda do "o" patina, sai fumaça leve e o Golf + "connect"
 * arrancam para a direita, revelando o painel real.
 * - Só logo depois do login: o login grava o cookie wag_abertura e o painel já chega com a logo por cima
 *   (renderizado no servidor, sem "flash" do painel antes); aqui o cookie é apagado e não repete.
 * - Sem porcentagem falsa: barra indeterminada até ficar pronto.
 * - prefers-reduced-motion: esmaece rápido, sem arrancada.
 * - Trava de segurança: o overlay SEMPRE sai (timeout), mesmo se algo der errado.
 */
type Fase = "preparando" | "arrancando" | "saindo" | "fim";
const DURACAO_SAIDA_MS = 1550;
const LIMITE_ESPERA_MS = 6000; // se "pronto" nunca chegar, sai assim mesmo

export default function Abertura() {
  const [fase, setFase] = useState<Fase>("preparando");

  useEffect(() => {
    document.cookie = "wag_abertura=; Max-Age=0; path=/painel; SameSite=Lax";
    const reduzido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const timers: number[] = [];
    let partiu = false;
    const partir = () => {
      if (partiu) return;
      partiu = true;
      if (reduzido) { setFase("saindo"); timers.push(window.setTimeout(() => setFase("fim"), 250)); return; }
      setFase("arrancando");
      timers.push(window.setTimeout(() => setFase("saindo"), 950));
      timers.push(window.setTimeout(() => setFase("fim"), DURACAO_SAIDA_MS));
    };
    // "pronto" = documento carregado (HTML do servidor + imagens/estilos) e já hidratado (estamos no useEffect)
    if (document.readyState === "complete") timers.push(window.setTimeout(partir, 350));
    else window.addEventListener("load", () => timers.push(window.setTimeout(partir, 200)), { once: true });
    timers.push(window.setTimeout(partir, LIMITE_ESPERA_MS));
    // finalização segura: nada fica preso por cima da tela
    timers.push(window.setTimeout(() => setFase("fim"), LIMITE_ESPERA_MS + DURACAO_SAIDA_MS + 500));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  if (fase === "fim") return null;
  return (
    <div className={`abertura abertura-${fase}`} role="status" aria-live="polite" aria-label="Carregando o WAGconnect CRM">
      <div className="abertura-logo">
        <img src="/branding/wagconnect/camada-marca.webp" alt="" className="abertura-marca" />
        <div className="abertura-carro">
          <img src="/branding/wagconnect/camada-carro.webp" alt="" />
          <img src="/branding/wagconnect/camada-roda.webp" alt="" className="abertura-roda" />
          <span className="abertura-fumaca" aria-hidden="true"><i /><i /><i /></span>
        </div>
      </div>
      <div className="abertura-info">
        <span>{fase === "preparando" ? "Preparando sua próxima venda" : "Vamos acelerar"}</span>
        <div className="abertura-barra"><i /></div>
      </div>
    </div>
  );
}
