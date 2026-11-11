import "server-only";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { janela24hAberta, dentroHorarioEnvio } from "@/lib/time";
import { variantesTelefone } from "@/lib/phone";
import { enviarTexto, enviarBotoes, enviarTemplate, type BotaoResposta } from "@/lib/whatsapp/client";
import { decidirEnvio, preencherCorpo, type Finalidade } from "./regras";

/**
 * PONTO ÚNICO de envio de WhatsApp. Nada sai do sistema sem passar aqui.
 */

type ClienteMin = { id: string; telefone: string; nome: string | null; ultimo_contato_em: string | null; anonimizado: boolean };

export type ResultadoNotificacao =
  | { ok: true; wamid: string; modo: "livre" | "template" }
  | { ok: false; motivo: string };

export type ContextoAtendimento = {
  id: string;
  mensagemId: string;
  conversaId: string;
  autorizar: () => Promise<boolean>;
};

const UUID_ATENDIMENTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidAtendimento = (v: unknown): v is string => typeof v === "string" && v.length === 36 && UUID_ATENDIMENTO.test(v);

async function possuiAtendimentoModular(clienteId: string): Promise<boolean> {
  const { count, error } = await db().from("atendimentos_modulares_ativos")
    .select("id", { count: "exact", head: true }).eq("cliente_id", clienteId);
  if (error || count === null || !Number.isSafeInteger(count) || count < 0) throw new Error("verificacao_atendimento_indisponivel");
  return count > 0;
}

async function botPodeResponder(clienteId: string): Promise<boolean> {
  const { data, error } = await db().from("conversas").select("status").eq("cliente_id", clienteId).maybeSingle();
  if (error || !data || !["bot", "humano", "encerrada"].includes(data.status)) throw new Error("verificacao_atendimento_indisponivel");
  return data.status !== "humano";
}

async function carregarCliente(clienteId: string): Promise<ClienteMin | null> {
  const { data } = await db()
    .from("clientes")
    .select("id, telefone, nome, ultimo_contato_em, anonimizado")
    .eq("id", clienteId)
    .maybeSingle();
  return data as ClienteMin | null;
}

/**
 * C7-004: falha ao consultar a lista de bloqueio NUNCA vira "não está bloqueado".
 * Lança erro (fail-closed) e quem chama bloqueia o envio.
 */
export async function estaOptout(telefone: string): Promise<boolean> {
  // mesmo celular com e sem o 9º dígito: opt-out vale para as duas formas (regra 3)
  const { count, error } = await db().from("optouts").select("id", { count: "exact", head: true }).in("telefone", variantesTelefone(telefone));
  if (error || count === null) throw new Error(`verificacao_optout_indisponivel: ${error?.message ?? "sem contagem"}`);
  return count > 0;
}

export async function consentimentosAtivos(clienteId: string): Promise<Finalidade[]> {
  const { data, error } = await db().from("consentimentos").select("tipo").eq("cliente_id", clienteId).eq("status", "ativo");
  if (error) throw new Error(`verificacao_consentimento_indisponivel: ${error.message}`);
  return (data ?? []).map((c) => c.tipo as Finalidade);
}

async function conversaDoCliente(clienteId: string): Promise<string> {
  const { data } = await db().from("conversas").select("id").eq("cliente_id", clienteId).maybeSingle();
  if (data) return data.id;
  const { data: nova, error } = await db().from("conversas").insert({ cliente_id: clienteId }).select("id").single();
  if (error) {
    // corrida: outra requisição criou primeiro
    const { data: existente } = await db().from("conversas").select("id").eq("cliente_id", clienteId).single();
    return existente!.id;
  }
  return nova.id;
}

export async function registrarSaida(args: {
  clienteId: string;
  autor: "bot" | "atendente" | "sistema";
  tipo: string;
  conteudo: string;
  wamid: string | null;
  status: "enviada" | "falhou" | "bloqueada";
  erro?: string | null;
  templateNome?: string | null;
  categoria?: string | null;
  campanhaId?: string | null;
  agendamentoId?: string | null;
  metadata?: Record<string, unknown>;
  contextoAtendimento?: Pick<ContextoAtendimento, "id" | "mensagemId" | "conversaId">;
}) {
  if (args.contextoAtendimento) {
    const ctx = args.contextoAtendimento;
    if (args.autor !== "atendente" || !uuidAtendimento(ctx.id) || !uuidAtendimento(ctx.mensagemId) || !uuidAtendimento(ctx.conversaId)) return false;
    try {
      // A reserva já contém corpo/classificação. Nunca restaura texto ou metadata
      // que uma redação LGPD possa ter removido durante o despacho.
      const { data, error } = await db().from("mensagens")
        .update({ wamid: args.wamid, status: args.status, erro: args.erro ?? null })
        .eq("id", ctx.mensagemId.toLowerCase()).eq("atendimento_id", ctx.id.toLowerCase())
        .eq("cliente_id", args.clienteId).eq("conversa_id", ctx.conversaId.toLowerCase())
        .eq("direcao", "saida").eq("autor", "atendente")
        .eq("status", "bloqueada").eq("erro", "envio_em_processamento")
        .select("id").maybeSingle();
      return !error && typeof data?.id === "string" && data.id.toLowerCase() === ctx.mensagemId.toLowerCase();
    } catch {
      return false;
    }
  }
  const conversaId = await conversaDoCliente(args.clienteId);
  await db().from("mensagens").insert({
    conversa_id: conversaId,
    cliente_id: args.clienteId,
    direcao: "saida",
    autor: args.autor,
    tipo: args.tipo,
    conteudo: args.conteudo,
    wamid: args.wamid,
    template_nome: args.templateNome ?? null,
    categoria_cobranca: args.categoria ?? null,
    status: args.status,
    erro: args.erro ?? null,
    campanha_id: args.campanhaId ?? null,
    agendamento_id: args.agendamentoId ?? null,
    metadata: args.metadata ?? {},
  });
  await db().from("conversas").update({ ultima_msg_em: new Date().toISOString() }).eq("id", conversaId);
}

/**
 * Resposta dentro da conversa (bot ou atendente). Exige janela de 24h aberta.
 * O cliente acabou de escrever, então para o bot a janela sempre está aberta.
 */
export async function responderLivre(args: {
  clienteId: string;
  texto: string;
  autor: "bot" | "atendente" | "sistema";
  botoes?: BotaoResposta[];
  metadata?: Record<string, unknown>;
  contextoAtendimento?: ContextoAtendimento;
}): Promise<ResultadoNotificacao> {
  const ctx = args.contextoAtendimento;
  if (ctx && (args.autor !== "atendente" || !uuidAtendimento(args.clienteId) ||
    !uuidAtendimento(ctx.id) || !uuidAtendimento(ctx.mensagemId) || !uuidAtendimento(ctx.conversaId) || typeof ctx.autorizar !== "function")) {
    return { ok: false, motivo: "contexto_atendimento_invalido" };
  }
  const cliente = await carregarCliente(args.clienteId);
  if (!cliente || cliente.anonimizado) return { ok: false, motivo: "cliente_indisponivel" };
  if (!janela24hAberta(cliente.ultimo_contato_em)) return { ok: false, motivo: "janela_24h_fechada" };

  try {
    if (args.autor === "atendente") {
      if (await estaOptout(cliente.telefone)) return { ok: false, motivo: "optout" };
      if (!ctx && await possuiAtendimentoModular(cliente.id)) return { ok: false, motivo: "atendimento_modular" };
    }
    if (args.autor === "bot" && !await botPodeResponder(cliente.id)) return { ok: false, motivo: "atendimento_humano" };
    // Ponto de autorização do despacho. Revogações anteriores recusam; após
    // este ponto não se promete cancelar uma requisição HTTP já em voo.
    if (ctx && !await ctx.autorizar()) return { ok: false, motivo: "atendimento_indisponivel" };
  } catch {
    return { ok: false, motivo: "verificacao_indisponivel" };
  }

  let r;
  try {
    r = args.botoes?.length
      ? await enviarBotoes(cliente.telefone, args.texto, args.botoes)
      : await enviarTexto(cliente.telefone, args.texto);
  } catch (erro) {
    if (ctx) return { ok: false, motivo: "envio_incerto" };
    throw erro;
  }
  // Sem recusa explícita da Meta, a rede pode ter perdido somente a resposta.
  // Mantém a reserva pendente; gravar "falhou" sugeriria um reenvio seguro.
  if (ctx && !r.ok && r.codigo === undefined) return { ok: false, motivo: "envio_incerto" };

  const persistiu = await registrarSaida({
    clienteId: cliente.id,
    autor: args.autor,
    tipo: args.botoes?.length ? "interactive" : "text",
    conteudo: args.texto,
    wamid: r.ok ? r.wamid : null,
    status: r.ok ? "enviada" : "falhou",
    erro: r.ok ? null : r.erro,
    metadata: args.metadata,
    contextoAtendimento: ctx,
  });
  if (ctx && persistiu !== true) return { ok: false, motivo: "envio_incerto" };
  return r.ok ? { ok: true, wamid: r.wamid, modo: "livre" } : { ok: false, motivo: r.erro };
}

/**
 * Notificação iniciada pelo sistema (confirmação, lembrete, convite, follow-up).
 * `uso` identifica o template (coluna templates.uso). `valores` preenche {{1}}..{{n}}.
 * `payloads`: um payload por botão quick_reply do template, na ordem.
 */
export async function notificar(args: {
  clienteId: string;
  uso: string;
  valores: string[];
  payloads?: string[];
  preferirLivre?: boolean;
  campanhaId?: string | null;
  agendamentoId?: string | null;
  ignorarHorario?: boolean;
}): Promise<ResultadoNotificacao> {
  const cfg = await getConfig();
  const cliente = await carregarCliente(args.clienteId);
  if (!cliente) return { ok: false, motivo: "cliente_inexistente" };

  if (args.uso === "retomada_atendimento") {
    try {
      if (await possuiAtendimentoModular(cliente.id)) return { ok: false, motivo: "atendimento_modular" };
    } catch {
      return { ok: false, motivo: "verificacao_indisponivel" };
    }
  }

  const { data: tpl } = await db()
    .from("templates")
    .select("nome, idioma, categoria_meta, finalidade, corpo_exemplo, botoes, status_aprovacao, ativo")
    .eq("uso", args.uso)
    .eq("ativo", true)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  // C7-004: sem conseguir verificar opt-out/consentimento, não envia (tenta de novo na próxima execução)
  let optout: boolean;
  let consentimentos: Finalidade[];
  try {
    [optout, consentimentos] = await Promise.all([estaOptout(cliente.telefone), consentimentosAtivos(cliente.id)]);
  } catch (e) {
    console.error("[outbound] verificação indisponível", e instanceof Error ? e.message : e);
    return { ok: false, motivo: "verificacao_indisponivel" };
  }

  const decisao = decidirEnvio({
    clienteAnonimizado: cliente.anonimizado,
    optout,
    template: tpl
      ? { aprovado: tpl.status_aprovacao === "aprovado", ativo: tpl.ativo, finalidade: tpl.finalidade, categoria: tpl.categoria_meta }
      : null,
    consentimentos,
    janelaAberta: janela24hAberta(cliente.ultimo_contato_em),
    dentroHorario: dentroHorarioEnvio(new Date(), cfg.horario_envio, cfg.fuso_offset),
    preferirLivre: args.preferirLivre ?? true,
    ignorarHorario: args.ignorarHorario,
  });

  const corpo = tpl ? preencherCorpo(tpl.corpo_exemplo, args.valores) : args.valores.join(" ");

  if (decisao.acao === "bloquear") {
    await registrarSaida({
      clienteId: cliente.id,
      autor: "sistema",
      tipo: "template",
      conteudo: corpo,
      wamid: null,
      status: "bloqueada",
      erro: decisao.motivo,
      templateNome: tpl?.nome ?? null,
      campanhaId: args.campanhaId,
      agendamentoId: args.agendamentoId,
    });
    return { ok: false, motivo: decisao.motivo };
  }

  const botoesTpl = (tpl?.botoes ?? []) as { tipo: string; texto: string; payload_prefixo: string }[];

  if (decisao.acao === "livre") {
    const botoes = botoesTpl.slice(0, 3).map((b, i) => ({ id: args.payloads?.[i] ?? b.payload_prefixo, titulo: b.texto }));
    const r = botoes.length ? await enviarBotoes(cliente.telefone, corpo, botoes) : await enviarTexto(cliente.telefone, corpo);
    await registrarSaida({
      clienteId: cliente.id,
      autor: "sistema",
      tipo: botoes.length ? "interactive" : "text",
      conteudo: corpo,
      wamid: r.ok ? r.wamid : null,
      status: r.ok ? "enviada" : "falhou",
      erro: r.ok ? null : r.erro,
      campanhaId: args.campanhaId,
      agendamentoId: args.agendamentoId,
      metadata: { uso: args.uso },
    });
    return r.ok ? { ok: true, wamid: r.wamid, modo: "livre" } : { ok: false, motivo: r.erro };
  }

  const r = await enviarTemplate(
    cliente.telefone,
    tpl!.nome,
    tpl!.idioma,
    args.valores.map((texto) => ({ texto })),
    botoesTpl.map((b, i) => ({ indice: i, payload: args.payloads?.[i] ?? b.payload_prefixo })),
  );
  await registrarSaida({
    clienteId: cliente.id,
    autor: "sistema",
    tipo: "template",
    conteudo: corpo,
    wamid: r.ok ? r.wamid : null,
    status: r.ok ? "enviada" : "falhou",
    erro: r.ok ? null : r.erro,
    templateNome: tpl!.nome,
    categoria: tpl!.categoria_meta,
    campanhaId: args.campanhaId,
    agendamentoId: args.agendamentoId,
    metadata: { uso: args.uso },
  });
  return r.ok ? { ok: true, wamid: r.wamid, modo: "template" } : { ok: false, motivo: r.erro };
}
