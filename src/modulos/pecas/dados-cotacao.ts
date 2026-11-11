import { interpretarBusca } from "@/lib/busca";
import { normalizarTelefone } from "@/lib/phone";

function campo(form: FormData, nome: string): string {
  const valor = form.get(nome);
  return typeof valor === "string" ? valor.trim() : "";
}

export function uuidV4Valido(id: string): boolean {
  return typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
}

export function lerIdCotacao(form: FormData) {
  const id = campo(form, "solicitacao");
  return uuidV4Valido(id) ? id : null;
}

export function lerDadosCotacao(form: FormData) {
  const id = lerIdCotacao(form);
  const telefone = normalizarTelefone(campo(form, "telefone"));
  const descricao = campo(form, "descricao");
  const entradaPlaca = campo(form, "placa");
  const buscaPlaca = entradaPlaca ? interpretarBusca(entradaPlaca) : null;

  if (!id || !telefone || !descricao || descricao.length > 1000) return null;
  if (entradaPlaca && buscaPlaca?.tipo !== "placa") return null;

  return { id, telefone, descricao, placa: buscaPlaca?.valor ?? null };
}

export type DadosCotacao = NonNullable<ReturnType<typeof lerDadosCotacao>>;

function lerCentavos(valor: string): number | null {
  if (!/^\d{1,6}(?:[,.]\d{1,2})?$/.test(valor)) return null;
  const [reais, decimal = ""] = valor.split(/[,.]/);
  return Number(reais) * 100 + Number(decimal.padEnd(2, "0"));
}

export function lerDadosItem(form: FormData) {
  const id = campo(form, "item");
  const descricao = campo(form, "descricao");
  const quantidade = campo(form, "quantidade");
  const precoUnitarioCentavos = lerCentavos(campo(form, "preco"));
  const custo = campo(form, "custo");
  const custoUnitarioCentavos = custo ? lerCentavos(custo) : null;

  if (!uuidV4Valido(id) || !descricao || descricao.length > 200) return null;
  if (!/^\d{1,4}$/.test(quantidade) || Number(quantidade) === 0) return null;
  if (precoUnitarioCentavos === null || (custo && custoUnitarioCentavos === null)) return null;

  return { id, descricao, quantidade: Number(quantidade), precoUnitarioCentavos, custoUnitarioCentavos };
}

export type DadosItem = NonNullable<ReturnType<typeof lerDadosItem>>;

export function centavosParaCampo(centavos: number | null): string {
  return centavos === null ? "" : (centavos / 100).toFixed(2).replace(".", ",");
}

export function lerDadosEdicaoItem(form: FormData) {
  const dados = lerDadosItem(form);
  const entradaVersao = campo(form, "versao");
  if (!dados || !/^[1-9]\d{0,9}$/.test(entradaVersao)) return null;

  const versao = Number(entradaVersao);
  return versao <= 2147483647 ? { ...dados, versao } : null;
}

export type DadosEdicaoItem = NonNullable<ReturnType<typeof lerDadosEdicaoItem>>;

export type TipoPreparo = "separacao" | "encomenda";
export type AcaoAtendimento = TipoPreparo | "entrega";

export function etapaCotacao(status: string, tipoPreparo: TipoPreparo | null): string {
  if (status !== "em_separacao") return status;
  return tipoPreparo === "encomenda" ? "em encomenda" : "em separação";
}

type ItemParaTotal = {
  quantidade: number;
  preco_unitario_centavos: number;
  custo_unitario_centavos: number | null;
};

export function totalizarCotacao(itens: ItemParaTotal[], vendaConfirmada: boolean) {
  let totalCentavos = 0;
  let custoCentavos = 0;
  let custoCompleto = itens.length > 0;
  for (const item of itens) {
    totalCentavos += item.quantidade * item.preco_unitario_centavos;
    if (item.custo_unitario_centavos === null) custoCompleto = false;
    else custoCentavos += item.quantidade * item.custo_unitario_centavos;
  }
  return {
    totalCentavos,
    margemCentavos: vendaConfirmada && custoCompleto ? totalCentavos - custoCentavos : null,
  };
}
