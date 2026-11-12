export type OrigemTransferencia = "central" | "vendas" | "pecas" | "oficina";
export type DestinoTransferencia = Exclude<OrigemTransferencia, "central">;
export type FunilTransferencia = "novos" | "seminovos";

export type DadosTransferencia = {
  operacaoId: string;
  origem: OrigemTransferencia;
  registroId: string;
  destino: DestinoTransferencia;
  funil: FunilTransferencia | null;
  responsavelId: string | null;
  nota: string;
  versao: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && UUID.test(v);
const objeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const origem = (v: unknown): v is OrigemTransferencia => v === "central" || v === "vendas" || v === "pecas" || v === "oficina";
const destino = (v: unknown): v is DestinoTransferencia => v === "vendas" || v === "pecas" || v === "oficina";

/** Normaliza somente dados da operação; ator, cliente e unidade nunca vêm deste objeto. */
export function normalizarDadosTransferencia(v: unknown): DadosTransferencia | null {
  if (!objeto(v) || !uuid(v.operacaoId) || !origem(v.origem) || !uuid(v.registroId) || !destino(v.destino)
    || v.origem === v.destino || typeof v.versao !== "number" || !Number.isSafeInteger(v.versao)
    || v.versao < 0 || v.versao > 2_147_483_646 || typeof v.nota !== "string") return null;

  const nota = v.nota.trim();
  const caracteres = Array.from(nota);
  if (caracteres.length < 1 || caracteres.length > 1000 || nota.includes("\0")
    || caracteres.some(c => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff)) return null;

  const funil = v.funil === undefined || v.funil === "" ? null : v.funil;
  const responsavel = v.responsavelId === undefined || v.responsavelId === "" ? null : v.responsavelId;
  if (responsavel !== null && !uuid(responsavel)) return null;
  if (v.destino === "vendas") {
    if (funil !== "novos" && funil !== "seminovos") return null;
  } else if (funil !== null) return null;

  return {
    operacaoId: v.operacaoId.toLowerCase(), origem: v.origem, registroId: v.registroId.toLowerCase(),
    destino: v.destino, funil: funil as FunilTransferencia | null,
    responsavelId: responsavel === null ? null : (responsavel as string).toLowerCase(), nota, versao: v.versao,
  };
}

/** Campos duplicados não escolhem uma interpretação arbitrária da mesma tentativa. */
export function parsearTransferencia(form: FormData): DadosTransferencia | null {
  const campos = new Map<string, FormDataEntryValue>();
  for (const [nome, valor] of form.entries()) {
    if (campos.has(nome)) return null;
    campos.set(nome, valor);
  }
  const valor = (nome: string) => campos.get(nome);
  const versao = valor("versao");
  if (typeof versao !== "string" || !/^(0|[1-9]\d*)$/.test(versao)) return null;
  return normalizarDadosTransferencia({
    operacaoId: valor("operacao"), origem: valor("origem"), registroId: valor("registro"),
    destino: valor("destino"), funil: valor("funil"), responsavelId: valor("responsavel"),
    nota: valor("nota"), versao: Number(versao),
  });
}
