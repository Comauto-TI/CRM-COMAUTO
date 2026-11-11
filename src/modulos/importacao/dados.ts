import "server-only";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import type { Usuario } from "@/lib/auth";
import { variantesTelefone } from "@/lib/phone";
import { vendedoresDaUnidade } from "@/modulos/vendas/dados";
import { revalidar, LIMITE_LINHAS, type ClienteImportado } from "./regras";

/**
 * F3 — importação de clientes. SEMPRE depois de exigirAcesso("importacao").
 * - nunca sobrescreve: cliente que já existe (mesmo telefone, com/sem o 9, ou mesmo CPF) só ganha os campos VAZIOS;
 * - não cria consentimento de WhatsApp (LGPD): o envio automático continua bloqueado para importados;
 * - ficha anonimizada nunca é tocada.
 */

type Existente = {
  id: string; telefone: string; cpf_cnpj: string | null; nome: string | null; email: string | null; cidade: string | null;
  data_nascimento: string | null; vendedor_id: string | null; anonimizado: boolean; ids_externos: Record<string, unknown> | null;
};
const COLUNAS = "id, telefone, cpf_cnpj, nome, email, cidade, data_nascimento, vendedor_id, anonimizado, ids_externos";

function limpar(entrada: unknown): ClienteImportado[] {
  if (!Array.isArray(entrada)) return [];
  const vistos = new Set<string>();
  const saida: ClienteImportado[] = [];
  for (const bruto of entrada.slice(0, LIMITE_LINHAS)) {
    const c = bruto && typeof bruto === "object" ? revalidar(bruto as Partial<ClienteImportado>) : null;
    if (!c) continue;
    const chaves = [...variantesTelefone(c.telefone), ...(c.cpf_cnpj ? [`doc:${c.cpf_cnpj}`] : [])];
    if (chaves.some((k) => vistos.has(k))) continue; // duplicado no próprio lote
    chaves.forEach((k) => vistos.add(k));
    saida.push(c);
  }
  return saida;
}

/** Acha as fichas que já existem para o lote (por telefone com/sem o 9 e por CPF). */
async function acharExistentes(clientes: ClienteImportado[]) {
  const porTelefone = new Map<string, Existente>();
  const porDoc = new Map<string, Existente>();
  const tels = [...new Set(clientes.flatMap((c) => variantesTelefone(c.telefone)))];
  for (let i = 0; i < tels.length; i += 300) {
    const { data, error } = await db().from("clientes").select(COLUNAS).in("telefone", tels.slice(i, i + 300));
    if (error) throw error;
    for (const e of (data ?? []) as Existente[]) porTelefone.set(e.telefone, e);
  }
  const docs = [...new Set(clientes.map((c) => c.cpf_cnpj).filter((d): d is string => !!d))];
  for (let i = 0; i < docs.length; i += 300) {
    const { data, error } = await db().from("clientes").select(COLUNAS).in("cpf_cnpj", docs.slice(i, i + 300));
    if (error) throw error;
    for (const e of (data ?? []) as Existente[]) if (e.cpf_cnpj && !porDoc.has(e.cpf_cnpj)) porDoc.set(e.cpf_cnpj, e);
  }
  const achar = (c: ClienteImportado): { ficha: Existente; por: "telefone" | "CPF" } | null => {
    for (const v of variantesTelefone(c.telefone)) { const e = porTelefone.get(v); if (e) return { ficha: e, por: "telefone" }; }
    const e = c.cpf_cnpj ? porDoc.get(c.cpf_cnpj) : undefined;
    return e ? { ficha: e, por: "CPF" } : null;
  };
  return achar;
}

export type ResultadoPrevia = { novos: number; existentes: number; exemplos: { linha: number; nome: string | null; por: string; ficha: string | null }[]; total: number };

export async function previaImportacao(entrada: unknown): Promise<ResultadoPrevia> {
  const clientes = limpar(entrada);
  const achar = await acharExistentes(clientes);
  let novos = 0;
  const exemplos: ResultadoPrevia["exemplos"] = [];
  for (const c of clientes) {
    const e = achar(c);
    if (!e) { novos++; continue; }
    if (exemplos.length < 20) exemplos.push({ linha: c.linha, nome: c.nome, por: e.por, ficha: e.ficha.anonimizado ? "(ficha anonimizada — não será alterada)" : e.ficha.nome });
  }
  return { novos, existentes: clientes.length - novos, exemplos, total: clientes.length };
}

export type ResultadoImportacao =
  | { ok: true; criados: number; completados: number; semMudanca: number; recusados: number }
  | { ok: false; motivo: string };

export async function importarClientes(u: Usuario, entrada: unknown, opcoes: { vendedorId: string | null; completar: boolean }): Promise<ResultadoImportacao> {
  const recebidos = Array.isArray(entrada) ? Math.min(entrada.length, LIMITE_LINHAS) : 0;
  const clientes = limpar(entrada);
  if (!clientes.length) return { ok: false, motivo: "Nenhuma linha válida para importar" };

  let vendedorId: string | null = null;
  if (opcoes.vendedorId) {
    const ok = (await vendedoresDaUnidade(u.unidade)).some((v) => v.user_id === opcoes.vendedorId);
    if (!ok) return { ok: false, motivo: "Escolha um vendedor com acesso a Vendas nesta unidade" };
    vendedorId = opcoes.vendedorId;
  }

  const achar = await acharExistentes(clientes);
  const agora = new Date().toISOString();
  const novos: ClienteImportado[] = [];
  const atualizar: { id: string; patch: Record<string, unknown> }[] = [];
  let semMudanca = 0;

  for (const c of clientes) {
    const e = achar(c);
    if (!e) { novos.push(c); continue; }
    const f = e.ficha;
    if (f.anonimizado || !opcoes.completar) { semMudanca++; continue; }
    const patch: Record<string, unknown> = {};
    if (!f.nome && c.nome) patch.nome = c.nome;
    if (!f.email && c.email) patch.email = c.email;
    if (!f.cidade && c.cidade) patch.cidade = c.cidade;
    if (!f.data_nascimento && c.data_nascimento) patch.data_nascimento = c.data_nascimento;
    if (!f.cpf_cnpj && c.cpf_cnpj && e.por === "telefone") patch.cpf_cnpj = c.cpf_cnpj;
    if (!f.vendedor_id && vendedorId) patch.vendedor_id = vendedorId;
    if (c.codigo_externo && !(f.ids_externos ?? {}).importacao) {
      patch.ids_externos = { ...(f.ids_externos ?? {}), importacao: { codigo: c.codigo_externo, em: agora, por: u.email } };
    }
    if (Object.keys(patch).length) atualizar.push({ id: f.id, patch });
    else semMudanca++;
  }

  // novos: em blocos; conflito de telefone (outra gravação no meio do caminho) é ignorado, nunca sobrescreve
  let criados = 0, recusados = recebidos - clientes.length;
  for (let i = 0; i < novos.length; i += 200) {
    const bloco = novos.slice(i, i + 200).map((c) => ({
      telefone: c.telefone, nome: c.nome, email: c.email, cidade: c.cidade, cpf_cnpj: c.cpf_cnpj, data_nascimento: c.data_nascimento,
      origem: "importacao", unidade_origem: u.unidade, vendedor_id: vendedorId,
      ids_externos: c.codigo_externo ? { importacao: { codigo: c.codigo_externo, em: agora, por: u.email } } : {},
    }));
    const { data, error } = await db().from("clientes").upsert(bloco, { onConflict: "telefone", ignoreDuplicates: true }).select("id");
    if (error) { recusados += bloco.length; continue; }
    criados += data?.length ?? 0;
    semMudanca += bloco.length - (data?.length ?? 0);
  }

  // completar fichas existentes: só campos vazios. A condição .is(null) de CADA campo é repetida na gravação
  // (revisão Codex PR #5): se alguém preencheu o campo entre a leitura e a gravação, a linha não é tocada.
  let completados = 0, falhas = 0;
  for (let i = 0; i < atualizar.length; i += 20) {
    const r = await Promise.all(atualizar.slice(i, i + 20).map(async ({ id, patch }) => {
      let q = db().from("clientes").update(patch).eq("id", id).eq("anonimizado", false);
      for (const campo of Object.keys(patch)) {
        q = campo === "ids_externos" ? q.is("ids_externos->importacao", null) : q.is(campo, null);
      }
      const { data, error } = await q.select("id");
      return error ? "falha" : data?.length ? "ok" : "sem";
    }));
    completados += r.filter((x) => x === "ok").length;
    semMudanca += r.filter((x) => x === "sem").length;
    falhas += r.filter((x) => x === "falha").length;
  }

  recusados += falhas; // erro de gravação nunca vira "sem mudança"
  await auditar(u.email, "importar_clientes", "clientes", null, { recebidos, criados, completados, semMudanca, recusados, falhas, vendedorId, completar: opcoes.completar });
  return { ok: true, criados, completados, semMudanca, recusados };
}
