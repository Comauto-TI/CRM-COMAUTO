const FUSO = "America/Sao_Paulo";

export function dataHora(d: Date): string {
  return d.toLocaleString("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function data(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// Dias entre hoje e uma data ISO (yyyy-mm-dd). Negativo = no passado.
export function diasAte(iso: string): number {
  const hoje = new Date(new Date().toLocaleDateString("en-CA", { timeZone: FUSO }));
  return Math.round((new Date(iso).getTime() - hoje.getTime()) / (24 * 60 * 60 * 1000));
}

export function linkWhatsApp(telefone: string): string {
  return `https://wa.me/55${telefone.replace(/\D/g, "")}`;
}

export const NOME_ETAPA = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  proposta: "Proposta",
  ganho: "Ganho",
  perdido: "Perdido",
} as const;
