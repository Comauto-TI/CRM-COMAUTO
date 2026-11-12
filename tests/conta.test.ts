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

import { validarCadastro } from "@/lib/convites";
describe("cadastro pelo link", () => {
  it("valida nome, e-mail, senha leve e confirmação", () => {
    expect(validarCadastro("Ana", "ana@comauto.com", "abc123", "abc123")).toBeNull();
    expect(validarCadastro("A", "ana@comauto.com", "abc123", "abc123")).toMatch(/nome/);
    expect(validarCadastro("Ana", "ana@", "abc123", "abc123")).toMatch(/E-mail/);
    expect(validarCadastro("Ana", "ana@comauto.com", "abc12", "abc12")).toMatch(/6 caracteres/);
    expect(validarCadastro("Ana", "ana@comauto.com", "abc123", "abc124")).toMatch(/confirmação/);
  });
});

import { mascararSeTelefone } from "@/lib/phone";
describe("quem confirmou: telefone sempre mascarado (LGPD)", () => {
  it("mascara telefone e mantém e-mail da equipe", () => {
    expect(mascararSeTelefone("5511900000099")).not.toContain("900000");
    expect(mascararSeTelefone("recepcao@comauto.com")).toBe("recepcao@comauto.com");
    expect(mascararSeTelefone(null)).toBe("—");
  });
});
