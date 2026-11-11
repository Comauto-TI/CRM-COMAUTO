import { describe, it, expect } from "vitest";
import { avaliarProntidao, resumoProntidao, configurado, TEMPLATES_ESSENCIAIS, type Fatos } from "@/lib/prontidao";

const tudoPronto: Fatos = {
  chaves: { anthropic: true, whatsappToken: true, whatsappNumero: true, whatsappSegredo: true, whatsappVerify: true, cron: true },
  appUrl: "https://painel.comauto.com.br",
  templatesAprovados: [...TEMPLATES_ESSENCIAIS],
  equipe: { admin: 1, recepcao: 2, vendedor: 5, recepcaoComAlerta: 1 },
  agenda: { servicos: 6, recursos: 3, horarios: 6 },
  qrAtivos: 2, botAtivo: true, nucleo: true, vendas: true,
};

describe("prontidão do piloto", () => {
  it("tudo configurado → pronto, sem bloqueio", () => {
    const r = resumoProntidao(avaliarProntidao(tudoPronto));
    expect(r.pronto).toBe(true);
    expect(r.bloqueia).toBe(0);
    expect(r.ok).toBe(r.total);
  });
  it("sem WhatsApp, sem HTTPS e sem vendedor → bloqueia, com ação clara", () => {
    const itens = avaliarProntidao({ ...tudoPronto, chaves: { ...tudoPronto.chaves, whatsappToken: false }, appUrl: "http://localhost:3000", equipe: { ...tudoPronto.equipe, vendedor: 0 } });
    const bloqueios = itens.filter((i) => i.estado === "bloqueia").map((i) => i.titulo);
    expect(bloqueios).toEqual(expect.arrayContaining(["Token da API do WhatsApp", "Painel no ar com HTTPS", "Vendedores cadastrados"]));
    expect(itens.find((i) => i.titulo === "Painel no ar com HTTPS")?.acao).toMatch(/Vercel/);
    expect(resumoProntidao(itens).pronto).toBe(false);
  });
  it("lista os modelos de mensagem que faltam aprovar", () => {
    const item = avaliarProntidao({ ...tudoPronto, templatesAprovados: ["lembrete_24h"] }).find((i) => i.titulo.startsWith("Modelos"));
    expect(item?.estado).toBe("bloqueia");
    expect(item?.titulo).toContain("1/5");
    expect(item?.acao).toContain("confirmacao_agendamento");
  });
  it("itens não críticos ficam como pendentes, não bloqueiam", () => {
    const r = resumoProntidao(avaliarProntidao({ ...tudoPronto, qrAtivos: 0, botAtivo: false }));
    expect(r).toMatchObject({ pronto: true, pendente: 2 });
  });
  it("marcadores de exemplo não contam como chave configurada", () => {
    expect(configurado("nao-configurado")).toBe(false);
    expect(configurado("")).toBe(false);
    expect(configurado("xxxx")).toBe(false);
    expect(configurado("abc123-real")).toBe(true);
    expect(configurado("curto", 16)).toBe(false);
  });
});
