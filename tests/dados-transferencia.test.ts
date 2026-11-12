import { describe, expect, it } from "vitest";
import { normalizarDadosTransferencia, parsearTransferencia, type DadosTransferencia } from "@/modulos/atendimento/dados-transferencia";

const operacao = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const registro = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const responsavel = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const dados: DadosTransferencia = { operacaoId: operacao, origem: "central", registroId: registro,
  destino: "pecas", funil: null, responsavelId: null, nota: "Solicitação fictícia de peça", versao: 0 };

function form(patch: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ operacao, origem: "central", registro, destino: "pecas", nota: dados.nota, versao: "0", ...patch })) f.append(k, v);
  return f;
}

describe("dados da transferência entre setores", () => {
  it("normaliza UUIDs e nota, mantendo somente os campos da operação", () => {
    expect(normalizarDadosTransferencia({ ...dados, operacaoId: operacao.toUpperCase(), registroId: registro.toUpperCase(),
      nota: "  Solicitação fictícia de peça  ", ator: responsavel, clienteId: responsavel, unidade: "outra",
      mensagemIds: [responsavel], historico: [responsavel] })).toEqual(dados);
  });

  it("normaliza responsável de Vendas sem tratar sua elegibilidade como comprovada", () => {
    expect(normalizarDadosTransferencia({ ...dados, origem: "pecas", destino: "vendas", funil: "seminovos", responsavelId: responsavel.toUpperCase() }))
      .toEqual({ ...dados, origem: "pecas", destino: "vendas", funil: "seminovos", responsavelId: responsavel });
  });

  it.each(["pecas", "oficina"] as const)("aceita pessoa ou fila no destino %s, sem comprovar elegibilidade no parser", destino => {
    expect(normalizarDadosTransferencia({ ...dados, destino, responsavelId: responsavel.toUpperCase() }))
      .toEqual({ ...dados, destino, responsavelId: responsavel });
    expect(normalizarDadosTransferencia({ ...dados, destino, responsavelId: null }))
      .toEqual({ ...dados, destino });
  });

  it("permite destino Vendas sem responsável e as nove combinações de setores", () => {
    let quantidade = 0;
    for (const origem of ["central", "vendas", "pecas", "oficina"] as const) {
      for (const destino of ["vendas", "pecas", "oficina"] as const) {
        if (origem === destino) continue;
        const d = normalizarDadosTransferencia({ ...dados, origem, destino, funil: destino === "vendas" ? "novos" : null });
        expect(d).toMatchObject({ origem, destino, responsavelId: null });
        quantidade++;
      }
    }
    expect(quantidade).toBe(9);
  });

  it("conta 1000 caracteres Unicode sem truncar ou dividir emoji", () => {
    const nota = "🔧".repeat(1000);
    expect(normalizarDadosTransferencia({ ...dados, nota: ` ${nota} ` })?.nota).toBe(nota);
    expect(normalizarDadosTransferencia({ ...dados, nota: nota + "a" })).toBeNull();
  });

  it.each([
    null, [], "entrada", { ...dados, operacaoId: "" }, { ...dados, operacaoId: operacao.replaceAll("-", "") },
    { ...dados, operacaoId: operacao + "\n" }, { ...dados, registroId: `{${registro}}` },
    { ...dados, origem: "administracao" }, { ...dados, destino: "central" }, { ...dados, origem: "pecas" },
    { ...dados, destino: "vendas", funil: null }, { ...dados, destino: "vendas", funil: "customizado" },
    { ...dados, destino: "vendas", funil: "novos", responsavelId: "pessoa" },
    { ...dados, funil: "novos" }, { ...dados, responsavelId: "pessoa" },
    { ...dados, destino: "oficina", responsavelId: responsavel + "\n" }, { ...dados, responsavelId: false },
    { ...dados, versao: -1 }, { ...dados, versao: 1.5 }, { ...dados, versao: "1" }, { ...dados, versao: NaN },
    { ...dados, versao: Infinity }, { ...dados, versao: 2_147_483_647 },
    { ...dados, nota: " \t\n " }, { ...dados, nota: "a".repeat(1001) },
    { ...dados, nota: "texto\0resto" }, { ...dados, nota: "texto\ud800" }, { ...dados, nota: "\udffftexto" },
  ])("recusa entrada inválida %j", entrada => {
    expect(normalizarDadosTransferencia(entrada)).toBeNull();
  });

  it("aceita o limite da versão e objeto de dados com protótipo nulo", () => {
    expect(normalizarDadosTransferencia(Object.assign(Object.create(null), dados, { versao: 2_147_483_646 })))
      .toEqual({ ...dados, versao: 2_147_483_646 });
    expect(normalizarDadosTransferencia(Object.assign(new Date(), dados))).toBeNull();
  });
});

describe("FormData da transferência", () => {
  it("lê a tentativa explícita e descarta identidade/unidade forjadas", () => {
    const f = form({ ator: responsavel, cliente: responsavel, unidade: "outra", email: "fixture@invalid.test",
      mensagemIds: responsavel, historico: responsavel });
    expect(parsearTransferencia(f)).toEqual(dados);
  });

  it("lê Vendas com funil e responsável opcional", () => {
    expect(parsearTransferencia(form({ destino: "vendas", funil: "novos", responsavel: "" })))
      .toEqual({ ...dados, destino: "vendas", funil: "novos" });
    expect(parsearTransferencia(form({ destino: "vendas", funil: "novos", responsavel: responsavel.toUpperCase() })))
      .toEqual({ ...dados, destino: "vendas", funil: "novos", responsavelId: responsavel });
  });

  it.each(["pecas", "oficina"] as const)("lê pessoa ou fila no FormData do destino %s", destino => {
    expect(parsearTransferencia(form({ destino, responsavel: responsavel.toUpperCase() })))
      .toEqual({ ...dados, destino, responsavelId: responsavel });
    expect(parsearTransferencia(form({ destino, responsavel: "" })))
      .toEqual({ ...dados, destino });
    expect(parsearTransferencia(form({ destino, responsavel: "nome livre" }))).toBeNull();
  });

  it.each(["operacao", "origem", "registro", "destino", "funil", "responsavel", "nota", "versao", "ator"])("recusa chave duplicada: %s", nome => {
    const f = form();
    if (!f.has(nome)) f.append(nome, "valor");
    f.append(nome, "outro");
    expect(parsearTransferencia(f)).toBeNull();
  });

  it.each(["", "-0", "01", "+1", "1.0", "1e2", " 1", "1\n", "-1", "2147483647", "9007199254740993"])("recusa versão textual ambígua: %j", versao => {
    expect(parsearTransferencia(form({ versao }))).toBeNull();
  });

  it.each(["operacao", "origem", "registro", "destino", "nota", "versao"])("recusa campo obrigatório ausente: %s", nome => {
    const f = form(); f.delete(nome);
    expect(parsearTransferencia(f)).toBeNull();
  });

  it("não converte arquivo em texto", () => {
    const f = form(); f.set("nota", new Blob(["fictício"], { type: "text/plain" }), "nota.txt");
    expect(parsearTransferencia(f)).toBeNull();
  });
});
