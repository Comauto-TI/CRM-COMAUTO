import "server-only";
import type { Usuario } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import type { DadosCotacao } from "./dados-cotacao";

type Cotacao = {
  id: string;
  unidade: string;
  origem: string;
  descricao: string;
  status: string;
  criado_em: string;
  clientes: { nome: string | null } | null;
  veiculos: { placa: string | null } | null;
};

function tabelaPendente(codigo: string) {
  return codigo === "PGRST205" || codigo === "42P01";
}

export async function listarCotacoes(unidades: string[]) {
  const { data, error } = await db()
    .from("pecas_cotacoes")
    .select("id, unidade, origem, descricao, status, criado_em, clientes(nome), veiculos(placa)")
    .in("unidade", unidades)
    .order("criado_em", { ascending: false })
    .limit(100);

  if (error) return { ok: false as const, pendente: tabelaPendente(error.code) };
  return { ok: true as const, cotacoes: (data ?? []) as unknown as Cotacao[] };
}

type ResultadoCotacao = "criada" | "cliente" | "veiculo" | "unidade" | "pendente" | "erro";

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
