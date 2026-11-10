"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Item = { id: string; cliente: string; telefone: string; motivo: string | null; aguardandoDesde: string | null };

function tempo(desde: string | null) {
  if (!desde) return "";
  const min = Math.floor((Date.now() - new Date(desde).getTime()) / 60000);
  return min < 1 ? "agora" : `${min} min`;
}

/** Bipe curto via Web Audio (sem arquivo externo). */
function bipe() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    /* navegador sem áudio liberado */
  }
}

/**
 * Popup da fila de atendimento humano. Consulta /api/painel/fila a cada 5 s.
 * Conversa nova na fila => toast + som + notificação do navegador. Clique abre a janela de atendimento.
 */
export default function AlertaFila() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [fila, setFila] = useState<Item[]>([]);
  const [dispensados, setDispensados] = useState<Set<string>>(new Set());
  const vistos = useRef<Set<string> | null>(null);
  const dispensar = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setDispensados((d) => new Set(d).add(id));
  };
  const [permissao, setPermissao] = useState<NotificationPermission | "indisponivel">("default");

  // abre a conversa na central de atendimento (estilo WhatsApp)
  const abrir = (id: string) => router.push(`/painel/conversas?aba=espera&c=${id}`, { scroll: false });
  const naCentral = pathname.startsWith("/painel/conversas");
  void params;

  useEffect(() => {
    setPermissao(typeof Notification === "undefined" ? "indisponivel" : Notification.permission);
  }, []);

  useEffect(() => {
    let ativo = true;
    async function consultar() {
      try {
        const r = await fetch("/api/painel/fila", { cache: "no-store" });
        if (!r.ok) return;
        const dados = (await r.json()) as { aguardando: Item[] };
        if (!ativo) return;
        const primeiraVez = vistos.current === null;
        if (primeiraVez) vistos.current = new Set();
        const novos = dados.aguardando.filter((i) => !vistos.current!.has(i.id));
        novos.forEach((i) => vistos.current!.add(i.id));
        setFila(dados.aguardando);
        document.title = dados.aguardando.length ? `(${dados.aguardando.length}) Atendimento — Comauto` : "Comauto — Painel do Assistente";
        if (!primeiraVez && novos.length) {
          bipe();
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            for (const n of novos) {
              const notif = new Notification("Novo atendimento no WhatsApp", {
                body: `${n.cliente} (${n.telefone}) — ${n.motivo ?? "pediu atendente"}`,
                tag: n.id,
              });
              notif.onclick = () => {
                window.focus();
                abrir(n.id);
              };
            }
          }
        }
      } catch {
        /* rede instável: tenta no próximo ciclo */
      }
    }
    consultar();
    const t = setInterval(consultar, 5000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dispensado some até sair da fila; cliente NOVO na fila sempre aparece
  // na própria central os cards não aparecem (a lista já mostra a fila); som e notificação continuam
  const visiveis = naCentral ? [] : fila.filter((i) => !dispensados.has(i.id));

  return (
    <div className="toast-pilha" aria-live="polite">
      {permissao === "default" && !dispensados.has("notif") && !naCentral && (
        <div className="toast info" onClick={() => Notification.requestPermission().then(setPermissao)}>
          <button className="toast-fechar" onClick={dispensar("notif")} aria-label="Dispensar">×</button>
          <strong>Ativar notificações</strong>
          <div className="mudo">Clique para ser avisada de novos atendimentos mesmo com o painel em outra aba.</div>
        </div>
      )}
      {visiveis.slice(0, 3).map((i) => (
        <div key={i.id} className="toast" onClick={() => abrir(i.id)} role="button">
          <button className="toast-fechar" onClick={dispensar(i.id)} aria-label="Dispensar aviso">×</button>
          <strong>🔔 {i.cliente} aguardando atendimento</strong>
          <div className="mudo">
            {i.telefone} · há {tempo(i.aguardandoDesde)} · {i.motivo ?? "pediu atendente"}
          </div>
        </div>
      ))}
      {visiveis.length > 3 && <div className="toast" onClick={() => router.push("/painel/conversas?aba=espera")}><strong>+{visiveis.length - 3} na fila</strong></div>}
    </div>
  );
}
