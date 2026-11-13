import { describe, expect, it } from "vitest";
import { validarCadastroCliente } from "@/lib/cadastro-cliente";

const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe("cadastro de cliente (recepção/Peças)", () => {
  it("pessoa física completa", () => {
    const r = validarCadastroCliente(form({ tipo_pessoa: "fisica", telefone: "(51) 99999-8888", nome: " Maria  Souza ", documento: "529.982.247-25", email: "Maria@Ex.com", nascimento: "1990-05-10", nome_mae: "Ana", endereco: "Rua A, 10", cidade: "Canoas" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados.nome).toBe("Maria Souza");
      expect(r.dados.cpf_cnpj).toBe("52998224725");
      expect(r.dados.email).toBe("maria@ex.com");
      expect(r.dados.nome_mae).toBe("Ana");
      expect(r.dados.inscricao_estadual).toBeNull();
    }
  });
  it("pessoa jurídica com CNPJ e inscrição estadual; ignora campos de PF", () => {
    const r = validarCadastroCliente(form({ tipo_pessoa: "juridica", telefone: "51999998888", nome: "Oficina X Ltda", documento: "11.222.333/0001-81", inscricao_estadual: "isento", nascimento: "1990-01-01", nome_mae: "Z" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados.cpf_cnpj).toBe("11222333000181");
      expect(r.dados.inscricao_estadual).toBe("ISENTO");
      expect(r.dados.data_nascimento).toBeNull();
      expect(r.dados.nome_mae).toBeNull();
    }
  });
  it("só o telefone é obrigatório", () => {
    expect(validarCadastroCliente(form({ telefone: "51999998888" })).ok).toBe(true);
    expect(validarCadastroCliente(form({ nome: "Sem telefone" })).ok).toBe(false);
  });
  it("documento precisa combinar com o tipo e ser válido", () => {
    expect(validarCadastroCliente(form({ tipo_pessoa: "fisica", telefone: "51999998888", documento: "11.222.333/0001-81" })).ok).toBe(false);
    expect(validarCadastroCliente(form({ tipo_pessoa: "juridica", telefone: "51999998888", documento: "529.982.247-25" })).ok).toBe(false);
    expect(validarCadastroCliente(form({ telefone: "51999998888", documento: "111.111.111-11" })).ok).toBe(false);
    expect(validarCadastroCliente(form({ telefone: "51999998888", email: "sem-arroba" })).ok).toBe(false);
  });
});
