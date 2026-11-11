import "server-only";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import { mascararTelefone } from "@/lib/phone";
import { nucleoAplicado } from "@/lib/usuarios";
import type { Usuario } from "@/lib/auth";
import { veTodasOportunidades } from "./regras";
import { classificarAniversario, aniversarioMaisProximo, idadeNoAniversario, ordenarAniversarios, ANTECEDENCIA_PADRAO, type EstadoAniversario } from "./aniversarios";

/** F5 — aniversários da carteira (vendedor) ou de todas as carteiras (gerente/admin). */

export type Aniversariante = {
  clienteId: string; nome: string; telefone: string; vendedor: string | null; vendedorId: string | null;
  estado: EstadoAniversario; dias: number; data: string; idade: number | null; lembreteAtivo: boolean;
};

export async function listarAniversarios(u: Usuario, hojeISO: string, antecedencia = ANTECEDENCIA_PADRAO): Promise<Aniversariante[]> {
  if (!(await nucleoAplicado())) return [];
  let q = db().from("clientes").select("id, nome, telefone, data_nascimento, vendedor_id").not("data_nascimento", "is", null).eq("anonimizado", false).limit(5000);
  if (!veTodasOportunidades(u)) q = q.eq("vendedor_id", u.id);
  const { data } = await q;
  // janela primeiro (sem consultar contato de quem está longe do aniversário)
  const naJanela = ((data ?? []) as { id: string; nome: string | null; telefone: string; data_nascimento: string; vendedor_id: string | null }[])
    .map((c) => ({ c, a: aniversarioMaisProximo(c.data_nascimento, hojeISO) }))
    .filter((x) => x.a && Math.abs(x.a.dias) <= antecedencia);
  if (!naJanela.length) return [];

  const ids = naJanela.map((x) => x.c.id);
  const desdeMaisAntigo = naJanela.map((x) => x.a!.data).sort()[0];
  const [lemb, ops, msgs, vend] = await Promise.all([
    db().from("lembretes").select("cliente_id, data_alvo, concluido_em, insistente, usuario_id").eq("tipo", "aniversario").in("cliente_id", ids),
    db().from("vendas_oportunidades").select("id, cliente_id").in("cliente_id", ids),
    db().from("mensagens").select("cliente_id, criado_em").in("cliente_id", ids).eq("direcao", "saida").eq("autor", "atendente").gte("criado_em", desdeMaisAntigo),
    db().from("usuarios").select("user_id, nome"),
  ]);
  const opsPorCliente = new Map<string, string[]>();
  for (const o of ops.data ?? []) opsPorCliente.set(o.cliente_id as string, [...(opsPorCliente.get(o.cliente_id as string) ?? []), o.id as string]);
  const todasOps = (ops.data ?? []).map((o) => o.id as string);
  const { data: ativ } = todasOps.length
    ? await db().from("vendas_atividades").select("oportunidade_id, criado_em").in("oportunidade_id", todasOps).gte("criado_em", desdeMaisAntigo)
    : { data: [] as { oportunidade_id: string; criado_em: string }[] };
  const nomeVend = new Map((vend.data ?? []).map((v) => [v.user_id as string, v.nome as string]));

  const lista = naJanela.map(({ c, a }) => {
    const desde = a!.data;
    const lembretesDele = (lemb.data ?? []).filter((l) => l.cliente_id === c.id && l.data_alvo === desde);
    const contato =
      lembretesDele.some((l) => l.concluido_em) ||
      (msgs.data ?? []).some((m) => m.cliente_id === c.id && (m.criado_em as string).slice(0, 10) >= desde) ||
      (ativ ?? []).some((x) => (opsPorCliente.get(c.id) ?? []).includes(x.oportunidade_id as string) && (x.criado_em as string).slice(0, 10) >= desde);
    const k = classificarAniversario(c.data_nascimento, hojeISO, contato, antecedencia)!;
    return {
      clienteId: c.id, nome: c.nome ?? "Cliente", telefone: mascararTelefone(c.telefone),
      vendedor: c.vendedor_id ? nomeVend.get(c.vendedor_id) ?? null : null, vendedorId: c.vendedor_id,
      estado: k.estado, dias: k.dias, data: k.data, idade: idadeNoAniversario(c.data_nascimento, k.data),
      lembreteAtivo: lembretesDele.some((l) => l.insistente && !l.concluido_em && l.usuario_id === u.id),
    };
  });
  return ordenarAniversarios(lista);
}

async function podeNoCliente(u: Usuario, clienteId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(clienteId)) return null;
  const { data } = await db().from("clientes").select("id, nome, data_nascimento, vendedor_id, anonimizado").eq("id", clienteId).maybeSingle();
  if (!data || data.anonimizado || !data.data_nascimento) return null;
  if (!veTodasOportunidades(u) && data.vendedor_id !== u.id) return null; // vendedor só na própria carteira
  return data as { id: string; nome: string | null; data_nascimento: string; vendedor_id: string | null };
}

/** "Contato feito": encerra o lembrete (se houver) ou registra a conclusão, e deixa nota na ficha. */
export async function marcarContatoAniversario(u: Usuario, clienteId: string, hojeISO: string): Promise<{ ok: boolean; motivo?: string }> {
  const c = await podeNoCliente(u, clienteId);
  if (!c) return { ok: false, motivo: "Cliente fora da sua carteira" };
  const a = aniversarioMaisProximo(c.data_nascimento, hojeISO)!;
  const agora = new Date().toISOString();
  const { data: abertos } = await db().from("lembretes").update({ concluido_em: agora })
    .eq("cliente_id", c.id).eq("tipo", "aniversario").eq("data_alvo", a.data).is("concluido_em", null).select("id");
  if (!abertos?.length) {
    await db().from("lembretes").insert({ usuario_id: u.id, cliente_id: c.id, tipo: "aniversario", data_alvo: a.data, insistente: false, concluido_em: agora, observacao: "contato de aniversário" });
  }
  await db().from("notas_cliente").insert({ cliente_id: c.id, autor: u.email, texto: `Contato de aniversário feito (${a.data.split("-").reverse().join("/")}).` });
  await auditar(u.email, "aniversario_contato", "cliente", c.id);
  return { ok: true };
}

/** Lembrete insistente: aparece toda vez que a pessoa abre o painel, até marcar "contato feito". */
export async function ativarLembreteAniversario(u: Usuario, clienteId: string, hojeISO: string): Promise<{ ok: boolean; motivo?: string }> {
  const c = await podeNoCliente(u, clienteId);
  if (!c) return { ok: false, motivo: "Cliente fora da sua carteira" };
  const a = aniversarioMaisProximo(c.data_nascimento, hojeISO)!;
  const { data: ja } = await db().from("lembretes").select("id").eq("cliente_id", c.id).eq("usuario_id", u.id).eq("tipo", "aniversario").eq("data_alvo", a.data).is("concluido_em", null).limit(1);
  if (ja?.length) return { ok: true };
  const { error } = await db().from("lembretes").insert({
    usuario_id: u.id, cliente_id: c.id, tipo: "aniversario", data_alvo: a.data, insistente: true, unidade: u.unidade,
    observacao: `Aniversário de ${c.nome ?? "cliente"}`,
  });
  return error ? { ok: false, motivo: "Não foi possível ativar o lembrete" } : { ok: true };
}

/** Pop-up insistente: lembretes de aniversário em aberto do usuário, dentro da janela. */
export async function lembretesInsistentes(u: Usuario, hojeISO: string, antecedencia = ANTECEDENCIA_PADRAO) {
  if (!(await nucleoAplicado())) return [];
  const de = new Date(Date.parse(hojeISO) - antecedencia * 86_400_000).toISOString().slice(0, 10);
  const ate = new Date(Date.parse(hojeISO) + antecedencia * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db().from("lembretes").select("id, cliente_id, data_alvo, cliente:clientes(nome)")
    .eq("usuario_id", u.id).eq("tipo", "aniversario").eq("insistente", true).is("concluido_em", null).gte("data_alvo", de).lte("data_alvo", ate).limit(20);
  return ((data ?? []) as unknown as { id: string; cliente_id: string; data_alvo: string; cliente: { nome: string | null } | null }[]).map((l) => ({
    id: l.id, clienteId: l.cliente_id, nome: l.cliente?.nome ?? "Cliente",
    dias: Math.round((Date.parse(l.data_alvo) - Date.parse(hojeISO)) / 86_400_000),
  }));
}
