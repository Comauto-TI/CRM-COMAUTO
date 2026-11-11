"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CotacaoQuadroPecas } from "@/modulos/pecas/quadro";
import QuadroKanban, { type CartaoQuadro, type ColunaQuadro, type ResultadoMover } from "../_components/quadro/QuadroKanban";
import ConversaPecas from "./ConversaPecas";
import { moverCotacaoQuadro } from "./quadro-actions";

const ABERTAS: ColunaQuadro[] = [
  { id: "novo", nome: "Novo", tipo: "aberta", slaDias: null },
  { id: "em_cotacao", nome: "Em cotação", tipo: "aberta", slaDias: null },
  { id: "aguardando_cliente", nome: "Aguardando cliente", tipo: "aberta", slaDias: null },
  { id: "aprovado", nome: "Aprovado", tipo: "ganho", slaDias: null },
  { id: "em_separacao", nome: "Em separação", tipo: "aberta", slaDias: null },
];
const ENCERRADAS: ColunaQuadro[] = [
  { id: "entregue", nome: "Entregue", tipo: "ganho", slaDias: null },
  { id: "perdido", nome: "Perdido", tipo: "perdido", slaDias: null },
  { id: "cancelado", nome: "Cancelado", tipo: "perdido", slaDias: null },
];
const ORIGENS: Record<string, string> = { balcao: "Balcão", oficina: "Oficina", whatsapp: "WhatsApp" };
const TEXTOS = { semResponsavel: "Sem responsável", naoMovel: "Consulte os detalhes da cotação para acompanhar esta etapa." };
const PERDA = {
  titulo: "Encerrar cotação", explicacao: "Registre o motivo para encerrar a cotação na etapa escolhida.",
  motivos: ["Cliente desistiu", "Condição comercial não atendida", "Solicitação cancelada pelo cliente", "Registro duplicado"],
  botao: "Confirmar encerramento",
};

export default function QuadroPecas({ cotacoes, selecionado }: { cotacoes: CotacaoQuadroPecas[]; selecionado?: string }) {
  const router = useRouter();
  const arrastando = useRef<string | null>(null);
  const painel = useRef<HTMLElement | null>(null);
  const porId = useMemo(() => new Map(cotacoes.map((c) => [c.id, c])), [cotacoes]);
  const cartoes = useMemo<CartaoQuadro[]>(() => cotacoes.map((c) => ({
    id: c.id, colunaId: c.status, posicao: c.posicao,
    criadoEm: c.criadoEm, atualizadoEm: c.atualizadoEm, entrouEm: c.entrouEm, ultimoContatoEm: c.ultimoContatoEm,
    valor: c.valorCentavos === null ? null : c.valorCentavos / 100,
    titulo: c.clienteNome || "Cliente cadastrado", origem: ORIGENS[c.origem] ?? c.origem,
    // O comum ainda formata null como zero; o rótulo distingue a cotação sem valor até a correção compartilhada.
    extras: [c.descricao, ...(c.valorCentavos === null ? ["Valor a cotar"] : []), c.unidade], responsavel: c.responsavelNome,
    href: `/painel/pecas?cotacao=${encodeURIComponent(c.id)}`, movel: c.podeMover,
  })), [cotacoes]);
  const selecionada = selecionado ? porId.get(selecionado) : undefined;
  const colunaEncerrada = selecionada ? ENCERRADAS.find((e) => e.id === selecionada.status) : undefined;
  const totalEncerradas = cartoes.filter((c) => ENCERRADAS.some((e) => e.id === c.colunaId)).length;

  useEffect(() => {
    if (selecionado && window.matchMedia("(max-width: 1100px)").matches) painel.current?.scrollIntoView({ block: "start" });
  }, [selecionado]);

  async function mover(id: string, destino: string, posicao: number, motivo?: string): Promise<ResultadoMover> {
    const cotacao = porId.get(id);
    if (!cotacao?.podeMover) return { ok: false, motivo: "Esta cotação não está disponível para movimentação. Atualize o quadro." };
    if (destino === "entregue") return { ok: false, motivo: "A etapa Entregue é apenas de consulta neste quadro." };
    try {
      return await moverCotacaoQuadro(id, destino, posicao, cotacao.status, cotacao.itensVersoes, motivo);
    } catch {
      return { ok: false, motivo: "Não foi possível confirmar a movimentação. Atualize o quadro antes de tentar novamente." };
    }
  }

  return (
    <div className={selecionada ? "vendas com-painel" : "vendas"}>
      <div className="vendas-principal"
        onDragStart={(e) => {
          const id = e.dataTransfer.getData("text/plain");
          arrastando.current = porId.get(id)?.podeMover ? id : null;
        }}
        onDragEnd={() => { arrastando.current = null; }}
        onDrop={() => { arrastando.current = null; }}
        onDragOver={(e) => { if (arrastando.current) e.preventDefault(); }}>
        <QuadroKanban colunas={ABERTAS} cartoes={cartoes} mover={mover} textos={TEXTOS} selecionado={selecionado} />
        <details className="secao" open={selecionada ? !!colunaEncerrada : undefined}>
          <summary>Cotações encerradas ({totalEncerradas})</summary>
          <p className="mudo">Perdas e cancelamentos pedem um motivo. Entregues ficam disponíveis para consulta.</p>
          <QuadroKanban colunas={ENCERRADAS} cartoes={cartoes} mover={mover} textos={TEXTOS} perda={PERDA} selecionado={selecionado} />
        </details>
        {selecionado && !selecionada && <p className="alerta aviso" role="status">Cotação indisponível neste quadro. Atualize a seleção.</p>}
      </div>
      {selecionada && (
        <aside ref={painel} className="painel-lateral card" aria-label={colunaEncerrada ? "Cotação encerrada de Peças" : "Atendimento da cotação de Peças"} style={{ padding: 0 }}>
          <div className="acoes" style={{ padding: 12 }}>
            <Link href={`/painel/pecas/${selecionada.id}`} className="btn pequeno" prefetch={false}>Ver detalhes da cotação</Link>
            <Link href="/painel/pecas" className="btn pequeno" aria-label="Fechar atendimento">Fechar</Link>
          </div>
          {colunaEncerrada ? (
            <div style={{ padding: 16 }}>
              <h2>Cotação encerrada</h2>
              <p>Etapa · {colunaEncerrada.nome}</p>
              <p className="mudo">Consulte os detalhes da cotação para acompanhar os registros do encerramento.</p>
            </div>
          ) : (
            <div style={{ display: "flex", height: "min(72vh, 760px)", minHeight: 400 }}>
              <ConversaPecas cotacaoId={selecionada.id} onMudou={() => router.refresh()} onVoltar={() => router.push("/painel/pecas", { scroll: true })} />
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
