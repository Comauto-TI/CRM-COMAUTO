"use client";

import { startTransition, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DadosTransferencia, DestinoTransferencia } from "@/modulos/atendimento/dados-transferencia";
import type { ResultadoTransferencia } from "@/modulos/atendimento/transferencias";
import { prepararTransferenciaCartao, confirmarTransferenciaCartao } from "../transferencia-actions";
import TransferirAtendimento, { type OpcaoDestinoTransferencia } from "./TransferirAtendimento";

export type PropsTransferirCartao = { origem: DestinoTransferencia; registroId: string; unidade: string };
type Preparo = { versao: number; destinos: OpcaoDestinoTransferencia[] };

/** A abertura só prepara o contexto; a confirmação continua sendo uma ação explícita. */
export default function TransferirCartao(props: PropsTransferirCartao) {
  if (props.origem !== "vendas" && props.origem !== "pecas" && props.origem !== "oficina") return null;
  return <TransferenciaDoCartao key={`${props.origem}:${props.registroId.toLowerCase()}:${props.unidade}`} {...props} />;
}

function TransferenciaDoCartao({ origem, registroId, unidade }: PropsTransferirCartao) {
  const router = useRouter();
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [preparo, setPreparo] = useState<Preparo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [teveRetorno, setTeveRetorno] = useState(false);
  const vivo = useRef(true);
  const travaPreparo = useRef(false);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  async function alternar() {
    if (aberto) { setAberto(false); return; }
    setAberto(true);
    if (preparo || travaPreparo.current) return;
    travaPreparo.current = true;
    setPreparando(true);
    setErro(null);
    try {
      const resposta = await new Promise<Awaited<ReturnType<typeof prepararTransferenciaCartao>>>((resolve, reject) => {
        startTransition(() => { prepararTransferenciaCartao(origem, registroId, unidade).then(resolve, reject); });
      });
      if (!vivo.current) return;
      if (resposta.ok) setPreparo({ versao: resposta.versao, destinos: resposta.destinos });
      else setErro(resposta.erro);
    } catch {
      if (vivo.current) setErro("Não foi possível preparar a transferência. Confira o cartão e tente novamente.");
    } finally {
      travaPreparo.current = false;
      if (vivo.current) setPreparando(false);
    }
  }

  async function confirmar(dados: DadosTransferencia): Promise<ResultadoTransferencia> {
    setConfirmando(true);
    try {
      return await new Promise<ResultadoTransferencia>((resolve, reject) => {
        startTransition(() => { confirmarTransferenciaCartao(dados).then(resolve, reject); });
      });
    } finally {
      if (vivo.current) { setConfirmando(false); setTeveRetorno(true); }
    }
  }

  function atualizar() {
    if (travaPreparo.current || preparando || confirmando) return;
    setAberto(false);
    setPreparo(null);
    setErro(null);
    setTeveRetorno(false);
    startTransition(() => router.refresh());
  }

  return (
    <section aria-label="Transferência entre setores" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <div className="acoes" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn pequeno" onClick={alternar} disabled={preparando} aria-expanded={aberto} aria-controls={`${id}-transferencia`}>
          {preparando ? "Preparando transferência…" : aberto ? "Fechar transferência" : "Transferir para setor"}
        </button>
        {(erro || teveRetorno) && <button type="button" className="btn pequeno" onClick={atualizar} disabled={preparando || confirmando}>Atualizar quadro</button>}
      </div>
      <div id={`${id}-transferencia`} hidden={!aberto} aria-busy={preparando || confirmando}>
        {preparando && <p className="mudo" role="status">Preparando opções do setor…</p>}
        {erro && <p className="alerta erro" role="alert">{erro}</p>}
        {preparo && <TransferirAtendimento origem={origem} registroId={registroId} versao={preparo.versao}
          destinos={preparo.destinos} transferirAction={confirmar} />}
      </div>
    </section>
  );
}
