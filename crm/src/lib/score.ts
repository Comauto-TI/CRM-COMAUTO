// Pontuação por regras (0-100), auditável pelo gerente.
// Pesos iniciais vindos da pesquisa; recalibrar com o histórico real do DuLeads.

const PESO_ORIGEM: Record<string, number> = {
  Indicação: 30,
  Loja: 25,
  Oficina: 20,
  Telefone: 15,
  WhatsApp: 12,
  Webmotors: 10,
  OLX: 10,
  "Site Comauto": 10,
  "Site VW": 10,
  Instagram: 3,
};

export type SinaisLead = {
  origem: string;
  testDrive: boolean;
  temTroca: boolean;
  querFinanciar: boolean;
  clienteDaCasa: boolean;
};

export function calcularPontuacao(s: SinaisLead): number {
  let pontos = PESO_ORIGEM[s.origem] ?? 5;
  if (s.testDrive) pontos += 30;
  if (s.temTroca) pontos += 20;
  if (s.querFinanciar) pontos += 10;
  if (s.clienteDaCasa) pontos += 10;
  return Math.min(pontos, 100);
}

export function faixa(pontuacao: number): "A" | "B" | "C" {
  if (pontuacao >= 60) return "A";
  if (pontuacao >= 30) return "B";
  return "C";
}
