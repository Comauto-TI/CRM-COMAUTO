import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarDataHora, DIAS } from "@/lib/time";
import {
  listarServicos,
  horariosDisponiveis,
  criarAgendamento,
  agendamentosDoCliente,
  reagendar,
  cancelarAgendamento,
} from "@/lib/scheduling/booking";
import { transferirParaHumano } from "@/lib/handoff";
import { registrarConsentimento, TEXTO_CONSENTIMENTO } from "@/lib/consent";
import { rotearLead } from "@/modulos/vendas/leads";
import { ehChave, INTERESSES, PAGAMENTOS, PRAZOS, type Interesse } from "@/modulos/vendas/regras";

/**
 * Ferramentas do agente. Regras:
 * - schemas `strict` (todos os campos obrigatórios; opcionais = null)
 * - os executores só devolvem dados de NEGÓCIO do próprio cliente; nunca segredo/config técnica
 * - ações que mudam estado exigem `cliente_confirmou: true`
 */

/** wamid = id da mensagem que disparou o agente (referência estável para ações idempotentes, ex.: cotação de peças). */
export type ContextoTool = { clienteId: string; telefone: string; nomeCliente: string | null; wamid?: string };

const s = (props: Record<string, unknown>, required: string[]): Anthropic.Tool["input_schema"] => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "listar_servicos",
    description: "Lista os serviços agendáveis da oficina (nome, duração e preço de referência se houver).",
    strict: true,
    input_schema: s({}, []),
  },
  {
    name: "consultar_horarios",
    description: "Consulta horários REALMENTE livres para um serviço. Use antes de oferecer qualquer horário.",
    strict: true,
    input_schema: s(
      {
        servico: { type: "string", description: "Nome do serviço, como em listar_servicos" },
        data: { type: ["string", "null"], description: "Dia desejado no formato AAAA-MM-DD, ou null para os próximos dias" },
        periodo: { type: ["string", "null"], enum: ["manha", "tarde", null], description: "Período preferido ou null" },
      },
      ["servico", "data", "periodo"],
    ),
  },
  {
    name: "criar_agendamento",
    description: "Cria o agendamento num horário devolvido por consultar_horarios. Só chame depois do cliente confirmar explicitamente.",
    strict: true,
    input_schema: s(
      {
        servico: { type: "string" },
        inicio_iso: { type: "string", description: "Campo inicio_iso exato devolvido por consultar_horarios" },
        nome_cliente: { type: "string" },
        placa: { type: ["string", "null"] },
        modelo_veiculo: { type: ["string", "null"] },
        km: { type: ["integer", "null"] },
        observacoes: { type: ["string", "null"], description: "Sintomas ou pedido do cliente, resumido" },
        cliente_confirmou: { type: "boolean", description: "true somente se o cliente disse que confirma" },
        aceitou_lembretes: { type: "boolean", description: "Cliente aceitou receber confirmação e lembretes pelo WhatsApp" },
      },
      ["servico", "inicio_iso", "nome_cliente", "placa", "modelo_veiculo", "km", "observacoes", "cliente_confirmou", "aceitou_lembretes"],
    ),
  },
  {
    name: "meus_agendamentos",
    description: "Lista os agendamentos futuros ativos deste cliente (com id para remarcar/cancelar).",
    strict: true,
    input_schema: s({}, []),
  },
  {
    name: "reagendar_agendamento",
    description: "Remarca um agendamento do cliente para um novo horário livre (consulte horários antes).",
    strict: true,
    input_schema: s(
      {
        agendamento_id: { type: "string" },
        novo_inicio_iso: { type: "string" },
        cliente_confirmou: { type: "boolean" },
      },
      ["agendamento_id", "novo_inicio_iso", "cliente_confirmou"],
    ),
  },
  {
    name: "cancelar_agendamento",
    description: "Cancela um agendamento do cliente.",
    strict: true,
    input_schema: s(
      {
        agendamento_id: { type: "string" },
        motivo: { type: ["string", "null"] },
        cliente_confirmou: { type: "boolean" },
      },
      ["agendamento_id", "motivo", "cliente_confirmou"],
    ),
  },
  {
    name: "eventos_ativos",
    description: "Lista eventos ativos da empresa (nome, data, local, se há vagas) e a situação do cliente em cada um.",
    strict: true,
    input_schema: s({}, []),
  },
  {
    name: "confirmar_presenca_evento",
    description: "Confirma a presença do cliente num evento ativo (respeita limite de vagas).",
    strict: true,
    input_schema: s({ evento_id: { type: "string" }, cliente_confirmou: { type: "boolean" } }, ["evento_id", "cliente_confirmou"]),
  },
  {
    name: "registrar_consentimento",
    description: "Registra autorização para receber convites de eventos e/ou ofertas, SOMENTE após o cliente aceitar o texto padrão.",
    strict: true,
    input_schema: s(
      {
        tipos: { type: "array", items: { type: "string", enum: ["eventos", "marketing"] } },
        cliente_aceitou_texto: { type: "boolean" },
      },
      ["tipos", "cliente_aceitou_texto"],
    ),
  },
  {
    name: "registrar_interesse",
    description: "Registra interesse do cliente (ex.: modelo de carro, serviço) quando ele não agendou agora, para a equipe dar retorno.",
    strict: true,
    input_schema: s({ assunto: { type: "string" } }, ["assunto"]),
  },
  {
    name: "qualificar_lead",
    description:
      "Registra o interesse de COMPRA do cliente (carro novo ou seminovo) para a equipe de vendas, ou encaminha pedido de peças/assunto incerto para a equipe. Use depois de entender o interesse. Para revisão/serviço use o fluxo de agendamento, não esta ferramenta.",
    strict: true,
    input_schema: s(
      {
        interesse: { type: "string", enum: ["novo", "seminovo", "oficina", "pecas", "indefinido"] },
        modelo: { type: ["string", "null"], description: "Modelo/versão que o cliente quer, nas palavras dele" },
        pagamento: { type: "string", enum: ["a_vista", "financiamento", "consorcio", "indefinido"] },
        prazo: { type: "string", enum: ["imediato", "ate_30_dias", "ate_90_dias", "sem_prazo", "indefinido"] },
        tem_troca: { type: ["boolean", "null"], description: "Cliente quer dar um usado na troca? null se não falou" },
        troca_descricao: { type: ["string", "null"], description: "Carro da troca (modelo, ano, km) se o cliente informou" },
        resumo: { type: "string", description: "Resumo curto do que o cliente quer, para o vendedor" },
        cliente_confirmou_dados: { type: "boolean", description: "true só se você leu o resumo para o cliente e ele confirmou" },
      },
      ["interesse", "modelo", "pagamento", "prazo", "tem_troca", "troca_descricao", "resumo", "cliente_confirmou_dados"],
    ),
  },
  {
    name: "info_empresa",
    description: "Endereço, horário de funcionamento e contato da empresa.",
    strict: true,
    input_schema: s({}, []),
  },
  {
    name: "transferir_humano",
    description: "Transfere a conversa para a recepção (atendente humano). Use nos casos previstos nas regras.",
    strict: true,
    input_schema: s({ motivo: { type: "string", description: "Resumo curto do motivo, para a recepção" } }, ["motivo"]),
  },
];

type In = Record<string, unknown>;
const ok = (dados: unknown) => JSON.stringify({ ok: true, ...((typeof dados === "object" && dados) || { resultado: dados }) });
const erro = (motivo: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ok: false, motivo, ...extra });

/** Garante que o agendamento é DESTE cliente (o modelo nunca acessa dado de outro). */
async function agendamentoDoCliente(agendamentoId: string, clienteId: string): Promise<boolean> {
  const { data } = await db().from("agendamentos").select("id").eq("id", agendamentoId).eq("cliente_id", clienteId).maybeSingle();
  return !!data;
}

export async function executarTool(nome: string, input: In, ctx: ContextoTool): Promise<{ resultado: string; transferiu?: boolean }> {
  const cfg = await getConfig();
  const off = cfg.fuso_offset;

  switch (nome) {
    case "listar_servicos": {
      const lista = await listarServicos();
      return {
        resultado: ok({
          servicos: lista.map((x) => ({
            nome: x.nome,
            duracao_min: x.duracao_min,
            preco_referencia: x.preco_referencia ?? "sob consulta (informado pela equipe)",
            descricao: x.descricao,
          })),
        }),
      };
    }

    case "consultar_horarios": {
      const r = await horariosDisponiveis({
        servicoId: String(input.servico),
        dataPreferida: (input.data as string | null) ?? null,
        periodo: (input.periodo as "manha" | "tarde" | null) ?? null,
      });
      if (!r) return { resultado: erro("servico_nao_encontrado") };
      if (!r.slots.length) return { resultado: erro("sem_horarios", { dica: "ofereça outro dia ou período" }) };
      return {
        resultado: ok({
          servico: r.servico.nome,
          horarios: r.slots.map((x) => ({ texto: formatarDataHora(x.inicio, off), inicio_iso: x.inicio.toISOString() })),
        }),
      };
    }

    case "criar_agendamento": {
      if (input.cliente_confirmou !== true) return { resultado: erro("cliente_ainda_nao_confirmou", { dica: "apresente o resumo e peça confirmação" }) };
      const nome = String(input.nome_cliente ?? "").slice(0, 80).trim();
      if (nome) await db().from("clientes").update({ nome }).eq("id", ctx.clienteId).is("nome", null);
      const r = await criarAgendamento({
        clienteId: ctx.clienteId,
        servicoId: String(input.servico),
        inicioISO: String(input.inicio_iso),
        ator: `cliente:${ctx.telefone}`,
        origem: "whatsapp",
        confirmadoPeloCliente: true,
        confirmadoPor: ctx.telefone,
        veiculo: {
          placa: (input.placa as string | null) ?? null,
          modelo: (input.modelo_veiculo as string | null) ?? null,
          km: (input.km as number | null) ?? null,
        },
        observacoes: ((input.observacoes as string | null) ?? null)?.slice(0, 500) ?? null,
      });
      if (r.ok && input.aceitou_lembretes === true) {
        await registrarConsentimento(ctx.clienteId, "servico", TEXTO_CONSENTIMENTO.servico(cfg.empresa.nome), "whatsapp_conversa");
      }
      // fecha follow-up de lead pendente: virou agendamento
      if (r.ok) await db().from("followups").update({ status: "cancelado", resultado: "agendou" }).eq("cliente_id", ctx.clienteId).eq("tipo", "lead_sem_agendamento").eq("status", "pendente");
      return { resultado: r.ok ? ok({ confirmado: r.resumo, endereco: cfg.empresa.endereco }) : erro(r.motivo, { alternativas: r.alternativas }) };
    }

    case "meus_agendamentos": {
      const lista = await agendamentosDoCliente(ctx.clienteId);
      return {
        resultado: ok({
          agendamentos: lista.map((a) => ({
            agendamento_id: a.id,
            servico: a.servicos?.nome,
            quando: formatarDataHora(a.inicio, off),
            status: a.status,
          })),
        }),
      };
    }

    case "reagendar_agendamento": {
      if (input.cliente_confirmou !== true) return { resultado: erro("cliente_ainda_nao_confirmou") };
      const id = String(input.agendamento_id);
      if (!(await agendamentoDoCliente(id, ctx.clienteId))) return { resultado: erro("agendamento_nao_encontrado") };
      const r = await reagendar(id, String(input.novo_inicio_iso), `cliente:${ctx.telefone}`);
      return { resultado: r.ok ? ok({ remarcado: r.resumo }) : erro(r.motivo, { alternativas: r.alternativas }) };
    }

    case "cancelar_agendamento": {
      if (input.cliente_confirmou !== true) return { resultado: erro("cliente_ainda_nao_confirmou") };
      const id = String(input.agendamento_id);
      if (!(await agendamentoDoCliente(id, ctx.clienteId))) return { resultado: erro("agendamento_nao_encontrado") };
      const r = await cancelarAgendamento(id, (input.motivo as string | null) ?? null, `cliente:${ctx.telefone}`);
      return { resultado: r.ok ? ok({ cancelado: true }) : erro(r.motivo) };
    }

    case "eventos_ativos": {
      const { data: eventos } = await db()
        .from("eventos")
        .select("id, nome, descricao, inicio, local, vagas")
        .eq("status", "ativo")
        .gte("inicio", new Date().toISOString())
        .order("inicio")
        .limit(5);
      const ids = (eventos ?? []).map((e) => e.id);
      const { data: inscr } = ids.length
        ? await db().from("inscricoes_evento").select("evento_id, status").eq("cliente_id", ctx.clienteId).in("evento_id", ids)
        : { data: [] };
      return {
        resultado: ok({
          eventos: (eventos ?? []).map((e) => ({
            evento_id: e.id,
            nome: e.nome,
            descricao: e.descricao,
            quando: formatarDataHora(e.inicio, off),
            local: e.local,
            situacao_cliente: inscr?.find((i) => i.evento_id === e.id)?.status ?? "nao_inscrito",
          })),
        }),
      };
    }

    case "confirmar_presenca_evento": {
      if (input.cliente_confirmou !== true) return { resultado: erro("cliente_ainda_nao_confirmou") };
      const { data, error } = await db().rpc("confirmar_inscricao", {
        p_evento: String(input.evento_id),
        p_cliente: ctx.clienteId,
        p_por: ctx.telefone,
      });
      if (error) return { resultado: erro("falha_ao_confirmar") };
      return { resultado: data === "confirmado" ? ok({ presenca: "confirmada" }) : erro(String(data), { dica: data === "esgotado" ? "informe esgotamento; cliente ficou na lista de espera" : undefined }) };
    }

    case "registrar_consentimento": {
      if (input.cliente_aceitou_texto !== true) return { resultado: erro("cliente_nao_aceitou") };
      const tipos = (input.tipos as string[]).filter((t) => t === "eventos" || t === "marketing") as ("eventos" | "marketing")[];
      for (const t of tipos) await registrarConsentimento(ctx.clienteId, t, TEXTO_CONSENTIMENTO.ofertas(cfg.empresa.nome), "whatsapp_conversa");
      return { resultado: ok({ registrados: tipos }) };
    }

    case "registrar_interesse": {
      const horas = cfg.followup.lead_horas;
      await db().from("followups").insert({
        cliente_id: ctx.clienteId,
        tipo: "lead_sem_agendamento",
        agendar_para: new Date(Date.now() + horas * 3600_000).toISOString(),
        resultado: String(input.assunto).slice(0, 200),
      });
      await db().from("clientes").update({ tags: ["lead"] }).eq("id", ctx.clienteId).eq("tags", "{}");
      return { resultado: ok({ registrado: true }) };
    }

    case "qualificar_lead": {
      const interesse = (INTERESSES as readonly string[]).includes(String(input.interesse)) ? (input.interesse as Interesse) : "indefinido";
      const pagamento = ehChave(PAGAMENTOS, input.pagamento) ? input.pagamento : "indefinido";
      const prazo = ehChave(PRAZOS, input.prazo) ? input.prazo : "indefinido";
      const r = await rotearLead({
        clienteId: ctx.clienteId,
        interesse,
        modelo: typeof input.modelo === "string" ? input.modelo : null,
        pagamento,
        prazo,
        temTroca: typeof input.tem_troca === "boolean" ? input.tem_troca : null,
        trocaDescricao: typeof input.troca_descricao === "string" ? input.troca_descricao : null,
        resumo: String(input.resumo ?? "").slice(0, 300) || "Interesse registrado pelo assistente",
        clienteConfirmou: input.cliente_confirmou_dados === true,
        referencia: ctx.wamid ?? null,
      });
      if (!r.ok) return { resultado: erro("nao_registrado", { instrucao: "ofereça falar com um atendente (transferir_humano)" }) };
      const instrucao = {
        vendas: "diga que um consultor de vendas vai entrar em contato por aqui; não prometa preço, prazo nem condição",
        agenda: "é serviço de oficina: siga o fluxo de agendamento",
        pecas: "diga que a equipe de peças vai verificar e retornar por aqui",
        triagem: "diga que a equipe vai entender o pedido e retornar; ofereça ATENDENTE se for urgente",
      }[r.destino];
      return { resultado: ok({ registrado: r.destino !== "agenda", instrucao }) };
    }

    case "info_empresa": {
      const { data: horarios } = await db().from("horarios_funcionamento").select("dia_semana, abre, fecha").order("dia_semana").order("abre");
      const porDia = new Map<number, string[]>();
      for (const h of horarios ?? []) porDia.set(h.dia_semana, [...(porDia.get(h.dia_semana) ?? []), `${h.abre.slice(0, 5)}-${h.fecha.slice(0, 5)}`]);
      return {
        resultado: ok({
          empresa: cfg.empresa.nome,
          endereco: cfg.empresa.endereco,
          site: cfg.empresa.site || null,
          horario: [...porDia.entries()].map(([d, f]) => `${DIAS[d]}: ${f.join(" e ")}`),
        }),
      };
    }

    case "transferir_humano": {
      await transferirParaHumano(ctx.clienteId, String(input.motivo ?? "solicitado pelo agente"));
      return { resultado: ok({ transferido: true, instrucao: "não responda mais nada; o sistema já avisou o cliente" }), transferiu: true };
    }

    default:
      return { resultado: erro("ferramenta_desconhecida") };
  }
}
