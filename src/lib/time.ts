/**
 * Data/hora no fuso da unidade. O Brasil não tem horário de verão desde 2019,
 * então usamos offset fixo configurável (padrão -03:00).
 */
export const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function offsetMinutos(offset: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return -180;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -v : v;
}

/** "Relógio local": Date cujos campos UTC representam a hora local. */
export function paraLocal(d: Date, offset: string): Date {
  return new Date(d.getTime() + offsetMinutos(offset) * 60_000);
}

/** Instante UTC a partir de data local (YYYY-MM-DD) e hora local (HH:MM). */
export function localParaUtc(dataISO: string, hora: string, offset: string): Date {
  return new Date(`${dataISO}T${hora.length === 5 ? hora + ":00" : hora}${offset}`);
}

export function dataLocalISO(d: Date, offset: string): string {
  return paraLocal(d, offset).toISOString().slice(0, 10);
}

export function horaLocal(d: Date, offset: string): string {
  return paraLocal(d, offset).toISOString().slice(11, 16);
}

export function diaSemanaLocal(d: Date, offset: string): number {
  return paraLocal(d, offset).getUTCDay();
}

/** "terça, 12/11 às 14:30" */
export function formatarDataHora(d: Date | string, offset: string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const l = paraLocal(dt, offset);
  const dd = String(l.getUTCDate()).padStart(2, "0");
  const mm = String(l.getUTCMonth() + 1).padStart(2, "0");
  return `${DIAS[l.getUTCDay()]}, ${dd}/${mm} às ${horaLocal(dt, offset)}`;
}

export function formatarBRL(v: number, casas = 2): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: Math.max(casas, 2),
  });
}

/** Dentro do horário permitido para envios iniciados pela empresa? */
export function dentroHorarioEnvio(agora: Date, cfg: { inicio: string; fim: string; dias: number[] }, offset: string): boolean {
  if (!cfg.dias.includes(diaSemanaLocal(agora, offset))) return false;
  const h = horaLocal(agora, offset);
  return h >= cfg.inicio && h < cfg.fim;
}

/** Janela de atendimento de 24h aberta? (conta a partir da última mensagem RECEBIDA do cliente) */
export function janela24hAberta(ultimoContatoCliente: string | Date | null | undefined, agora = new Date()): boolean {
  if (!ultimoContatoCliente) return false;
  const t = typeof ultimoContatoCliente === "string" ? new Date(ultimoContatoCliente) : ultimoContatoCliente;
  // margem de 10 min para não arriscar texto livre com a janela fechando
  return agora.getTime() - t.getTime() < 24 * 3600_000 - 10 * 60_000;
}
