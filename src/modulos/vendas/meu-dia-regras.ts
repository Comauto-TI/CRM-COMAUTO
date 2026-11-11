/**
 * "Meu dia" do vendedor — regras puras (testadas em tests/meu-dia.test.ts).
 * Responde "por onde eu começo hoje?": tarefas vencidas/de hoje, cartões parados além do prazo da etapa
 * e leads novos ainda sem nenhum contato humano.
 */
import { diasNaEtapa, semaforoEtapa } from "@/lib/quadro";

export type TarefaDia = { id: string; titulo: string; prazo: string; oportunidadeId: string; cliente: string; funil: string };
export type CartaoDia = {
  id: string; cliente: string; funil: string; etapa: string; ordemEtapa: number; primeiraOrdem: number;
  slaDias: number | null; entrouEm: string; criadoEm: string; teveContatoHumano: boolean;
};

/** Lead novo sem contato: está na 1ª etapa, ninguém da equipe registrou contato e já passou deste tempo. */
export const HORAS_LEAD_SEM_CONTATO = 2;

export function classificarMeuDia(tarefas: TarefaDia[], cartoes: CartaoDia[], agora: Date, fimDoDia: Date) {
  const atrasadas = tarefas.filter((t) => new Date(t.prazo) < agora).sort((a, b) => a.prazo.localeCompare(b.prazo));
  const hoje = tarefas.filter((t) => { const p = new Date(t.prazo); return p >= agora && p < fimDoDia; }).sort((a, b) => a.prazo.localeCompare(b.prazo));

  const limiteLead = agora.getTime() - HORAS_LEAD_SEM_CONTATO * 3_600_000;
  const semContato = cartoes
    .filter((c) => c.ordemEtapa === c.primeiraOrdem && !c.teveContatoHumano && new Date(c.criadoEm).getTime() <= limiteLead)
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  const idsSemContato = new Set(semContato.map((c) => c.id));

  const parados = cartoes
    .map((c) => ({ ...c, dias: diasNaEtapa(c.entrouEm, agora) }))
    .filter((c) => !idsSemContato.has(c.id) && semaforoEtapa(c.dias, c.slaDias) === "critico")
    .sort((a, b) => b.dias - (b.slaDias ?? 0) - (a.dias - (a.slaDias ?? 0))); // mais estourado primeiro

  return { atrasadas, hoje, semContato, parados, total: atrasadas.length + hoje.length + semContato.length + parados.length };
}
