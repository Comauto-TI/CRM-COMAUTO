import "server-only";
import { db } from "@/lib/supabase/admin";
import { mascararTelefone } from "@/lib/phone";
import { localParaUtc } from "@/lib/time";
import { nucleoAplicado } from "@/lib/usuarios";
import { podeAcessar } from "@/lib/permissoes";
import type { Usuario } from "@/lib/auth";
import { veTodasOportunidades } from "./regras";
import { classificarAniversario, aniversarioMaisProximo, idadeNoAniversario, ordenarAniversarios, ANTECEDENCIA_PADRAO, type EstadoAniversario } from "./aniversarios";

export type Aniversariante = {
  clienteId: string; nome: string; telefone: string; vendedor: string | null; vendedorId: string | null;
  estado: EstadoAniversario; dias: number; data: string; idade: number | null; lembreteAtivo: boolean;
};
type Cliente = { id: string; nome: string | null; telefone: string; data_nascimento: string; vendedor_id: string | null; unidade_origem: string | null; anonimizado?: boolean };
type Dono = { user_id: string; nome: string; unidade: string };
type Lembrete = { id: string; cliente_id: string | null; data_alvo: string; concluido_em: string | null; insistente: boolean; usuario_id: string; unidade: string };
type Pagina = { data: unknown[] | null; error: unknown; count: number | null };
const COLUNAS_CLIENTE = "id, nome, telefone, data_nascimento, vendedor_id, unidade_origem, anonimizado";
const COLUNAS_LEMBRETE = "id, cliente_id, data_alvo, concluido_em, insistente, usuario_id, unidade";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A contagem evita tratar o limite da Data API ou uma falha como uma carteira completa. */
async function todas<T>(consultar: (de: number, ate: number) => PromiseLike<Pagina>): Promise<T[]> {
  const linhas: T[] = [];
  let total: number | undefined;
  do {
    const { data, error, count } = await consultar(linhas.length, linhas.length + 499);
    if (error || !Array.isArray(data) || count === null || !Number.isSafeInteger(count) || count < 0 || (total !== undefined && count !== total)) {
      throw new Error("Não foi possível carregar todos os dados de aniversários. Atualize para tentar novamente.");
    }
    total = count;
    if ((!data.length && linhas.length < total) || linhas.length + data.length > total) {
      throw new Error("Leitura incompleta dos aniversários. Atualize para tentar novamente.");
    }
    linhas.push(...data as T[]);
  } while (linhas.length < total);
  return linhas;
}

async function porLotes<T>(ids: string[], consultar: (ids: string[], de: number, ate: number) => PromiseLike<Pagina>) {
  const resultado: T[] = [];
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 100) {
    const lote = unicos.slice(i, i + 100);
    resultado.push(...await todas<T>((de, ate) => consultar(lote, de, ate)));
  }
  return resultado;
}

async function donosDos(clientes: Cliente[]) {
  const donos = await porLotes<Dono>(clientes.flatMap((c) => c.vendedor_id ? [c.vendedor_id] : []), (ids, de, ate) =>
    db().from("usuarios").select("user_id, nome, unidade", { count: "exact" }).in("user_id", ids).order("user_id").range(de, ate));
  return new Map(donos.map((d) => [d.user_id, d]));
}

function noEscopo(u: Usuario, c: Cliente, donos: Map<string, Dono>) {
  if (c.anonimizado || !dataValida(c.data_nascimento) || !podeAcessar(u, "vendas")) return false;
  if (u.papel === "admin") return true;
  if (!veTodasOportunidades(u) && c.vendedor_id !== u.id) return false;
  const unidade = (c.vendedor_id && donos.get(c.vendedor_id)?.unidade) || c.unidade_origem;
  return !!unidade && u.unidades.includes(unidade);
}

function dataValida(data: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(data) && Number(data.slice(0, 4)) >= 1 &&
    Number.isFinite(Date.parse(data)) && new Date(`${data}T00:00:00Z`).toISOString().slice(0, 10) === data;
}

export async function listarAniversarios(u: Usuario, hojeISO: string, antecedencia = ANTECEDENCIA_PADRAO, fusoOffset = "-03:00"): Promise<Aniversariante[]> {
  if (!podeAcessar(u, "vendas") || !(await nucleoAplicado())) return [];
  if (!dataValida(hojeISO)) throw new Error("Data de referência inválida.");
  const clientes = await todas<Cliente>((de, ate) => {
    let q = db().from("clientes").select(COLUNAS_CLIENTE, { count: "exact" }).not("data_nascimento", "is", null).eq("anonimizado", false);
    if (!veTodasOportunidades(u)) q = q.eq("vendedor_id", u.id);
    return q.order("id").range(de, ate);
  });
  const donos = await donosDos(clientes);
  const naJanela = clientes.filter((c) => noEscopo(u, c, donos))
    .map((c) => ({ c, a: aniversarioMaisProximo(c.data_nascimento, hojeISO) }))
    .filter((x) => x.a && Math.abs(x.a.dias) <= antecedencia);
  if (!naJanela.length) return [];
  const ids = naJanela.map(({ c }) => c.id);
  const inicio = localParaUtc(naJanela.map(({ a }) => a!.data).sort()[0], "00:00", fusoOffset).toISOString();
  const [lembretes, ops, mensagens, contatos] = await Promise.all([
    porLotes<Lembrete>(ids, (lote, de, ate) => db().from("lembretes").select(COLUNAS_LEMBRETE, { count: "exact" }).eq("tipo", "aniversario").in("cliente_id", lote).order("id").range(de, ate)),
    porLotes<{ id: string; cliente_id: string }>(ids, (lote, de, ate) => db().from("vendas_oportunidades").select("id, cliente_id", { count: "exact" }).in("cliente_id", lote).order("id").range(de, ate)),
    porLotes<{ cliente_id: string; criado_em: string; status: string }>(ids, (lote, de, ate) => db().from("mensagens").select("id, cliente_id, criado_em, status", { count: "exact" }).in("cliente_id", lote).eq("direcao", "saida").eq("autor", "atendente").in("status", ["enviada", "entregue", "lida"]).gte("criado_em", inicio).order("id").range(de, ate)),
    porLotes<{ cliente_id: string; data_alvo: string }>(ids, (lote, de, ate) => db().from("aniversarios_contatos").select("cliente_id, data_alvo", { count: "exact" }).in("cliente_id", lote).order("cliente_id").order("data_alvo").range(de, ate)),
  ]);
  const atividades = await porLotes<{ oportunidade_id: string; tipo: string; ator: string; criado_em: string }>(ops.map((o) => o.id), (lote, de, ate) =>
    db().from("vendas_atividades").select("id, oportunidade_id, tipo, ator, criado_em", { count: "exact" }).in("oportunidade_id", lote).in("tipo", ["ligacao", "whatsapp", "visita", "test_drive", "email"]).gte("criado_em", inicio).order("id").range(de, ate));
  const opsPorId = new Map(ops.map((o) => [o.id, o.cliente_id]));
  const ultimoContato = new Map<string, number>();
  for (const m of mensagens) {
    const t = Date.parse(m.criado_em);
    ultimoContato.set(m.cliente_id, Math.max(ultimoContato.get(m.cliente_id) ?? -Infinity, t));
  }
  for (const a of atividades) {
    const ator = a.ator.trim().toLowerCase();
    const id = opsPorId.get(a.oportunidade_id);
    if (id && ator && !["assistente", "sistema", "bot"].includes(ator)) {
      ultimoContato.set(id, Math.max(ultimoContato.get(id) ?? -Infinity, Date.parse(a.criado_em)));
    }
  }
  const registrados = new Set(contatos.map((c) => `${c.cliente_id}:${c.data_alvo}`));
  return ordenarAniversarios(naJanela.map(({ c, a }) => {
    const desde = a!.data;
    const contato = registrados.has(`${c.id}:${desde}`) || (ultimoContato.get(c.id) ?? -Infinity) >= localParaUtc(desde, "00:00", fusoOffset).getTime();
    const k = classificarAniversario(c.data_nascimento, hojeISO, contato, antecedencia)!;
    return {
      clienteId: c.id, nome: c.nome ?? "Cliente", telefone: mascararTelefone(c.telefone),
      vendedor: c.vendedor_id ? donos.get(c.vendedor_id)?.nome ?? null : null, vendedorId: c.vendedor_id,
      estado: k.estado, dias: k.dias, data: k.data, idade: idadeNoAniversario(c.data_nascimento, k.data),
      lembreteAtivo: lembretes.some((l) => l.cliente_id === c.id && l.data_alvo === desde && l.insistente && !l.concluido_em && l.usuario_id === u.id),
    };
  }));
}

async function podeNoCliente(u: Usuario, clienteId: string) {
  if (!UUID.test(clienteId) || !podeAcessar(u, "vendas")) return null;
  const { data, error } = await db().from("clientes").select(COLUNAS_CLIENTE).eq("id", clienteId).maybeSingle();
  if (error) throw new Error("Não foi possível consultar o cliente.");
  if (!data) return null;
  const c = data as Cliente;
  return noEscopo(u, c, await donosDos([c])) ? c : null;
}

function ehDataAniversario(c: Cliente, data: string) {
  return dataValida(c.data_nascimento) && dataValida(data) && data >= c.data_nascimento && aniversarioMaisProximo(c.data_nascimento, data)?.data === data;
}

function dataDoContato(c: Cliente, hojeISO: string, dataAlvo?: string) {
  if (!dataValida(hojeISO) || !dataValida(c.data_nascimento)) return null;
  const data = dataAlvo ?? aniversarioMaisProximo(c.data_nascimento, hojeISO)?.data;
  if (!data || !ehDataAniversario(c, data)) return null;
  const dias = (Date.parse(data) - Date.parse(hojeISO)) / 86_400_000;
  if (dias > ANTECEDENCIA_PADRAO || (!dataAlvo && Math.abs(dias) > ANTECEDENCIA_PADRAO)) return null;
  // Um lembrete antigo mantém o aniversário original, mesmo após virar o ano.
  return data;
}

/** RPC mantém contato explícito, nota, auditoria e conclusão na mesma transação. */
export async function marcarContatoAniversario(u: Usuario, clienteId: string, hojeISO: string, dataAlvo?: string): Promise<{ ok: boolean; motivo?: string }> {
  try {
    const c = await podeNoCliente(u, clienteId);
    if (!c) return { ok: false, motivo: "Cliente fora da sua carteira ou unidade." };
    const data = dataDoContato(c, hojeISO, dataAlvo);
    if (!data) return { ok: false, motivo: "Data de aniversário inválida ou fora da janela." };
    const r = await db().rpc("registrar_contato_aniversario", { p_cliente_id: c.id, p_ator: u.id, p_unidades: u.unidades, p_data: data, p_autor: u.email });
    if (r.error || r.data?.ok !== true) return { ok: false, motivo: "Não foi possível registrar o contato. Tente novamente." };
    return { ok: true };
  } catch {
    return { ok: false, motivo: "Não foi possível registrar o contato. Tente novamente." };
  }
}

export async function ativarLembreteAniversario(u: Usuario, clienteId: string, hojeISO: string): Promise<{ ok: boolean; motivo?: string }> {
  try {
    const c = await podeNoCliente(u, clienteId);
    if (!c) return { ok: false, motivo: "Cliente fora da sua carteira ou unidade." };
    const data = dataDoContato(c, hojeISO);
    if (!data || Math.abs(Date.parse(data) - Date.parse(hojeISO)) > ANTECEDENCIA_PADRAO * 86_400_000) return { ok: false, motivo: "Aniversário fora da janela de lembrete." };
    const r = await db().rpc("ativar_lembrete_aniversario", { p_cliente_id: c.id, p_ator: u.id, p_unidades: u.unidades, p_data: data });
    return r.error || r.data?.ok !== true ? { ok: false, motivo: "Não foi possível ativar o lembrete. Tente novamente." } : { ok: true };
  } catch {
    return { ok: false, motivo: "Não foi possível ativar o lembrete. Tente novamente." };
  }
}

/** Pendentes continuam visíveis até contato; não expiram depois de sete dias. */
export async function lembretesInsistentes(u: Usuario, hojeISO: string, antecedencia = ANTECEDENCIA_PADRAO) {
  if (!podeAcessar(u, "vendas") || !(await nucleoAplicado())) return [];
  if (!dataValida(hojeISO)) throw new Error("Data de referência inválida.");
  const ate = new Date(Date.parse(hojeISO) + antecedencia * 86_400_000).toISOString().slice(0, 10);
  const lembretes = await todas<Lembrete>((de, fim) => {
    let q = db().from("lembretes").select(COLUNAS_LEMBRETE, { count: "exact" })
      .eq("usuario_id", u.id).eq("tipo", "aniversario").eq("insistente", true).is("concluido_em", null).lte("data_alvo", ate);
    if (u.papel !== "admin") q = q.in("unidade", u.unidades);
    return q.order("id").range(de, fim);
  });
  const clientes = await porLotes<Cliente>(lembretes.flatMap((l) => l.cliente_id ? [l.cliente_id] : []), (ids, de, fim) =>
    db().from("clientes").select(COLUNAS_CLIENTE, { count: "exact" }).in("id", ids).eq("anonimizado", false).order("id").range(de, fim));
  const donos = await donosDos(clientes);
  const porId = new Map(clientes.filter((c) => noEscopo(u, c, donos)).map((c) => [c.id, c]));
  // Correção do nascimento pode tornar o lembrete antigo inválido. Preserva o registro
  // original sem insistir em uma data que já não pertence ao cliente.
  return lembretes.filter((l) => l.cliente_id && porId.has(l.cliente_id) && ehDataAniversario(porId.get(l.cliente_id)!, l.data_alvo)).map((l) => ({
    id: l.id, clienteId: l.cliente_id!, nome: porId.get(l.cliente_id!)!.nome ?? "Cliente", dataAlvo: l.data_alvo,
    dias: Math.round((Date.parse(l.data_alvo) - Date.parse(hojeISO)) / 86_400_000),
  })).sort((a, b) => a.dataAlvo.localeCompare(b.dataAlvo) || a.id.localeCompare(b.id));
}
