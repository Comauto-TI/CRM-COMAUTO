import { describe, it, expect } from "vitest";
import {
  lerVinculoProcessoVendas, linkProcessoVendas, lerVinculoAvaliex, linkAvaliex, lerVinculos,
} from "@/modulos/vendas/vinculos";

const UUID = "3f2b8c1e-4d5a-4b6c-9e7f-0a1b2c3d4e5f";

describe("F2-2 — vínculo com o Processo de Vendas", () => {
  it("lê o link da proposta (p= e empresa=)", () => {
    expect(lerVinculoProcessoVendas(`https://grupocomauto.com.br/processo-de-vendas/proposta.html?p=${UUID}&empresa=comauto`))
      .toEqual({ ok: true, id: UUID, empresa: "comauto" });
    expect(lerVinculoProcessoVendas(`https://processo-vendas-phi.vercel.app/proposta.html?proposta=12345`))
      .toEqual({ ok: true, id: "12345", empresa: null });
  });
  it("aceita só o ID", () => {
    expect(lerVinculoProcessoVendas(`  ${UUID} `)).toEqual({ ok: true, id: UUID, empresa: null });
  });
  it("recusa link de outro site e ID estranho", () => {
    expect(lerVinculoProcessoVendas(`https://site-falso.com/proposta.html?p=${UUID}`).ok).toBe(false);
    expect(lerVinculoProcessoVendas("javascript:alert(1)").ok).toBe(false);
    expect(lerVinculoProcessoVendas("<script>").ok).toBe(false);
    expect(lerVinculoProcessoVendas("https://grupocomauto.com.br/processo-de-vendas/painel.html").ok).toBe(false);
    expect(lerVinculoProcessoVendas("").ok).toBe(false);
  });
  it("link exibido é sempre montado a partir do endereço oficial", () => {
    expect(linkProcessoVendas(UUID, "comauto")).toBe(`https://grupocomauto.com.br/processo-de-vendas/proposta.html?p=${UUID}&empresa=comauto`);
    expect(linkProcessoVendas("x\"><script>")).toBeNull();
  });
});

describe("F2-2 — vínculo com o Avaliex", () => {
  it("lê a unidade do caminho e o ID da query ou do caminho", () => {
    expect(lerVinculoAvaliex(`https://avaliex.onrender.com/motomecanica/avaliacao?id=${UUID}`, "comauto"))
      .toEqual({ ok: true, id: UUID, unidade: "motomecanica", placa: null });
    expect(lerVinculoAvaliex("https://avaliex.onrender.com/comauto/avaliacoes/987", "comauto"))
      .toEqual({ ok: true, id: "987", unidade: "comauto", placa: null });
  });
  it("só o ID usa a unidade do cartão; placa opcional é normalizada", () => {
    expect(lerVinculoAvaliex("987", "comauto", "abc-1d23")).toEqual({ ok: true, id: "987", unidade: "comauto", placa: "ABC1D23" });
    expect(lerVinculoAvaliex("987", "comauto", "xx").ok).toBe(false);
  });
  it("recusa link de outro site", () => {
    expect(lerVinculoAvaliex(`https://avaliex.fake.com/comauto/avaliacao?id=${UUID}`, "comauto").ok).toBe(false);
  });
  it("link do Avaliex abre a unidade", () => {
    expect(linkAvaliex("comauto")).toBe("https://avaliex.onrender.com/comauto/");
    expect(linkAvaliex("../x")).toBeNull();
  });
});

describe("F2-2 — leitura tolerante de ids_externos", () => {
  it("ignora lixo e mantém outras chaves fora", () => {
    expect(lerVinculos(null)).toEqual({});
    expect(lerVinculos({ bravus: "1", processo_vendas: { id: "<x>" } })).toEqual({});
    const v = lerVinculos({ processo_vendas: { id: UUID, empresa: null, vinculado_por: "a", vinculado_em: "2026-11-10" } });
    expect(v.processo_vendas?.id).toBe(UUID);
  });
});
