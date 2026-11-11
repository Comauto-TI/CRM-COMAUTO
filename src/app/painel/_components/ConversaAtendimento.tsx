"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import DialogoMensagens, { type MensagemDialogo } from "./DialogoMensagens";

type Mensagem = MensagemDialogo & { direcao: "entrada" | "saida"; autor: "cliente" | "atendente" };
type Dados = {
  ok: true; id: string | null; versao: number; clienteNome: string;
  estado: "livre" | "minha" | "outra"; janelaAberta: boolean; podeDevolver: boolean; podeAssumir: boolean;
  mensagens: Mensagem[]; revisaoPendente: boolean;
};
type Resultado = { ok: boolean; erro?: string; incerto?: boolean };
type Tentativa = { id: string; texto: string; incerta: boolean };
type Rascunho = { texto: string; tentativa: Tentativa | null; enviando: boolean; erro: string | null };
export type ConfigConversa = {
  setor: "pecas" | "vendas"; chave: "cotacaoId" | "oportunidadeId"; nome: "Peças" | "Vendas";
  registro: "Cotação" | "Oportunidade"; assumirSemResponsavel: boolean;
  assumir: (id: string, versao: number) => Promise<Resultado>;
  devolver: (id: string, versao: number) => Promise<Resultado>;
  responder: (id: string, versao: number, mensagemId: string, texto: string) => Promise<Resultado>;
};
type Props = { registroId: string; config: ConfigConversa; onMudou?: () => void; onVoltar?: () => void };
const VAZIO: Rascunho = { texto: "", tentativa: null, enviando: false, erro: null };
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function dadosValidos(v: unknown, registroId: string, chave: ConfigConversa["chave"]): v is Dados {
  return objeto(v) && v.ok === true && (v.id === null || uuid(v.id)) && uuid(v[chave]) && (v[chave] as string).toLowerCase() === registroId.toLowerCase() &&
    typeof v.versao === "number" && Number.isSafeInteger(v.versao) && v.versao >= 0 && v.versao < 2_147_483_647 &&
    typeof v.clienteNome === "string" && (v.estado === "livre" || v.estado === "minha" || v.estado === "outra") &&
    typeof v.janelaAberta === "boolean" && typeof v.podeDevolver === "boolean" &&
    (!v.podeDevolver || (v.id !== null && v.estado !== "livre")) &&
    typeof v.podeAssumir === "boolean" && (!v.podeAssumir || v.estado === "livre") &&
    typeof v.revisaoPendente === "boolean" && Array.isArray(v.mensagens) &&
    (v.id !== null || (v.estado !== "minha" && v.versao === 0 && v.mensagens.length === 0)) &&
    v.mensagens.every((m: unknown) => objeto(m) && uuid(m.id) && (m.direcao === "entrada" || m.direcao === "saida") &&
      (m.autor === "cliente" || m.autor === "atendente") && typeof m.tipo === "string" &&
      (m.conteudo === null || typeof m.conteudo === "string") && typeof m.status === "string" &&
      typeof m.criadoEm === "string" && Number.isFinite(Date.parse(m.criadoEm)) && (m.pendente === undefined || typeof m.pendente === "boolean"));
}

function corAvatar(nome: string) {
  const cores = ["#0040c5", "#0a7f6f", "#7a3fd1", "#c2570c", "#0e7490", "#b4235a", "#3d5a99", "#5b7d12"];
  let h = 0;
  for (const ch of nome) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return cores[h % cores.length];
}
function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/** Rascunhos ficam por setor e negócio enquanto o painel está aberto, sem persistência no navegador. */
export default function ConversaAtendimento(props: Props) {
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({});
  const chave = `${props.config.setor}:${props.registroId.toLowerCase()}`;
  return <ConversaDoRegistro key={chave} {...props} rascunho={rascunhos[chave] ?? VAZIO}
    atualizarRascunho={(atualizar) => setRascunhos((atuais) => ({ ...atuais, [chave]: atualizar(atuais[chave] ?? VAZIO) }))} />;
}

function ConversaDoRegistro({ registroId, config, onMudou, onVoltar, rascunho, atualizarRascunho }: Props & {
  rascunho: Rascunho; atualizarRascunho: (atualizar: (atual: Rascunho) => Rascunho) => void;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erroConsulta, setErroConsulta] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [semResponsavel, setSemResponsavel] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [pendente, iniciar] = useTransition();
  const vivo = useRef(true);
  const consulta = useRef<AbortController | null>(null);
  const emAcao = useRef(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const ultimaMensagem = useRef<string | null>(null);

  const carregar = useCallback(async () => {
    consulta.current?.abort();
    const controller = new AbortController();
    consulta.current = controller;
    try {
      const resposta = await fetch(`/api/painel/${config.setor}/${encodeURIComponent(registroId)}/conversa`, { cache: "no-store", signal: controller.signal });
      const corpo: unknown = await resposta.json().catch(() => null);
      if (!vivo.current || controller.signal.aborted || consulta.current !== controller) return;
      if (!resposta.ok || !dadosValidos(corpo, registroId, config.chave)) {
        setDados(null);
        const semDono = objeto(corpo) && corpo.ok === false && corpo.codigo === "sem_responsavel";
        setSemResponsavel(semDono);
        setErroConsulta(objeto(corpo) && typeof corpo.erro === "string" ? corpo.erro : semDono
          ? `Assuma a ${config.registro.toLowerCase()} no cartão para abrir o atendimento.` : "Não foi possível carregar esta conversa. Tente novamente.");
      } else {
        setDados(corpo);
        setSemResponsavel(false);
        setErroConsulta(null);
      }
    } catch {
      if (!vivo.current || controller.signal.aborted || consulta.current !== controller) return;
      setDados(null);
      setSemResponsavel(false);
      setErroConsulta("Não foi possível atualizar a conversa. Confira a conexão e tente novamente.");
    } finally {
      if (vivo.current && !controller.signal.aborted && consulta.current === controller) setCarregando(false);
    }
  }, [registroId, config]);

  useEffect(() => {
    vivo.current = true;
    let ativo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function consultar() {
      await carregar();
      if (ativo && vivo.current) timer = setTimeout(consultar, 4000);
    }
    void consultar();
    return () => { ativo = false; vivo.current = false; clearTimeout(timer); consulta.current?.abort(); };
  }, [carregar]);

  useEffect(() => {
    const ultima = dados?.mensagens.at(-1)?.id ?? null;
    if (ultima && ultima !== ultimaMensagem.current) {
      fimRef.current?.scrollIntoView({ block: "end", behavior: ultimaMensagem.current ? "smooth" : "auto" });
      ultimaMensagem.current = ultima;
    }
  }, [dados?.mensagens]);

  function executar(acao: () => Promise<Resultado>) {
    if (emAcao.current || pendente || rascunho.enviando) return;
    emAcao.current = true;
    iniciar(async () => {
      setErroAcao(null);
      try {
        const r = await acao();
        if (!vivo.current) return;
        if (r.ok !== true || r.incerto) setErroAcao(r.erro ?? "Não foi possível confirmar a ação. Atualize antes de tentar novamente.");
        else onMudou?.();
      } catch {
        if (vivo.current) setErroAcao("Não foi possível confirmar a ação. Atualize antes de tentar novamente.");
      } finally {
        emAcao.current = false;
        if (vivo.current) await carregar();
      }
    });
  }

  function enviar() {
    const texto = rascunho.texto.trim();
    if (emAcao.current || pendente || rascunho.enviando || !texto || !dados || dados.estado !== "minha" || !dados.janelaAberta) return;
    let tentativa = rascunho.tentativa;
    if (!tentativa || tentativa.texto !== texto) {
      try { tentativa = { id: crypto.randomUUID(), texto, incerta: false }; }
      catch { atualizarRascunho((r) => ({ ...r, erro: "Não foi possível iniciar o envio. Tente novamente." })); return; }
    }
    const envio = tentativa;
    const versao = dados.versao;
    emAcao.current = true;
    atualizarRascunho((r) => ({ ...r, tentativa: envio, enviando: true, erro: null }));
    iniciar(async () => {
      try {
        const r: Resultado = await config.responder(registroId, versao, envio.id, envio.texto);
        atualizarRascunho((atual) => atual.tentativa?.id !== envio.id ? atual : r.ok === true && !r.incerto
          ? { ...VAZIO } : { ...atual, enviando: false, tentativa: { ...envio, incerta: envio.incerta || r.incerto === true },
            erro: r.erro ?? "Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente." });
        if (vivo.current && r.ok === true && !r.incerto) onMudou?.();
      } catch {
        atualizarRascunho((atual) => atual.tentativa?.id !== envio.id ? atual : { ...atual, enviando: false,
          tentativa: { ...envio, incerta: true }, erro: "Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente." });
      } finally {
        emAcao.current = false;
        if (vivo.current) await carregar();
      }
    });
  }

  const nome = dados?.clienteNome ?? `Atendimento de ${config.nome}`;
  const ocupado = pendente || rascunho.enviando;
  const podeEnviar = !!dados && dados.estado === "minha" && dados.janelaAberta && !ocupado;
  const estado = dados?.estado === "minha" ? "Em atendimento com você" : dados?.estado === "outra"
    ? "Em atendimento por outra pessoa" : dados ? "Disponível para assumir" : semResponsavel ? `${config.registro} sem responsável` : `Conversa de ${config.nome}`;

  return (
    <div className="wa-conversa">
      <section className="wa-chat" aria-label={`Conversa de ${config.nome}`} aria-busy={ocupado || carregando}>
        <header className="wa-topo">
          {onVoltar && <button type="button" className="wa-icone-btn so-mobile" onClick={onVoltar} aria-label="Voltar">←</button>}
          <div className="wa-avatar" style={{ background: corAvatar(nome) }}>{iniciais(nome)}</div>
          <div className="wa-topo-info"><strong>{nome}</strong><span>{estado}</span></div>
          <div className="acoes wa-topo-acoes">
            {((semResponsavel && config.assumirSemResponsavel) || dados?.podeAssumir) && <button type="button" className="btn primario" disabled={ocupado}
              onClick={() => executar(() => config.assumir(registroId, dados?.versao ?? 0))}>Assumir atendimento</button>}
            {dados?.podeDevolver && <button type="button" className="btn" disabled={ocupado}
              onClick={() => executar(() => config.devolver(registroId, dados.versao))}>Devolver atendimento</button>}
          </div>
        </header>
        <div className="wa-msgs" role="log" aria-label="Mensagens do atendimento" aria-live="polite">
          {carregando && <div className="mudo" role="status">Carregando conversa…</div>}
          {erroConsulta && <div className="alerta erro" role="alert">{erroConsulta} <button type="button" className="btn pequeno" disabled={ocupado} onClick={() => void carregar()}>Atualizar</button></div>}
          {dados?.revisaoPendente && <div className="alerta aviso" role="status">Há mensagens que precisam de revisão antes de aparecer neste atendimento.</div>}
          {dados && !dados.mensagens.length && <div className="wa-aviso">Nenhuma mensagem disponível neste atendimento.</div>}
          {dados && <DialogoMensagens mensagens={dados.mensagens} autorAtendente={config.nome} />}
          <div ref={fimRef} />
        </div>
        <footer className="wa-envio">
          {erroAcao && <div className="alerta erro" role="alert">{erroAcao}</div>}
          {rascunho.erro && <div className="alerta erro" role="alert">{rascunho.erro}</div>}
          {rascunho.tentativa?.incerta && <div className="alerta aviso" role="status">Resultado incerto. Confira a conversa antes de tentar novamente.</div>}
          {dados?.estado === "outra" && <div className="wa-aviso">Este atendimento está com outra pessoa.</div>}
          {dados && !dados.janelaAberta && <div className="wa-aviso">Janela de 24h fechada. O envio de texto está indisponível.</div>}
          <div className="wa-barra">
            <textarea aria-label={`Mensagem para o lead de ${config.nome}`} value={rascunho.texto} rows={1} maxLength={4000}
              disabled={!podeEnviar || rascunho.tentativa?.incerta === true} placeholder="Digite uma mensagem pelo número oficial"
              onChange={(e) => {
                const texto = e.target.value;
                atualizarRascunho((r) => ({ ...r, texto, erro: null,
                  tentativa: r.tentativa && r.tentativa.texto === texto.trim() ? r.tentativa : null }));
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); } }} />
            <button type="button" className="wa-enviar" disabled={!podeEnviar || !rascunho.texto.trim()} onClick={enviar}
              aria-label={rascunho.tentativa ? "Tentar novamente o envio" : "Enviar mensagem"}>
              {ocupado ? "…" : "➤"}
            </button>
          </div>
          <span className="mudo wa-dica">{rascunho.tentativa ? "Use o botão para repetir esta tentativa." : "Enter envia · Shift+Enter quebra linha"}</span>
        </footer>
      </section>
    </div>
  );
}
