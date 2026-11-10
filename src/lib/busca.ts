/**
 * Busca global (F0-4) — parte pura: entende o que a pessoa digitou.
 * CPF (11 dígitos), CNPJ (14), telefone (10–13 dígitos), placa (antiga ou Mercosul) ou nome.
 */

export type TipoBusca = "cpf" | "cnpj" | "telefone" | "cpf_ou_telefone" | "placa" | "nome";
export type Busca = { tipo: TipoBusca; valor: string };

const PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;

export function interpretarBusca(entrada: string): Busca | null {
  const bruto = (entrada ?? "").trim().slice(0, 80);
  if (bruto.length < 2) return null;

  const placa = bruto.toUpperCase().replace(/[\s-]/g, "");
  if (PLACA.test(placa)) return { tipo: "placa", valor: placa };

  const digitos = bruto.replace(/\D/g, "");
  const soNumeros = /^[\d\s().+\-/]+$/.test(bruto);
  if (soNumeros && digitos.length >= 4) {
    if (digitos.length === 14) return { tipo: "cnpj", valor: digitos };
    // 11 dígitos: CPF formatado → CPF; só dígitos com DV de CPF válido → procura em CPF e telefone; resto → telefone
    if (digitos.length === 11) {
      if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(bruto)) return { tipo: "cpf", valor: digitos };
      if (/^\d{11}$/.test(bruto) && cpfValido(digitos)) return { tipo: "cpf_ou_telefone", valor: digitos };
    }
    return { tipo: "telefone", valor: digitos.replace(/^0+/, "") };
  }

  // nome: remove caracteres que quebram o filtro do PostgREST
  const nome = bruto.replace(/[%,()*\\:"']/g, " ").replace(/\s+/g, " ").trim();
  if (nome.length < 2) return null;
  return { tipo: "nome", valor: nome };
}

export function cpfValido(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string, pesoIni: number) => {
    let s = 0;
    for (let i = 0; i < base.length; i++) s += Number(base[i]) * (pesoIni - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

/** LGPD: documento sempre mascarado na tela — ***.456.789-** / **.345.678/0001-** */
export function mascararDocumento(doc: string | null | undefined): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  return d ? "***" : "";
}
