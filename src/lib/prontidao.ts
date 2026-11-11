/**
 * Prontidão do piloto: o que está pronto e o que bloqueia colocar o WhatsApp e o painel em uso.
 * Puro (testado em tests/prontidao.test.ts). Recebe só FATOS (configurado sim/não, contagens) — nunca valores de chave.
 */

export type Fatos = {
  chaves: { anthropic: boolean; whatsappToken: boolean; whatsappNumero: boolean; whatsappSegredo: boolean; whatsappVerify: boolean; cron: boolean };
  appUrl: string;
  templatesAprovados: string[];
  equipe: { admin: number; recepcao: number; vendedor: number; recepcaoComAlerta: number };
  agenda: { servicos: number; recursos: number; horarios: number };
  qrAtivos: number;
  botAtivo: boolean;
  nucleo: boolean;
  vendas: boolean;
};

export type Item = { grupo: string; titulo: string; estado: "ok" | "pendente" | "bloqueia"; acao: string };

/** Templates sem os quais o piloto não funciona direito (o resto pode esperar). */
export const TEMPLATES_ESSENCIAIS = ["confirmacao_agendamento", "lembrete_24h", "alerta_recepcao", "convite_evento", "retomada_atendimento"] as const;

export function avaliarProntidao(f: Fatos): Item[] {
  const itens: Item[] = [];
  const add = (grupo: string, titulo: string, ok: boolean, acao: string, critico = true) =>
    itens.push({ grupo, titulo, estado: ok ? "ok" : critico ? "bloqueia" : "pendente", acao: ok ? "" : acao });

  // Banco
  add("Banco", "Núcleo da plataforma aplicado", f.nucleo, "Aplicar a migration 0002_nucleo.");
  add("Banco", "Setor de Vendas aplicado", f.vendas, "Aplicar a migration 0003_vendas.");

  // WhatsApp (Meta)
  add("WhatsApp", "Token da API do WhatsApp", f.chaves.whatsappToken, "Gerar o token permanente no Meta Business (usuário do sistema) e colocar em WHATSAPP_TOKEN.");
  add("WhatsApp", "Número do WhatsApp (Phone Number ID)", f.chaves.whatsappNumero, "Copiar o Phone Number ID no Meta e colocar em WHATSAPP_PHONE_NUMBER_ID.");
  add("WhatsApp", "Segredo do app (assinatura do webhook)", f.chaves.whatsappSegredo, "Copiar o App Secret do app na Meta para WHATSAPP_APP_SECRET.");
  add("WhatsApp", "Token de verificação do webhook", f.chaves.whatsappVerify, "Definir WHATSAPP_VERIFY_TOKEN e usar o mesmo valor ao cadastrar o webhook na Meta.");
  const faltando = TEMPLATES_ESSENCIAIS.filter((t) => !f.templatesAprovados.includes(t));
  add("WhatsApp", `Modelos de mensagem aprovados (${TEMPLATES_ESSENCIAIS.length - faltando.length}/${TEMPLATES_ESSENCIAIS.length})`, faltando.length === 0,
    `Enviar para aprovação na Meta e marcar como aprovado em Configurações: ${faltando.join(", ")}.`);

  // IA e rotinas
  add("Assistente", "Chave da IA (Anthropic)", f.chaves.anthropic, "Criar a chave no console da Anthropic e colocar em ANTHROPIC_API_KEY.");
  add("Assistente", "Assistente virtual ligado", f.botAtivo, "Ligar o assistente em Configurações (sem ele, tudo vai para a recepção).", false);
  add("Rotinas", "Segredo das rotinas automáticas (cron)", f.chaves.cron, "Definir CRON_SECRET (16+ caracteres) na Vercel.");

  // Publicação
  const publicado = /^https:\/\//.test(f.appUrl) && !/localhost|127\.0\.0\.1/.test(f.appUrl);
  add("Publicação", "Painel no ar com HTTPS", publicado, "Publicar na Vercel e definir APP_URL com o endereço https (necessário para o webhook, os QR Codes e instalar o app nos PCs).");

  // Equipe
  add("Equipe", "Administrador", f.equipe.admin > 0, "Cadastrar ao menos um administrador.");
  add("Equipe", "Recepção cadastrada", f.equipe.recepcao > 0, "Cadastrar a recepção em Configurações → Cadastrar pessoa.");
  add("Equipe", "Vendedores cadastrados", f.equipe.vendedor > 0, "Cadastrar os vendedores (os leads do WhatsApp são distribuídos entre eles).");
  add("Equipe", "Recepção recebe alerta no WhatsApp", f.equipe.recepcaoComAlerta > 0, "Marcar \"recebe alertas\" e o WhatsApp de quem atende (com autorização da pessoa).", false);

  // Operação
  add("Operação", "Serviços da oficina", f.agenda.servicos > 0, "Cadastrar os serviços em Configurações.");
  add("Operação", "Boxes/recursos da agenda", f.agenda.recursos > 0, "Cadastrar os boxes da oficina.");
  add("Operação", "Horário de funcionamento", f.agenda.horarios > 0, "Cadastrar os horários em Configurações.");
  add("Operação", "QR Code para o piloto", f.qrAtivos > 0, "Gerar ao menos um QR Code em QR Codes e links.", false);

  return itens;
}

export function resumoProntidao(itens: Item[]) {
  const bloqueia = itens.filter((i) => i.estado === "bloqueia").length;
  const pendente = itens.filter((i) => i.estado === "pendente").length;
  return { total: itens.length, ok: itens.length - bloqueia - pendente, bloqueia, pendente, pronto: bloqueia === 0 };
}

/** Valor de ambiente conta como configurado só se não for vazio nem um marcador ("nao-configurado", "xxx"...). */
export function configurado(valor: string | undefined, minimo = 1): boolean {
  const v = (valor ?? "").trim();
  if (v.length < minimo) return false;
  return !/^(nao[-_ ]?configurado|não[-_ ]?configurado|x+|changeme|seu[-_].*|placeholder|todo)$/i.test(v);
}
