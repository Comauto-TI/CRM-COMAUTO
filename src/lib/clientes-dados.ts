import "server-only";
import { db } from "@/lib/supabase/admin";
import { mascararTelefone, variantesTelefone } from "@/lib/phone";
import { mascararDocumento } from "@/lib/busca";
import { nucleoAplicado } from "@/lib/usuarios";
import type { Usuario } from "@/lib/auth";

/** F2-5 — aba Clientes: lista com filtros e ficha do cliente. Sempre depois de exigirAcesso("clientes"). */

export const ORIGENS_CLIENTE = { whatsapp: "WhatsApp", painel: "Cadastro manual", importacao: "Importação", evento: "Evento" } as const;
export const FILTRO_AUTORIZACAO = {
  servico: "Autorizou serviço", eventos: "Autorizou eventos", marketing: "Autorizou ofertas", nenhuma: "Sem autorização", optout: "Pediu para sair",
} as const;

export type FiltrosClientes = { nome?: string; telefone?: string; cidade?: string; origem?: string; autorizacao?: string; atalho?: string; vendedor?: string };

export type LinhaCliente = {
  id: string; nome: string | null; telefone: string; cidade: string | null; origem: string; tags: string[];
  ultimo_contato_em: string | null; criado_em: string; anonimizado: boolean; vendedor_id: string | null;
  autorizacoes: string[]; optout: boolean;
};

const limpar = (s: string | undefined, max = 60) => s?.replace(/[%,()*\\:"']/g, " ").trim().slice(0, max) ?? "";

export async function listarClientes(u: Usuario, f: FiltrosClientes): Promise<LinhaCliente[]> {
  const nucleo = await nucleoAplicado();
  let q = db()
    .from("clientes")
    .select(`id, nome, telefone, cidade, origem, tags, ultimo_contato_em, criado_em, anonimizado${nucleo ? ", vendedor_id" : ""}, consentimentos(tipo, status)`)
    .order("ultimo_contato_em", { ascending: false, nullsFirst: false })
    .limit(300);
  const nome = limpar(f.nome);
  if (nome.length >= 2) q = q.ilike("nome", `%${nome}%`);
  const tel = (f.telefone ?? "").replace(/\D/g, "").slice(0, 13);
  if (tel.length >= 4) q = q.like("telefone", `%${tel}%`);
  const cidade = limpar(f.cidade, 40);
  if (cidade.length >= 2) q = q.ilike("cidade", `%${cidade}%`);
  if (f.origem && f.origem in ORIGENS_CLIENTE) q = q.eq("origem", f.origem);
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  if (f.atalho === "novos_mes") q = q.gte("criado_em", inicioMes);
  if (f.atalho === "falaram_7d") q = q.gte("ultimo_contato_em", new Date(Date.now() - 7 * 86_400_000).toISOString());
  if (nucleo && f.atalho === "carteira") q = q.eq("vendedor_id", u.id);
  if (nucleo && f.vendedor === "sem") q = q.is("vendedor_id", null);
  else if (nucleo && f.vendedor && /^[0-9a-f-]{36}$/i.test(f.vendedor)) q = q.eq("vendedor_id", f.vendedor);

  const [{ data }, { data: opts }] = await Promise.all([q, db().from("optouts").select("telefone")]);
  const bloqueados = new Set((opts ?? []).flatMap((o) => variantesTelefone(o.telefone as string)));
  const linhas = ((data ?? []) as unknown as (Omit<LinhaCliente, "autorizacoes" | "optout" | "vendedor_id"> & { vendedor_id?: string | null; consentimentos: { tipo: string; status: string }[] })[]).map((c) => ({
    id: c.id, nome: c.nome, telefone: mascararTelefone(c.telefone), cidade: c.cidade, origem: c.origem, tags: c.tags ?? [],
    ultimo_contato_em: c.ultimo_contato_em, criado_em: c.criado_em, anonimizado: c.anonimizado, vendedor_id: c.vendedor_id ?? null,
    autorizacoes: (c.consentimentos ?? []).filter((k) => k.status === "ativo").map((k) => k.tipo),
    optout: bloqueados.has(c.telefone),
  }));

  // filtro de autorização depois da leitura (consentimento é tabela filha)
  switch (f.autorizacao) {
    case "servico": case "eventos": case "marketing": return linhas.filter((l) => !l.optout && l.autorizacoes.includes(f.autorizacao!));
    case "nenhuma": return linhas.filter((l) => !l.optout && !l.autorizacoes.length);
    case "optout": return linhas.filter((l) => l.optout);
    default: return linhas;
  }
}

/** Ficha do cliente para o painel lateral (dados sensíveis sempre mascarados). */
export async function fichaCliente(u: Usuario, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const nucleo = await nucleoAplicado();
  const { data: c } = await db()
    .from("clientes")
    .select(`id, nome, telefone, email, cidade, origem, tags, ultimo_contato_em, criado_em, anonimizado${nucleo ? ", vendedor_id, cpf_cnpj, data_nascimento" : ""}`)
    .eq("id", id)
    .maybeSingle();
  if (!c) return null;
  const cli = c as unknown as {
    id: string; nome: string | null; telefone: string; email: string | null; cidade: string | null; origem: string; tags: string[];
    ultimo_contato_em: string | null; criado_em: string; anonimizado: boolean; vendedor_id?: string | null; cpf_cnpj?: string | null; data_nascimento?: string | null;
  };

  const [consent, opt, veiculos, agend, ops] = await Promise.all([
    db().from("consentimentos").select("tipo, status, origem, concedido_em, revogado_em").eq("cliente_id", id).order("concedido_em", { ascending: false }),
    db().from("optouts").select("criado_em, origem").in("telefone", variantesTelefone(cli.telefone)).order("criado_em", { ascending: false }).limit(1).maybeSingle(),
    db().from("veiculos").select("modelo, ano, placa, km_atual, proxima_revisao_em").eq("cliente_id", id),
    db().from("agendamentos").select("id, inicio, status, servicos!agendamentos_servico_id_fkey(nome)").eq("cliente_id", id).order("inicio", { ascending: false }).limit(6),
    nucleo
      ? db().from("vendas_oportunidades").select("id, veiculo_interesse, fechado_em, etapa:vendas_etapas(nome, tipo), funil:vendas_funis(chave, nome)").eq("cliente_id", id).in("unidade", u.unidades).order("criado_em", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);
  let vendedorNome: string | null = null;
  if (cli.vendedor_id) {
    const { data: v } = await db().from("usuarios").select("nome").eq("user_id", cli.vendedor_id).maybeSingle();
    vendedorNome = (v?.nome as string | undefined) ?? null;
  }
  return {
    cliente: { ...cli, telefone: mascararTelefone(cli.telefone), cpf_cnpj: mascararDocumento(cli.cpf_cnpj) || null },
    vendedorNome,
    consentimentos: consent.data ?? [],
    optout: opt.data ?? null,
    veiculos: veiculos.data ?? [],
    agendamentos: (agend.data ?? []) as unknown as { id: string; inicio: string; status: string; servicos: { nome: string } | null }[],
    oportunidades: (ops.data ?? []) as unknown as { id: string; veiculo_interesse: string | null; fechado_em: string | null; etapa: { nome: string; tipo: string } | null; funil: { chave: string; nome: string } | null }[],
  };
}
