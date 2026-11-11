import "server-only";
import type { Usuario } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { buscarClientePorTelefone } from "@/lib/clientes-telefone";
import { podeAcessar, supervisiona, type Papel, type Setor } from "@/lib/permissoes";
import { COTACOES_POR_PAGINA, ETAPAS_ABERTAS, ETAPAS_ENCERRADAS, type DadosAcompanhamento, type DadosCotacao, type DadosEdicaoItem, type DadosEncerramento, type DadosItem, type FilaCotacoes, type TipoPreparo } from "./dados-cotacao";

type Cotacao = {
  id: string;
  unidade: string;
  origem: "balcao" | "oficina" | "whatsapp";
  descricao: string;
  status: string;
  tipo_preparo: TipoPreparo | null;
  proxima_acao: string | null;
  prazo: string | null;
  criado_em: string;
  venda_confirmada_em: string | null;
  responsavel_id: string | null;
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

type CotacaoDetalhada = Cotacao & {
  motivo_encerramento: string | null;
  acompanhamento_versao: number;
  itens: ItemCotacao[];
};

const RESUMO_COTACAO = "id, unidade, origem, descricao, status, tipo_preparo, proxima_acao, prazo, criado_em, venda_confirmada_em, responsavel_id, clientes(nome), veiculos(placa), responsavel:usuarios!pecas_cotacoes_responsavel_id_fkey(nome)";

function tabelaPendente(codigo: string) {
  return codigo === "PGRST205" || codigo === "42P01";
}

export async function listarCotacoes(u: Usuario, filtros: { pagina: number; fila: FilaCotacoes } = { pagina: 1, fila: "abertas" }) {
  const inicio = (filtros.pagina - 1) * COTACOES_POR_PAGINA;
  const { data, error } = await db()
    .rpc("pecas_cotacoes_visiveis", { p_ator: u.id })
    .select(RESUMO_COTACAO)
    .in("status", filtros.fila === "abertas" ? ETAPAS_ABERTAS : ETAPAS_ENCERRADAS)
    .order("criado_em", { ascending: false })
    .order("id")
    .range(inicio, inicio + COTACOES_POR_PAGINA);

  if (error) return { ok: false as const, pendente: tabelaPendente(error.code) };
  if (!Array.isArray(data)) return { ok: false as const, pendente: false };
  return {
    ok: true as const,
    cotacoes: data.slice(0, COTACOES_POR_PAGINA) as unknown as Cotacao[],
    temMais: data.length > COTACOES_POR_PAGINA,
  };
}

export async function obterCotacao(u: Usuario, id: string) {
  const { data, error } = await db()
    .rpc("pecas_cotacoes_visiveis", { p_ator: u.id })
    .select(`${RESUMO_COTACAO}, motivo_encerramento, acompanhamento_versao, itens:pecas_cotacao_itens(id, versao, descricao, quantidade, preco_unitario_centavos, custo_unitario_centavos)`)
    .eq("id", id)
    .order("criado_em", { referencedTable: "itens" })
    .order("id", { referencedTable: "itens" })
    .maybeSingle();

  if (error) return { ok: false as const, pendente: tabelaPendente(error.code) };
  return { ok: true as const, cotacao: data as unknown as CotacaoDetalhada | null };
}

type ResultadoItem = "adicionado" | "indisponivel" | "limite" | "pendente" | "erro_item";

type Responsavel = {
  user_id: string;
  nome: string;
  papel: Papel;
  setor: Setor;
  unidade: string;
  usuario_unidades: { unidade: string }[];
};

export async function listarResponsaveis(u: Usuario, unidade: string) {
  if (!supervisiona(u) || !podeAcessar(u, "pecas") || !u.unidades.includes(unidade)) {
    return { ok: false as const };
  }
  const { data, error } = await db().from("usuarios")
    .select("user_id, nome, papel, setor, unidade, usuario_unidades(unidade)")
    .eq("ativo", true)
    .order("nome");
  if (error) return { ok: false as const };
  const usuarios = ((data ?? []) as unknown as Responsavel[])
    .filter((pessoa) => podeAcessar(pessoa, "pecas") &&
      (pessoa.unidade === unidade || pessoa.usuario_unidades.some((extra) => extra.unidade === unidade)))
    .map((pessoa) => ({ id: pessoa.user_id, nome: pessoa.nome }));
  return { ok: true as const, usuarios };
}

type ResultadoResponsavel = "responsavel_atualizado" | "indisponivel" | "pendente" | "erro_responsavel";

export async function reatribuirCotacao(u: Usuario, id: string, responsavelId: string): Promise<ResultadoResponsavel> {
  if (!supervisiona(u) || !podeAcessar(u, "pecas")) return "indisponivel";
  const { data, error } = await db().rpc("pecas_reatribuir_cotacao", {
    p_id: id, p_unidades: u.unidades, p_ator: u.id, p_responsavel: responsavelId,
  });
  if (error) return tabelaPendente(error.code) || error.code === "PGRST202" ? "pendente" : "erro_responsavel";
  return data === true ? "responsavel_atualizado" : "indisponivel";
}

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

type PedidoDoBot = {
  clienteId: string;
  unidade: string;
  referencia: string;
  descricao: string;
};

type ResultadoCotacaoDoBot =
  | { ok: true; id: string }
  | { ok: false; motivo: "invalido" | "pendente" | "indisponivel" | "erro" };

export async function registrarCotacaoDoBot(pedido: PedidoDoBot): Promise<ResultadoCotacaoDoBot> {
  const clienteId = pedido.clienteId.trim();
  const unidade = pedido.unidade.trim();
  const referencia = pedido.referencia.trim();
  const descricao = pedido.descricao.trim();

  if (!clienteId || !unidade || !referencia || referencia.length > 512 || !descricao || descricao.length > 1000) {
    return { ok: false, motivo: "invalido" };
  }

  const { data, error } = await db().rpc("pecas_registrar_cotacao_bot", {
    p_cliente_id: clienteId,
    p_unidade: unidade,
    p_referencia: referencia,
    p_descricao: descricao,
  });
  if (error) {
    const pendente = tabelaPendente(error.code) || error.code === "PGRST202";
    return { ok: false, motivo: pendente ? "pendente" : "erro" };
  }
  if (typeof data === "string") return { ok: true, id: data };
  return { ok: false, motivo: "indisponivel" };
}

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

type ResultadoApresentacao = "apresentada" | "sem_itens" | "desatualizada" | "indisponivel" | "pendente" | "erro_apresentacao";

export async function marcarApresentada(u: Usuario, id: string, itens: Record<string, number>): Promise<ResultadoApresentacao> {
  const { data, error } = await db().rpc("pecas_registrar_apresentacao", {
    p_id: id,
    p_unidades: u.unidades,
    p_ator: u.id,
    p_itens: itens,
  });
  if (error) return tabelaPendente(error.code) || error.code === "PGRST202" ? "pendente" : "erro_apresentacao";
  if (data === "apresentada" || data === "sem_itens" || data === "desatualizada" || data === "indisponivel") return data;
  return "erro_apresentacao";
}

type ResultadoAprovacao = "aprovada" | "indisponivel" | "pendente" | "erro_aprovacao";

export async function marcarAprovada(u: Usuario, id: string): Promise<ResultadoAprovacao> {
  const { data, error } = await db().rpc("pecas_registrar_aprovacao", {
    p_id: id,
    p_unidades: u.unidades,
    p_ator: u.id,
  });
  if (error) return tabelaPendente(error.code) || error.code === "PGRST202" ? "pendente" : "erro_aprovacao";
  return data === true ? "aprovada" : "indisponivel";
}

type ResultadoVenda = "venda_confirmada" | "indisponivel" | "pendente" | "erro_venda";

export async function marcarVendaConfirmada(u: Usuario, id: string): Promise<ResultadoVenda> {
  const { data, error } = await db().rpc("pecas_confirmar_venda", {
    p_id: id,
    p_unidades: u.unidades,
    p_ator: u.id,
  });
  if (error) return tabelaPendente(error.code) || error.code === "PGRST202" ? "pendente" : "erro_venda";
  return data === true ? "venda_confirmada" : "indisponivel";
}

type ResultadoEncerramento = "perda_registrada" | "cancelamento_registrado" | "indisponivel" | "pendente" | "erro_encerramento";

export async function encerrarCotacao(u: Usuario, id: string, dados: DadosEncerramento): Promise<ResultadoEncerramento> {
  const { data, error } = await db().rpc("pecas_encerrar_cotacao", {
    p_id: id,
    p_unidades: u.unidades,
    p_ator: u.id,
    p_destino: dados.destino,
    p_motivo: dados.motivo,
  });
  if (error) return tabelaPendente(error.code) || error.code === "PGRST202" ? "pendente" : "erro_encerramento";
  if (data !== true) return "indisponivel";
  return dados.destino === "perdido" ? "perda_registrada" : "cancelamento_registrado";
}

type ResultadoAcompanhamento = "acompanhamento_salvo" | "acompanhamento_desatualizado" | "indisponivel" | "pendente" | "erro_acompanhamento";

export async function atualizarAcompanhamento(u: Usuario, id: string, dados: DadosAcompanhamento): Promise<ResultadoAcompanhamento> {
  const { data, error } = await db().rpc("pecas_atualizar_acompanhamento", {
    p_id: id,
    p_unidades: u.unidades,
    p_ator: u.id,
    p_versao: dados.versao,
    p_proxima_acao: dados.proximaAcao,
    p_prazo: dados.prazo,
  });
  if (error) return tabelaPendente(error.code) || error.code === "PGRST202" ? "pendente" : "erro_acompanhamento";
  if (data === "atualizado") return "acompanhamento_salvo";
  if (data === "desatualizado") return "acompanhamento_desatualizado";
  return data === "indisponivel" ? "indisponivel" : "erro_acompanhamento";
}

export async function registrarCotacao(u: Usuario, dados: DadosCotacao): Promise<ResultadoCotacao> {
  if (!u.unidades.includes(u.unidade)) return "unidade";

  const client = db();
  const [{ data: unidade, error: erroUnidade }, cliente] = await Promise.all([
    client.from("unidades").select("chave").eq("chave", u.unidade).eq("ativa", true).maybeSingle(),
    buscarClientePorTelefone<{ anonimizado: boolean }>(dados.telefone, "anonimizado"),
  ]);
  if (erroUnidade) return tabelaPendente(erroUnidade.code) ? "pendente" : "erro";
  if (!unidade) return "unidade";
  if (!cliente || cliente.anonimizado) return "cliente";

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
