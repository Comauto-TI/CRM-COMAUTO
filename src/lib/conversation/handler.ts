import "server-only";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { valoresSecretos } from "@/lib/env";
import { formatarDataHora } from "@/lib/time";
import { normalizarTelefone } from "@/lib/phone";
import { marcarComoLida } from "@/lib/whatsapp/client";
import type { MensagemRecebida, StatusRecebido } from "@/lib/whatsapp/webhook";
import { verificarEntrada, mensagemRecusa, filtrarSaida, mascararDadosSensiveis } from "@/lib/security/guard";
import { detectarOptout, pediuAtendente, pedidoLGPD } from "@/lib/security/optout";
import { responderLivre, consentimentosAtivos } from "@/lib/messaging/outbound";
import { aplicarOptout } from "@/lib/consent";
import { transferirParaHumano } from "@/lib/handoff";
import { confirmarAgendamento, cancelarAgendamento, agendamentosDoCliente } from "@/lib/scheduling/booking";
import { registrarEventoSeguranca } from "@/lib/audit";
import { lancarCustoMeta } from "@/lib/costs";
import { verificarPausaCampanha } from "@/lib/campaigns";
import { rodarAgente, type MensagemHistorico } from "@/lib/agent/run";
import { extrairCodigo, removerCodigo } from "@/lib/links";
import { vincularLink } from "@/lib/links-db";
import { buscarClientePorTelefone } from "@/lib/clientes-telefone";

type Cliente = { id: string; telefone: string; nome: string | null };

const MSG_OPTOUT = "Entendido. Registramos seu pedido para não receber mais mensagens pelo WhatsApp. Seu número foi removido das próximas comunicações.";
const MSG_SO_TEXTO = "Por aqui eu consigo ler apenas mensagens de texto. Pode escrever, por favor? Se preferir, digite *ATENDENTE* para falar com nossa equipe.";
const MSG_FALHA = "Desculpe, tive uma instabilidade agora. Já chamei alguém da nossa equipe para continuar com você.";

async function upsertCliente(telefone: string, nomePerfil: string | null, quando: Date): Promise<Cliente> {
  // Ficha única: o mesmo celular pode estar salvo com/sem o 9º dígito. Se já existe, atualiza a ficha antiga
  // e passa a guardar o número que o WhatsApp usa agora (é para ele que as respostas vão).
  const existente = await buscarClientePorTelefone<{ nome: string | null }>(telefone, "nome");
  if (existente && existente.telefone !== telefone) {
    const { data: atualizado, error: errAtual } = await db()
      .from("clientes")
      .update({ telefone, ultimo_contato_em: quando.toISOString() })
      .eq("id", existente.id)
      .select("id, telefone, nome")
      .single();
    if (!errAtual && atualizado) {
      if (!atualizado.nome && nomePerfil) {
        await db().from("clientes").update({ nome: nomePerfil.slice(0, 80) }).eq("id", atualizado.id);
        atualizado.nome = nomePerfil;
      }
      return atualizado as Cliente;
    }
    // F0-TEL-001: há DUAS fichas legadas (uma por formato) e a troca colidiu. A identidade continua sendo a
    // ficha mais antiga — só atualiza o último contato; juntar as duplicatas é tarefa da ferramenta de mesclagem.
    const { data: antiga } = await db()
      .from("clientes")
      .update({ ultimo_contato_em: quando.toISOString() })
      .eq("id", existente.id)
      .select("id, telefone, nome")
      .single();
    if (antiga) return antiga as Cliente;
  }
  const { data, error } = await db()
    .from("clientes")
    .upsert({ telefone, ultimo_contato_em: quando.toISOString() }, { onConflict: "telefone" })
    .select("id, telefone, nome")
    .single();
  if (error) throw error;
  if (!data.nome && nomePerfil) {
    await db().from("clientes").update({ nome: nomePerfil.slice(0, 80) }).eq("id", data.id);
    data.nome = nomePerfil;
  }
  return data as Cliente;
}

async function conversa(clienteId: string) {
  const { data } = await db().from("conversas").select("id, status, falhas_entendimento, nao_lidas").eq("cliente_id", clienteId).maybeSingle();
  if (data) return data;
  const { data: nova } = await db().from("conversas").insert({ cliente_id: clienteId }).select("id, status, falhas_entendimento, nao_lidas").single();
  return nova!;
}

async function excedeuLimite(clienteId: string, cfg: Awaited<ReturnType<typeof getConfig>>): Promise<boolean> {
  const umMin = new Date(Date.now() - 60_000).toISOString();
  const umDia = new Date(Date.now() - 86400_000).toISOString();
  const [{ count: porMin }, { count: porDia }] = await Promise.all([
    db().from("mensagens").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId).eq("direcao", "entrada").gte("criado_em", umMin),
    db().from("mensagens").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId).eq("direcao", "entrada").gte("criado_em", umDia),
  ]);
  return (porMin ?? 0) > cfg.seguranca.max_msgs_por_minuto || (porDia ?? 0) > cfg.seguranca.max_msgs_por_dia;
}

async function historico(conversaId: string, limite: number, excluirWamid: string): Promise<MensagemHistorico[]> {
  const { data } = await db()
    .from("mensagens")
    .select("direcao, autor, conteudo, wamid, status")
    .eq("conversa_id", conversaId)
    .in("status", ["recebida", "enviada", "entregue", "lida"])
    .order("criado_em", { ascending: false })
    .limit(limite + 1);
  return (data ?? [])
    .filter((m) => m.wamid !== excluirWamid && m.conteudo)
    .reverse()
    .map((m) => ({
      papel: m.direcao === "entrada" ? ("cliente" as const) : ("assistente" as const),
      texto: m.autor === "atendente" ? `[mensagem da recepção] ${m.conteudo}` : (m.conteudo as string),
    }));
}

/** Botões tocados pelo cliente — tratamento determinístico, sem IA. Retorna texto para o agente, se for o caso. */
async function tratarBotao(payload: string, cliente: Cliente): Promise<{ textoParaAgente?: string; tratado: boolean }> {
  const [acao, id] = payload.split(":");
  const cfg = await getConfig();

  const agendamentoAlvo = async () => {
    if (id) {
      const { data } = await db().from("agendamentos").select("id").eq("id", id).eq("cliente_id", cliente.id).maybeSingle();
      return data?.id ?? null;
    }
    return (await agendamentosDoCliente(cliente.id))[0]?.id ?? null;
  };

  switch (acao) {
    case "AG_CONF": {
      const agId = await agendamentoAlvo();
      if (!agId) return { tratado: false, textoParaAgente: "Quero confirmar meu agendamento" };
      await confirmarAgendamento(agId, cliente.telefone, "whatsapp_botao", `cliente:${cliente.telefone}`);
      await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: "Presença confirmada! ✅ Te esperamos. Se precisar alterar, é só responder aqui." });
      return { tratado: true };
    }
    case "AG_CANC": {
      const agId = await agendamentoAlvo();
      if (!agId) return { tratado: false, textoParaAgente: "Quero cancelar meu agendamento" };
      await responderLivre({
        clienteId: cliente.id,
        autor: "sistema",
        texto: "Quer mesmo cancelar o agendamento?",
        botoes: [
          { id: `AG_CANC_OK:${agId}`, titulo: "Sim, cancelar" },
          { id: `AG_REM:${agId}`, titulo: "Prefiro remarcar" },
          { id: "NADA", titulo: "Manter" },
        ],
      });
      return { tratado: true };
    }
    case "AG_CANC_OK": {
      const agId = await agendamentoAlvo();
      if (agId) await cancelarAgendamento(agId, "cancelado pelo cliente (botão)", `cliente:${cliente.telefone}`);
      await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: "Agendamento cancelado. Quando quiser remarcar, é só me chamar por aqui." });
      return { tratado: true };
    }
    case "AG_REM":
      return { tratado: false, textoParaAgente: "Quero remarcar meu agendamento para outro horário." };
    case "EV_CONF": {
      if (!id) return { tratado: false, textoParaAgente: "Quero confirmar presença no evento" };
      const { data } = await db().rpc("confirmar_inscricao", { p_evento: id, p_cliente: cliente.id, p_por: cliente.telefone });
      const { data: ev } = await db().from("eventos").select("nome, inicio, local").eq("id", id).maybeSingle();
      const texto =
        data === "confirmado" && ev
          ? `Presença confirmada em *${ev.nome}*! 🎉 ${formatarDataHora(ev.inicio, cfg.fuso_offset)}, no ${ev.local}. Até lá!`
          : data === "esgotado" && ev
            ? `Obrigado pelo interesse em ${ev.nome}. As vagas já foram preenchidas, mas você ficou na nossa lista de espera e avisamos se abrir vaga.`
            : "Esse evento não está mais disponível para confirmação. Posso ajudar com outra coisa?";
      await responderLivre({ clienteId: cliente.id, autor: "sistema", texto });
      await db().from("campanha_envios").update({ status: "respondido", respondido_em: new Date().toISOString() }).eq("cliente_id", cliente.id).in("status", ["enviado", "entregue", "lido"]);
      return { tratado: true };
    }
    case "EV_REC": {
      if (id) {
        await db()
          .from("inscricoes_evento")
          .upsert({ evento_id: id, cliente_id: cliente.id, status: "recusado", origem: "whatsapp" }, { onConflict: "evento_id,cliente_id" });
      }
      await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: "Sem problemas, obrigado por avisar! Se mudar de ideia, é só responder aqui." });
      return { tratado: true };
    }
    case "LEAD_AGENDAR":
      return { tratado: false, textoParaAgente: "Quero agendar um horário." };
    case "OPT_SAIR":
      await aplicarOptout(cliente.id, cliente.telefone, "CANCELAR (confirmado no botão)");
      await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: MSG_OPTOUT });
      return { tratado: true };
    case "OPT_CANC_AG":
      return { tratado: false, textoParaAgente: "Quero cancelar meu agendamento." };
    case "NADA":
      await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: "Combinado, mantive tudo como estava. 👍" });
      return { tratado: true };
    default:
      return { tratado: false };
  }
}

/** Atualiza o estado de processamento guardado em mensagens.metadata (sem migration). */
async function marcarEstado(mensagemId: string, patch: Record<string, unknown>) {
  const { data } = await db().from("mensagens").select("metadata").eq("id", mensagemId).single();
  await db().from("mensagens").update({ metadata: { ...((data?.metadata as Record<string, unknown>) ?? {}), ...patch } }).eq("id", mensagemId);
}

const RETOMAR_APOS_MS = 2 * 60_000;
const MAX_TENTATIVAS = 2;

/**
 * C7-005: a mensagem só conta como tratada quando o processamento TERMINA (metadata.processada_em).
 * Reentrega da Meta ou o cron de retomada reprocessam uma mensagem gravada que ficou pela metade
 * (após 2 min, no máximo 2 tentativas) — nada se perde em silêncio.
 */
export async function processarMensagem(m: MensagemRecebida) {
  const cfg = await getConfig();
  const telefone = normalizarTelefone(m.de) ?? m.de.replace(/\D/g, "");
  if (!telefone || !m.wamid) return;

  const { data: existente } = await db().from("mensagens").select("id, metadata, criado_em").eq("wamid", m.wamid).maybeSingle();
  if (existente) {
    const meta = (existente.metadata ?? {}) as Record<string, unknown>;
    if (meta.processada_em) return; // já concluída
    const idade = Date.now() - new Date(existente.criado_em).getTime();
    if (idade < RETOMAR_APOS_MS || Number(meta.tentativas ?? 0) >= MAX_TENTATIVAS) return; // em andamento agora, ou já desistiu
  }

  const cliente = await upsertCliente(telefone, m.nomePerfil, m.timestamp);
  const conv = await conversa(cliente.id);

  const textoOriginal = (m.texto ?? "").slice(0, cfg.seguranca.max_chars_entrada);
  const mascarado = mascararDadosSensiveis(textoOriginal);
  const mascarou = mascarado.mascarou;
  let textoSeguro = mascarado.texto;

  let mensagemId = existente?.id as string | undefined;
  if (!mensagemId) {
    const { data: nova, error: errIns } = await db()
      .from("mensagens")
      .insert({
        conversa_id: conv.id,
        cliente_id: cliente.id,
        direcao: "entrada",
        autor: "cliente",
        tipo: m.tipo,
        conteudo: textoSeguro || `[${m.tipo}]`,
        wamid: m.wamid,
        status: "recebida",
        metadata: { ...(m.payloadBotao ? { payload: m.payloadBotao } : {}), tentativas: 1 },
      })
      .select("id")
      .single();
    if (errIns || !nova) return; // conflito de wamid = outra execução gravou primeiro
    mensagemId = nova.id as string;
    await db().from("conversas").update({ ultima_msg_em: new Date().toISOString(), nao_lidas: (conv.nao_lidas ?? 0) + 1 }).eq("id", conv.id);
    void marcarComoLida(m.wamid);
  } else {
    await marcarEstado(mensagemId, { tentativas: Number(((existente!.metadata ?? {}) as Record<string, unknown>).tentativas ?? 1) + 1, retomada_em: new Date().toISOString() });
  }

  try {
    await tratarMensagem({ m, cfg, telefone, cliente, conv, textoSeguro, mascarou, setTexto: (t) => (textoSeguro = t) });
    await marcarEstado(mensagemId, { processada_em: new Date().toISOString() });
  } catch (e) {
    await marcarEstado(mensagemId, { ultimo_erro: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).catch(() => undefined);
    throw e;
  }
}

/** Cron: retoma mensagens recebidas que ficaram sem processamento concluído (C7-005). */
export async function retomarMensagensPendentes() {
  const { data } = await db()
    .from("mensagens")
    .select("wamid, tipo, conteudo, metadata, criado_em, clientes(telefone, nome)")
    .eq("direcao", "entrada")
    .not("wamid", "is", null)
    .is("metadata->>processada_em", null)
    .gte("criado_em", new Date(Date.now() - 3600_000).toISOString())
    .lte("criado_em", new Date(Date.now() - RETOMAR_APOS_MS).toISOString())
    .limit(20);
  let retomadas = 0;
  for (const r of (data ?? []) as unknown as { wamid: string; tipo: string; conteudo: string | null; metadata: Record<string, unknown> | null; criado_em: string; clientes: { telefone: string; nome: string | null } | null }[]) {
    if (!r.clientes?.telefone || Number(r.metadata?.tentativas ?? 0) >= MAX_TENTATIVAS) continue;
    const texto = r.conteudo && !/^\[[a-z_]+\]$/.test(r.conteudo) ? r.conteudo : null;
    await processarMensagem({
      wamid: r.wamid,
      de: r.clientes.telefone,
      nomePerfil: r.clientes.nome,
      timestamp: new Date(r.criado_em),
      tipo: r.tipo,
      texto,
      payloadBotao: (r.metadata?.payload as string | undefined) ?? null,
      contexto: null,
    }).catch((e) => console.error("[retomada]", e instanceof Error ? e.message : e));
    retomadas++;
  }
  return { retomadas };
}

async function tratarMensagem(args: {
  m: MensagemRecebida;
  cfg: Awaited<ReturnType<typeof getConfig>>;
  telefone: string;
  cliente: Cliente;
  conv: { id: string; status: string; falhas_entendimento: number | null };
  textoSeguro: string;
  mascarou: boolean;
  setTexto: (t: string) => void;
}) {
  const { m, cfg, telefone, cliente, conv, mascarou } = args;
  let textoSeguro = args.textoSeguro;

  if (mascarou) {
    await registrarEventoSeguranca({ telefone, clienteId: cliente.id, tipo: "dados_sensiveis", trecho: textoSeguro, acao: "mascarado" });
  }

  // Veio de link/QR rastreado? Vincula a origem e tira o código antes dos filtros e da IA.
  const codigoLink = m.payloadBotao ? null : extrairCodigo(textoSeguro);
  if (codigoLink) {
    await vincularLink(codigoLink, cliente.id).catch(() => false);
    textoSeguro = removerCodigo(textoSeguro);
    args.setTexto(textoSeguro);
  }

  // C7-003: o opt-out vem ANTES do limite de mensagens — descadastro nunca pode ser engolido pelo rate limit.
  // 1) Opt-out tem prioridade sobre tudo (inclusive atendimento humano e limite de volume)
  if (!m.payloadBotao && textoSeguro) {
    const opt = detectarOptout(textoSeguro);
    if (opt === "optout") {
      await aplicarOptout(cliente.id, telefone, textoSeguro);
      await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: MSG_OPTOUT });
      return;
    }
    if (opt === "ambiguo_cancelar") {
      const ativos = await agendamentosDoCliente(cliente.id);
      if (ativos.length) {
        await responderLivre({
          clienteId: cliente.id,
          autor: "sistema",
          texto: "Você quer cancelar seu agendamento ou parar de receber nossas mensagens?",
          botoes: [
            { id: "OPT_CANC_AG", titulo: "Cancelar agendamento" },
            { id: "OPT_SAIR", titulo: "Parar mensagens" },
          ],
        });
      } else {
        await aplicarOptout(cliente.id, telefone, textoSeguro);
        await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: MSG_OPTOUT });
      }
      return;
    }
  }

  // Limite de volume (anti-abuso) — só depois do opt-out
  if (await excedeuLimite(cliente.id, cfg)) {
    await registrarEventoSeguranca({ telefone, clienteId: cliente.id, tipo: "rate_limit", trecho: textoSeguro, acao: "ignorado" });
    return;
  }

  // 2) Conversa com a recepção: a IA fica calada (a recepção vê no painel)
  if (conv.status === "humano") return;

  // 3) Botões
  let textoParaAgente = textoSeguro;
  if (m.payloadBotao) {
    const r = await tratarBotao(m.payloadBotao, cliente);
    if (r.tratado) return;
    if (r.textoParaAgente) textoParaAgente = r.textoParaAgente;
  }

  // 4) Mídia sem texto
  if (!textoParaAgente) {
    await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: MSG_SO_TEXTO });
    return;
  }

  // 5) Humano: pedido explícito, LGPD ou bot desligado
  if (!cfg.bot_ativo || pediuAtendente(textoParaAgente) || pedidoLGPD(textoParaAgente)) {
    const motivo = !cfg.bot_ativo ? "assistente desligado no painel" : pedidoLGPD(textoParaAgente) ? "pedido LGPD (dados pessoais)" : "cliente pediu atendente";
    await transferirParaHumano(cliente.id, `${motivo}: "${textoParaAgente.slice(0, 80)}"`);
    return;
  }

  // 6) Barreira de entrada — recusa fixa, a IA nem é chamada
  const guard = verificarEntrada(textoParaAgente);
  if (guard.bloqueado) {
    await registrarEventoSeguranca({ telefone, clienteId: cliente.id, tipo: guard.categoria, trecho: textoParaAgente, acao: `recusado:${guard.regra}` });
    await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: mensagemRecusa(guard.categoria, cfg.empresa.nome) });
    return;
  }

  // 7) Agente
  const [hist, consent, ags] = await Promise.all([
    historico(conv.id, cfg.seguranca.historico_msgs, m.wamid),
    consentimentosAtivos(cliente.id),
    agendamentosDoCliente(cliente.id),
  ]);
  const r = await rodarAgente({
    ctx: { clienteId: cliente.id, telefone, nomeCliente: cliente.nome, wamid: m.wamid, conversaId: conv.id },
    historico: hist,
    mensagem: textoParaAgente,
    contexto: {
      consentimentos: consent,
      agendamentos: ags.map((a) => `${a.servicos?.nome ?? "serviço"} ${formatarDataHora(a.inicio, cfg.fuso_offset)} (${a.status})`),
    },
  });

  if (r.tipo === "transferido") return;

  if (r.tipo === "falha") {
    if (r.motivo === "refusal") {
      await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: mensagemRecusa("prompt_injection", cfg.empresa.nome) });
      return;
    }
    const falhas = (conv.falhas_entendimento ?? 0) + 1;
    await db().from("conversas").update({ falhas_entendimento: falhas }).eq("id", conv.id);
    await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: MSG_FALHA });
    await transferirParaHumano(cliente.id, `falha técnica do assistente (${r.motivo})`, { avisarCliente: false });
    return;
  }

  // 8) Barreira de saída — última linha de defesa
  const saida = filtrarSaida(r.texto, valoresSecretos());
  if (!saida.ok) {
    await registrarEventoSeguranca({ telefone, clienteId: cliente.id, tipo: "saida_bloqueada", trecho: `${saida.motivo}: ${r.texto}`, acao: "bloqueado" });
    await responderLivre({ clienteId: cliente.id, autor: "sistema", texto: mensagemRecusa("prompt_injection", cfg.empresa.nome) });
    return;
  }
  await responderLivre({ clienteId: cliente.id, autor: "bot", texto: r.texto });
  if (conv.falhas_entendimento) await db().from("conversas").update({ falhas_entendimento: 0 }).eq("id", conv.id);
}

const ORDEM_STATUS: Record<string, number> = { enviada: 1, entregue: 2, lida: 3 };

export async function processarStatus(s: StatusRecebido) {
  if (!s.wamid) return;
  const mapa: Record<string, string> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" };
  const novo = mapa[s.status];
  if (!novo) return;

  const { data: msg } = await db().from("mensagens").select("id, status, campanha_id").eq("wamid", s.wamid).maybeSingle();
  if (msg && (novo === "falhou" || (ORDEM_STATUS[novo] ?? 0) > (ORDEM_STATUS[msg.status] ?? 0))) {
    await db().from("mensagens").update({ status: novo, erro: s.erro }).eq("id", msg.id);
  }

  const envio: Record<string, unknown> = {};
  if (novo === "entregue") Object.assign(envio, { status: "entregue", entregue_em: s.timestamp.toISOString() });
  if (novo === "lida") Object.assign(envio, { status: "lido", lido_em: s.timestamp.toISOString() });
  if (novo === "falhou") Object.assign(envio, { status: "falhou", erro: s.erro });
  if (Object.keys(envio).length) {
    await db().from("campanha_envios").update(envio).eq("wamid", s.wamid).neq("status", "respondido");
  }

  if (novo === "entregue" || novo === "lida") {
    await lancarCustoMeta({ wamid: s.wamid, categoria: s.categoria, cobravel: s.cobravel, modeloPreco: s.modeloPreco, quando: s.timestamp });
  }
  if (novo === "falhou" && msg?.campanha_id) await verificarPausaCampanha(msg.campanha_id);
}
