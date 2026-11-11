import "server-only";
import { criarDialogo } from "@/modulos/atendimento/dialogo";
import type { DialogoAtendimento, FalhaDialogo, MensagemAtendimento, ResultadoAcao, ResultadoDialogo } from "@/modulos/atendimento/dialogo";

export type FalhaAtendimentoPecas = FalhaDialogo;
export type MensagemDialogoPecas = MensagemAtendimento;
export type DialogoPecas = DialogoAtendimento<"cotacaoId">;
export type ResultadoDialogoPecas = ResultadoDialogo<"cotacaoId">;
export type ResultadoAcaoPecas = ResultadoAcao<"cotacaoId">;
const dialogo = criarDialogo({ setor: "pecas", chave: "cotacaoId", parametro: "p_cotacao", nome: "Peças", registro: "Cotação" });
export const obterDialogoPecas = dialogo.obter;
export const assumirAtendimentoPecas = dialogo.assumir;
export const devolverAtendimentoPecas = dialogo.devolver;
export const responderAtendimentoPecas = dialogo.responder;
