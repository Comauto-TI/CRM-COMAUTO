import { describe, it, expect } from "vitest";
import { lerCSV, sugerirMapeamento, lerData, lerTelefone, prepararClientes, revalidar } from "@/modulos/importacao/regras";

describe("importação de clientes — leitura do CSV", () => {
  it("detecta ponto e vírgula, aspas com separador dentro, CRLF e BOM", () => {
    const t = '﻿Nome;Celular;Cidade\r\n"Silva; Maria";(51) 99999-8888;Porto Alegre\r\n\r\nJoão;51 98888-7777;"Canoas"\r\n';
    expect(lerCSV(t)).toEqual([["Nome", "Celular", "Cidade"], ["Silva; Maria", "(51) 99999-8888", "Porto Alegre"], ["João", "51 98888-7777", "Canoas"]]);
  });
  it("detecta vírgula e aspas escapadas", () => {
    expect(lerCSV('a,b\n"x ""y""",2')).toEqual([["a", "b"], ['x "y"', "2"]]);
  });
});

describe("mapeamento sugerido", () => {
  it("reconhece cabeçalhos comuns com acento e variações", () => {
    const m = sugerirMapeamento(["Cód. Cliente", "Nome/Razão Social", "CPF/CNPJ", "Fone Celular", "E-mail", "Município", "Dt. Nascimento"]);
    expect(m).toMatchObject({ codigo_externo: 0, nome: 1, cpf_cnpj: 2, telefone: 3, email: 4, cidade: 5, data_nascimento: 6 });
  });
});

describe("datas e telefones", () => {
  it("aceita dd/mm/aaaa, dd-mm-aaaa e aaaa-mm-dd; recusa data impossível ou futura", () => {
    const hoje = new Date("2026-11-11T12:00:00Z");
    expect(lerData("05/03/1980", hoje)).toBe("1980-03-05");
    expect(lerData("5-3-1980", hoje)).toBe("1980-03-05");
    expect(lerData("1980-03-05 00:00:00", hoje)).toBe("1980-03-05");
    expect(lerData("31/02/1980", hoje)).toBeNull();
    expect(lerData("01/01/2030", hoje)).toBeNull();
  });
  it("prefere o celular quando há fixo e celular no mesmo campo", () => {
    expect(lerTelefone("(51) 3333-4444 / (51) 99999-8888")).toBe("5551999998888");
    expect(lerTelefone("(51) 3333-4444")).toBe("555133334444");
    expect(lerTelefone("sem telefone")).toBeNull();
  });
});

describe("preparar clientes", () => {
  const cab = ["Nome", "Celular", "CPF", "Email", "Nascimento"];
  const mapa = { nome: 0, telefone: 1, cpf_cnpj: 2, email: 3, data_nascimento: 4 };
  it("separa erros, avisos e duplicados do próprio arquivo", () => {
    const r = prepararClientes([
      cab,
      ["Ana", "(51) 99999-8888", "529.982.247-25", "ana@x.com", "05/03/1980"],
      ["Sem Fone", "", "", "", ""],
      ["Ana de novo (sem o 9)", "(51) 9999-8888", "", "", ""],
      ["Beto", "51 98888-7777", "111.111.111-11", "beto@", "99/99/9999"],
      ["Mesmo CPF da Ana", "51 97777-6666", "52998224725", "", ""],
    ], mapa, true);
    expect(r.clientes.map((c) => c.nome)).toEqual(["Ana", "Beto"]);
    expect(r.erros).toEqual([{ linha: 3, motivo: "sem telefone válido" }]);
    expect(r.duplicadas).toBe(2);
    expect(r.avisos.map((a) => a.linha)).toEqual([5, 5, 5]);
    expect(r.clientes[0]).toMatchObject({ telefone: "5551999998888", cpf_cnpj: "52998224725", email: "ana@x.com", data_nascimento: "1980-03-05" });
    expect(r.clientes[1]).toMatchObject({ cpf_cnpj: null, email: null, data_nascimento: null });
  });
  it("servidor revalida e recusa telefone adulterado", () => {
    expect(revalidar({ telefone: "abc" })).toBeNull();
    expect(revalidar({ telefone: "5551999998888", cpf_cnpj: "111.111.111-11", nome: "  X  " })).toMatchObject({ cpf_cnpj: null, nome: "X" });
  });
});
