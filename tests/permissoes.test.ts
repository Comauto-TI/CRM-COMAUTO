import { describe, it, expect } from "vitest";
import { AREAS, PAPEIS, podeAcessar, atendeFila, supervisiona, papelValido, setorValido, type Area } from "@/lib/permissoes";

const areas = Object.keys(AREAS) as Area[];

describe("permissões por área (F0-3)", () => {
  it("admin entra em todas as áreas, de qualquer setor", () => {
    for (const a of areas) expect(podeAcessar({ papel: "admin", setor: "vendas" }, a)).toBe(true);
  });

  it("áreas exclusivas do admin ficam fechadas para os demais", () => {
    for (const p of PAPEIS.filter((x) => x !== "admin")) {
      for (const a of ["configuracoes", "seguranca", "lgpd"] as Area[]) {
        expect(podeAcessar({ papel: p, setor: "administracao" }, a)).toBe(false);
      }
    }
  });

  it("vendedor: vendas, clientes, busca e atendimento — sem oficina, peças nem financeiro", () => {
    const v = { papel: "vendedor", setor: "vendas" } as const;
    expect(podeAcessar(v, "vendas")).toBe(true);
    expect(podeAcessar(v, "clientes")).toBe(true);
    expect(podeAcessar(v, "busca")).toBe(true);
    expect(podeAcessar(v, "atendimento")).toBe(true);
    expect(podeAcessar(v, "oficina")).toBe(false);
    expect(podeAcessar(v, "pecas")).toBe(false);
    expect(podeAcessar(v, "financeiro")).toBe(false);
    expect(podeAcessar(v, "campanhas")).toBe(false);
  });

  it("consultor técnico: oficina e agenda, sem vendas", () => {
    const c = { papel: "consultor_tecnico", setor: "oficina" } as const;
    expect(podeAcessar(c, "oficina")).toBe(true);
    expect(podeAcessar(c, "agenda")).toBe(true);
    expect(podeAcessar(c, "vendas")).toBe(false);
  });

  it("peças: só o setor de peças e a ficha do cliente", () => {
    const p = { papel: "pecas", setor: "pecas" } as const;
    expect(podeAcessar(p, "pecas")).toBe(true);
    expect(podeAcessar(p, "clientes")).toBe(true);
    expect(podeAcessar(p, "atendimento")).toBe(false);
    expect(podeAcessar(p, "vendas")).toBe(false);
  });

  it("gerente só entra no próprio setor (ou em todos, se for da administração)", () => {
    expect(podeAcessar({ papel: "gerente", setor: "vendas" }, "vendas")).toBe(true);
    expect(podeAcessar({ papel: "gerente", setor: "vendas" }, "oficina")).toBe(false);
    expect(podeAcessar({ papel: "gerente", setor: "oficina" }, "pecas")).toBe(false);
    for (const a of ["vendas", "oficina", "pecas"] as Area[]) {
      expect(podeAcessar({ papel: "gerente", setor: "administracao" }, a)).toBe(true);
    }
  });

  it("atendente legado = recepção (mantém o que já tinha antes da plataforma)", () => {
    for (const a of ["atendimento", "agenda", "clientes", "links", "followups"] as Area[]) {
      expect(podeAcessar({ papel: "atendente", setor: "administracao" }, a)).toBe(true);
      expect(podeAcessar({ papel: "recepcao", setor: "administracao" }, a)).toBe(true);
    }
    expect(podeAcessar({ papel: "atendente", setor: "administracao" }, "campanhas")).toBe(false);
    expect(podeAcessar({ papel: "atendente", setor: "administracao" }, "financeiro")).toBe(false);
  });

  it("financeiro: financeiro e custos, sem atendimento", () => {
    const f = { papel: "financeiro", setor: "administracao" } as const;
    expect(podeAcessar(f, "financeiro")).toBe(true);
    expect(podeAcessar(f, "custos_config")).toBe(true);
    expect(podeAcessar(f, "atendimento")).toBe(false);
  });

  it("todo papel entra no início e nas notificações", () => {
    for (const p of PAPEIS) {
      expect(podeAcessar({ papel: p, setor: "vendas" }, "inicio")).toBe(true);
      expect(podeAcessar({ papel: p, setor: "vendas" }, "notificacoes")).toBe(true);
    }
  });

  it("fila de atendimento (popup) e supervisão", () => {
    expect(atendeFila({ papel: "recepcao", setor: "administracao" })).toBe(true);
    expect(atendeFila({ papel: "vendedor", setor: "vendas" })).toBe(false);
    expect(supervisiona({ papel: "gerente" })).toBe(true);
    expect(supervisiona({ papel: "atendente" })).toBe(false);
  });

  it("validação de valores vindos do banco/formulário", () => {
    expect(papelValido("vendedor")).toBe(true);
    expect(papelValido("root")).toBe(false);
    expect(papelValido(null)).toBe(false);
    expect(setorValido("oficina")).toBe(true);
    expect(setorValido("rh")).toBe(false);
  });
});

describe("métricas de vendas por setor", () => {
  it("gerente de Vendas e da administração veem; gerente de Peças/Oficina não", () => {
    expect(podeAcessar({ papel: "gerente", setor: "vendas" }, "metricas")).toBe(true);
    expect(podeAcessar({ papel: "gerente", setor: "administracao" }, "metricas")).toBe(true);
    expect(podeAcessar({ papel: "gerente", setor: "pecas" }, "metricas")).toBe(false);
    expect(podeAcessar({ papel: "gerente", setor: "oficina" }, "metricas")).toBe(false);
    expect(podeAcessar({ papel: "financeiro", setor: "administracao" }, "metricas")).toBe(true);
  });
});

describe("agenda é da Oficina", () => {
  it("gerente de Oficina/administração vê; gerente de Vendas/Peças não; recepção e consultor veem", () => {
    expect(podeAcessar({ papel: "gerente", setor: "oficina" }, "agenda")).toBe(true);
    expect(podeAcessar({ papel: "gerente", setor: "administracao" }, "agenda")).toBe(true);
    expect(podeAcessar({ papel: "gerente", setor: "vendas" }, "agenda")).toBe(false);
    expect(podeAcessar({ papel: "gerente", setor: "pecas" }, "agenda")).toBe(false);
    expect(podeAcessar({ papel: "recepcao", setor: "oficina" }, "agenda")).toBe(true);
    expect(podeAcessar({ papel: "consultor_tecnico", setor: "oficina" }, "agenda")).toBe(true);
  });
});

describe("métricas por pessoa", () => {
  it("vendedor acessa Métricas (a página recorta só as oportunidades dele)", () => {
    expect(podeAcessar({ papel: "vendedor", setor: "vendas" }, "metricas")).toBe(true);
    expect(podeAcessar({ papel: "pecas", setor: "pecas" }, "metricas")).toBe(false);
    expect(podeAcessar({ papel: "recepcao", setor: "oficina" }, "metricas")).toBe(false);
  });
});
