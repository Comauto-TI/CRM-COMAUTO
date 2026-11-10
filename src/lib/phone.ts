/** Normaliza para dígitos com DDI. Aceita "(51) 99999-8888", "+55 51 99999-8888", "5551999998888". */
export function normalizarTelefone(entrada: string, ddiPadrao = "55"): string | null {
  const digitos = (entrada ?? "").replace(/\D/g, "");
  if (!digitos) return null;
  let n = digitos.replace(/^0+/, "");
  if (n.length === 10 || n.length === 11) n = ddiPadrao + n; // só DDD + número
  if (n.length < 12 || n.length > 15) return null;
  if (n.startsWith("55")) {
    const ddd = Number(n.slice(2, 4));
    if (ddd < 11 || ddd > 99) return null;
    const local = n.slice(4);
    if (local.length !== 8 && local.length !== 9) return null;
    if (local.length === 9 && local[0] !== "9") return null;
  }
  return n;
}

/** Mascara telefone para logs e telas: 5551*****8888 */
export function mascararTelefone(t: string): string {
  if (!t || t.length < 8) return "****";
  return t.slice(0, 4) + "*".repeat(Math.max(0, t.length - 8)) + t.slice(-4);
}
