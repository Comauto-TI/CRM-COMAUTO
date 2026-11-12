import { describe, expect, it } from "vitest";
import { hrefFilaOficina, lerFiltrosFila } from "@/modulos/oficina/filtros-fila";

const ID = "ab000000-0000-4000-8000-000000000001";
const INSTANTE = "2026-11-12T13:45:59.123456-03:00";

describe("filtros da fila de Oficina", () => {
  it.each([undefined, "0", "1"])("aceita somente a opção literal minhas=%s", minhas => {
    expect(lerFiltrosFila({ minhas })).toEqual({ minhas: minhas === "1", limite: 50, antes: null });
  });

  it.each([null, true, false, 0, 1, "", "true", "on", "01", " 1", "1\n", ["1"], ["0", "1"]])("recusa minhas malformado %j", minhas => {
    expect(lerFiltrosFila({ minhas })).toBeNull();
  });

  it("preserva micros e fuso, normaliza UUID em cópia e mantém limite fixo", () => {
    const p = { minhas: "1", antes: INSTANTE, antes_id: ID.toUpperCase(), limite: "100", unidade: "forjada", responsavel: ID };
    const original = structuredClone(p);
    expect(lerFiltrosFila(p)).toEqual({ minhas: true, limite: 50, antes: { criadoEm: INSTANTE, id: ID } });
    expect(p).toEqual(original);
  });

  it.each([
    "2026-11-12T13:45:59Z",
    "2026-11-12T13:45:59.1+00:00",
    "2026-11-12T13:45:59.000001Z",
    "2024-02-29T13:45:59.999999+03:30",
  ])("mantém a representação válida %s sem serializar por Date", antes => {
    expect(lerFiltrosFila({ antes, antes_id: ID })?.antes).toEqual({ criadoEm: antes, id: ID });
  });

  it.each([
    ["timestamp sem ID", { antes: INSTANTE }],
    ["ID sem timestamp", { antes_id: ID }],
    ["cursor vazio", { antes: "", antes_id: "" }],
    ["cursor nulo", { antes: null, antes_id: null }],
    ["timestamp array", { antes: [INSTANTE], antes_id: ID }],
    ["ID array", { antes: INSTANTE, antes_id: [ID] }],
    ["timestamp repetido", { antes: [INSTANTE, INSTANTE], antes_id: ID }],
    ["ID com newline", { antes: INSTANTE, antes_id: ID + "\n" }],
    ["timestamp com newline", { antes: INSTANTE + "\n", antes_id: ID }],
    ["dia inexistente", { antes: "2026-02-29T13:45:59Z", antes_id: ID }],
    ["hora 24", { antes: "2026-11-12T24:00:00Z", antes_id: ID }],
    ["precisão excessiva", { antes: "2026-11-12T13:45:59.1234567Z", antes_id: ID }],
    ["fuso ausente", { antes: "2026-11-12T13:45:59.123456", antes_id: ID }],
    ["UUID sem hífens", { antes: INSTANTE, antes_id: ID.replaceAll("-", "") }],
  ] as Array<[string, { antes?: unknown; antes_id?: unknown }]>)("recusa %s antes de montar opções para o serviço", (_nome, p) => {
    expect(lerFiltrosFila(p)).toBeNull();
  });
});

describe("links seguros da fila de Oficina", () => {
  it("usa destino fixo e omite parâmetros ausentes ou minhas=false", () => {
    expect(hrefFilaOficina({})).toBe("/painel/oficina");
    expect(hrefFilaOficina({ minhas: false, antes: null })).toBe("/painel/oficina");
    expect(hrefFilaOficina({ minhas: true })).toBe("/painel/oficina?minhas=1");
  });

  it("faz ida e volta pelo query preservando micros, UUID e sinal do fuso", () => {
    const href = hrefFilaOficina({ minhas: true, antes: { criadoEm: INSTANTE, id: ID.toUpperCase() } });
    const url = new URL(href, "https://exemplo.invalid");
    expect(url.pathname).toBe("/painel/oficina");
    expect(lerFiltrosFila(Object.fromEntries(url.searchParams))).toEqual({
      minhas: true, limite: 50, antes: { criadoEm: INSTANTE, id: ID },
    });
    const positivo = "2026-11-12T13:45:59.123456+03:00";
    const query = new URL(hrefFilaOficina({ antes: { criadoEm: positivo, id: ID } }), url.origin).searchParams;
    expect(query.get("antes")).toBe(positivo);
  });

  it("mensagem não cria parâmetros ou outro destino", () => {
    const mensagem = "erro&next=https://outro.invalid/\n#fim";
    const url = new URL(hrefFilaOficina({ minhas: true }, mensagem), "https://exemplo.invalid");
    expect(url.origin + url.pathname).toBe("https://exemplo.invalid/painel/oficina");
    expect([...url.searchParams]).toEqual([["minhas", "1"], ["msg", mensagem]]);
    expect(url.hash).toBe("");
  });
});
