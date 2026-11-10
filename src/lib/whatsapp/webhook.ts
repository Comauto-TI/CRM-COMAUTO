/** Tipos e parser do payload do webhook da WhatsApp Cloud API. */

export type MensagemRecebida = {
  wamid: string;
  de: string; // telefone (wa_id) só dígitos
  nomePerfil: string | null;
  timestamp: Date;
  tipo: string;
  texto: string | null; // texto do cliente OU título do botão tocado
  payloadBotao: string | null; // id/payload do botão (AG_CONF:<uuid> etc.)
  contexto: string | null; // wamid da mensagem respondida
};

export type StatusRecebido = {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed" | string;
  para: string;
  timestamp: Date;
  cobravel: boolean | null;
  categoria: string | null; // marketing | utility | authentication | service ...
  modeloPreco: string | null;
  erro: string | null;
};

type Bruto = {
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: Record<string, unknown>[];
        statuses?: Record<string, unknown>[];
      };
    }[];
  }[];
};

// C7-002: só itera o que for array de verdade; item malformado é descartado sem derrubar o lote.
const lista = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** Timestamp da Meta (segundos). Ausente/inválido => agora; futuro => agora (não estende a janela de 24h). */
export function timestampSeguro(valor: unknown, agora = Date.now()): Date {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return new Date(agora);
  const ms = n * 1000;
  return new Date(ms > agora + 60_000 ? agora : ms);
}

export function parsearWebhook(body: unknown): { mensagens: MensagemRecebida[]; status: StatusRecebido[] } {
  const mensagens: MensagemRecebida[] = [];
  const status: StatusRecebido[] = [];
  const b = (body && typeof body === "object" ? body : {}) as Bruto;

  for (const entry of lista<NonNullable<Bruto["entry"]>[number]>(b.entry)) {
    for (const change of lista<NonNullable<NonNullable<Bruto["entry"]>[number]["changes"]>[number]>(entry?.changes)) {
      const v = change?.value;
      if (!v || typeof v !== "object") continue;
      const nomes = new Map(lista<{ wa_id?: string; profile?: { name?: string } }>(v.contacts).map((c) => [c?.wa_id ?? "", c?.profile?.name ?? null]));

      for (const m of lista<Record<string, unknown>>(v.messages)) {
        if (!m || typeof m !== "object" || !m.id || !m.from) continue; // sem id/remetente não dá para processar nem deduplicar
        const tipo = String(m.type ?? "desconhecido");
        let texto: string | null = null;
        let payloadBotao: string | null = null;

        if (tipo === "text") texto = (m.text as { body?: string })?.body ?? null;
        else if (tipo === "button") {
          // resposta a botão de TEMPLATE
          const bt = m.button as { text?: string; payload?: string };
          texto = bt?.text ?? null;
          payloadBotao = bt?.payload ?? null;
        } else if (tipo === "interactive") {
          const it = m.interactive as {
            type?: string;
            button_reply?: { id?: string; title?: string };
            list_reply?: { id?: string; title?: string };
          };
          const r = it?.button_reply ?? it?.list_reply;
          texto = r?.title ?? null;
          payloadBotao = r?.id ?? null;
        }

        const de = String(m.from ?? "");
        mensagens.push({
          wamid: String(m.id ?? ""),
          de,
          nomePerfil: nomes.get(de) ?? null,
          timestamp: timestampSeguro(m.timestamp),
          tipo,
          texto,
          payloadBotao,
          contexto: (m.context as { id?: string })?.id ?? null,
        });
      }

      for (const s of lista<Record<string, unknown>>(v.statuses)) {
        if (!s || typeof s !== "object" || !s.id) continue;
        const pricing = s.pricing as { billable?: boolean; category?: string; pricing_model?: string } | undefined;
        const erros = s.errors as { title?: string; message?: string; code?: number }[] | undefined;
        status.push({
          wamid: String(s.id ?? ""),
          status: String(s.status ?? ""),
          para: String(s.recipient_id ?? ""),
          timestamp: timestampSeguro(s.timestamp),
          cobravel: pricing?.billable ?? null,
          categoria: pricing?.category ?? null,
          modeloPreco: pricing?.pricing_model ?? null,
          erro: erros?.[0] ? `${erros[0].code ?? ""} ${erros[0].title ?? erros[0].message ?? ""}`.trim() : null,
        });
      }
    }
  }
  return { mensagens, status };
}
