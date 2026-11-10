import { describe, it, expect } from "vitest";
import { interpretarBusca, cpfValido, mascararDocumento } from "@/lib/busca";

describe("busca global — interpretar o que foi digitado", () => {
  it("CPF formatado ou só dígitos válidos", () => {
    expect(interpretarBusca("529.982.247-25")).toEqual({ tipo: "cpf", valor: "52998224725" });
    // só dígitos e DV válido: pode ser CPF ou celular → procura nos dois campos
    expect(interpretarBusca("52998224725")).toEqual({ tipo: "cpf_ou_telefone", valor: "52998224725" });
  });
  it("CNPJ", () => {
    expect(interpretarBusca("11.222.333/0001-81")).toEqual({ tipo: "cnpj", valor: "11222333000181" });
  });
  it("celular com DDD (11 dígitos começando com 9 no 3º) é telefone, não CPF", () => {
    expect(interpretarBusca("(51) 99999-8888")).toEqual({ tipo: "telefone", valor: "51999998888" });
    expect(interpretarBusca("+55 51 99999-8888")).toEqual({ tipo: "telefone", valor: "5551999998888" });
  });
  it("pedaço do telefone (busca parcial)", () => {
    expect(interpretarBusca("8888")).toEqual({ tipo: "telefone", valor: "8888" });
  });
  it("placa antiga e Mercosul, com ou sem hífen", () => {
    expect(interpretarBusca("abc-1234")).toEqual({ tipo: "placa", valor: "ABC1234" });
    expect(interpretarBusca("BRA2E19")).toEqual({ tipo: "placa", valor: "BRA2E19" });
  });
  it("nome, sem caracteres que quebram o filtro", () => {
    expect(interpretarBusca("  Maria  Souza ")).toEqual({ tipo: "nome", valor: "Maria Souza" });
    expect(interpretarBusca("maria,nome.eq.x")?.valor).not.toContain(",");
    expect(interpretarBusca("joão (pai)")?.valor).toBe("joão pai");
  });
  it("entradas curtas ou vazias não buscam", () => {
    expect(interpretarBusca("")).toBeNull();
    expect(interpretarBusca("a")).toBeNull();
    expect(interpretarBusca("%%")).toBeNull();
  });
});

describe("CPF e máscara LGPD", () => {
  it("valida dígitos verificadores", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
  });
  it("mascara documento na tela", () => {
    expect(mascararDocumento("52998224725")).toBe("***.982.247-**");
    expect(mascararDocumento("11222333000181")).toBe("**.222.333/0001-**");
    expect(mascararDocumento(null)).toBe("");
  });
});

import { linkInternoSeguro } from "@/lib/notificacoes";
describe("notificações — link só para dentro do painel", () => {
  it("aceita caminhos do painel", () => {
    expect(linkInternoSeguro("/painel/conversas?c=1")).toBe("/painel/conversas?c=1");
    expect(linkInternoSeguro("/painel")).toBe("/painel");
  });
  it("recusa links externos ou truques", () => {
    expect(linkInternoSeguro("https://evil.com")).toBeNull();
    expect(linkInternoSeguro("//evil.com/painel")).toBeNull();
    expect(linkInternoSeguro("/painelfalso")).toBeNull();
    expect(linkInternoSeguro("javascript:alert(1)")).toBeNull();
    expect(linkInternoSeguro(null)).toBeNull();
  });
});
