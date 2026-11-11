import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";
import { objeto, uuid, setorValido, natural, cursor, opcoesValidas, mensagem,
  type SetorLeitura, type CursorMensagens, type OpcoesLeituraAtendimento, type MensagemAtendimento } from "./contrato-leitura";
export type { CursorMensagens, OpcoesLeituraAtendimento, MensagemAtendimento } from "./contrato-leitura";

export type ResultadoLeituraAtendimento =
  | { ok: true; atendimentoId: string; setor: SetorLeitura; total: number; revisaoPendente: boolean; mensagens: MensagemAtendimento[]; proximoCursor: CursorMensagens | null }
  | { ok: false; status: 400 | 403 | 404 | 503; motivo: string };

function falha(status: 400 | 403 | 404 | 503): ResultadoLeituraAtendimento {
  const motivos = {
    400: "Dados de leitura de mensagens inválidos.",
    403: "Seu perfil não tem acesso ao atendimento desse setor.",
    404: "Atendimento não encontrado ou fora do seu acesso.",
    503: "Não foi possível carregar as mensagens. Tente novamente.",
  };
  return { ok: false, status, motivo: motivos[status] };
}

/** Autoriza e lê na mesma transação; uma autorização anterior não é reutilizada. */
export async function lerMensagensAtendimento(u: Usuario, atendimentoId: string, setor: SetorLeitura, opcoes?: OpcoesLeituraAtendimento): Promise<ResultadoLeituraAtendimento> {
  const opts = opcoesValidas(opcoes);
  if (!objeto(u) || !uuid(u.id) || !uuid(atendimentoId) || !setorValido(setor) || !opts) return falha(400);
  if (!podeAcessar(u, setor)) return falha(403);
  const id = atendimentoId.toLowerCase();
  try {
    const { data, error } = await db().rpc("ler_mensagens_atendimento", {
      p_atendimento_id: id, p_ator: u.id.toLowerCase(), p_setor: setor, p_limite: opts.limite,
      p_antes_em: opts.antes?.criadoEm ?? null, p_antes_id: opts.antes?.id ?? null,
    });
    if (error || !objeto(data)) return falha(503);
    if (data.ok === false) {
      if (data.codigo === "invalido" || data.codigo === "cursor_invalido") return falha(400);
      if (data.codigo === "nao_encontrado") return falha(404);
      return falha(503);
    }
    if (data.ok !== true || !uuid(data.atendimentoId) || data.atendimentoId.toLowerCase() !== id || data.setor !== setor ||
      !natural(data.total) || typeof data.revisaoPendente !== "boolean" || !Array.isArray(data.mensagens) ||
      data.mensagens.length > opts.limite || data.total < data.mensagens.length) return falha(503);
    const mensagens: MensagemAtendimento[] = [];
    const ids = new Set<string>();
    for (const linha of data.mensagens) {
      const m = mensagem(linha);
      if (!m || ids.has(m.id)) return falha(503);
      ids.add(m.id);
      mensagens.push(m);
    }
    const proximoCursor = data.proximoCursor === null ? null : cursor(data.proximoCursor);
    if (data.proximoCursor !== null) {
      const ultima = mensagens.at(-1);
      if (!proximoCursor || !ultima || mensagens.length !== opts.limite || data.total <= mensagens.length ||
        proximoCursor.id !== ultima.id || proximoCursor.criadoEm !== ultima.criadoEm) return falha(503);
    }
    return { ok: true, atendimentoId: id, setor, total: data.total, revisaoPendente: data.revisaoPendente, mensagens, proximoCursor };
  } catch {
    return falha(503);
  }
}
