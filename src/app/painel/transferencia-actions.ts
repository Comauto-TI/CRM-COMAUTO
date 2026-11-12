"use server";

import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import { filtrarSaida } from "@/lib/security/guard";
import { valoresSecretos } from "@/lib/env";
import { obterOpcoesTransferencia } from "@/modulos/atendimento/opcoes-transferencia";
import { transferirAtendimento } from "@/modulos/atendimento/transferencias";
import type { DadosTransferencia, DestinoTransferencia } from "@/modulos/atendimento/dados-transferencia";

export async function prepararTransferenciaCartao(origem: DestinoTransferencia, registroId: string, unidade: string) {
  const u = await exigirAcesso();
  return obterOpcoesTransferencia(u, origem, registroId, unidade);
}

export async function confirmarTransferenciaCartao(dados: DadosTransferencia) {
  const u = await exigirAcesso();
  const resultado = await transferirAtendimento(u, dados);
  if (resultado.ok) {
    if (resultado.avisoResponsavel && !filtrarSaida(resultado.avisoResponsavel.nome, valoresSecretos()).ok) {
      resultado.avisoResponsavel = { nome: "Responsável atual" };
    }
    // Falha de invalidação não transforma uma operação já confirmada em tentativa reenviável.
    try {
      revalidatePath("/painel/vendas");
      revalidatePath("/painel/pecas");
      revalidatePath("/painel/oficina");
    } catch { /* O operador ainda pode atualizar o quadro explicitamente. */ }
  }
  return resultado;
}
