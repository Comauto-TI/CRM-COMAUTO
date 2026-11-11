import "server-only";
import { criarDialogo } from "@/modulos/atendimento/dialogo";
import type { DialogoAtendimento, FalhaDialogo, MensagemAtendimento, ResultadoAcao, ResultadoDialogo } from "@/modulos/atendimento/dialogo";

export type FalhaAtendimentoVendas = FalhaDialogo;
export type MensagemDialogoVendas = MensagemAtendimento;
export type DialogoVendas = DialogoAtendimento<"oportunidadeId">;
export type ResultadoDialogoVendas = ResultadoDialogo<"oportunidadeId">;
export type ResultadoAcaoVendas = ResultadoAcao<"oportunidadeId">;
const dialogo = criarDialogo({ setor: "vendas", chave: "oportunidadeId", parametro: "p_oportunidade", nome: "Vendas", registro: "Oportunidade" });
export const obterDialogoVendas = dialogo.obter;
export const assumirAtendimentoVendas = dialogo.assumir;
export const devolverAtendimentoVendas = dialogo.devolver;
export const responderAtendimentoVendas = dialogo.responder;
