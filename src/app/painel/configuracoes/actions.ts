"use server";

import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { invalidarConfig, getConfig } from "@/lib/config";
import { normalizarTelefone } from "@/lib/phone";
import { auditar } from "@/lib/audit";
import { tabelaUsuarios } from "@/lib/usuarios";
import { papelValido, setorValido } from "@/lib/permissoes";

async function salvarChave(chave: string, valor: unknown, email: string) {
  await db().from("config").upsert({ chave, valor, atualizado_em: new Date().toISOString() });
  invalidarConfig();
  await auditar(email, "config", "config", chave, { valor });
}

export async function salvarEmpresa(formData: FormData) {
  const u = await exigirAcesso("configuracoes");
  await salvarChave("empresa", {
    nome: String(formData.get("nome")).trim().slice(0, 80),
    endereco: String(formData.get("endereco")).trim().slice(0, 200),
    telefone_humano: String(formData.get("telefone_humano")).trim().slice(0, 30),
    site: String(formData.get("site")).trim().slice(0, 120),
    whatsapp_numero: normalizarTelefone(String(formData.get("whatsapp_numero") ?? "")) ?? "",
    // só https (evita javascript:/data: e conteúdo misto)
    logo_url: /^https:\/\/[^\s"'<>]+$/.test(String(formData.get("logo_url") ?? "").trim()) ? String(formData.get("logo_url")).trim().slice(0, 500) : "",
  }, u.email);
  await salvarChave("bot_ativo", formData.get("bot_ativo") === "on", u.email);
  revalidatePath("/painel", "layout");
}

export async function salvarFinanceiro(formData: FormData) {
  const u = await exigirAcesso("custos_config");
  const cambio = Number(String(formData.get("cambio")).replace(",", "."));
  if (cambio > 0) await salvarChave("cambio_usd_brl", cambio, u.email);
  for (const cat of ["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"]) {
    const v = Number(String(formData.get(`preco_${cat}`) ?? "").replace(",", "."));
    const vigente = String(formData.get("vigente") || new Date().toISOString().slice(0, 10));
    if (v >= 0 && formData.get(`preco_${cat}`) !== null && formData.get(`preco_${cat}`) !== "") {
      const { data: atual } = await db().from("precos_meta").select("valor_brl").eq("categoria", cat).order("vigente_desde", { ascending: false }).limit(1).maybeSingle();
      if (!atual || Number(atual.valor_brl) !== v) {
        await db().from("precos_meta").insert({ categoria: cat, valor_brl: v, vigente_desde: vigente, observacao: `alterado por ${u.email}` });
      }
    }
  }
  await auditar(u.email, "precos_meta", "precos_meta", null);
  revalidatePath("/painel/configuracoes");
}

export async function salvarCustoFixo(formData: FormData) {
  const u = await exigirAcesso("custos_config");
  const id = String(formData.get("id") || "");
  const dados = {
    nome: String(formData.get("nome")).slice(0, 80),
    valor: Number(String(formData.get("valor")).replace(",", ".")) || 0,
    moeda: formData.get("moeda") === "USD" ? "USD" : "BRL",
    recorrencia: formData.get("recorrencia") === "anual" ? "anual" : "mensal",
    ativo: formData.get("ativo") === "on",
  };
  if (id) await db().from("custos_fixos").update(dados).eq("id", id);
  else await db().from("custos_fixos").insert(dados);
  await auditar(u.email, "custo_fixo", "custos_fixos", id || null, dados);
  revalidatePath("/painel/configuracoes");
}

export async function salvarTemplate(formData: FormData) {
  const u = await exigirAcesso("configuracoes");
  const id = String(formData.get("id"));
  const status = String(formData.get("status_aprovacao"));
  if (!["rascunho", "pendente", "aprovado", "reprovado"].includes(status)) return;
  await db().from("templates").update({ status_aprovacao: status, ativo: formData.get("ativo") === "on" }).eq("id", id);
  await auditar(u.email, "template_status", "template", id, { status });
  revalidatePath("/painel/configuracoes");
}

export async function salvarServico(formData: FormData) {
  const u = await exigirAcesso("configuracoes");
  const id = String(formData.get("id") || "");
  const preco = String(formData.get("preco") || "").replace(",", ".");
  const dados = {
    nome: String(formData.get("nome")).slice(0, 80),
    duracao_min: Math.max(15, Number(formData.get("duracao")) || 60),
    preco_referencia: preco ? Number(preco) : null,
    tipo_recurso: String(formData.get("tipo_recurso") || "box"),
    ativo: formData.get("ativo") === "on",
  };
  if (id) await db().from("servicos").update(dados).eq("id", id);
  else await db().from("servicos").insert(dados);
  await auditar(u.email, "servico", "servicos", id || null, dados);
  revalidatePath("/painel/configuracoes");
}

export async function adicionarBloqueio(formData: FormData) {
  const u = await exigirAcesso("configuracoes");
  const { fuso_offset } = await getConfig();
  const recurso = String(formData.get("recurso") || "") || null;
  const ini = new Date(`${formData.get("inicio")}:00${fuso_offset}`);
  const fim = new Date(`${formData.get("fim")}:00${fuso_offset}`);
  if (!(fim > ini)) return;
  await db().from("bloqueios").insert({ recurso_id: recurso, inicio: ini.toISOString(), fim: fim.toISOString(), motivo: String(formData.get("motivo") || "") || null });
  await auditar(u.email, "bloqueio_agenda", "bloqueios", null, { recurso, ini, fim });
  revalidatePath("/painel/configuracoes");
}

export async function removerBloqueio(formData: FormData) {
  const u = await exigirAcesso("configuracoes");
  const id = String(formData.get("id"));
  await db().from("bloqueios").delete().eq("id", id);
  await auditar(u.email, "remover_bloqueio", "bloqueios", id);
  revalidatePath("/painel/configuracoes");
}

/** Equipe: telefone de alerta e consentimento para receber alertas de atendimento no WhatsApp. */
export async function salvarEquipe(formData: FormData) {
  const u = await exigirAcesso("configuracoes");
  const userId = String(formData.get("user_id"));
  const tel = normalizarTelefone(String(formData.get("telefone") || ""));
  const recebe = formData.get("recebe_alertas") === "on" && !!tel;
  const papel = formData.get("papel");
  const setor = formData.get("setor");
  if (!papelValido(papel)) return;
  const tabela = await tabelaUsuarios();
  const { data: atual } = await db().from(tabela).select("consentimento_alertas_em").eq("user_id", userId).single();
  await db()
    .from(tabela)
    .update({
      papel,
      ...(tabela === "usuarios" && setorValido(setor) ? { setor } : {}),
      ativo: formData.get("ativo") === "on",
      telefone_whatsapp: tel,
      recebe_alertas: recebe,
      consentimento_alertas_em: recebe ? atual?.consentimento_alertas_em ?? new Date().toISOString() : null,
    })
    .eq("user_id", userId);
  await auditar(u.email, "equipe", "usuarios", userId, { papel, setor });
  revalidatePath("/painel/configuracoes");
}
