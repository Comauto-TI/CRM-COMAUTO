"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icone from "../Icone";
import { diasNaEtapa, semaforoEtapa, posicaoEntre, tempoAtras, ordenarQuadro, iniciais, type Ordenacao } from "@/lib/quadro";

/**
 * Quadro (Kanban) comum a todos os setores — padrão visual do Simão (quadro de oportunidades).
 * Cada setor só adapta os dados (colunas + cartões) e passa a sua ação de mover.
 * A regra de quem pode mover/transferir é decidida no SERVIDOR; aqui só reflete o que veio.
 */

export type ColunaQuadro = { id: string; nome: string; tipo: "aberta" | "ganho" | "perdido"; slaDias: number | null };

export type CartaoQuadro = {
  id: string;
  colunaId: string;
  posicao: number;
  criadoEm: string;
  atualizadoEm: string;
  entrouEm: string;
  ultimoContatoEm: string | null;
  valor: number | null;
  titulo: string; // normalmente o nome do cliente
  temperatura?: string | null; // frio | morno | quente (borda do avatar); vazio = sem borda
  temperaturaRotulo?: string;
  origem: string; // primeira informação da linha de baixo (ex.: "WhatsApp")
  extras?: string[]; // complementos em itálico (ex.: modelo, "troca")
  responsavel: string | null; // nome de quem cuida; null = mostra a etiqueta de "sem responsável"
  href: string; // abre o detalhe do cartão
  movel: boolean;
  hrefTransferir?: string; // presente = mostra o botão de setas
  pontuacao?: number | null; // 0–100: usado na ordenação "Maior chance"
  selo?: { texto: string; tom: "alta" | "media" | "baixa"; titulo?: string }; // ex.: pontuação do lead
};

export type ResultadoMover = { ok: true } | { ok: false; motivo: string };

export type TextosQuadro = {
  semResponsavel: string; // "sem vendedor"
  naoMovel: string; // dica quando a pessoa não pode mover
  transferir?: string; // aria-label do botão de setas (recebe o título)
};

export type PerdaQuadro = { titulo: string; explicacao: string; motivos: readonly string[]; botao: string };
/** Ao soltar em "ganho": pede o valor fechado (texto livre em R$, o SERVIDOR interpreta e valida). Vazio = mantém o valor atual. */
export type GanhoQuadro = { titulo: string; explicacao: string; botao: string };

const brl = (v: number | null) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function QuadroKanban({
  colunas, cartoes, mover, textos, perda, ganho, selecionado, ordem = "posicao",
}: {
  colunas: ColunaQuadro[];
  cartoes: CartaoQuadro[];
  mover: (id: string, colunaId: string, posicao: number, motivoPerda?: string, valorGanho?: string) => Promise<ResultadoMover>;
  textos: TextosQuadro;
  perda?: PerdaQuadro; // sem isso, soltar numa coluna "perdido" não pede motivo
  ganho?: GanhoQuadro; // sem isso, soltar numa coluna "ganho" não pede valor
  selecionado?: string;
  ordem?: Ordenacao;
}) {
  const router = useRouter();
  const [lista, setLista] = useState(cartoes);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendentePerda, setPendentePerda] = useState<{ id: string; colunaId: string; posicao: number } | null>(null);
  const [motivo, setMotivo] = useState<string>(perda?.motivos[0] ?? "");
  const [pendenteGanho, setPendenteGanho] = useState<{ id: string; colunaId: string; posicao: number } | null>(null);
  const [valor, setValor] = useState("");
  const [pendente, iniciar] = useTransition();
  const dialogo = useRef<HTMLDialogElement>(null);
  const dialogoGanho = useRef<HTMLDialogElement>(null);
  const [agora] = useState(() => new Date());

  // mantém a lista sincronizada quando o servidor manda dados novos
  const [base, setBase] = useState(cartoes);
  if (base !== cartoes) { setBase(cartoes); setLista(cartoes); }

  function enviar(id: string, colunaId: string, posicao: number, motivoPerda?: string, valorGanho?: string) {
    const anterior = lista;
    setLista((l) => l.map((c) => (c.id === id ? { ...c, colunaId, posicao, entrouEm: c.colunaId === colunaId ? c.entrouEm : new Date().toISOString() } : c)));
    iniciar(async () => {
      const r = await mover(id, colunaId, posicao, motivoPerda, valorGanho);
      if (!r.ok) { setLista(anterior); setErro(r.motivo); }
      else { setErro(null); router.refresh(); }
    });
  }

  function soltar(coluna: ColunaQuadro, e: React.DragEvent) {
    e.preventDefault();
    setAlvo(null);
    const id = e.dataTransfer.getData("text/plain") || arrastando;
    setArrastando(null);
    const atual = lista.find((c) => c.id === id);
    if (!id || !atual?.movel || atual.colunaId === coluna.id) return;
    const naColuna = lista.filter((c) => c.colunaId === coluna.id && c.id !== id).sort((a, b) => a.posicao - b.posicao);
    const posicao = posicaoEntre(naColuna.at(-1)?.posicao ?? null, null); // entra no fim da coluna
    if (coluna.tipo === "perdido" && perda) {
      setPendentePerda({ id, colunaId: coluna.id, posicao });
      dialogo.current?.showModal();
      return;
    }
    if (coluna.tipo === "ganho" && ganho) {
      setPendenteGanho({ id, colunaId: coluna.id, posicao });
      setValor(atual.valor ? atual.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
      dialogoGanho.current?.showModal();
      return;
    }
    enviar(id, coluna.id, posicao);
  }

  return (
    <>
      {erro && <div className="alerta erro" role="alert">{erro} <button className="btn pequeno" onClick={() => setErro(null)}>ok</button></div>}
      <div className={`kanban${pendente ? " salvando" : ""}`}>
        {colunas.map((coluna) => {
          const daColuna = ordenarQuadro(lista.filter((c) => c.colunaId === coluna.id), ordem, (c) => c);
          const total = daColuna.reduce((s, c) => s + (c.valor ?? 0), 0);
          return (
            <section
              key={coluna.id}
              className={`kanban-coluna tipo-${coluna.tipo}${alvo === coluna.id ? " alvo" : ""}`}
              onDragOver={(e) => { if (arrastando) { e.preventDefault(); setAlvo(coluna.id); } }}
              onDragLeave={() => setAlvo((a) => (a === coluna.id ? null : a))}
              onDrop={(e) => soltar(coluna, e)}
              aria-label={`Etapa ${coluna.nome}`}
            >
              <header className="kanban-cabeca">
                <strong>{coluna.nome} ({daColuna.length})</strong>
                <span>{brl(total)}</span>
              </header>
              <div className="kanban-cartoes">
                {daColuna.map((c) => {
                  const dias = diasNaEtapa(c.entrouEm, agora);
                  const sem = coluna.tipo === "aberta" ? semaforoEtapa(dias, coluna.slaDias) : "neutro";
                  return (
                    <div key={c.id} className="kanban-cartao-wrap">
                      <Link
                        href={c.href}
                        scroll={false}
                        className={`kanban-cartao borda-${sem}${selecionado === c.id ? " selecionado" : ""}${arrastando === c.id ? " arrastando" : ""}`}
                        draggable={c.movel}
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setArrastando(c.id); }}
                        onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                        title={c.movel ? "Arraste para mudar de etapa" : textos.naoMovel}
                      >
                        <div className="cartao-topo">
                          <span className={`cartao-avatar${c.temperatura ? ` temp-borda-${c.temperatura}` : ""}`} title={c.temperaturaRotulo ? `Temperatura: ${c.temperaturaRotulo}` : undefined}>
                            {iniciais(c.titulo)}
                          </span>
                          <div className="cartao-id">
                            <strong>{c.titulo}{c.selo && <span className={`selo-pontuacao selo-${c.selo.tom}`} title={c.selo.titulo}>{c.selo.texto}</span>}</strong>
                            <small>Contato: {tempoAtras(c.ultimoContatoEm, agora)}</small>
                            <small>Atualização: {tempoAtras(c.atualizadoEm, agora)}</small>
                          </div>
                        </div>
                        <div className="cartao-base">
                          <span className="cartao-origem">
                            {c.origem}
                            {(c.extras ?? []).map((x) => <em key={x}> · {x}</em>)}
                          </span>
                          <strong className="cartao-valor">{brl(c.valor)}</strong>
                        </div>
                        <div className="cartao-rodape">
                          {c.responsavel ? <span>{c.responsavel}</span> : <span className="tag aviso">{textos.semResponsavel}</span>}
                          {coluna.tipo === "aberta" && <span className={`dias dias-${sem}`} title="Dias nesta etapa">{dias}d na etapa</span>}
                        </div>
                      </Link>
                      {c.hrefTransferir && (
                        <Link href={c.hrefTransferir} scroll={false} className="botao-transferir" title="Transferir" aria-label={`${textos.transferir ?? "Transferir"} ${c.titulo}`}>
                          <Icone nome="transferir" tamanho={15} />
                        </Link>
                      )}
                    </div>
                  );
                })}
                {!daColuna.length && <div className="kanban-vazio mudo">Nenhum cartão</div>}
              </div>
            </section>
          );
        })}
      </div>

      {perda && (
        <dialog ref={dialogo} className="dialogo" onClose={() => setPendentePerda(null)}>
          <form
            method="dialog"
            onSubmit={(e) => {
              if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "ok" || !pendentePerda) return;
              enviar(pendentePerda.id, pendentePerda.colunaId, pendentePerda.posicao, motivo);
            }}
          >
            <h2>{perda.titulo}</h2>
            <p className="mudo">{perda.explicacao}</p>
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label={perda.titulo}>
              {perda.motivos.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="acoes" style={{ marginTop: 14 }}>
              <button className="btn" value="cancelar">Cancelar</button>
              <button className="btn primario" value="ok">{perda.botao}</button>
            </div>
          </form>
        </dialog>
      )}

      {ganho && (
        <dialog ref={dialogoGanho} className="dialogo" onClose={() => setPendenteGanho(null)}>
          <form
            method="dialog"
            onSubmit={(e) => {
              if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "ok" || !pendenteGanho) return;
              enviar(pendenteGanho.id, pendenteGanho.colunaId, pendenteGanho.posicao, undefined, valor.trim() || undefined);
            }}
          >
            <h2>{ganho.titulo}</h2>
            <p className="mudo">{ganho.explicacao}</p>
            <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" aria-label="Valor da venda" />
            <div className="acoes" style={{ marginTop: 14 }}>
              <button className="btn" value="cancelar">Cancelar</button>
              <button className="btn primario" value="ok">{ganho.botao}</button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
