import { describe, it, expect } from "vitest";
import {
  veTodasOportunidades, podeMexer, podeAssumir, diasNaEtapa, semaforoEtapa, faixaFunil, taxaConversao, posicaoEntre, ehChave, PAGAMENTOS,
} from "@/modulos/vendas/regras";

const vendedor = { id: "v1", papel: "vendedor" as const };
const outro = { id: "v2", papel: "vendedor" as const };
const gerente = { id: "g1", papel: "gerente" as const };

describe("vendas — quem vê e quem mexe", () => {
  it("gerente e admin veem tudo; vendedor não", () => {
    expect(veTodasOportunidades(gerente)).toBe(true);
    expect(veTodasOportunidades({ id: "a", papel: "admin" })).toBe(true);
    expect(veTodasOportunidades(vendedor)).toBe(false);
  });
  it("vendedor só mexe no próprio cartão; gerente em qualquer um", () => {
    expect(podeMexer(vendedor, { vendedor_id: "v1" })).toBe(true);
    expect(podeMexer(outro, { vendedor_id: "v1" })).toBe(false);
    expect(podeMexer(gerente, { vendedor_id: "v1" })).toBe(true);
    expect(podeMexer(vendedor, { vendedor_id: null })).toBe(false); // precisa assumir antes
  });
  it("lead sem dono pode ser assumido por vendedor; com dono, não", () => {
    expect(podeAssumir(vendedor, { vendedor_id: null })).toBe(true);
    expect(podeAssumir(vendedor, { vendedor_id: "v2" })).toBe(false);
    expect(podeAssumir({ id: "r", papel: "recepcao" }, { vendedor_id: null })).toBe(false);
  });
});

describe("vendas — tempo na etapa e semáforo", () => {
  const agora = new Date("2026-11-10T12:00:00Z");
  it("conta dias inteiros e nunca negativo", () => {
    expect(diasNaEtapa("2026-11-07T12:00:00Z", agora)).toBe(3);
    expect(diasNaEtapa("2026-11-12T12:00:00Z", agora)).toBe(0);
    expect(diasNaEtapa("lixo", agora)).toBe(0);
  });
  it("verde, âmbar a 70% do prazo, vermelho estourado", () => {
    expect(semaforoEtapa(1, 7)).toBe("ok");
    expect(semaforoEtapa(5, 7)).toBe("aviso");
    expect(semaforoEtapa(8, 7)).toBe("critico");
    expect(semaforoEtapa(30, null)).toBe("neutro");
  });
});

describe("vendas — funil e conversão", () => {
  const etapas = [
    { etapa_id: "1", nome: "Novo", ordem: 1, tipo: "aberta" as const, abertas: 5, alcancaram: 40 },
    { etapa_id: "2", nome: "Qualificado", ordem: 3, tipo: "aberta" as const, abertas: 3, alcancaram: 20 },
    { etapa_id: "6", nome: "Ganho", ordem: 6, tipo: "ganho" as const, abertas: 0, alcancaram: 4 },
    { etapa_id: "7", nome: "Perdido", ordem: 7, tipo: "perdido" as const, abertas: 0, alcancaram: 10 },
  ];
  it("faixa em % da entrada, sem a etapa Perdido", () => {
    expect(faixaFunil(etapas).map((e) => e.pct)).toEqual([100, 50, 10]);
    expect(faixaFunil(etapas).some((e) => e.nome === "Perdido")).toBe(false);
  });
  it("funil vazio não divide por zero", () => {
    expect(faixaFunil([]).length).toBe(0);
    expect(faixaFunil(etapas.map((e) => ({ ...e, alcancaram: 0 })))[0].pct).toBe(0);
  });
  it("conversão = ganhos / fechados; sem fechados → null", () => {
    expect(taxaConversao(4, 6)).toBe(40);
    expect(taxaConversao(0, 0)).toBeNull();
  });
});

describe("vendas — utilitários", () => {
  it("posição fracionária entre vizinhos", () => {
    expect(posicaoEntre(null, null)).toBe(1000);
    expect(posicaoEntre(1000, 2000)).toBe(1500);
    expect(posicaoEntre(null, 1000)).toBe(0);
    expect(posicaoEntre(3000, null)).toBe(4000);
  });
  it("valida chave de domínio (não aceita protótipo)", () => {
    expect(ehChave(PAGAMENTOS, "financiamento")).toBe(true);
    expect(ehChave(PAGAMENTOS, "toString")).toBe(false);
    expect(ehChave(PAGAMENTOS, 1)).toBe(false);
  });
});

import { destinoDoLead, escolherVendedor, temperaturaInicial } from "@/modulos/vendas/regras";
describe("F2-1 — roteamento do lead do WhatsApp", () => {
  it("novo/seminovo viram cartão no funil certo; oficina agenda; peças e incerto vão para pessoas", () => {
    expect(destinoDoLead("novo")).toEqual({ tipo: "funil", funil: "novos" });
    expect(destinoDoLead("seminovo")).toEqual({ tipo: "funil", funil: "seminovos" });
    expect(destinoDoLead("oficina")).toEqual({ tipo: "agenda" });
    expect(destinoDoLead("pecas")).toEqual({ tipo: "pecas" });
    expect(destinoDoLead("indefinido")).toEqual({ tipo: "triagem" });
  });
  it("vendedor da carteira tem prioridade, se continuar ativo", () => {
    const vs = [{ id: "a", abertas: 9, ultimoLeadEm: null }, { id: "b", abertas: 0, ultimoLeadEm: null }];
    expect(escolherVendedor("a", vs)).toBe("a");
    expect(escolherVendedor("saiu-da-empresa", vs)).toBe("b");
  });
  it("rodízio: menos abertas; empate → quem recebeu lead há mais tempo", () => {
    const vs = [
      { id: "a", abertas: 2, ultimoLeadEm: "2026-11-10T10:00:00Z" },
      { id: "b", abertas: 2, ultimoLeadEm: "2026-11-09T10:00:00Z" },
      { id: "c", abertas: 5, ultimoLeadEm: null },
    ];
    expect(escolherVendedor(null, vs)).toBe("b");
    expect(escolherVendedor(null, [])).toBeNull();
  });
  it("temperatura inicial pelo prazo e pagamento", () => {
    expect(temperaturaInicial("imediato", false)).toBe("quente");
    expect(temperaturaInicial("ate_30_dias", true)).toBe("quente");
    expect(temperaturaInicial("ate_30_dias", false)).toBe("morno");
    expect(temperaturaInicial("sem_prazo", true)).toBe("frio");
  });
});

import { lerValorBRL, valorParaCampo } from "@/modulos/vendas/regras";
describe("F1-V-001 — valor em reais ida e volta, sem perder centavos", () => {
  it("lê os formatos que o vendedor digita", () => {
    expect(lerValorBRL("150.000")).toBe(150000);
    expect(lerValorBRL("150.000,50")).toBe(150000.5);
    expect(lerValorBRL("12500,5")).toBe(12500.5);
    expect(lerValorBRL("12500.5")).toBe(12500.5);
    expect(lerValorBRL("R$ 1.234,56")).toBe(1234.56);
    expect(lerValorBRL("")).toBeNull();
    expect(lerValorBRL("abc")).toBeNull();
    expect(lerValorBRL("-10")).toBeNull();
  });
  it("salvar sem editar preserva o valor (12.500,50)", () => {
    const campo = valorParaCampo(12500.5);
    expect(campo).toBe("12.500,50");
    expect(lerValorBRL(campo)).toBe(12500.5);
    expect(lerValorBRL(valorParaCampo("159990.00"))).toBe(159990);
    expect(valorParaCampo(null)).toBe("");
  });
});

import { completarQualificacao } from "@/modulos/vendas/regras";
describe("F2-1 — cliente volta a falar: completa sem apagar nem rebaixar", () => {
  const vazio = { veiculo_interesse: null, pagamento: "indefinido", prazo_compra: "indefinido", tem_troca: false, troca_descricao: null };
  it("'a definir' da conversa não apaga o que o vendedor preencheu", () => {
    expect(completarQualificacao("qualificado", vazio, { temTroca: null, clienteConfirmou: false })).toEqual({});
  });
  it("nunca rebaixa a qualificação; só sobe de 'a verificar' para 'confirmado pelo cliente'", () => {
    expect(completarQualificacao("confirmado_cliente", vazio, { temTroca: null, clienteConfirmou: false })).not.toHaveProperty("qualificacao");
    expect(completarQualificacao("a_verificar", vazio, { temTroca: null, clienteConfirmou: true })).toEqual({ qualificacao: "confirmado_cliente" });
    expect(completarQualificacao("desqualificado", vazio, { temTroca: null, clienteConfirmou: true })).not.toHaveProperty("qualificacao");
  });
  it("dado concreto novo entra", () => {
    const p = completarQualificacao("a_verificar", { ...vazio, veiculo_interesse: "Polo", pagamento: "a_vista", troca_descricao: "Gol 2018" }, { temTroca: true, clienteConfirmou: false });
    expect(p).toEqual({ veiculo_interesse: "Polo", pagamento: "a_vista", tem_troca: true, troca_descricao: "Gol 2018" });
    expect(completarQualificacao("a_verificar", vazio, { temTroca: false, clienteConfirmou: false })).toEqual({ tem_troca: false, troca_descricao: null });
  });
});

import { tempoAtras, ordenarCartoes } from "@/modulos/vendas/regras";
describe("quadro estilo referência — tempo e ordenação", () => {
  const agora = new Date("2026-11-10T12:00:00Z");
  it("tempo relativo", () => {
    expect(tempoAtras("2026-11-10T11:59:40Z", agora)).toBe("agora");
    expect(tempoAtras("2026-11-10T11:15:00Z", agora)).toBe("45 min atrás");
    expect(tempoAtras("2026-11-10T03:00:00Z", agora)).toBe("9 h atrás");
    expect(tempoAtras("2026-10-24T12:00:00Z", agora)).toBe("17 d atrás");
    expect(tempoAtras(null, agora)).toBe("—");
  });
  it("ordenações", () => {
    const base = { posicao: 0, criado_em: "2026-11-01T00:00:00Z", valor_estimado: 0, entrou_na_etapa_em: "2026-11-01T00:00:00Z", ultimo_contato_em: null as string | null };
    const a = { ...base, id: "a", posicao: 2, valor_estimado: 100, criado_em: "2026-11-09T00:00:00Z", entrou_na_etapa_em: "2026-11-09T00:00:00Z", ultimo_contato_em: "2026-11-09T00:00:00Z" };
    const b = { ...base, id: "b", posicao: 1, valor_estimado: 900, criado_em: "2026-11-01T00:00:00Z", entrou_na_etapa_em: "2026-10-01T00:00:00Z", ultimo_contato_em: null };
    expect(ordenarCartoes([a, b], "posicao").map((c) => c.id)).toEqual(["b", "a"]);
    expect(ordenarCartoes([a, b], "recentes").map((c) => c.id)).toEqual(["a", "b"]);
    expect(ordenarCartoes([a, b], "valor").map((c) => c.id)).toEqual(["b", "a"]);
    expect(ordenarCartoes([a, b], "parado").map((c) => c.id)).toEqual(["b", "a"]);
    expect(ordenarCartoes([a, b], "contato").map((c) => c.id)).toEqual(["b", "a"]); // nunca contatado primeiro
  });
});

import { podeTransferir, distribuirRodizio, podeReceberLead } from "@/modulos/vendas/regras";
describe("transferência de leads", () => {
  it("dono ou supervisor transfere; colega não; lead sem dono só o supervisor", () => {
    expect(podeTransferir({ id: "v1", papel: "vendedor" }, { vendedor_id: "v1" })).toBe(true);
    expect(podeTransferir({ id: "v2", papel: "vendedor" }, { vendedor_id: "v1" })).toBe(false);
    expect(podeTransferir({ id: "v1", papel: "vendedor" }, { vendedor_id: null })).toBe(false);
    expect(podeTransferir({ id: "g", papel: "gerente" }, { vendedor_id: "v1" })).toBe(true);
  });
  it("férias: divide entre os que ficam, equilibrando a carga", () => {
    const r = distribuirRodizio(5, [{ id: "a", abertas: 3, ultimoLeadEm: null }, { id: "b", abertas: 0, ultimoLeadEm: null }]);
    expect(r).toEqual(["b", "b", "b", "a", "b"]); // b vai de 0 a 3 empatando com a; depois alterna
    expect(r.filter((x) => x === "a").length + r.filter((x) => x === "b").length).toBe(5);
    expect(distribuirRodizio(3, [])).toEqual([]);
  });
});

describe("podeReceberLead (F1-V-T001)", () => {
  const base = { papel: "vendedor", setor: "vendas", ativo: true, unidade: "comauto", extras: [] as string[] };
  it("vendedor ativo da unidade recebe", () => expect(podeReceberLead(base, "comauto")).toBe(true));
  it("inativo não recebe", () => expect(podeReceberLead({ ...base, ativo: false }, "comauto")).toBe(false));
  it("gerente de Oficina não recebe lead de Vendas", () => expect(podeReceberLead({ ...base, papel: "gerente", setor: "oficina" }, "comauto")).toBe(false));
  it("gerente de Vendas e gerente da administração recebem", () => {
    expect(podeReceberLead({ ...base, papel: "gerente", setor: "vendas" }, "comauto")).toBe(true);
    expect(podeReceberLead({ ...base, papel: "gerente", setor: "administracao" }, "comauto")).toBe(true);
  });
  it("papéis fora de vendedor/gerente não recebem", () => {
    for (const papel of ["admin", "recepcao", "pecas", "financeiro"]) expect(podeReceberLead({ ...base, papel }, "comauto")).toBe(false);
  });
  it("outra unidade só com acesso adicional", () => {
    expect(podeReceberLead(base, "motomecanica")).toBe(false);
    expect(podeReceberLead({ ...base, extras: ["motomecanica"] }, "motomecanica")).toBe(true);
  });
});

import { pontuarLead } from "@/modulos/vendas/regras";
describe("pontuarLead (F7)", () => {
  const agora = new Date("2026-11-11T12:00:00Z");
  const base = { temperatura: "morno", prazo: "indefinido", pagamento: "indefinido", qualificacao: "a_verificar", temTroca: false, valor: null, ultimoContatoEm: null };
  it("lead quente, imediato, à vista, qualificado e recém-contatado é alta (teto 100)", () => {
    const p = pontuarLead({ temperatura: "quente", prazo: "imediato", pagamento: "a_vista", qualificacao: "qualificado", temTroca: true, valor: 90000, ultimoContatoEm: "2026-11-11T08:00:00Z" }, agora);
    expect(p.nota).toBe(100);
    expect(p.faixa).toBe("alta");
  });
  it("lead morno sem dados é baixa e mostra os motivos", () => {
    const p = pontuarLead(base, agora);
    expect(p.nota).toBe(18);
    expect(p.faixa).toBe("baixa");
    expect(p.motivos.length).toBeGreaterThan(0);
  });
  it("sem contato há mais de 14 dias perde pontos; desqualificado é zero", () => {
    const fresco = pontuarLead({ ...base, ultimoContatoEm: "2026-11-10T12:00:00Z" }, agora).nota;
    const velho = pontuarLead({ ...base, ultimoContatoEm: "2026-10-01T12:00:00Z" }, agora).nota;
    expect(fresco - velho).toBe(20);
    expect(pontuarLead({ ...base, qualificacao: "desqualificado", temperatura: "quente" }, agora).nota).toBe(0);
  });
  it("faixa média entre 35 e 59", () => {
    expect(pontuarLead({ ...base, temperatura: "quente", prazo: "ate_90_dias" }, agora).faixa).toBe("media");
  });
});
