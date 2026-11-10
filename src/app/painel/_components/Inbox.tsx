"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Conversa, { corAvatar, iniciais } from "./Conversa";

type Item = {
  id: string; cliente: string; telefone: string; status: string; motivo: string | null; aguardandoDesde: string | null; assumidaPor: string | null;
  naoLidas: number; resultado: string | null; ultimaMsg: string | null; ultimaDirecao: string | null; ultimoAutor: string | null; ultimoStatus: string | null; ultimaEm: string | null;
};
type Resp = { eu: string; contagem: { espera: number; atendimento: number; minhas: number; finalizados: number; bot: number }; itens: Item[] };

const ABAS = [
  { chave: "espera", rotulo: "Em espera" },
  { chave: "atendimento", rotulo: "Em atendimento" },
  { chave: "finalizados", rotulo: "Finalizados" },
  { chave: "bot", rotulo: "Assistente" },
] as const;

const RESULTADO: Record<string, string> = { agendou: "✅ Agendou", resolvido: "✔ Resolvido", sem_retorno: "⏳ Sem retorno", reclamacao: "⚠ Reclamação", outro: "Outro" };

function quando(d: string | null) {
  if (!d) return "";
  const dt = new Date(d);
  const hoje = new Date();
  if (dt.toDateString() === hoje.toDateString()) return dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (dt.toDateString() === new Date(Date.now() - 86400_000).toDateString()) return "Ontem";
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
const minutos = (d: string | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000)) : 0);

export default function Inbox({ slaMin }: { slaMin: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const aba = params.get("aba") ?? "espera";
  const selecionada = params.get("c") ?? params.get("abrir");
  const [busca, setBusca] = useState("");
  const [dados, setDados] = useState<Resp | null>(null);
  const [notif, setNotif] = useState<NotificationPermission | "indisponivel">("granted");
  useEffect(() => setNotif(typeof Notification === "undefined" ? "indisponivel" : Notification.permission), []);

  const irPara = (novo: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    p.delete("abrir");
    for (const [k, v] of Object.entries(novo)) (v === null ? p.delete(k) : p.set(k, v));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  // troca de aba: limpa a lista na hora (mostra esqueleto) para nunca clicar num item da aba anterior
  useEffect(() => setDados(null), [aba]);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/painel/inbox?aba=${aba}&q=${encodeURIComponent(busca)}`, { cache: "no-store" });
    if (r.ok) setDados(await r.json());
  }, [aba, busca]);

  useEffect(() => {
    const t0 = setTimeout(carregar, busca ? 250 : 0); // debounce da busca
    const t = setInterval(carregar, 5000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [carregar, busca]);

  return (
    <div className={`wa ${selecionada ? "tem-selecao" : ""}`}>
      <aside className="wa-lista">
        <div className="wa-lista-topo">
          <div className="wa-lista-titulo">
            <h1>Atendimento</h1>
            {dados && <span className="mudo">{dados.contagem.minhas} com você · limite de espera {slaMin} min</span>}
          </div>
          {notif === "default" && (
            <button className="wa-notif" onClick={() => Notification.requestPermission().then(setNotif)}>🔔 Ativar notificações de novos atendimentos</button>
          )}
          <div className="wa-busca">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar nome ou telefone" aria-label="Pesquisar conversas" />
          </div>
          <div className="wa-abas" role="tablist">
            {ABAS.map((a) => {
              const n = dados?.contagem[a.chave] ?? 0;
              return (
                <button key={a.chave} role="tab" aria-selected={aba === a.chave} className={`wa-aba ${aba === a.chave ? "ativa" : ""} ${a.chave === "espera" && n ? "alerta" : ""}`} onClick={() => irPara({ aba: a.chave, c: null })}>
                  {a.rotulo}
                  {n > 0 && <span className="wa-contador">{n}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="wa-itens">
          {!dados && [0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="wa-item-lista"><div className="esqueleto" style={{ width: 46, height: 46, borderRadius: "50%" }} /><div style={{ flex: 1 }}><div className="esqueleto" style={{ width: "60%", height: 12 }} /><div className="esqueleto" style={{ width: "85%", height: 10, marginTop: 8 }} /></div></div>
          ))}
          {dados && !dados.itens.length && (
            <div className="wa-vazio">
              <span>{aba === "espera" ? "🎉" : "💬"}</span>
              {aba === "espera" ? "Ninguém esperando. Fila zerada!" : "Nenhuma conversa aqui."}
            </div>
          )}
          {dados?.itens.map((i) => {
            const espera = minutos(i.aguardandoDesde);
            const estourou = aba === "espera" && espera >= slaMin;
            const prefixo = i.ultimaDirecao === "saida" ? (i.ultimoAutor === "atendente" ? "Você: " : i.ultimoAutor === "bot" ? "🤖 " : "") : "";
            return (
              <button key={i.id} className={`wa-item-lista ${selecionada === i.id ? "selecionada" : ""}`} onClick={() => irPara({ c: i.id })}>
                <div className="wa-avatar" style={{ background: corAvatar(i.cliente) }}>{iniciais(i.cliente)}</div>
                <div className="wa-item-corpo">
                  <div className="wa-item-linha">
                    <strong>{i.cliente}</strong>
                    <span className={`wa-hora ${i.naoLidas ? "nova" : ""}`}>{quando(i.ultimaEm)}</span>
                  </div>
                  <div className="wa-item-linha">
                    <span className="wa-previa">
                      {i.ultimaDirecao === "saida" && <span className={`ticks ${i.ultimoStatus === "lida" ? "lida" : ""}`}>{i.ultimoStatus === "enviada" ? "✓" : "✓✓"}</span>}
                      {prefixo}{i.ultimaMsg ?? i.motivo ?? "—"}
                    </span>
                    {i.naoLidas > 0 && <span className="wa-nao-lidas">{i.naoLidas}</span>}
                  </div>
                  <div className="wa-item-rodape">
                    {aba === "espera" && <span className={`tag ${estourou ? "erro" : "aviso"}`}>⏱ {espera} min</span>}
                    {aba === "atendimento" && <span className={`tag ${i.assumidaPor === dados.eu ? "info" : ""}`}>{i.assumidaPor === dados.eu ? "com você" : i.assumidaPor}</span>}
                    {aba === "finalizados" && i.resultado && <span className="tag">{RESULTADO[i.resultado] ?? i.resultado}</span>}
                    {aba !== "finalizados" && i.motivo && <span className="wa-motivo">{i.motivo}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="wa-principal">
        {selecionada ? (
          <Conversa key={selecionada} id={selecionada} onMudou={carregar} onVoltar={() => irPara({ c: null })} />
        ) : (
          <div className="wa-boas-vindas">
            <svg viewBox="0 0 120 100" width="160" aria-hidden="true">
              <rect x="10" y="12" width="74" height="52" rx="14" fill="#fff" stroke="#cfdcef" strokeWidth="2" />
              <path d="M30 64l-6 14 18-14z" fill="#fff" stroke="#cfdcef" strokeWidth="2" />
              <rect x="24" y="28" width="44" height="6" rx="3" fill="#0040c5" opacity=".8" />
              <rect x="24" y="42" width="30" height="6" rx="3" fill="#00b0f0" />
              <rect x="56" y="40" width="54" height="40" rx="12" fill="#dcf8d4" stroke="#bfe8b4" strokeWidth="2" />
              <path d="m72 60 6 6 12-12" stroke="#0f7a55" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2>Central de atendimento</h2>
            <p className="mudo">Escolha uma conversa na lista. As respostas saem pelo número oficial do WhatsApp da empresa.</p>
            {dados && dados.contagem.espera > 0 && (
              <button className="btn primario" onClick={() => { irPara({ aba: "espera", c: dados.itens[0]?.id ?? null }); }}>Atender o próximo da fila ({dados.contagem.espera})</button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
