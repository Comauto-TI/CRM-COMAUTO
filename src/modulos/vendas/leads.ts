import "server-only";
import { db } from "@/lib/supabase/admin";
import { auditar } from "@/lib/audit";
import { notificar } from "@/lib/notificacoes";
import { nucleoAplicado } from "@/lib/usuarios";
import { registrarCotacaoDoBot } from "@/modulos/pecas/cotacoes";
import { destinoDoLead, escolherVendedor, temperaturaInicial, completarQualificacao, type Interesse, type Pagamento, type Prazo } from "./regras";

/**
 * F2-1 — o assistente do WhatsApp qualifica o interesse e o lead entra no CRM.
 * Regras:
 *  - nunca duplica: se o cliente já tem oportunidade ABERTA no funil, atualiza a qualificação;
 *  - "confirmado pelo cliente" só quando o próprio cliente confirmou os dados na conversa; senão "a verificar";
 *  - dono = vendedor da carteira do cliente; senão rodízio entre vendedores ativos da unidade;
 *  - devolve ao agente só o necessário para responder (nenhum nome de funcionário ou dado interno).
 */

export type DadosLead = {
  clienteId: string;
  interesse: Interesse;
  modelo: string | null;
  pagamento: Pagamento;
  prazo: Prazo;
  temTroca: boolean | null;
  trocaDescricao: string | null;
  resumo: string;
  clienteConfirmou: boolean;
  /** wamid da mensagem: referência estável (a mesma mensagem nunca cria duas cotações de peças). */
  referencia?: string | null;
};

export type ResultadoLead =
  | { ok: true; destino: "vendas"; novo: boolean }
  | { ok: true; destino: "agenda" | "pecas" | "triagem" }
  | { ok: false; motivo: string };

async function unidadeDoCliente(clienteId: string): Promise<string> {
  const { data } = await db().from("conversas").select("unidade").eq("cliente_id", clienteId).maybeSingle();
  return (data?.unidade as string | undefined) ?? "comauto";
}

type Aviso = { tipo: "lead" | "pecas"; titulo: string; corpo: string; link: string };

/**
 * Avisa a equipe certa (notificação + pop-up no painel). Recebe quem tem um dos PAPÉIS (em qualquer setor)
 * ou é GERENTE do setor indicado. Ninguém recebeu → avisa os administradores (lead nunca fica sem dono).
 */
async function avisarEquipe(unidade: string, filtro: { papeis: string[]; gerenteDoSetor?: string }, aviso: Aviso): Promise<number> {
  const partes = [
    ...(filtro.papeis.length ? [`papel.in.(${filtro.papeis.join(",")})`] : []),
    ...(filtro.gerenteDoSetor ? [`and(papel.eq.gerente,setor.eq.${filtro.gerenteDoSetor})`] : []),
  ];
  const { data } = partes.length
    ? await db().from("usuarios").select("user_id").eq("ativo", true).eq("unidade", unidade).or(partes.join(","))
    : { data: [] };
  let enviados = 0;
  for (const p of data ?? []) if (await notificar(p.user_id as string, { ...aviso, unidade })) enviados++;
  if (!enviados && !filtro.papeis.includes("admin")) return avisarEquipe(unidade, { papeis: ["admin"] }, aviso);
  return enviados;
}

async function escolherDono(unidade: string, carteira: string | null): Promise<string | null> {
  const { data: vendedores } = await db().from("usuarios").select("user_id").eq("ativo", true).eq("unidade", unidade).eq("papel", "vendedor");
  const ids = (vendedores ?? []).map((v) => v.user_id as string);
  if (!ids.length) return null;
  const { data: abertas } = await db().from("vendas_oportunidades").select("vendedor_id, criado_em").in("vendedor_id", ids).is("fechado_em", null);
  const carga = ids.map((id) => {
    const minhas = (abertas ?? []).filter((o) => o.vendedor_id === id);
    const ultimo = minhas.map((o) => o.criado_em as string).sort().at(-1) ?? null;
    return { id, abertas: minhas.length, ultimoLeadEm: ultimo };
  });
  return escolherVendedor(carteira, carga);
}

export async function rotearLead(d: DadosLead): Promise<ResultadoLead> {
  const destino = destinoDoLead(d.interesse);
  if (destino.tipo === "agenda") return { ok: true, destino: "agenda" };
  if (!(await nucleoAplicado())) return { ok: false, motivo: "crm_indisponivel" };

  const unidade = await unidadeDoCliente(d.clienteId);
  const { data: cliente } = await db()
    .from("clientes")
    .select("id, nome, vendedor_id, anonimizado, link_origem_id, links_rastreados(codigo, canal)")
    .eq("id", d.clienteId)
    .maybeSingle();
  if (!cliente || cliente.anonimizado) return { ok: false, motivo: "cliente_indisponivel" };
  const nome = (cliente.nome as string | null) ?? "Cliente";
  const resumo = d.resumo.slice(0, 300);

  // Peças: o pedido entra na FILA DE COTAÇÕES do setor (módulo do Codex), sem duplicar pela mesma mensagem.
  let cotacaoId: string | null = null;
  if (destino.tipo === "pecas") {
    const r = await registrarCotacaoDoBot({
      clienteId: d.clienteId,
      unidade,
      referencia: d.referencia || `bot:${d.clienteId}:${new Date().toISOString().slice(0, 16)}`,
      descricao: resumo.slice(0, 1000),
    });
    if (r.ok) cotacaoId = r.id; // se a fila ainda não existir no banco, cai no aviso + nota abaixo
  }

  if (destino.tipo === "pecas" || destino.tipo === "triagem") {
    // F2-1-001: encaminhamento é INTERNO — nota na ficha + aviso à equipe. Nunca vira follow-up
    // (o cron de follow-up manda template de marketing ao cliente; o resumo é texto interno).
    await db().from("notas_cliente").insert({
      cliente_id: d.clienteId,
      autor: "assistente",
      texto: `[${destino.tipo === "pecas" ? "Peças" : "Triagem"}] ${resumo}`.slice(0, 500),
    });
    await avisarEquipe(
      unidade,
      destino.tipo === "pecas" ? { papeis: ["pecas"], gerenteDoSetor: "pecas" } : { papeis: ["recepcao", "atendente"] },
      {
        tipo: destino.tipo === "pecas" ? "pecas" : "lead",
        titulo: destino.tipo === "pecas" ? `Pedido de peças pelo WhatsApp: ${nome}` : `Lead para triagem: ${nome}`,
        corpo: resumo,
        link: cotacaoId ? `/painel/pecas/${cotacaoId}` : `/painel/clientes?q=${encodeURIComponent(nome)}`,
      },
    );
    return { ok: true, destino: destino.tipo };
  }

  // ---- Vendas: cartão no funil certo ----
  const { data: funil } = await db().from("vendas_funis").select("id, chave").eq("unidade", unidade).eq("chave", destino.funil).eq("ativo", true).maybeSingle();
  if (!funil) return { ok: false, motivo: "funil_inexistente" };

  const link = Array.isArray(cliente.links_rastreados) ? cliente.links_rastreados[0] : cliente.links_rastreados;
  const origem = link ? (link.canal === "evento" ? "evento" : "qr") : "whatsapp";
  const qualificacao = d.clienteConfirmou ? "confirmado_cliente" : "a_verificar";
  const campos = {
    veiculo_interesse: d.modelo?.slice(0, 120) || null,
    pagamento: d.pagamento,
    prazo_compra: d.prazo,
    tem_troca: d.temTroca ?? false,
    troca_descricao: d.temTroca ? d.trocaDescricao?.slice(0, 300) || null : null,
    qualificacao,
  };

  const { data: existente } = await db()
    .from("vendas_oportunidades")
    .select("id, vendedor_id, veiculo_interesse, qualificacao")
    .eq("cliente_id", d.clienteId)
    .eq("funil_id", funil.id)
    .is("fechado_em", null)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existente) {
    // não apaga nem rebaixa o que já existe: só completa com o que a conversa trouxe de concreto
    const patch: Record<string, unknown> = { atualizado_por: "assistente", ...completarQualificacao(existente.qualificacao as string, campos, d) };
    await db().from("vendas_oportunidades").update(patch).eq("id", existente.id);
    await db().from("vendas_atividades").insert({ oportunidade_id: existente.id, tipo: "whatsapp", descricao: `Assistente atualizou o interesse: ${resumo}`, ator: "assistente" });
    if (existente.vendedor_id) {
      await notificar(existente.vendedor_id, { tipo: "lead", titulo: `${nome} voltou a falar no WhatsApp`, corpo: resumo, link: `/painel/vendas?funil=${funil.chave}&op=${existente.id}`, unidade });
    }
    await auditar("assistente", "atualizar_lead", "vendas_oportunidades", existente.id, { interesse: d.interesse });
    return { ok: true, destino: "vendas", novo: false };
  }

  const primeira = await db().from("vendas_etapas").select("id").eq("funil_id", funil.id).eq("tipo", "aberta").eq("ativo", true).order("ordem").limit(1).maybeSingle();
  if (!primeira.data) return { ok: false, motivo: "funil_sem_etapas" };
  const dono = await escolherDono(unidade, (cliente.vendedor_id as string | null) ?? null);

  const { data: op, error } = await db()
    .from("vendas_oportunidades")
    .insert({
      unidade,
      funil_id: funil.id,
      etapa_id: primeira.data.id,
      cliente_id: d.clienteId,
      vendedor_id: dono,
      ...campos,
      temperatura: temperaturaInicial(d.prazo, d.pagamento !== "indefinido"),
      origem,
      origem_ref: link?.codigo ?? null,
      observacoes: resumo,
      posicao: Date.now() / 1000,
      criado_por: "assistente",
    })
    .select("id")
    .single();
  if (error || !op) return { ok: false, motivo: "falha_ao_criar" };

  await db().from("vendas_atividades").insert({ oportunidade_id: op.id, tipo: "whatsapp", descricao: `Lead qualificado pelo assistente: ${resumo}`, ator: "assistente" });
  // carteira: cliente sem vendedor passa a ser do vendedor que recebeu o lead
  if (dono && !cliente.vendedor_id) await db().from("clientes").update({ vendedor_id: dono }).eq("id", d.clienteId).is("vendedor_id", null);

  const aviso = { tipo: "lead" as const, titulo: `Novo lead (${funil.chave === "novos" ? "Novos" : "Seminovos"}): ${nome}`, corpo: resumo, link: `/painel/vendas?funil=${funil.chave}&op=${op.id}` };
  if (dono) await notificar(dono, { ...aviso, unidade });
  else {
    // sem vendedor ativo: gerente de vendas distribui (se não houver, o admin)
    await avisarEquipe(unidade, { papeis: [], gerenteDoSetor: "vendas" }, aviso);
  }

  await auditar("assistente", "criar_lead", "vendas_oportunidades", op.id, { interesse: d.interesse, origem, com_dono: !!dono });
  return { ok: true, destino: "vendas", novo: true };
}
