"use client";

import { useMemo } from "react";
import { moverCartao } from "./actions";
import QuadroKanban, { type CartaoQuadro, type ColunaQuadro } from "../_components/quadro/QuadroKanban";
import { TEMPERATURAS, MOTIVOS_PERDA, type Temperatura, type Ordenacao } from "@/modulos/vendas/regras";

/** Quadro de Vendas = quadro comum (_components/quadro) com os dados das oportunidades. */

type Etapa = { id: string; nome: string; ordem: number; tipo: "aberta" | "ganho" | "perdido"; sla_dias: number | null };
type Cartao = {
  id: string; etapa_id: string; vendedor_id: string | null; veiculo_interesse: string | null; valor_estimado: number | null;
  temperatura: string; qualificacao: string; tem_troca: boolean; origem: string; entrou_na_etapa_em: string; posicao: number;
  criado_em: string; atualizado_em: string; ultimo_contato_em: string | null;
  cliente: { nome: string | null; telefone: string };
};

const ORIGEM: Record<string, string> = { whatsapp: "WhatsApp", qr: "QR Code", evento: "Evento", campanha: "Campanha", painel: "Cadastro manual", importacao: "Importação" };

const PERDA = {
  titulo: "Motivo da perda",
  explicacao: "Obrigatório: é com isso que vamos medir por que estamos perdendo vendas.",
  motivos: MOTIVOS_PERDA,
  botao: "Marcar como perdida",
};

const GANHO = {
  titulo: "Venda fechada!",
  explicacao: "Qual foi o valor da venda? Assim as métricas e a previsão do mês ficam certas. Pode deixar em branco e preencher depois.",
  botao: "Marcar como ganha",
};

export default function Quadro({
  etapas, cartoes, podeMover, podeTransferir = [], vendedores, linkBase, selecionado, ordem = "posicao",
}: {
  etapas: Etapa[]; cartoes: Cartao[]; podeMover: string[]; podeTransferir?: string[]; vendedores: Record<string, string>; linkBase: string; selecionado?: string; ordem?: Ordenacao;
}) {
  // memorizado: o quadro comum trata lista nova como "dado novo do servidor" (recriar a cada render = loop)
  const colunas = useMemo<ColunaQuadro[]>(() => etapas.map((e) => ({ id: e.id, nome: e.nome, tipo: e.tipo, slaDias: e.sla_dias })), [etapas]);
  const lista = useMemo<CartaoQuadro[]>(() => {
    const pode = new Set(podeMover);
    const transferiveis = new Set(podeTransferir);
    return cartoes.map((c) => ({
    id: c.id,
    colunaId: c.etapa_id,
    posicao: c.posicao,
    criadoEm: c.criado_em,
    atualizadoEm: c.atualizado_em,
    entrouEm: c.entrou_na_etapa_em,
    ultimoContatoEm: c.ultimo_contato_em,
    valor: c.valor_estimado,
    titulo: c.cliente.nome ?? "Cliente sem nome",
    temperatura: c.temperatura,
    temperaturaRotulo: TEMPERATURAS[c.temperatura as Temperatura] ?? c.temperatura,
    origem: ORIGEM[c.origem] ?? c.origem,
    extras: [...(c.veiculo_interesse ? [c.veiculo_interesse] : []), ...(c.tem_troca ? ["troca"] : [])],
    responsavel: c.vendedor_id ? vendedores[c.vendedor_id] ?? "Vendedor" : null,
    href: `${linkBase}&op=${c.id}`,
    movel: pode.has(c.id),
    hrefTransferir: transferiveis.has(c.id) ? `${linkBase}&op=${c.id}&transferir=1` : undefined,
    }));
  }, [cartoes, podeMover, podeTransferir, vendedores, linkBase]);

  return (
    <QuadroKanban
      colunas={colunas}
      cartoes={lista}
      mover={moverCartao}
      perda={PERDA}
      ganho={GANHO}
      selecionado={selecionado}
      ordem={ordem}
      textos={{ semResponsavel: "sem vendedor", naoMovel: "Somente o vendedor responsável ou o gerente move este cartão", transferir: "Transferir para outro vendedor:" }}
    />
  );
}
