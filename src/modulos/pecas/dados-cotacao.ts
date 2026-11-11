import { interpretarBusca } from "@/lib/busca";
import { normalizarTelefone } from "@/lib/phone";

function campo(form: FormData, nome: string): string {
  const valor = form.get(nome);
  return typeof valor === "string" ? valor.trim() : "";
}

export function lerIdCotacao(form: FormData) {
  const id = campo(form, "solicitacao");
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id) ? id : null;
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
