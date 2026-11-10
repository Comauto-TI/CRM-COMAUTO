import "server-only";
import { db } from "@/lib/supabase/admin";

/** Regra 10: registrar quem criou, alterou ou excluiu informações. */
export async function auditar(ator: string, acao: string, entidade: string, entidadeId: string | null, dados: Record<string, unknown> = {}) {
  await db().from("audit_log").insert({ ator, acao, entidade, entidade_id: entidadeId, dados });
}

export async function registrarEventoSeguranca(args: {
  telefone: string | null;
  clienteId: string | null;
  tipo: string;
  trecho: string | null;
  acao: string;
}) {
  await db().from("eventos_seguranca").insert({
    telefone: args.telefone,
    cliente_id: args.clienteId,
    tipo: args.tipo,
    trecho: args.trecho?.slice(0, 300) ?? null,
    acao: args.acao,
  });
}
