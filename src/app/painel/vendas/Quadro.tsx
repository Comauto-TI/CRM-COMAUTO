"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { moverCartao } from "./actions";
import { diasNaEtapa, semaforoEtapa, posicaoEntre, TEMPERATURAS, MOTIVOS_PERDA, type Temperatura } from "@/modulos/vendas/regras";

type Etapa = { id: string; nome: string; ordem: number; tipo: "aberta" | "ganho" | "perdido"; sla_dias: number | null };
type Cartao = {
  id: string; etapa_id: string; vendedor_id: string | null; veiculo_interesse: string | null; valor_estimado: number | null;
  temperatura: string; qualificacao: string; tem_troca: boolean; origem: string; entrou_na_etapa_em: string; posicao: number;
  cliente: { nome: string | null; telefone: string };
};

const brl = (v: number | null) => (v == null ? null : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));

export default function Quadro({
  etapas, cartoes, podeMover, vendedores, linkBase, selecionado,
}: {
  etapas: Etapa[]; cartoes: Cartao[]; podeMover: string[]; vendedores: Record<string, string>; linkBase: string; selecionado?: string;
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
    const naColuna = lista.filter((c) => c.etapa_id === etapa.id && c.id !== id).sort((a, b) => a.posicao - b.posicao);
    const posicao = posicaoEntre(naColuna.at(-1)?.posicao ?? null, null); // entra no fim da coluna
    const atual = lista.find((c) => c.id === id);
    if (atual?.etapa_id === etapa.id) return;
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
          const doEstagio = lista.filter((c) => c.etapa_id === etapa.id).sort((a, b) => a.posicao - b.posicao);
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
              <header>
                <strong>{etapa.nome}</strong>
                <span className="kanban-contagem">{doEstagio.length}</span>
                {total > 0 && <span className="mudo kanban-total">{brl(total)}</span>}
              </header>
              <div className="kanban-cartoes">
                {doEstagio.map((c) => {
                  const dias = diasNaEtapa(c.entrou_na_etapa_em, agora);
                  const sem = etapa.tipo === "aberta" ? semaforoEtapa(dias, etapa.sla_dias) : "neutro";
                  const movel = pode.has(c.id);
                  return (
                    <Link
                      key={c.id}
                      href={`${linkBase}&op=${c.id}`}
                      scroll={false}
                      className={`kanban-cartao${selecionado === c.id ? " selecionado" : ""}${arrastando === c.id ? " arrastando" : ""}`}
                      draggable={movel}
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setArrastando(c.id); }}
                      onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                      title={movel ? "Arraste para mudar de etapa" : "Somente o vendedor responsável ou o gerente move este cartão"}
                    >
                      <div className="kanban-linha">
                        <strong>{c.cliente.nome ?? "Cliente sem nome"}</strong>
                        <span className={`temp temp-${c.temperatura}`} title={`Temperatura: ${TEMPERATURAS[c.temperatura as Temperatura] ?? c.temperatura}`} />
                      </div>
                      <div className="mudo">{c.veiculo_interesse ?? "Interesse a definir"}{c.tem_troca ? " · com troca" : ""}</div>
                      <div className="kanban-linha kanban-rodape">
                        <span className="mudo">{c.vendedor_id ? vendedores[c.vendedor_id] ?? "vendedor" : <span className="tag aviso">sem vendedor</span>}</span>
                        <span className="kanban-meta">
                          {c.valor_estimado ? <span>{brl(c.valor_estimado)}</span> : null}
                          {etapa.tipo === "aberta" && <span className={`dias dias-${sem}`} title="Dias nesta etapa">{dias}d</span>}
                        </span>
                      </div>
                    </Link>
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
