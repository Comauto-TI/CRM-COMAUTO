"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Notif = { id: string; tipo: string; titulo: string; corpo: string | null; link: string | null; criado_em: string };
type Insistente = { id: string; clienteId: string; nome: string; dias: number; dataAlvo: string };
const chaveContato = (l: Insistente) => `${l.clienteId}:${l.dataAlvo}`;
const quando = (d: number) => (d === 0 ? "é hoje" : d === 1 ? "é amanhã" : d === -1 ? "foi ontem" : d > 0 ? `em ${d} dias` : `foi há ${-d} dias`);

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
  // lembrete insistente: volta a cada abertura do painel; o × só esconde nesta visita
  const [insistentes, setInsistentes] = useState<Insistente[]>([]);
  const [erroAtualizacaoInsistentes, setErroAtualizacaoInsistentes] = useState(false);
  const [escondidos, setEscondidos] = useState<Set<string>>(new Set());
  const [salvandoContato, setSalvandoContato] = useState<Set<string>>(new Set());
  const [errosContato, setErrosContato] = useState<Record<string, string>>({});
  const contatosEmEnvio = useRef(new Set<string>());
  const contatosConcluidos = useRef(new Set<string>());
  async function contatoFeito(l: Insistente) {
    const chave = chaveContato(l);
    if (contatosEmEnvio.current.has(chave)) return;
    contatosEmEnvio.current.add(chave);
    setSalvandoContato(new Set(contatosEmEnvio.current));
    setErrosContato((erros) => ({ ...erros, [chave]: "" }));
    try {
      const resposta = await fetch("/api/painel/notificacoes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contatoAniversario: l.clienteId, dataAniversario: l.dataAlvo }),
      });
      const resultado = await resposta.json().catch(() => null) as { ok?: unknown; motivo?: unknown } | null;
      if (!resposta.ok || resultado?.ok !== true) {
        const motivo = typeof resultado?.motivo === "string" && resultado.motivo
          ? resultado.motivo.slice(0, 300)
          : "Não foi possível registrar o contato. Tente novamente.";
        setErrosContato((erros) => ({ ...erros, [chave]: motivo }));
        return;
      }
      contatosConcluidos.current.add(chave);
      setInsistentes((lista) => lista.filter((item) => chaveContato(item) !== chave));
      router.refresh();
    } catch {
      setErrosContato((erros) => ({ ...erros, [chave]: "Não foi possível registrar o contato. Confira a conexão e tente novamente." }));
    } finally {
      contatosEmEnvio.current.delete(chave);
      setSalvandoContato(new Set(contatosEmEnvio.current));
    }
  }
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
        const { naoLidas, insistentes: ins, erroInsistentes } = (await r.json()) as { naoLidas: Notif[]; insistentes?: Insistente[]; erroInsistentes?: boolean };
        if (!ativo) return;
        setErroAtualizacaoInsistentes(erroInsistentes === true);
        if (erroInsistentes !== true) {
          setInsistentes((ins ?? []).filter((item) => !contatosConcluidos.current.has(chaveContato(item))));
        }
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

  const insVisiveis = insistentes.filter((l) => !escondidos.has(l.id));
  if (!itens.length && !insVisiveis.length && !erroAtualizacaoInsistentes) return null;
  return (
    <div className="toast-pilha topo" aria-live="polite" aria-label="Notificações">
      {insVisiveis.slice(0, 3).map((l) => (
        <div key={`ins-${l.id}`} className="toast notif-aniversario insistente" role="alert" aria-busy={salvandoContato.has(chaveContato(l))}>
          <button className="toast-fechar" disabled={salvandoContato.has(chaveContato(l))} onClick={() => setEscondidos((s) => new Set(s).add(l.id))} aria-label="Esconder até a próxima vez que abrir o painel">×</button>
          <strong>🎂 Aniversário de {l.nome} {quando(l.dias)}</strong>
          <div className="mudo">Lembrete insistente: volta toda vez que você abrir o painel até registrar o contato.</div>
          <div className="toast-acoes">
            <button className="btn pequeno primario" disabled={salvandoContato.has(chaveContato(l))} onClick={() => contatoFeito(l)}>{salvandoContato.has(chaveContato(l)) ? "Salvando…" : "Contato feito"}</button>
            <a className="btn pequeno" href={`/painel/clientes?c=${l.clienteId}`}>Abrir ficha</a>
          </div>
          {errosContato[chaveContato(l)] && <p className="texto-erro" role="alert">{errosContato[chaveContato(l)]}</p>}
        </div>
      ))}
      {erroAtualizacaoInsistentes && (
        <div className="toast notif-alerta" role="status">
          <strong>Não foi possível atualizar os lembretes de aniversário.</strong>
          <div className="mudo">{insistentes.length ? "Os lembretes já exibidos foram mantidos. " : ""}Tentaremos novamente em instantes.</div>
        </div>
      )}
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
