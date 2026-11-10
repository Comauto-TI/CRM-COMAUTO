"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Notif = { id: string; tipo: string; titulo: string; corpo: string | null; link: string | null; criado_em: string };

const ICONE: Record<string, string> = { lead: "🚗", pecas: "🔧", atendimento: "💬", aniversario: "🎂", tarefa: "⏰", alerta: "⚠️", sistema: "ℹ️" };

function bipe() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.35);
  } catch {
    /* áudio não liberado pelo navegador */
  }
}

/**
 * Pop-up da central de notificações (lead novo, atendimento, aniversário, tarefa).
 * Consulta /api/painel/notificacoes a cada 15 s. Pendentes aparecem ao abrir o painel;
 * as que chegarem depois tocam som e geram aviso do navegador. Clique abre e marca como lida.
 */
export default function AlertaNotificacoes() {
  const router = useRouter();
  const [itens, setItens] = useState<Notif[]>([]);
  const vistos = useRef<Set<string> | null>(null);

  async function marcar(ids: string[]) {
    setItens((l) => l.filter((n) => !ids.includes(n.id)));
    try {
      await fetch("/api/painel/notificacoes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    } catch {
      /* tenta de novo na próxima ação */
    }
    router.refresh(); // atualiza o contador do sino
  }

  function abrir(n: Notif) {
    void marcar([n.id]);
    if (n.link) router.push(n.link, { scroll: false });
  }

  useEffect(() => {
    let ativo = true;
    async function consultar() {
      try {
        const r = await fetch("/api/painel/notificacoes", { cache: "no-store" });
        if (!r.ok) return;
        const { naoLidas } = (await r.json()) as { naoLidas: Notif[] };
        if (!ativo) return;
        const primeira = vistos.current === null;
        if (primeira) vistos.current = new Set();
        const novas = naoLidas.filter((n) => !vistos.current!.has(n.id));
        novas.forEach((n) => vistos.current!.add(n.id));
        setItens(naoLidas);
        if (!primeira && novas.length) {
          bipe();
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            for (const n of novas) {
              const aviso = new Notification(n.titulo, { body: n.corpo ?? "", tag: `notif-${n.id}` });
              aviso.onclick = () => { window.focus(); abrir(n); };
            }
          }
        }
      } catch {
        /* rede instável: tenta no próximo ciclo */
      }
    }
    consultar();
    const t = setInterval(consultar, 15000);
    return () => { ativo = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!itens.length) return null;
  return (
    <div className="toast-pilha topo" aria-live="polite" aria-label="Notificações">
      {itens.slice(0, 3).map((n) => (
        <div key={n.id} className={`toast notif-${n.tipo}`} onClick={() => abrir(n)} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter") abrir(n); }}>
          <button className="toast-fechar" onClick={(e) => { e.stopPropagation(); void marcar([n.id]); }} aria-label="Dispensar notificação">×</button>
          <strong>{ICONE[n.tipo] ?? "🔔"} {n.titulo}</strong>
          {n.corpo && <div className="mudo">{n.corpo}</div>}
        </div>
      ))}
      {itens.length > 3 && (
        <div className="toast notif-sistema" role="button" onClick={() => router.push("/painel/notificacoes")}>
          <strong>+{itens.length - 3} notificações</strong>
          <div className="mudo">Abrir a central</div>
        </div>
      )}
    </div>
  );
}
