import { localParaUtc, dataLocalISO, diaSemanaLocal, horaLocal } from "@/lib/time";

/**
 * Cálculo PURO de horários livres (sem banco) — testável.
 * Considera: horário de funcionamento (com intervalo de almoço), bloqueios/feriados,
 * agendamentos ocupados por recurso, duração do serviço, passo da grade,
 * antecedência mínima, janela máxima de dias e intervalo entre atendimentos.
 */

export type Horario = { dia_semana: number; abre: string; fecha: string };
export type Intervalo = { recurso_id: string | null; inicio: string | Date; fim: string | Date };
export type Recurso = { id: string; nome: string };
export type Slot = { inicio: Date; fim: Date; recursoId: string; recursoNome: string };

export type ParamsSlots = {
  agora: Date;
  offset: string;
  agenda: { antecedencia_min_horas: number; janela_dias: number; passo_min: number; intervalo_min: number };
  horarios: Horario[];
  recursos: Recurso[];
  ocupados: Intervalo[];
  bloqueios: Intervalo[];
  duracaoMin: number;
  dataPreferida?: string | null; // YYYY-MM-DD (local)
  periodo?: "manha" | "tarde" | null;
  limite?: number;
};

const ms = (d: string | Date) => (typeof d === "string" ? new Date(d).getTime() : d.getTime());

function sobrepoe(aIni: number, aFim: number, bIni: number, bFim: number) {
  return aIni < bFim && bIni < aFim;
}

function somarMin(hhmm: string, min: number): string {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function calcularSlots(p: ParamsSlots): Slot[] {
  const limite = p.limite ?? 6;
  const slots: Slot[] = [];
  const minimo = p.agora.getTime() + p.agenda.antecedencia_min_horas * 3600_000;
  const folga = p.agenda.intervalo_min * 60_000;

  const hojeLocal = dataLocalISO(p.agora, p.offset);
  const ultimoDia = new Date(localParaUtc(hojeLocal, "12:00", p.offset).getTime() + p.agenda.janela_dias * 86400_000);

  let inicioBusca = hojeLocal;
  if (p.dataPreferida && p.dataPreferida > hojeLocal) inicioBusca = p.dataPreferida;
  let cursor = localParaUtc(inicioBusca, "12:00", p.offset); // meio-dia evita bordas de fuso

  while (cursor.getTime() <= ultimoDia.getTime() && slots.length < limite) {
    const dataISO = dataLocalISO(cursor, p.offset);
    const dia = diaSemanaLocal(cursor, p.offset);
    const turnos = p.horarios
      .filter((h) => h.dia_semana === dia)
      .sort((a, b) => a.abre.localeCompare(b.abre));

    for (const turno of turnos) {
      let hora = turno.abre.slice(0, 5);
      const fecha = turno.fecha.slice(0, 5);
      while (somarMin(hora, p.duracaoMin) <= fecha && slots.length < limite) {
        const ini = localParaUtc(dataISO, hora, p.offset);
        const fim = new Date(ini.getTime() + p.duracaoMin * 60_000);
        const periodoOk =
          !p.periodo || (p.periodo === "manha" ? horaLocal(ini, p.offset) < "12:00" : horaLocal(ini, p.offset) >= "12:00");

        if (ini.getTime() >= minimo && periodoOk) {
          const iniT = ini.getTime();
          const fimT = fim.getTime();
          const bloqueioGeral = p.bloqueios.some((b) => b.recurso_id === null && sobrepoe(iniT, fimT, ms(b.inicio), ms(b.fim)));
          if (!bloqueioGeral) {
            const livre = p.recursos.find(
              (r) =>
                !p.bloqueios.some((b) => b.recurso_id === r.id && sobrepoe(iniT, fimT, ms(b.inicio), ms(b.fim))) &&
                !p.ocupados.some((o) => o.recurso_id === r.id && sobrepoe(iniT - folga, fimT + folga, ms(o.inicio), ms(o.fim))),
            );
            if (livre) slots.push({ inicio: ini, fim, recursoId: livre.id, recursoNome: livre.nome });
          }
        }
        hora = somarMin(hora, p.agenda.passo_min);
      }
    }
    // Com data preferida, só aquele dia (o agente pergunta outro dia se vier vazio)
    if (p.dataPreferida) break;
    cursor = new Date(cursor.getTime() + 86400_000);
  }
  return slots;
}
