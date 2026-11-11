/**
 * F5 — Aniversários: regras puras (testadas em tests/aniversarios.test.ts).
 * Semáforo: 🟡 próximo (até N dias antes) · 🟢 hoje · 🔴 passou (até N dias depois) sem contato registrado.
 */

export const ANTECEDENCIA_PADRAO = 7;

export type EstadoAniversario = "proximo" | "hoje" | "passou" | "feito";

/** Data (AAAA-MM-DD) do aniversário mais próximo de hoje (ano anterior, atual ou seguinte). 29/02 vira 28/02 em ano não bissexto. */
export function aniversarioMaisProximo(nascimento: string, hojeISO: string): { data: string; dias: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nascimento ?? "");
  const h = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hojeISO ?? "");
  if (!m || !h) return null;
  const hoje = Date.UTC(+h[1], +h[2] - 1, +h[3]);
  let melhor: { data: string; dias: number } | null = null;
  for (const ano of [+h[1] - 1, +h[1], +h[1] + 1]) {
    let mes = +m[2] - 1, dia = +m[3];
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
    if (mes === 1 && dia === 29 && !bissexto) dia = 28;
    const t = Date.UTC(ano, mes, dia);
    const dias = Math.round((t - hoje) / 86_400_000);
    if (!melhor || Math.abs(dias) < Math.abs(melhor.dias)) {
      melhor = { data: new Date(t).toISOString().slice(0, 10), dias };
    }
  }
  return melhor;
}

/**
 * Estado do aniversário para o semáforo. null = fora da janela (não aparece).
 * contatoFeito = alguém registrou contato desde o aniversário (ou marcou "contato feito").
 */
export function classificarAniversario(
  nascimento: string | null, hojeISO: string, contatoFeito: boolean, antecedencia = ANTECEDENCIA_PADRAO,
): { estado: EstadoAniversario; dias: number; data: string } | null {
  if (!nascimento) return null;
  const a = aniversarioMaisProximo(nascimento, hojeISO);
  if (!a) return null;
  if (a.dias > antecedencia || a.dias < -antecedencia) return null;
  if (contatoFeito) return { estado: "feito", ...a };
  if (a.dias > 0) return { estado: "proximo", ...a };
  if (a.dias === 0) return { estado: "hoje", ...a };
  return { estado: "passou", ...a };
}

/** Texto curto para a lista/pop-up. */
export function quandoAniversario(dias: number): string {
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  if (dias === -1) return "ontem";
  return dias > 0 ? `em ${dias} dias` : `há ${-dias} dias`;
}

/** Idade que o cliente completa no aniversário em questão. */
export function idadeNoAniversario(nascimento: string, dataAniversario: string): number | null {
  const n = Number(nascimento.slice(0, 4)), a = Number(dataAniversario.slice(0, 4));
  return Number.isFinite(n) && Number.isFinite(a) && a > n ? a - n : null;
}

/** Ordem da lista: vermelho (passou sem contato) primeiro, depois hoje, depois próximos; feitos por último. */
export function ordenarAniversarios<T extends { estado: EstadoAniversario; dias: number }>(lista: T[]): T[] {
  const peso: Record<EstadoAniversario, number> = { passou: 0, hoje: 1, proximo: 2, feito: 3 };
  return [...lista].sort((a, b) => peso[a.estado] - peso[b.estado] || a.dias - b.dias);
}
