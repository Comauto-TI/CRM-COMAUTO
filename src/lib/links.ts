/**
 * Links wa.me e QR codes rastreados (funções PURAS — testáveis).
 *
 * Fluxo: QR/link → /r/<codigo> (conta o clique) → wa.me/<número>?text=<mensagem pronta "(cód. XXXXXX)">
 * → cliente envia → o webhook acha o código, vincula o cliente ao link e tira o código antes da IA.
 * Como é o CLIENTE quem inicia, abre a janela de 24h: resposta livre, sem template e sem verificação da Meta.
 */

// Sem caracteres ambíguos (0/O, 1/I/L) — o cliente pode digitar se precisar.
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function gerarCodigo(tamanho = 6, aleatorio: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < tamanho; i++) s += ALFABETO[Math.floor(aleatorio() * ALFABETO.length)];
  return s;
}

export function mensagemComCodigo(mensagem: string, codigo: string): string {
  return `${mensagem.trim()} (cód. ${codigo})`;
}

/** https://wa.me/5551999998888?text=... */
export function montarLinkWhatsApp(numero: string, mensagem: string, codigo: string): string {
  const n = numero.replace(/\D/g, "");
  return `https://wa.me/${n}?text=${encodeURIComponent(mensagemComCodigo(mensagem, codigo))}`;
}

const RE_CODIGO = /\(?\s*c[oó]d(?:igo)?\.?\s*[:#]?\s*([A-HJ-NP-Z2-9]{6})\s*\)?\s*$/i;

/** Extrai o código de rastreio do fim da mensagem do cliente. */
export function extrairCodigo(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = RE_CODIGO.exec(texto.trim());
  return m ? m[1].toUpperCase() : null;
}

/** Remove o código para a IA receber só a intenção do cliente. */
export function removerCodigo(texto: string): string {
  return texto.trim().replace(RE_CODIGO, "").trim();
}

export const CANAIS: { valor: string; rotulo: string }[] = [
  { valor: "balcao", rotulo: "Balcão / recepção" },
  { valor: "oficina", rotulo: "Oficina" },
  { valor: "instagram", rotulo: "Instagram" },
  { valor: "facebook", rotulo: "Facebook" },
  { valor: "site", rotulo: "Site" },
  { valor: "anuncio", rotulo: "Anúncio" },
  { valor: "evento", rotulo: "Evento" },
  { valor: "panfleto", rotulo: "Panfleto / impresso" },
  { valor: "email", rotulo: "E-mail" },
  { valor: "outro", rotulo: "Outro" },
];

export const MENSAGENS_SUGERIDAS = [
  "Olá! Quero agendar minha revisão.",
  "Olá! Quero agendar um serviço na oficina.",
  "Olá! Quero agendar um test drive.",
  "Olá! Quero saber mais sobre o evento.",
];
