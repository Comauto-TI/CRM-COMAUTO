import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { registrarCotacao } from "@/modulos/pecas/cotacoes";

const fixture = vi.hoisted(() => ({
  anonimizado: false,
  insercoes: [] as Record<string, unknown>[],
  formas: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  db: () => ({
    from(tabela: string) {
      if (tabela === "unidades") return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { chave: "comauto" }, error: null }; },
      };
      if (tabela === "clientes") return {
        select() { return this; },
        in(campo: string, valores: string[]) {
          expect(campo).toBe("telefone");
          fixture.formas = valores;
          return this;
        },
        order() { return this; },
        async limit() {
          return { data: [{
            id: "00000000-0000-4000-8000-000000000062",
            telefone: "555198765432",
            anonimizado: fixture.anonimizado,
          }], error: null };
        },
      };
      expect(tabela).toBe("pecas_cotacoes");
      return {
        async insert(pedido: Record<string, unknown>) {
          fixture.insercoes.push(pedido);
          return { error: null };
        },
      };
    },
  }),
}));

const usuario: Usuario = {
  id: "00000000-0000-4000-8000-000000000061",
  email: "pecas@example.invalid",
  nome: "Pessoa de teste",
  papel: "pecas",
  setor: "pecas",
  unidade: "comauto",
  unidades: ["comauto"],
};

describe("ficha única na cotação de balcão", () => {
  beforeEach(() => {
    fixture.anonimizado = false;
    fixture.insercoes = [];
    fixture.formas = [];
  });

  const dados = {
    id: "00000000-0000-4000-8000-000000000063",
    telefone: "5551998765432",
    descricao: "Pastilhas dianteiras",
    placa: null,
  };

  it("reaproveita a ficha pelo celular com ou sem o nono dígito", async () => {
    expect(await registrarCotacao(usuario, dados)).toBe("criada");
    expect(fixture.formas).toEqual(["5551998765432", "555198765432"]);
    expect(fixture.insercoes).toEqual([expect.objectContaining({
      cliente_id: "00000000-0000-4000-8000-000000000062",
      unidade: "comauto",
      criado_por: usuario.id,
    })]);
  });

  it("preserva o bloqueio da ficha anonimizada", async () => {
    fixture.anonimizado = true;
    expect(await registrarCotacao(usuario, dados)).toBe("cliente");
    expect(fixture.insercoes).toEqual([]);
  });
});
