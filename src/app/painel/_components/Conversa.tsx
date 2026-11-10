"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { assumir, puxarParaHumano, responder, enviarRetomada, devolver, encerrar, adicionarNota, adicionarTag } from "../conversas/actions";

type Msg = { id: string; direcao: string; autor: string; tipo: string; conteudo: string | null; status: string; erro: string | null; criado_em: string };
type Dados = {
  eu: string;
  conversa: { id: string; status: string; motivo_transferencia: string | null; aguardando_desde: string | null; assumida_por: string | null; resultado: string | null; cliente_id: string };
  cliente: { id: string; nome: string | null; telefone: string; email: string | null; cidade: string | null; tags: string[]; origem: string; criado_em: string } | null;
  janelaAberta: boolean;
  optout: boolean;
  mensagens: Msg[];
  veiculos: { placa: string | null; modelo: string | null; ano: number | null; km_atual: number | null; proxima_revisao_em: string | null }[];
  agendamentos: { id: string; inicio: string; status: string; confirmado_por: string | null; confirmado_em: string | null; confirmado_canal: string | null; servicos: { nome: string } | null }[];
  consentimentos: { tipo: string; status: string; concedido_em: string }[];
  notas: { id: string; autor: string; texto: string; criado_em: string }[];
  inscricoes: { status: string; eventos: { nome: string; inicio: string } | null }[];
  respostasRapidas: { id: string; titulo: string; texto: string }[];
};

const hora = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dataCurta = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
function rotuloDia(d: string) {
  const dia = new Date(d);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86400_000);
  if (dia.toDateString() === hoje.toDateString()) return "Hoje";
  if (dia.toDateString() === ontem.toDateString()) return "Ontem";
  return dia.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}
const STATUS_TAG: Record<string, string> = { confirmado: "ok", pendente: "aviso", cancelado: "erro", compareceu: "info", nao_compareceu: "erro" };

export function corAvatar(nome: string) {
  const cores = ["#0040c5", "#0a7f6f", "#7a3fd1", "#c2570c", "#0e7490", "#b4235a", "#3d5a99", "#5b7d12"];
  let h = 0;
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return cores[h % cores.length];
}
export function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

function Ticks({ status }: { status: string }) {
  if (status === "falhou" || status === "bloqueada") return <span className="ticks erro" title={status}>!</span>;
  if (status === "enviada") return <span className="ticks" title="enviada">✓</span>;
  return <span className={`ticks ${status === "lida" ? "lida" : ""}`} title={status}>✓✓</span>;
}

/** Conversa estilo WhatsApp (chat + ficha do lead). Usada na caixa de entrada do Atendimento. */
export default function Conversa({ id, onMudou, onVoltar }: { id: string; onMudou?: () => void; onVoltar?: () => void }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [texto, setTexto] = useState("");
  const [nota, setNota] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [fichaAberta, setFichaAberta] = useState(true);
  const [pendente, iniciar] = useTransition();
  const fimRef = useRef<HTMLDivElement>(null);
  const qtdMsgs = useRef(0);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/painel/conversa/${id}`, { cache: "no-store" });
    if (r.ok) setDados(await r.json());
  }, [id]);

  useEffect(() => {
    setDados(null);
    setErro(null);
    setTexto("");
    qtdMsgs.current = 0;
    carregar();
    const t = setInterval(carregar, 4000);
    return () => clearInterval(t);
  }, [id, carregar]);

  useEffect(() => {
    const n = dados?.mensagens.length ?? 0;
    if (n !== qtdMsgs.current) {
      fimRef.current?.scrollIntoView({ block: "end", behavior: qtdMsgs.current ? "smooth" : "auto" });
      qtdMsgs.current = n;
    }
  }, [dados?.mensagens.length]);

  const acao = (fn: () => Promise<{ ok: boolean; erro?: string }>, depois?: () => void) =>
    iniciar(async () => {
      setErro(null);
      const r = await fn();
      if (!r.ok) setErro(r.erro ?? "Não foi possível concluir.");
      else depois?.();
      await carregar();
      onMudou?.();
    });

  const c = dados?.conversa;
  const minha = c?.assumida_por === dados?.eu;
  const outra = !!c?.assumida_por && !minha;
  const nome = dados?.cliente?.nome ?? "Cliente";
  const enviar = () => texto.trim() && c && acao(() => responder(c.id, texto), () => setTexto(""));

  let diaAnterior = "";

  return (
    <div className={`wa-conversa ${fichaAberta ? "com-ficha" : ""}`}>
      <section className="wa-chat">
        <header className="wa-topo">
          {onVoltar && <button className="wa-icone-btn so-mobile" onClick={onVoltar} aria-label="Voltar">←</button>}
          {dados ? (
            <>
              <div className="wa-avatar" style={{ background: corAvatar(nome) }}>{iniciais(nome)}</div>
              <div className="wa-topo-info">
                <strong>{nome}</strong>
                <span>
                  {c?.status === "humano" ? (c.assumida_por ? (minha ? "Em atendimento com você" : `Em atendimento com ${c.assumida_por}`) : "Aguardando na fila") : c?.status === "bot" ? "Assistente virtual atendendo" : `Finalizado${c?.resultado ? ` · ${c.resultado}` : ""}`}
                  {c?.motivo_transferencia ? ` · ${c.motivo_transferencia}` : ""}
                </span>
              </div>
            </>
          ) : (
            <div className="wa-topo-info"><div className="esqueleto" style={{ width: 180, height: 14 }} /><div className="esqueleto" style={{ width: 260, height: 10, marginTop: 6 }} /></div>
          )}
          <div className="acoes wa-topo-acoes">
            {c?.status === "humano" && !c.assumida_por && (
              <button className="btn primario" disabled={pendente} onClick={() => acao(() => assumir(c.id))}>Assumir atendimento</button>
            )}
            {c && c.status !== "humano" && (
              <button className="btn" disabled={pendente} onClick={() => acao(() => puxarParaHumano(c.id))}>{c.status === "encerrada" ? "Reabrir" : "Assumir do bot"}</button>
            )}
            {c?.status === "humano" && (minha || !c.assumida_por) && (
              <>
                <button className="btn" disabled={pendente} onClick={() => acao(() => devolver(c.id))}>Devolver ao bot</button>
                <select className="btn" value="" disabled={pendente} onChange={(e) => e.target.value && acao(() => encerrar(c.id, e.target.value))} aria-label="Finalizar atendimento">
                  <option value="" disabled>Finalizar…</option>
                  <option value="agendou">✅ Agendou</option>
                  <option value="resolvido">✔ Resolvido</option>
                  <option value="sem_retorno">⏳ Sem retorno</option>
                  <option value="reclamacao">⚠ Reclamação tratada</option>
                  <option value="outro">Outro</option>
                </select>
              </>
            )}
            <button className={`wa-icone-btn ${fichaAberta ? "ativo" : ""}`} onClick={() => setFichaAberta((v) => !v)} title="Ficha do cliente" aria-label="Ficha do cliente">ⓘ</button>
          </div>
        </header>

        <div className="wa-msgs">
          {!dados && [55, 40, 62, 35].map((w, i) => <div key={i} className={`esqueleto bolha-esq ${i % 2 ? "dir" : ""}`} style={{ width: `${w}%` }} />)}
          {dados?.mensagens.map((m) => {
            const dia = rotuloDia(m.criado_em);
            const separador = dia !== diaAnterior;
            diaAnterior = dia;
            const saida = m.direcao === "saida";
            return (
              <div key={m.id} className="wa-linha-wrap">
                {separador && <div className="wa-dia"><span>{dia}</span></div>}
                <div className={`wa-linha ${saida ? "saida" : "entrada"}`}>
                  <div className={`wa-bolha ${saida ? "saida" : "entrada"} ${m.autor === "atendente" ? "atendente" : ""} ${m.autor === "sistema" ? "sistema" : ""} ${m.status === "bloqueada" || m.status === "falhou" ? "falha" : ""}`}>
                    {saida && <span className="wa-autor">{m.autor === "atendente" ? "Recepção" : m.autor === "bot" ? "Assistente" : "Sistema"}</span>}
                    <span className="wa-texto">{m.conteudo}</span>
                    <span className="wa-meta">
                      {m.erro && <em title={m.erro}>{m.status} · </em>}
                      {hora(m.criado_em)} {saida && <Ticks status={m.status} />}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={fimRef} />
        </div>

        <footer className="wa-envio">
          {erro && <div className="alerta erro">{erro}</div>}
          {dados?.optout && <div className="alerta aviso">Cliente pediu para não receber mensagens. Responda só o necessário.</div>}
          {!dados ? (
            <div className="esqueleto" style={{ height: 44, borderRadius: 22 }} />
          ) : outra ? (
            <div className="wa-aviso">🔒 Esta conversa está com <strong>{c?.assumida_por}</strong>.</div>
          ) : c?.status !== "humano" ? (
            <div className="wa-aviso">{c?.status === "bot" ? "🤖 O assistente virtual está atendendo. Clique em “Assumir do bot” para responder." : "Atendimento finalizado. Clique em “Reabrir” para continuar."}</div>
          ) : !dados.janelaAberta ? (
            <div className="wa-aviso">
              Janela de 24h fechada: só é possível enviar template aprovado.{" "}
              <button className="btn pequeno" disabled={pendente} onClick={() => acao(() => enviarRetomada(c!.id))}>Enviar template de retomada</button>
            </div>
          ) : (
            <>
              {!!dados.respostasRapidas.length && (
                <div className="wa-rapidas">
                  {dados.respostasRapidas.map((r) => <button key={r.id} className="wa-chip" onClick={() => setTexto(r.texto)}>{r.titulo}</button>)}
                </div>
              )}
              <div className="wa-barra">
                <textarea
                  value={texto}
                  rows={1}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder="Digite uma mensagem (sai pelo número oficial)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      enviar();
                    }
                  }}
                />
                <button className="wa-enviar" disabled={pendente || !texto.trim()} onClick={enviar} aria-label="Enviar">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" /></svg>
                </button>
              </div>
              <span className="mudo wa-dica">Enter envia · Shift+Enter quebra linha</span>
            </>
          )}
        </footer>
      </section>

      {fichaAberta && (
        <aside className="wa-ficha">
          <div className="wa-ficha-topo">
            <div className="wa-avatar grande" style={{ background: corAvatar(nome) }}>{iniciais(nome)}</div>
            <strong>{dados?.cliente?.nome ?? "—"}</strong>
            <span className="mudo">{dados?.cliente?.telefone}{dados?.cliente?.cidade ? ` · ${dados.cliente.cidade}` : ""}</span>
            <span className="mudo">Origem: {dados?.cliente?.origem ?? "—"}</span>
            <div className="acoes" style={{ justifyContent: "center", marginTop: 6 }}>
              {dados?.cliente?.tags.map((t) => <span key={t} className="tag info">{t}</span>)}
              <button className="btn pequeno" onClick={() => { const t = prompt("Nova tag (ex.: suv, interessado-hilux)"); if (t && dados?.cliente) acao(() => adicionarTag(dados.cliente!.id, t)); }}>+ tag</button>
            </div>
          </div>

          <section>
            <h3>Veículos</h3>
            {dados?.veiculos.length ? dados.veiculos.map((v, i) => (
              <div key={i} className="wa-item">
                <strong>{v.modelo ?? "Modelo não informado"}</strong>
                <span className="mudo">{[v.placa, v.km_atual ? `${v.km_atual.toLocaleString("pt-BR")} km` : null].filter(Boolean).join(" · ")}</span>
                {v.proxima_revisao_em && <span className="mudo">Próxima revisão: {new Date(v.proxima_revisao_em).toLocaleDateString("pt-BR")}</span>}
              </div>
            )) : <span className="mudo">Nenhum cadastrado</span>}
          </section>

          <section>
            <h3>Agendamentos</h3>
            {dados?.agendamentos.length ? dados.agendamentos.map((a) => (
              <div key={a.id} className="wa-item">
                <div className="acoes" style={{ justifyContent: "space-between" }}><strong>{a.servicos?.nome}</strong><span className={`tag ${STATUS_TAG[a.status] ?? ""}`}>{a.status.replace("_", " ")}</span></div>
                <span className="mudo">{dataCurta(a.inicio)}</span>
                {a.confirmado_por && <span className="mudo">✓ por {a.confirmado_por} ({a.confirmado_canal?.replace(/_/g, " ")})</span>}
              </div>
            )) : <span className="mudo">Nenhum</span>}
          </section>

          <section>
            <h3>Consentimentos</h3>
            {dados?.consentimentos.length ? (
              <div className="acoes">{dados.consentimentos.map((k, i) => <span key={i} className={`tag ${k.status === "ativo" ? "ok" : "erro"}`}>{k.tipo}</span>)}</div>
            ) : <span className="mudo">Nenhum registrado</span>}
          </section>

          {!!dados?.inscricoes.length && (
            <section>
              <h3>Eventos</h3>
              {dados.inscricoes.map((x, i) => <div key={i} className="wa-item"><strong>{x.eventos?.nome}</strong><span className="tag">{x.status}</span></div>)}
            </section>
          )}

          <section>
            <h3>Notas internas</h3>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Visível só para a equipe" rows={2} />
            <button className="btn pequeno" style={{ marginTop: 6 }} disabled={!nota.trim() || pendente} onClick={() => dados?.cliente && acao(() => adicionarNota(dados.cliente!.id, nota), () => setNota(""))}>Salvar nota</button>
            {dados?.notas.map((n) => (
              <div key={n.id} className="wa-nota"><div>{n.texto}</div><span className="mudo">{n.autor} · {dataCurta(n.criado_em)}</span></div>
            ))}
          </section>
        </aside>
      )}
    </div>
  );
}
