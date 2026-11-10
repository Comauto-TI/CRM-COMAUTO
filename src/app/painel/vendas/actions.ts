"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { localParaUtc } from "@/lib/time";
import {
  criarOportunidade, moverOportunidade, assumirOportunidade, atualizarQualificacao, registrarAtividade, criarTarefa, concluirTarefa,
} from "@/modulos/vendas/dados";
import { ehChave, PAGAMENTOS, PRAZOS, TEMPERATURAS, QUALIFICACOES, TIPOS_ATIVIDADE, MOTIVOS_PERDA } from "@/modulos/vendas/regras";

const texto = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const valorBRL = (s: string): number | null => {
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};
const voltar = (f: FormData, extra: Record<string, string> = {}) => {
  const p = new URLSearchParams();
  const funil = texto(f, "funil");
  if (/^[a-z0-9_]+$/.test(funil)) p.set("funil", funil);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return `/painel/vendas?${p}`;
};

export async function novaOportunidade(f: FormData) {
  const u = await exigirAcesso("vendas");
  const pagamento = texto(f, "pagamento"), temperatura = texto(f, "temperatura"), prazo = texto(f, "prazo");
  const r = await criarOportunidade(u, {
    funilId: texto(f, "funil_id"),
    telefone: texto(f, "telefone"),
    nome: texto(f, "nome"),
    veiculo: texto(f, "veiculo") || null,
    valor: valorBRL(texto(f, "valor")),
    pagamento: ehChave(PAGAMENTOS, pagamento) ? pagamento : "indefinido",
    temperatura: ehChave(TEMPERATURAS, temperatura) ? temperatura : "morno",
    prazo: ehChave(PRAZOS, prazo) ? prazo : "indefinido",
    temTroca: f.get("tem_troca") === "on",
    troca: texto(f, "troca") || null,
    observacoes: texto(f, "observacoes") || null,
  });
  revalidatePath("/painel/vendas");
  redirect(r.ok ? voltar(f, { op: r.id! }) : voltar(f, { nova: "1", erro: r.motivo }));
}

/** Chamado pelo quadro (arrastar cartão). Devolve o resultado para a tela avisar. */
export async function moverCartao(id: string, etapaId: string, posicao: number | null, motivoPerda?: string) {
  const u = await exigirAcesso("vendas");
  const motivo = motivoPerda && (MOTIVOS_PERDA as readonly string[]).includes(motivoPerda) ? motivoPerda : motivoPerda?.slice(0, 200);
  const r = await moverOportunidade(u, String(id), String(etapaId), typeof posicao === "number" ? posicao : null, motivo);
  revalidatePath("/painel/vendas");
  return r;
}

export async function moverPeloFormulario(f: FormData) {
  const u = await exigirAcesso("vendas");
  const id = texto(f, "id");
  const r = await moverOportunidade(u, id, texto(f, "etapa_id"), null, texto(f, "motivo_perda") || undefined);
  revalidatePath("/painel/vendas");
  redirect(voltar(f, r.ok ? { op: id } : { op: id, erro: r.motivo }));
}

export async function assumir(f: FormData) {
  const u = await exigirAcesso("vendas");
  const id = texto(f, "id");
  const r = await assumirOportunidade(u, id);
  revalidatePath("/painel/vendas");
  redirect(voltar(f, r.ok ? { op: id } : { op: id, erro: r.motivo }));
}

export async function salvarQualificacao(f: FormData) {
  const u = await exigirAcesso("vendas");
  const id = texto(f, "id");
  const [temperatura, qualificacao, pagamento, prazo, canal] = ["temperatura", "qualificacao", "pagamento", "prazo", "canal"].map((k) => texto(f, k));
  const vendedor = texto(f, "vendedor_id");
  const r = await atualizarQualificacao(u, id, {
    temperatura: ehChave(TEMPERATURAS, temperatura) ? temperatura : "morno",
    qualificacao: ehChave(QUALIFICACOES, qualificacao) ? qualificacao : "a_verificar",
    pagamento: ehChave(PAGAMENTOS, pagamento) ? pagamento : "indefinido",
    prazo: ehChave(PRAZOS, prazo) ? prazo : "indefinido",
    canal: canal === "varejo" || canal === "venda_direta" ? canal : null,
    veiculo: texto(f, "veiculo") || null,
    valor: valorBRL(texto(f, "valor")),
    temTroca: f.get("tem_troca") === "on",
    troca: texto(f, "troca") || null,
    vendedorId: f.has("vendedor_id") ? (/^[0-9a-f-]{36}$/i.test(vendedor) ? vendedor : null) : undefined,
  });
  revalidatePath("/painel/vendas");
  redirect(voltar(f, r.ok ? { op: id, ok: "salvo" } : { op: id, erro: r.motivo }));
}

export async function novaAtividade(f: FormData) {
  const u = await exigirAcesso("vendas");
  const id = texto(f, "id"), tipo = texto(f, "tipo"), descricao = texto(f, "descricao");
  const r = descricao && ehChave(TIPOS_ATIVIDADE, tipo) ? await registrarAtividade(u, id, tipo, descricao) : { ok: false as const, motivo: "Descreva o contato" };
  revalidatePath("/painel/vendas");
  redirect(voltar(f, r.ok ? { op: id } : { op: id, erro: r.motivo }));
}

export async function novaTarefa(f: FormData) {
  const u = await exigirAcesso("vendas");
  const id = texto(f, "id"), titulo = texto(f, "titulo"), prazo = texto(f, "prazo");
  // prazo vem do <input type="datetime-local"> no fuso configurado da loja
  const m = /^(d{4}-d{2}-d{2})T(d{2}:d{2})$/.exec(prazo);
  const cfg = await getConfig();
  const r = titulo && m ? await criarTarefa(u, id, titulo, localParaUtc(m[1], m[2], cfg.fuso_offset).toISOString()) : { ok: false as const, motivo: "Informe a tarefa e o prazo" };
  revalidatePath("/painel/vendas");
  redirect(voltar(f, r.ok ? { op: id } : { op: id, erro: r.motivo }));
}

export async function concluir(f: FormData) {
  const u = await exigirAcesso("vendas");
  await concluirTarefa(u, texto(f, "tarefa_id"));
  revalidatePath("/painel/vendas");
  redirect(voltar(f, { op: texto(f, "id") }));
}
