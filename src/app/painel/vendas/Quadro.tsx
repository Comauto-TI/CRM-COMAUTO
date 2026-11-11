"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moverCartao } from "./actions";
import Icone from "../_components/Icone";
import {
  diasNaEtapa, semaforoEtapa, posicaoEntre, tempoAtras, ordenarCartoes,
  TEMPERATURAS, MOTIVOS_PERDA, type Temperatura, type Ordenacao,
} from "@/modulos/vendas/regras";

type Etapa = { id: string; nome: string; ordem: number; tipo: "aberta" | "ganho" | "perdido"; sla_dias: number | null };
type Cartao = {
  id: string; etapa_id: string; vendedor_id: string | null; veiculo_interesse: string | null; valor_estimado: number | null;
  temperatura: string; qualificacao: string; tem_troca: boolean; origem: string; entrou_na_etapa_em: string; posicao: number;
  criado_em: string; atualizado_em: string; ultimo_contato_em: string | null;
  cliente: { nome: string | null; telefone: string };
};

const ORIGEM: Record<string, string> = { whatsapp: "WhatsApp", qr: "QR Code", evento: "Evento", campanha: "Campanha", painel: "Cadastro manual", importacao: "Importação" };
const brl = (v: number | null, centavos = false) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: centavos ? 2 : 0, maximumFractionDigits: centavos ? 2 : 0 });
const iniciais = (nome: string | null) =>
  (nome ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";

export default function Quadro({
  etapas, cartoes, podeMover, podeTransferir = [], vendedores, linkBase, selecionado, ordem = "posicao",
}: {
  etapas: Etapa[]; cartoes: Cartao[]; podeMover: string[]; podeTransferir?: string[]; vendedores: Record<string, string>; linkBase: string; selecionado?: string; ordem?: Ordenacao;
}) {
  const router = useRouter();
  const [lista, setLista] = useState(cartoes);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [perda, setPerda] = useState<{ id: string; etapaId: string; posicao: number } | null>(null);
  const [motivo, setMotivo] = useState<string>(MOTIVOS_PERDA[0]);
  const [pendente, iniciar] = useTransition();
  const dialogo = useRef<HTMLDialogElement>(null);
  const pode = new Set(podeMover);
  const transferiveis = new Set(podeTransferir);
  const [agora] = useState(() => new Date());

  // mantém a lista sincronizada quando o servidor manda dados novos
  const [base, setBase] = useState(cartoes);
  if (base !== cartoes) { setBase(cartoes); setLista(cartoes); }

  function enviar(id: string, etapaId: string, posicao: number, motivoPerda?: string) {
    const anterior = lista;
    setLista((l) => l.map((c) => (c.id === id ? { ...c, etapa_id: etapaId, posicao, entrou_na_etapa_em: c.etapa_id === etapaId ? c.entrou_na_etapa_em : new Date().toISOString() } : c)));
    iniciar(async () => {
      const r = await moverCartao(id, etapaId, posicao, motivoPerda);
      if (!r.ok) { setLista(anterior); setErro(r.motivo); }
      else { setErro(null); router.refresh(); }
    });
  }

  function soltar(etapa: Etapa, e: React.DragEvent) {
    e.preventDefault();
    setAlvo(null);
    const id = e.dataTransfer.getData("text/plain") || arrastando;
    setArrastando(null);
    if (!id || !pode.has(id)) return;
    const atual = lista.find((c) => c.id === id);
    if (atual?.etapa_id === etapa.id) return;
    const naColuna = lista.filter((c) => c.etapa_id === etapa.id && c.id !== id).sort((a, b) => a.posicao - b.posicao);
    const posicao = posicaoEntre(naColuna.at(-1)?.posicao ?? null, null); // entra no fim da coluna
    if (etapa.tipo === "perdido") {
      setPerda({ id, etapaId: etapa.id, posicao });
      dialogo.current?.showModal();
      return;
    }
    enviar(id, etapa.id, posicao);
  }

  return (
    <>
      {erro && <div className="alerta erro" role="alert">{erro} <button className="btn pequeno" onClick={() => setErro(null)}>ok</button></div>}
      <div className={`kanban${pendente ? " salvando" : ""}`}>
        {etapas.map((etapa) => {
          const doEstagio = ordenarCartoes(lista.filter((c) => c.etapa_id === etapa.id), ordem);
          const total = doEstagio.reduce((s, c) => s + (c.valor_estimado ?? 0), 0);
          return (
            <section
              key={etapa.id}
              className={`kanban-coluna tipo-${etapa.tipo}${alvo === etapa.id ? " alvo" : ""}`}
              onDragOver={(e) => { if (arrastando) { e.preventDefault(); setAlvo(etapa.id); } }}
              onDragLeave={() => setAlvo((a) => (a === etapa.id ? null : a))}
              onDrop={(e) => soltar(etapa, e)}
              aria-label={`Etapa ${etapa.nome}`}
            >
              <header className="kanban-cabeca">
                <strong>{etapa.nome} ({doEstagio.length})</strong>
                <span>{brl(total, true)}</span>
              </header>
              <div className="kanban-cartoes">
                {doEstagio.map((c) => {
                  const dias = diasNaEtapa(c.entrou_na_etapa_em, agora);
                  const sem = etapa.tipo === "aberta" ? semaforoEtapa(dias, etapa.sla_dias) : "neutro";
                  const movel = pode.has(c.id);
                  const vendedor = c.vendedor_id ? vendedores[c.vendedor_id] ?? "Vendedor" : null;
                  return (
                    <div key={c.id} className="kanban-cartao-wrap">
                    <Link
                      href={`${linkBase}&op=${c.id}`}
                      scroll={false}
                      className={`kanban-cartao borda-${sem}${selecionado === c.id ? " selecionado" : ""}${arrastando === c.id ? " arrastando" : ""}`}
                      draggable={movel}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setArrastando(c.id); }}
                      onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                      title={movel ? "Arraste para mudar de etapa" : "Somente o vendedor responsável ou o gerente move este cartão"}
                    >
                      <div className="cartao-topo">
                        <span className={`cartao-avatar temp-borda-${c.temperatura}`} title={`Temperatura: ${TEMPERATURAS[c.temperatura as Temperatura] ?? c.temperatura}`}>
                          {iniciais(c.cliente.nome)}
                        </span>
                        <div className="cartao-id">
                          <strong>{c.cliente.nome ?? "Cliente sem nome"}</strong>
                          <small>Contato: {tempoAtras(c.ultimo_contato_em, agora)}</small>
                          <small>Atualização: {tempoAtras(c.atualizado_em, agora)}</small>
                        </div>
                      </div>
                      <div className="cartao-base">
                        <span className="cartao-origem">
                          {ORIGEM[c.origem] ?? c.origem}
                          {c.veiculo_interesse ? <em> · {c.veiculo_interesse}</em> : null}
                          {c.tem_troca ? <em> · troca</em> : null}
                        </span>
                        <strong className="cartao-valor">{brl(c.valor_estimado, true)}</strong>
                      </div>
                      <div className="cartao-rodape">
                        {vendedor ? <span>{vendedor}</span> : <span className="tag aviso">sem vendedor</span>}
                        {etapa.tipo === "aberta" && <span className={`dias dias-${sem}`} title="Dias nesta etapa">{dias}d na etapa</span>}
                      </div>
                    </Link>
                    {transferiveis.has(c.id) && (
                      <Link href={`${linkBase}&op=${c.id}&transferir=1`} scroll={false} className="botao-transferir" title="Transferir" aria-label={`Transferir ${c.cliente.nome ?? "lead"} para outro vendedor`}>
                        <Icone nome="transferir" tamanho={15} />
                      </Link>
                    )}
                    </div>
                  );
                })}
                {!doEstagio.length && <div className="kanban-vazio mudo">Nenhum cartão</div>}
              </div>
            </section>
          );
        })}
      </div>

      <dialog ref={dialogo} className="dialogo" onClose={() => setPerda(null)}>
        <form
          method="dialog"
          onSubmit={(e) => {
            if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "ok" || !perda) return;
            enviar(perda.id, perda.etapaId, perda.posicao, motivo);
          }}
        >
          <h2>Motivo da perda</h2>
          <p className="mudo">Obrigatório: é com isso que vamos medir por que estamos perdendo vendas.</p>
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo da perda">
            {MOTIVOS_PERDA.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="acoes" style={{ marginTop: 14 }}>
            <button className="btn" value="cancelar">Cancelar</button>
            <button className="btn primario" value="ok">Marcar como perdida</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
