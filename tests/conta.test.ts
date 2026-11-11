import { describe, it, expect } from "vitest";
import { validarNovaSenha } from "@/lib/conta";

describe("troca da própria senha — regra leve", () => {
  it("aceita 6+ caracteres sem exigir maiúscula/símbolo", () => {
    expect(validarNovaSenha("antiga1", "comauto", "comauto")).toBeNull();
  });
  it("recusa curta, sem confirmação igual, igual à atual ou sem a atual", () => {
    expect(validarNovaSenha("a", "12345", "12345")).toMatch(/6 caracteres/);
    expect(validarNovaSenha("a", "123456", "123457")).toMatch(/confirmação/);
    expect(validarNovaSenha("123456", "123456", "123456")).toMatch(/diferente/);
    expect(validarNovaSenha("", "123456", "123456")).toMatch(/atual/);
  });
});
