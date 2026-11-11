import "server-only";
import type { Usuario } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import type { DadosCotacao, DadosEdicaoItem, DadosItem } from "./dados-cotacao";

type Cotacao = {
  id: string;
  unidade: string;
  origem: string;
  descricao: string;
  status: string;
  criado_em: string;
  clientes: { nome: string | null } | null;
  veiculos: { placa: string | null } | null;
  responsavel: { nome: string | null } | null;
};

type ItemCotacao = {
  id: string;
  versao: number;
  descricao: string;
  quantidade: number;
  preco_unitario_centavos: number;
  custo_unitario_centavos: number | null;
};

type CotacaoDetalhada = Cotacao & { responsavel_id: string | null; itens: ItemCotacao[] };

const RESUMO_COTACAO = "id, unidade, origem, descricao, status, criado_em, clientes(nome), veiculos(placa), responsavel:usuarios!pecas_cotacoes_responsavel_id_fkey(nome)";

function tabelaPendente(codigo: string) {
  return codigo === "PGRST205" || codigo === "42P01";
}

export async function listarCotacoes(unidades: string[]) {
  const { data, error } = await db()
    .from("pecas_cotacoes")
    .select(RESUMO_COTACAO)
    .in("unidade", unidades)
    .order("criado_em", { ascending: false })
    .limit(100);

  if (error) return { ok: false as const, pendente: tabelaPendente(error.code) };
  return { ok: true as const, cotacoes: (data ?? []) as unknown as Cotacao[] };
}

export async function obterCotacao(unidades: string[], id: string) {
  const { data, error } = await db()
    .from("pecas_cotacoes")
    .select(`${RESUMO_COTACAO}, responsavel_id, itens:pecas_cotacao_itens(id, versao, descricao, quantidade, preco_unitario_centavos, custo_unitario_centavos)`)
    .in("unidade", unidades)
    .eq("id", id)
    .order("criado_em", { referencedTable: "itens" })
    .order("id", { referencedTable: "itens" })
    .maybeSingle();

  if (error) return { ok: false as const, pendente: tabelaPendente(error.code) };
  return { ok: true as const, cotacao: data as unknown as CotacaoDetalhada | null };
}

type ResultadoItem = "adicionado" | "indisponivel" | "limite" | "pendente" | "erro_item";

function parametrosItem(u: Usuario, cotacaoId: string, dados: DadosItem) {
  return {
    p_cotacao_id: cotacaoId,
    p_item_id: dados.id,
    p_unidades: u.unidades,
    p_ator: u.id,
    p_descricao: dados.descricao,
    p_quantidade: dados.quantidade,
    p_preco_unitario_centavos: dados.precoUnitarioCentavos,
    p_custo_unitario_centavos: dados.custoUnitarioCentavos,
  };
}

export async function registrarItem(u: Usuario, cotacaoId: string, dados: DadosItem): Promise<ResultadoItem> {
  const { data, error } = await db().rpc("pecas_adicionar_item", parametrosItem(u, cotacaoId, dados));
  if (error) return tabelaPendente(error.code) || error.code === "PGRST202" ? "pendente" : "erro_item";
  if (data === "adicionado" || data === "indisponivel" || data === "limite") return data;
  return "erro_item";
}

type ResultadoCotacao = "criada" | "cliente" | "veiculo" | "unidade" | "pendente" | "erro";

export async function iniciarCotacao(u: Usuario, id: string): Promise<"iniciada" | "indisponivel" | "pendente" | "erro_inicio"> {
  const { data, error } = await db().rpc("pecas_assumir_cotacao", { p_id: id, p_unidades: u.unidades, p_ator: u.id });
  if (error) return tabelaPendente(error.code) || error.code === "PGRST202" ? "pendente" : "erro_inicio";
  return data === true ? "iniciada" : "indisponivel";
}

type ResultadoEdicaoItem = "atualizado" | "indisponivel" | "desatualizado" | "pendente" | "erro_edicao";

export async function atualizarItem(u: Usuario, cotacaoId: string, dados: DadosEdicaoItem): Promise<ResultadoEdicaoItem> {
  const { data, error } = await db().rpc("pecas_atualizar_item", {
    ...parametrosItem(u, cotacaoId, dados),
    p_versao: dados.versao,
  });
  if (error) return tabelaPendente(error.code) || error.code === "PGRST202" ? "pendente" : "erro_edicao";
  if (data === "atualizado" || data === "indisponivel" || data === "desatualizado") return data;
  return "erro_edicao";
}

export async function registrarCotacao(u: Usuario, dados: DadosCotacao): Promise<ResultadoCotacao> {
  if (!u.unidades.includes(u.unidade)) return "unidade";

  const client = db();
  const [{ data: unidade, error: erroUnidade }, { data: cliente, error: erroCliente }] = await Promise.all([
    client.from("unidades").select("chave").eq("chave", u.unidade).eq("ativa", true).maybeSingle(),
    client.from("clientes").select("id").eq("telefone", dados.telefone).eq("anonimizado", false).maybeSingle(),
  ]);
  if (erroUnidade) return tabelaPendente(erroUnidade.code) ? "pendente" : "erro";
  if (erroCliente) return "erro";
  if (!unidade) return "unidade";
  if (!cliente) return "cliente";

  let veiculoId: string | null = null;
  if (dados.placa) {
    const { data: veiculo, error } = await client.from("veiculos")
      .select("id").eq("cliente_id", cliente.id).eq("placa", dados.placa).maybeSingle();
    if (error) return "erro";
    if (!veiculo) return "veiculo";
    veiculoId = veiculo.id;
  }

  const pedido = {
    id: dados.id,
    unidade: u.unidade,
    cliente_id: cliente.id,
    veiculo_id: veiculoId,
    criado_por: u.id,
    origem: "balcao",
    descricao: dados.descricao,
  };
  const { error } = await client.from("pecas_cotacoes").insert(pedido);
  if (!error) return "criada";
  if (tabelaPendente(error.code)) return "pendente";
  if (error.code !== "23505") return "erro";

  const { data: anterior } = await client.from("pecas_cotacoes").select("cliente_id, veiculo_id, origem, descricao")
    .eq("id", pedido.id).eq("unidade", pedido.unidade).eq("criado_por", pedido.criado_por).maybeSingle();
  return anterior && anterior.cliente_id === pedido.cliente_id && anterior.veiculo_id === pedido.veiculo_id &&
    anterior.origem === pedido.origem && anterior.descricao === pedido.descricao ? "criada" : "erro";
}
