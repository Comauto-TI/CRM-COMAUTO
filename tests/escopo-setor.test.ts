import { describe, it, expect } from "vitest";
import { setorDoMarketing, setorParaGravar, noEscopo } from "@/lib/escopo-setor";

describe("marketing por setor (decisão do Simão 12/11)", () => {
  it("admin e gerente da administração veem todos; os demais só o próprio setor", () => {
    expect(setorDoMarketing({ papel: "admin", setor: "administracao" })).toBeNull();
    expect(setorDoMarketing({ papel: "gerente", setor: "administracao" })).toBeNull();
    expect(setorDoMarketing({ papel: "gerente", setor: "pecas" })).toBe("pecas");
    expect(setorDoMarketing({ papel: "recepcao", setor: "oficina" })).toBe("oficina");
  });
  it("quem tem setor fixo grava no próprio setor mesmo se tentar outro; admin escolhe", () => {
    expect(setorParaGravar({ papel: "gerente", setor: "pecas" }, "vendas")).toBe("pecas");
    expect(setorParaGravar({ papel: "admin", setor: "administracao" }, "oficina")).toBe("oficina");
    expect(setorParaGravar({ papel: "admin", setor: "administracao" }, "invalido")).toBe("vendas");
  });
  it("registro de outro setor fica fora do escopo", () => {
    expect(noEscopo({ papel: "gerente", setor: "pecas" }, "vendas")).toBe(false);
    expect(noEscopo({ papel: "gerente", setor: "pecas" }, "pecas")).toBe(true);
    expect(noEscopo({ papel: "admin", setor: "administracao" }, "vendas")).toBe(true);
  });
});
