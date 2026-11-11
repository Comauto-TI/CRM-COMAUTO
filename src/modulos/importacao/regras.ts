/**
 * F3 — Importação de clientes por planilha (Bravus ou qualquer CSV). Regras puras, sem I/O.
 * O navegador usa estas funções para a prévia; o SERVIDOR roda as mesmas de novo antes de gravar
 * (nunca confia no que veio do navegador).
 * LGPD: importar NÃO dá consentimento de WhatsApp a ninguém — o envio automático continua bloqueado.
 */
import { normalizarTelefone } from "@/lib/phone";
import { lerDocumento, lerNascimento } from "@/lib/busca";

export const CAMPOS = {
  nome: "Nome",
  telefone: "Telefone / celular",
  cpf_cnpj: "CPF / CNPJ",
  email: "E-mail",
  cidade: "Cidade",
  data_nascimento: "Data de nascimento",
  codigo_externo: "Código no sistema de origem",
} as const;
export type Campo = keyof typeof CAMPOS;
export type Mapeamento = Partial<Record<Campo, number>>; // campo → índice da coluna

/** Máximo de linhas por lote (o envio ao servidor tem limite de tamanho). Planilha maior: dividir. */
export const LIMITE_LINHAS = 1000; // ~560 B/linha serializada: 1.000 linhas ≈ 0,6 MB, abaixo do limite de 1 MiB da Server Action

/** Lê CSV com ; , ou TAB (detecta pelo cabeçalho), aspas, quebras CRLF e BOM. Linhas vazias saem. */
export function lerCSV(texto: string): string[][] {
  const t = (texto ?? "").replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/, 1)[0] ?? "";
  const conta = (c: string) => primeira.split(c).length - 1;
  const sep = [";", ",", "\t"].sort((a, b) => conta(b) - conta(a))[0]!;
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (aspas) {
      if (ch === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((c) => c.trim())) linhas.push(linha);
      linha = [];
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((c) => c.trim())) linhas.push(linha);
  return linhas.map((l) => l.map((c) => c.trim()));
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SINONIMOS: Record<Campo, string[]> = {
  nome: ["nome", "cliente", "nome cliente", "razao social", "nome completo", "nome razao social"],
  telefone: ["celular", "telefone", "fone", "whatsapp", "tel", "telefone celular", "fone celular", "contato"],
  cpf_cnpj: ["cpf", "cnpj", "cpf cnpj", "cpf/cnpj", "documento", "doc"],
  email: ["email", "e mail", "correio eletronico"],
  cidade: ["cidade", "municipio"],
  data_nascimento: ["nascimento", "data nascimento", "data de nascimento", "dt nascimento", "aniversario", "dt nasc"],
  codigo_externo: ["codigo", "cod", "codigo cliente", "id", "cod cliente", "id cliente"],
};

/** Sugere qual coluna é cada campo pelo nome do cabeçalho (a pessoa confirma ou corrige). */
export function sugerirMapeamento(cabecalho: string[]): Mapeamento {
  const norm = cabecalho.map(semAcento);
  const mapa: Mapeamento = {};
  const usadas = new Set<number>();
  for (const campo of Object.keys(SINONIMOS) as Campo[]) {
    const nomes = SINONIMOS[campo].map(semAcento);
    let idx = norm.findIndex((h, i) => !usadas.has(i) && nomes.includes(h));
    if (idx < 0) idx = norm.findIndex((h, i) => !usadas.has(i) && nomes.some((n) => n.length > 3 && h.includes(n)));
    if (idx >= 0) { mapa[campo] = idx; usadas.add(idx); }
  }
  return mapa;
}

/** Data em dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa ou aaaa-mm-dd → AAAA-MM-DD (validada). Inválida → null. */
export function lerData(entrada: string, hoje: Date = new Date()): string | null {
  const t = (entrada ?? "").trim().split(/[ T]/)[0] ?? "";
  let iso: string | null = null;
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) iso = `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) iso = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  if (!iso) return null;
  const r = lerNascimento(iso, hoje);
  return r.ok ? r.valor : null;
}

/** Vários telefones no mesmo campo ("(51) 3333-4444 / 99999-8888"): prefere o primeiro CELULAR válido. */
export function lerTelefone(entrada: string): string | null {
  const partes = (entrada ?? "").split(/[/;,|]|\s{2,}|\be\b/i).map((p) => p.trim()).filter(Boolean);
  const validos = partes.map((p) => normalizarTelefone(p)).filter((n): n is string => !!n);
  return validos.find((n) => n.startsWith("55") && n.length === 13) ?? validos[0] ?? null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type ClienteImportado = {
  linha: number; // número da linha na planilha (para a pessoa achar o erro)
  nome: string | null;
  telefone: string;
  cpf_cnpj: string | null;
  email: string | null;
  cidade: string | null;
  data_nascimento: string | null;
  codigo_externo: string | null;
};
export type Problema = { linha: number; motivo: string };

/** Variantes do celular BR com e sem o 9 (mesma regra de src/lib/phone.ts), para achar duplicado. */
function chaveTelefone(n: string): string {
  return n.startsWith("55") && n.length === 13 && n[4] === "9" ? n.slice(0, 4) + n.slice(5) : n;
}

/**
 * Transforma as linhas da planilha em clientes prontos para gravar.
 * Erro (linha não entra): sem telefone válido. Aviso (entra sem o dado): CPF, e-mail ou nascimento inválidos.
 * Duplicado DENTRO do arquivo (mesmo telefone ou mesmo CPF): fica só a primeira ocorrência.
 */
export function prepararClientes(linhas: string[][], mapa: Mapeamento, temCabecalho: boolean) {
  const clientes: ClienteImportado[] = [];
  const erros: Problema[] = [];
  const avisos: Problema[] = [];
  let duplicadas = 0;
  const vistosTel = new Set<string>();
  const vistosDoc = new Set<string>();
  const col = (l: string[], c: Campo) => (mapa[c] === undefined ? "" : (l[mapa[c]!] ?? "").trim());

  linhas.slice(temCabecalho ? 1 : 0).slice(0, LIMITE_LINHAS).forEach((l, i) => {
    const linha = i + (temCabecalho ? 2 : 1);
    const telefone = lerTelefone(col(l, "telefone"));
    if (!telefone) { erros.push({ linha, motivo: "sem telefone válido" }); return; }

    let cpf: string | null = null;
    const docBruto = col(l, "cpf_cnpj");
    if (docBruto) {
      const d = lerDocumento(docBruto);
      if (d.ok) cpf = d.valor;
      else avisos.push({ linha, motivo: `${d.motivo}: importado sem documento` });
    }
    const emailBruto = col(l, "email").toLowerCase();
    const email = emailBruto && EMAIL.test(emailBruto) ? emailBruto.slice(0, 160) : null;
    if (emailBruto && !email) avisos.push({ linha, motivo: "e-mail inválido: importado sem e-mail" });
    const nascBruto = col(l, "data_nascimento");
    const nasc = nascBruto ? lerData(nascBruto) : null;
    if (nascBruto && !nasc) avisos.push({ linha, motivo: "data de nascimento inválida: importado sem a data" });

    const kTel = chaveTelefone(telefone);
    if (vistosTel.has(kTel) || (cpf && vistosDoc.has(cpf))) { duplicadas++; return; }
    vistosTel.add(kTel);
    if (cpf) vistosDoc.add(cpf);

    clientes.push({
      linha,
      nome: col(l, "nome").replace(/\s+/g, " ").slice(0, 120) || null,
      telefone,
      cpf_cnpj: cpf,
      email,
      cidade: col(l, "cidade").replace(/\s+/g, " ").slice(0, 80) || null,
      data_nascimento: nasc,
      codigo_externo: col(l, "codigo_externo").slice(0, 60) || null,
    });
  });
  const ignoradasPorLimite = Math.max(0, linhas.length - (temCabecalho ? 1 : 0) - LIMITE_LINHAS);
  return { clientes, erros, avisos, duplicadas, ignoradasPorLimite };
}

/**
 * Revalidação no servidor de um cliente que veio do navegador: só passa o que as mesmas regras aceitariam.
 * Devolve null se a linha não for aceitável (ex.: telefone adulterado).
 */
export function revalidar(c: Partial<ClienteImportado>): ClienteImportado | null {
  const telefone = typeof c.telefone === "string" ? lerTelefone(c.telefone) : null;
  if (!telefone) return null;
  const txt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);
  const doc = typeof c.cpf_cnpj === "string" ? lerDocumento(c.cpf_cnpj) : null;
  const email = typeof c.email === "string" && EMAIL.test(c.email.trim().toLowerCase()) ? c.email.trim().toLowerCase().slice(0, 160) : null;
  const nasc = typeof c.data_nascimento === "string" ? lerData(c.data_nascimento) : null;
  return {
    linha: typeof c.linha === "number" && Number.isInteger(c.linha) ? c.linha : 0,
    nome: txt(c.nome, 120),
    telefone,
    cpf_cnpj: doc && doc.ok ? doc.valor : null,
    email,
    cidade: txt(c.cidade, 80),
    data_nascimento: nasc,
    codigo_externo: txt(c.codigo_externo, 60),
  };
}
