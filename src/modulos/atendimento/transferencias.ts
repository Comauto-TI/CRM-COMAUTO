import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";
import { objeto, uuid } from "./contrato-leitura";
import { normalizarDadosTransferencia, type DadosTransferencia, type DestinoTransferencia } from "./dados-transferencia";

type CodigoTransferencia = "invalido" | "nao_encontrado" | "conflito" | "origem_ambigua" | "envio_incerto";
export type FalhaTransferencia = { ok: false; status: 400 | 403 | 404 | 409 | 503; erro: string; codigo?: CodigoTransferencia };
export type ResultadoTransferencia =
  | { ok: true; operacaoId: string; setorDestino: DestinoTransferencia; idDestino: string; reutilizado: boolean }
  | FalhaTransferencia;

function falha(status: FalhaTransferencia["status"], codigo?: CodigoTransferencia): FalhaTransferencia {
  const textos = {
    400: "Dados da transferência inválidos.",
    403: "Seu perfil não tem acesso ao atendimento de origem.",
    404: "Atendimento não encontrado ou fora do seu acesso.",
    409: "O atendimento mudou ou não está disponível para transferência. Atualize e confira antes de tentar novamente.",
    503: "Não foi possível confirmar a transferência. Confira o atendimento antes de tentar novamente.",
  };
  const erro = codigo === "origem_ambigua" ? "A origem das mensagens precisa de revisão antes de transferir."
    : codigo === "envio_incerto" ? "Há um envio em processamento ou sem confirmação. Confira a conversa antes de transferir."
      : textos[status];
  return codigo ? { ok: false, status, codigo, erro } : { ok: false, status, erro };
}

/** Uma chamada transacional; o banco revalida vínculo, posse, replay e responsável elegível nos três destinos. */
export async function transferirAtendimento(u: Usuario, dados: DadosTransferencia): Promise<ResultadoTransferencia> {
  const d = normalizarDadosTransferencia(dados);
  if (!d || !objeto(u) || !uuid(u.id)) return falha(400);
  if (!podeAcessar(u, d.origem === "central" ? "atendimento" : d.origem)) return falha(403);

  try {
    const { data, error } = await db().rpc("transferir_atendimento_setor", {
      p_operacao: d.operacaoId, p_origem: d.origem, p_registro: d.registroId, p_ator: u.id.toLowerCase(),
      p_destino: d.destino, p_funil: d.funil, p_responsavel: d.responsavelId, p_nota: d.nota, p_versao: d.versao,
    });
    if (error || !objeto(data)) return falha(503);
    if (data.ok === false) {
      if (data.codigo === "invalido") return falha(400, data.codigo);
      if (data.codigo === "nao_encontrado") return falha(404, data.codigo);
      if (data.codigo === "conflito" || data.codigo === "origem_ambigua" || data.codigo === "envio_incerto") return falha(409, data.codigo);
      return falha(503);
    }
    if (data.ok !== true || !uuid(data.operacaoId) || data.operacaoId.toLowerCase() !== d.operacaoId
      || data.setorDestino !== d.destino || !uuid(data.idDestino) || typeof data.reutilizado !== "boolean") return falha(503);
    return { ok: true, operacaoId: d.operacaoId, setorDestino: d.destino, idDestino: data.idDestino.toLowerCase(), reutilizado: data.reutilizado };
  } catch {
    return falha(503);
  }
}
