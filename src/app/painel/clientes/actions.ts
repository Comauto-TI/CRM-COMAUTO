"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { normalizarTelefone } from "@/lib/phone";
import { auditar } from "@/lib/audit";
import { registrarConsentimento, aplicarOptout } from "@/lib/consent";

/** LGPD: anonimiza o titular (mantém só o mínimo para comprovar opt-out/consentimentos). */
export async function anonimizar(formData: FormData) {
  const u = await exigirAcesso("lgpd");
  const id = String(formData.get("id"));
  const { data: c } = await db().from("clientes").select("telefone").eq("id", id).single();
  if (!c) return;
  await aplicarOptout(id, c.telefone, "anonimização LGPD", "painel");
  await db().from("mensagens").update({ conteudo: "[removido — LGPD]", metadata: {} }).eq("cliente_id", id);
  await db().from("notas_cliente").delete().eq("cliente_id", id);
  await db().from("veiculos").update({ placa: null }).eq("cliente_id", id);
  await db()
    .from("clientes")
    .update({ nome: null, email: null, cidade: null, tags: [], anonimizado: true, telefone: `anon-${id.slice(0, 8)}-${c.telefone.slice(-4)}` })
    .eq("id", id);
  await auditar(u.email, "anonimizar_lgpd", "cliente", id);
  revalidatePath("/painel/clientes");
}

export async function optoutManual(formData: FormData) {
  const u = await exigirAcesso("clientes");
  const id = String(formData.get("id"));
  const { data: c } = await db().from("clientes").select("telefone").eq("id", id).single();
  if (!c) return;
  await aplicarOptout(id, c.telefone, "registrado pela recepção", "painel");
  await auditar(u.email, "optout_manual", "cliente", id);
  revalidatePath("/painel/clientes");
}

/**
 * Importação de base CONSENTIDA (CSV colado). Origem e texto do consentimento são obrigatórios —
 * regra: nunca importar lista comprada ou sem permissão comprovada.
 * Colunas: telefone;nome;cidade;tags(separadas por |)
 */
export async function importarCSV(formData: FormData) {
  const u = await exigirAcesso("lgpd");
  const csv = String(formData.get("csv") ?? "");
  const origem = String(formData.get("origem") ?? "").trim();
  const texto = String(formData.get("texto") ?? "").trim();
  const tipos = formData.getAll("tipos").map(String).filter((t) => ["servico", "eventos", "marketing"].includes(t)) as ("servico" | "eventos" | "marketing")[];
  if (!origem || texto.length < 20 || !tipos.length || formData.get("declaro") !== "on") redirect("/painel/clientes?msg=import_incompleto");

  const { data: opts } = await db().from("optouts").select("telefone");
  const bloqueados = new Set((opts ?? []).map((o) => o.telefone));
  let ok = 0, invalidos = 0, optout = 0;
  for (const linha of csv.split(/\r?\n/).slice(0, 5000)) {
    const [tel, nome, cidade, tags] = linha.split(/[;,\t]/).map((x) => x?.trim());
    if (!tel || /telefone/i.test(tel)) continue;
    const telefone = normalizarTelefone(tel);
    if (!telefone) { invalidos++; continue; }
    if (bloqueados.has(telefone)) { optout++; continue; }
    const { data: existente } = await db().from("clientes").select("id").eq("telefone", telefone).maybeSingle();
    const id =
      existente?.id ??
      (await db().from("clientes").insert({ telefone, nome: nome || null, cidade: cidade || null, tags: tags ? tags.split("|").map((t) => t.trim().toLowerCase()) : [], origem: "importacao" }).select("id").single()).data?.id;
    if (!id) continue;
    for (const t of tipos) await registrarConsentimento(id, t, texto, `importacao:${origem}`);
    ok++;
  }
  await auditar(u.email, "importar_base", "clientes", null, { ok, invalidos, optout, origem, tipos });
  redirect(`/painel/clientes?msg=import_ok&ok=${ok}&inv=${invalidos}&opt=${optout}`);
}
