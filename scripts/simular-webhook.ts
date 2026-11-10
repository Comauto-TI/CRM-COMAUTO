import { createHmac, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const endpoint = "http://localhost:3000/api/webhook/whatsapp";
const statusAceitos = ["delivered", "read", "failed"] as const;
const categorias = ["utility", "marketing", "authentication", "service"] as const;
type Status = (typeof statusAceitos)[number];
type Categoria = (typeof categorias)[number];

export type EventoSimulado =
  | { tipo: "texto"; telefone: string; texto: string }
  | { tipo: "botao-template" | "botao-interativo"; telefone: string; payload: string; titulo: string }
  | { tipo: "status"; telefone: string; wamid: string; status: Status; categoria: Categoria };

type Metadados = { wabaId: string; phoneNumberId: string; timestamp?: number; wamid?: string };

export function montarPayload(evento: EventoSimulado, dados: Metadados) {
  const timestamp = String(dados.timestamp ?? Math.floor(Date.now() / 1000));
  const metadata = { display_phone_number: "5500000000000", phone_number_id: dados.phoneNumberId };
  const value = { messaging_product: "whatsapp", metadata };

  if (evento.tipo === "status") {
    return envelope(dados.wabaId, {
      ...value,
      statuses: [{
        id: evento.wamid,
        status: evento.status,
        recipient_id: evento.telefone,
        timestamp,
        pricing: {
          billable: evento.status === "delivered",
          category: evento.categoria,
          pricing_model: "PMP",
        },
        ...(evento.status === "failed" && {
          errors: [{ code: 131026, title: "Message undeliverable", message: "Falha simulada" }],
        }),
      }],
    });
  }

  const base = { from: evento.telefone, id: dados.wamid ?? `wamid.simulacao.${randomUUID()}`, timestamp };
  let mensagem;
  switch (evento.tipo) {
    case "texto":
      mensagem = { ...base, type: "text", text: { body: evento.texto } };
      break;
    case "botao-template":
      mensagem = { ...base, type: "button", button: { text: evento.titulo, payload: evento.payload } };
      break;
    case "botao-interativo":
      mensagem = {
        ...base,
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: evento.payload, title: evento.titulo } },
      };
      break;
  }

  return envelope(dados.wabaId, {
    ...value,
    contacts: [{ wa_id: evento.telefone, profile: { name: "Contato de teste" } }],
    messages: [mensagem],
  });
}

function envelope(wabaId: string, value: Record<string, unknown>) {
  return { object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field: "messages", value }] }] };
}

export function assinarPayload(corpo: string, segredo: string): string {
  return `sha256=${createHmac("sha256", segredo).update(corpo, "utf8").digest("hex")}`;
}

const uso = `Execute na raiz do projeto, usando um ambiente local com integrações de teste.
O script envia somente para localhost:3000. O app local pode processar o evento
e acionar suas integrações, então use um número de teste controlado pela equipe.

npx tsx scripts/simular-webhook.ts texto 5551999990000 "quero agendar revisão"
npx tsx scripts/simular-webhook.ts botao-template 5551999990000 "AG_CONF:<uuid>" "Confirmar"
npx tsx scripts/simular-webhook.ts botao-interativo 5551999990000 "OPT_SAIR" "Parar mensagens"
npx tsx scripts/simular-webhook.ts status 5551999990000 "wamid.de-teste" delivered utility

Status: delivered, read ou failed. Categoria opcional: utility, marketing,
authentication ou service. Node 24 também permite executar com node no lugar de npx tsx.`;

function lerEvento(args: string[]): EventoSimulado {
  const [tipo, telefone, ...valores] = args;
  if (!telefone || !/^[1-9]\d{7,14}$/.test(telefone)) {
    throw new Error("Informe um telefone de teste com DDI e DDD, só dígitos.");
  }

  const [primeiro, segundo, terceiro] = valores;
  if (tipo === "texto" && valores.length === 1 && primeiro?.trim()) {
    return { tipo, telefone, texto: primeiro };
  }
  if ((tipo === "botao-template" || tipo === "botao-interativo") && valores.length === 2 && primeiro?.trim() && segundo?.trim()) {
    return { tipo, telefone, payload: primeiro, titulo: segundo };
  }
  if (tipo === "status" && valores.length >= 2 && valores.length <= 3 && primeiro?.startsWith("wamid.")) {
    const status = statusAceitos.find((item) => item === segundo);
    const categoria = categorias.find((item) => item === (terceiro ?? "utility"));
    if (status && categoria) return { tipo, telefone, wamid: primeiro, status, categoria };
  }

  throw new Error("Tipo de evento ou argumentos inválidos. Consulte --help.");
}

async function executar(args: string[]) {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(uso);
    return;
  }

  const evento = lerEvento(args);
  const envLocal = resolve(".env.local");
  if (existsSync(envLocal)) process.loadEnvFile(envLocal);
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (!segredo) throw new Error("Defina WHATSAPP_APP_SECRET no .env.local ou no ambiente de teste.");

  const corpo = JSON.stringify(montarPayload(evento, {
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "0",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "0",
  }));
  const resposta = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": assinarPayload(corpo, segredo),
    },
    body: corpo,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  console.log(`Webhook local retornou HTTP ${resposta.status}.`);
  if (!resposta.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  executar(process.argv.slice(2)).catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : "Falha na simulação.");
    process.exitCode = 1;
  });
}

