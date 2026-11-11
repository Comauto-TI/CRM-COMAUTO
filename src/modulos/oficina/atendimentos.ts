import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";
import { buscarClientePorTelefone } from "@/lib/clientes-telefone";
import { mascararDadosSensiveis } from "@/lib/security/guard";
import { objeto, uuid, instante, natural, cursor, opcoesValidas, type CursorMensagens } from "@/modulos/atendimento/contrato-leitura";
import type { DadosAtendimento } from "./dados-atendimento";

export type FiltrosFilaOficina = { minhas?: boolean; limite?: number; antes?: CursorMensagens | null };
export type AtendimentoOficina = {
  id: string; unidade: string; descricao: string; status: "novo" | "em_triagem"; criadoEm: string; clienteNome: string;
  veiculo: { placa: string | null; modelo: string | null } | null;
  responsavel: { id: string; nome: string } | null;
  podeAssumir: boolean;
};
export type ResultadoFilaOficina =
  | { ok: true; atendimentos: AtendimentoOficina[]; total: number; proximo: CursorMensagens | null }
  | { ok: false; status: 400 | 403 | 404 | 503; motivo: string; pendente: boolean };

const unidadeValida = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9_]+$/.exec(v)?.[0] === v;
const textoOpcional = (v: unknown): v is string | null => v === null || typeof v === "string";
const mascarar = (v: string) => mascararDadosSensiveis(v).texto;
const mascararOpcional = (v: string | null) => v === null ? null : mascarar(v);
const migrationPendente = (codigo: unknown) => ["PGRST202", "PGRST205", "42P01", "42883"].includes(codigo as string);
const atorValido = (u: unknown): u is Usuario => objeto(u) && uuid(u.id);

function falha(status: 400 | 403 | 404 | 503, pendente = false): ResultadoFilaOficina {
  const motivos = {
    400: "Confira os filtros da fila de Oficina.",
    403: "Seu perfil não tem acesso à Oficina.",
    404: "A fila não está disponível no seu acesso atual.",
    503: "Não foi possível carregar a fila de Oficina. Tente novamente.",
  };
  return { ok: false, status, motivo: motivos[status], pendente };
}

function atendimento(v: unknown): AtendimentoOficina | null {
  if (!objeto(v) || !uuid(v.id) || !unidadeValida(v.unidade) || typeof v.descricao !== "string" ||
    !v.descricao || v.descricao.length > 1000 || v.descricao.trim() !== v.descricao ||
    (v.status !== "novo" && v.status !== "em_triagem") || !instante(v.criadoEm) || typeof v.clienteNome !== "string" ||
    typeof v.podeAssumir !== "boolean") return null;
  if (v.veiculo !== null && (!objeto(v.veiculo) || !textoOpcional(v.veiculo.placa) || !textoOpcional(v.veiculo.modelo))) return null;
  if (v.responsavel !== null && (!objeto(v.responsavel) || !uuid(v.responsavel.id) || typeof v.responsavel.nome !== "string")) return null;
  if (v.podeAssumir && (v.status !== "novo" || v.responsavel !== null)) return null;
  return {
    id: v.id.toLowerCase(), unidade: v.unidade, descricao: mascarar(v.descricao), status: v.status,
    criadoEm: v.criadoEm, clienteNome: mascarar(v.clienteNome), podeAssumir: v.podeAssumir,
    veiculo: v.veiculo === null ? null : { placa: mascararOpcional(v.veiculo.placa as string | null), modelo: mascararOpcional(v.veiculo.modelo as string | null) },
    responsavel: v.responsavel === null ? null : { id: (v.responsavel.id as string).toLowerCase(), nome: mascarar(v.responsavel.nome as string) },
  };
}

/** A RPC revalida ator, setor, unidade e carteira antes da contagem e da paginação. */
export async function listarAtendimentos(u: Usuario, filtros?: FiltrosFilaOficina): Promise<ResultadoFilaOficina> {
  const opts = opcoesValidas(filtros);
  if (!atorValido(u) || !opts || (filtros?.minhas !== undefined && typeof filtros.minhas !== "boolean")) return falha(400);
  if (!podeAcessar(u, "oficina")) return falha(403);
  try {
    const { data, error } = await db().rpc("oficina_fila", {
      p_ator: u.id.toLowerCase(), p_limite: opts.limite, p_antes: opts.antes?.criadoEm ?? null,
      p_antes_id: opts.antes?.id ?? null, p_minhas: filtros?.minhas ?? false,
    });
    if (error) return falha(503, migrationPendente(error.code));
    if (!objeto(data)) return falha(503);
    if (data.ok === false) {
      if (data.codigo === "invalido" || data.codigo === "cursor_invalido") return falha(400);
      return falha(data.codigo === "nao_encontrado" ? 404 : 503);
    }
    if (data.ok !== true || !natural(data.total) || !Array.isArray(data.atendimentos) ||
      data.atendimentos.length > opts.limite || data.total < data.atendimentos.length) return falha(503);
    const atendimentos: AtendimentoOficina[] = [];
    const ids = new Set<string>();
    for (const linha of data.atendimentos) {
      const a = atendimento(linha);
      if (!a || ids.has(a.id)) return falha(503);
      ids.add(a.id); atendimentos.push(a);
    }
    const proximo = data.proximo === null ? null : cursor(data.proximo);
    if (data.proximo !== null) {
      const ultimo = atendimentos.at(-1);
      if (!proximo || !ultimo || atendimentos.length !== opts.limite || data.total <= atendimentos.length ||
        proximo.id !== ultimo.id || proximo.criadoEm !== ultimo.criadoEm) return falha(503);
    }
    if (opts.antes === null && proximo === null && data.total !== atendimentos.length) return falha(503);
    return { ok: true, atendimentos, total: data.total, proximo };
  } catch { return falha(503); }
}

export type ResultadoRegistroOficina = "criado" | "unidade" | "cliente" | "veiculo" | "conflito" | "pendente" | "erro";

export async function registrarAtendimento(u: Usuario, dados: DadosAtendimento): Promise<ResultadoRegistroOficina> {
  if (!atorValido(u) || !podeAcessar(u, "oficina") || !unidadeValida(u.unidade)) return "unidade";
  if (!objeto(dados) || !uuid(dados.id) || typeof dados.descricao !== "string" || !dados.descricao ||
    dados.descricao.length > 1000 || dados.descricao.trim() !== dados.descricao) return "conflito";
  if (typeof dados.telefone !== "string") return "cliente";
  if (!textoOpcional(dados.placa)) return "veiculo";
  try {
    const cliente = await buscarClientePorTelefone<{ anonimizado: boolean }>(dados.telefone, "anonimizado");
    if (!cliente || !uuid(cliente.id) || cliente.anonimizado !== false || typeof cliente.telefone !== "string") return "cliente";
    const { data, error } = await db().rpc("oficina_registrar_atendimento", {
      p_id: dados.id.toLowerCase(), p_unidade: u.unidade, p_ator: u.id.toLowerCase(),
      p_telefone: cliente.telefone, p_placa: dados.placa, p_descricao: dados.descricao,
    });
    if (error) return migrationPendente(error.code) ? "pendente" : "erro";
    return data === "criado" || data === "unidade" || data === "cliente" || data === "veiculo" || data === "conflito" ? data : "erro";
  } catch { return "erro"; }
}

export type ResultadoTriagemOficina = "triagem" | "indisponivel" | "pendente" | "erro_triagem";

export async function iniciarTriagem(u: Usuario, id: string): Promise<ResultadoTriagemOficina> {
  if (!atorValido(u) || !uuid(id) || !podeAcessar(u, "oficina")) return "indisponivel";
  try {
    const { data, error } = await db().rpc("oficina_assumir_atendimento", { p_id: id.toLowerCase(), p_ator: u.id.toLowerCase() });
    if (error) return migrationPendente(error.code) ? "pendente" : "erro_triagem";
    return data === true ? "triagem" : data === false ? "indisponivel" : "erro_triagem";
  } catch { return "erro_triagem"; }
}
