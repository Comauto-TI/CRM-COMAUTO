import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";
import { responderLivre } from "@/lib/messaging/outbound";
import { filtrarSaida, mascararDadosSensiveis } from "@/lib/security/guard";
import { valoresSecretos } from "@/lib/env";
import { objeto, uuid, natural, instante } from "@/modulos/atendimento/contrato-leitura";

type Estado = "livre" | "minha" | "outra";
type StatusMensagem = "recebida" | "enviada" | "entregue" | "lida" | "falhou" | "bloqueada";
export type FalhaAtendimentoPecas = {
  ok: false; erro: string; status: 400 | 403 | 404 | 409 | 503; incerto?: boolean; codigo?: "sem_responsavel";
};
export type MensagemDialogoPecas = {
  id: string; direcao: "entrada" | "saida"; autor: "cliente" | "atendente"; tipo: string;
  conteudo: string | null; status: StatusMensagem; criadoEm: string; pendente: boolean;
};
export type DialogoPecas = {
  ok: true; id: string | null; cotacaoId: string; versao: number; clienteNome: string; estado: Estado;
  janelaAberta: boolean; podeAssumir: boolean; podeDevolver: boolean; mensagens: MensagemDialogoPecas[]; revisaoPendente: boolean;
};
export type ResultadoDialogoPecas = DialogoPecas | FalhaAtendimentoPecas;
export type ResultadoAcaoPecas = { ok: true; id?: string; cotacaoId?: string; versao?: number; estado?: "minha" | "livre" } | FalhaAtendimentoPecas;
const VERSAO_MAXIMA = 2_147_483_646;
const versaoValida = (v: unknown): v is number => natural(v) && v <= VERSAO_MAXIMA;
const estados = ["recebida", "enviada", "entregue", "lida", "falhou", "bloqueada"];
const segredos = new Set(["segredo_literal", "chave_anthropic", "token_meta", "jwt", "chave_privada", "nome_variavel"]);

function limitarTexto(texto: string): string {
  const t = texto.trim().slice(0, 4000);
  const fim = t.charCodeAt(t.length - 1);
  return (fim >= 0xd800 && fim <= 0xdbff ? t.slice(0, -1) : t).trim();
}

function falha(status: FalhaAtendimentoPecas["status"], incerto = false): FalhaAtendimentoPecas {
  const textos = {
    400: "Dados do atendimento inválidos.", 403: "Seu perfil não tem acesso ao atendimento de Peças.",
    404: "Cotação não encontrada ou fora do seu acesso.", 409: "O atendimento mudou. Atualize a conversa e tente novamente.",
    503: "Não foi possível processar o atendimento. Tente novamente.",
  };
  return incerto
    ? { ok: false, status, incerto: true, erro: "O envio está em processamento ou sem confirmação. Confira a conversa antes de tentar outra mensagem." }
    : { ok: false, status, erro: textos[status] };
}

function erroSql(d: Record<string, unknown>): FalhaAtendimentoPecas {
  if (d.codigo === "sem_responsavel") return { ...falha(404), codigo: "sem_responsavel", erro: "Assuma a cotação para iniciar o atendimento." };
  if (d.codigo === "nao_encontrado") return falha(404);
  if (d.codigo === "invalido") return falha(400);
  if (d.codigo === "conflito") return falha(409);
  if (d.codigo === "origem_ambigua") return { ...falha(409), erro: "A origem das mensagens precisa de revisão antes de responder." };
  if (d.codigo === "envio_incerto") return falha(409, true);
  return falha(503);
}

function contexto(u: Usuario, id: string): FalhaAtendimentoPecas | null {
  if (!objeto(u) || !uuid(u.id) || !uuid(id)) return falha(400);
  return podeAcessar(u, "pecas") ? null : falha(403);
}

async function rpc(nome: string, args: Record<string, string | number>): Promise<{ ok: true; dados: Record<string, unknown> } | FalhaAtendimentoPecas> {
  try {
    const { data, error } = await db().rpc(nome, args);
    if (error || !objeto(data)) return falha(503);
    if (data.ok === false) return erroSql(data);
    return data.ok === true ? { ok: true, dados: data } : falha(503);
  } catch { return falha(503); }
}

function mensagem(v: unknown): MensagemDialogoPecas | null {
  if (!objeto(v) || !uuid(v.id) || typeof v.tipo !== "string" || !instante(v.criadoEm) ||
    (v.conteudo !== null && typeof v.conteudo !== "string") || !estados.includes(v.status as string) ||
    typeof v.pendente !== "boolean" || !((v.direcao === "entrada" && v.autor === "cliente") ||
      (v.direcao === "saida" && v.autor === "atendente")) ||
    (v.pendente && (v.direcao !== "saida" || v.status !== "bloqueada"))) return null;
  return { id: v.id.toLowerCase(), direcao: v.direcao, autor: v.autor, tipo: v.tipo,
    conteudo: v.conteudo === null ? null : mascararDadosSensiveis(v.conteudo).texto,
    status: v.status as StatusMensagem, criadoEm: v.criadoEm, pendente: v.pendente };
}

export async function obterDialogoPecas(u: Usuario, cotacaoId: string): Promise<ResultadoDialogoPecas> {
  const erro = contexto(u, cotacaoId); if (erro) return erro;
  const id = cotacaoId.toLowerCase();
  const r = await rpc("pecas_dialogo", { p_cotacao: id, p_ator: u.id.toLowerCase() });
  if (!r.ok) return r;
  const d = r.dados;
  if (!(d.id === null || uuid(d.id)) || !uuid(d.cotacaoId) || d.cotacaoId.toLowerCase() !== id || !versaoValida(d.versao) ||
    !["livre", "minha", "outra"].includes(d.estado as string) || typeof d.clienteNome !== "string" ||
    typeof d.janelaAberta !== "boolean" || typeof d.podeAssumir !== "boolean" || typeof d.podeDevolver !== "boolean" || typeof d.revisaoPendente !== "boolean" || !Array.isArray(d.mensagens) ||
    (d.podeAssumir && d.estado !== "livre") ||
    (d.podeDevolver && (d.id === null || d.estado === "livre")) ||
    (d.id === null && (d.versao !== 0 || d.estado === "minha" || d.mensagens.length !== 0))) return falha(503);
  const mensagens: MensagemDialogoPecas[] = []; const ids = new Set<string>();
  for (const linha of d.mensagens) {
    const m = mensagem(linha); if (!m || ids.has(m.id)) return falha(503);
    ids.add(m.id); mensagens.push(m);
  }
  return { ok: true, id: d.id === null ? null : (d.id as string).toLowerCase(), cotacaoId: id, versao: d.versao,
    clienteNome: mascararDadosSensiveis(d.clienteNome).texto, estado: d.estado as Estado,
    janelaAberta: d.janelaAberta, podeAssumir: d.podeAssumir, podeDevolver: d.podeDevolver, mensagens, revisaoPendente: d.revisaoPendente };
}

async function mudar(u: Usuario, cotacaoId: string, versao: number, acao: "assumir" | "devolver"): Promise<ResultadoAcaoPecas> {
  const erro = contexto(u, cotacaoId); if (erro) return erro;
  if (!versaoValida(versao)) return falha(400);
  const id = cotacaoId.toLowerCase();
  const r = await rpc(`pecas_${acao}_atendimento`, { p_cotacao: id, p_ator: u.id.toLowerCase(), p_versao: versao });
  if (!r.ok) return r;
  const d = r.dados;
  const estado = acao === "assumir" ? "minha" : "livre";
  if (!uuid(d.id) || !uuid(d.cotacaoId) || d.cotacaoId.toLowerCase() !== id || !versaoValida(d.versao) ||
    (d.versao !== versao && d.versao !== versao + 1) || d.estado !== estado) return falha(503);
  return { ok: true, id: d.id.toLowerCase(), cotacaoId: id, versao: d.versao, estado };
}
export const assumirAtendimentoPecas = (u: Usuario, id: string, versao: number) => mudar(u, id, versao, "assumir");
export const devolverAtendimentoPecas = (u: Usuario, id: string, versao: number) => mudar(u, id, versao, "devolver");

export async function responderAtendimentoPecas(u: Usuario, cotacaoId: string, versao: number, mensagemId: string, texto: string): Promise<ResultadoAcaoPecas> {
  const erro = contexto(u, cotacaoId); if (erro) return erro;
  if (!versaoValida(versao) || !uuid(mensagemId) || typeof texto !== "string") return falha(400);
  const limpo = limitarTexto(texto); if (!limpo) return falha(400);
  try {
    const filtro = filtrarSaida(limpo, valoresSecretos());
    if (!filtro.ok && segredos.has(filtro.motivo)) return falha(400);
    const corpo = limitarTexto(mascararDadosSensiveis(limpo).texto);
    const id = cotacaoId.toLowerCase(), msg = mensagemId.toLowerCase();
    const args = { p_cotacao: id, p_ator: u.id.toLowerCase(), p_versao: versao, p_mensagem: msg };
    const reservado = await rpc("pecas_reservar_resposta", { ...args, p_texto: corpo });
    if (!reservado.ok) return reservado;
    const d = reservado.dados;
    if (!uuid(d.id) || !uuid(d.cotacaoId) || d.cotacaoId.toLowerCase() !== id || d.versao !== versao ||
      !uuid(d.clienteId) || !uuid(d.conversaId) || !uuid(d.mensagemId) || d.mensagemId.toLowerCase() !== msg || typeof d.despachar !== "boolean") return falha(503);
    if (!d.despachar) return { ok: true, versao };
    const atendimentoId = d.id.toLowerCase(), clienteId = d.clienteId.toLowerCase(), conversaId = d.conversaId.toLowerCase();
    let falhaAutorizacao: FalhaAtendimentoPecas | undefined;
    const r = await responderLivre({ clienteId, texto: corpo, autor: "atendente", contextoAtendimento: {
      id: atendimentoId, mensagemId: msg, conversaId,
      autorizar: async () => {
        const autorizado = await rpc("pecas_autorizar_resposta", args);
        if (!autorizado.ok) { falhaAutorizacao = autorizado; return false; }
        const a = autorizado.dados;
        return uuid(a.id) && a.id.toLowerCase() === atendimentoId &&
          uuid(a.clienteId) && a.clienteId.toLowerCase() === clienteId && uuid(a.conversaId) && a.conversaId.toLowerCase() === conversaId &&
          uuid(a.mensagemId) && a.mensagemId.toLowerCase() === msg;
      },
    } });
    if (r.ok) return { ok: true, versao };
    if (r.motivo === "atendimento_indisponivel" && falhaAutorizacao) return falhaAutorizacao;
    if (r.motivo === "envio_incerto") return falha(409, true);
    if (r.motivo === "janela_24h_fechada") return { ...falha(409), erro: "A janela de 24 horas está fechada. Aguarde uma nova mensagem do cliente." };
    if (r.motivo === "optout") return { ...falha(409), erro: "O cliente pediu para não receber mensagens pelo WhatsApp." };
    return falha(503);
  } catch { return falha(503); }
}
