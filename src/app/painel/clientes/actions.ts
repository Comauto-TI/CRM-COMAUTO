"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { normalizarTelefone, variantesTelefone } from "@/lib/phone";
import { auditar } from "@/lib/audit";
import { registrarConsentimento, aplicarOptout } from "@/lib/consent";
import { getConfig } from "@/lib/config";
import { localParaUtc } from "@/lib/time";
import { agendarLembrete, agendarMensagem } from "@/lib/agendados";
import { lerDocumento, lerNascimento } from "@/lib/busca";
import { buscarClientePorTelefone } from "@/lib/clientes-telefone";

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

/** F2-4/F2-5: lembrete para mim ou mensagem agendada, a partir da ficha do cliente. */
export async function agendarNaFicha(formData: FormData) {
  const u = await exigirAcesso("clientes");
  const id = String(formData.get("id") ?? "");
  const volta = (q: string) => `/painel/clientes?c=${encodeURIComponent(id)}&${q}`;
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/painel/clientes");
  const { data: c } = await db().from("clientes").select("id, anonimizado").eq("id", id).maybeSingle();
  if (!c || c.anonimizado) redirect(volta("erro=Cliente%20indispon%C3%ADvel"));
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(String(formData.get("quando") ?? ""));
  const cfg = await getConfig();
  const quando = m ? localParaUtc(m[1], m[2], cfg.fuso_offset) : new Date(NaN);
  const dados = { clienteId: id, quando, texto: String(formData.get("texto") ?? "") };
  const r = formData.get("tipo") === "mensagem" ? await agendarMensagem(u, dados) : await agendarLembrete(u, dados);
  revalidatePath("/painel/clientes");
  redirect(volta(r.ok ? "ok=agendado" : `erro=${encodeURIComponent(r.motivo)}`));
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
    if (variantesTelefone(telefone).some((v) => bloqueados.has(v))) { optout++; continue; }
    const existente = await buscarClientePorTelefone(telefone);
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

/** Ficha do cliente: editar dados básicos. CPF não vem preenchido (LGPD): vazio = manter o atual. */
export async function editarCliente(formData: FormData) {
  const u = await exigirAcesso("clientes");
  const id = String(formData.get("id") ?? "");
  const volta = (q: string) => `/painel/clientes?c=${encodeURIComponent(id)}&${q}`;
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/painel/clientes");
  const { data: atual } = await db().from("clientes").select("id, anonimizado").eq("id", id).maybeSingle();
  if (!atual || atual.anonimizado) redirect(volta("erro=Cliente%20indispon%C3%ADvel"));

  const nome = String(formData.get("nome") ?? "").trim().slice(0, 120);
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 160);
  const cidade = String(formData.get("cidade") ?? "").trim().slice(0, 80);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) redirect(volta("erro=E-mail%20inv%C3%A1lido"));
  const nasc = lerNascimento(String(formData.get("nascimento") ?? ""));
  if (!nasc.ok) redirect(volta(`erro=${encodeURIComponent(nasc.motivo)}`));
  const patch: Record<string, unknown> = { nome: nome || null, email: email || null, cidade: cidade || null, data_nascimento: nasc.ok ? nasc.valor : null, atualizado_em: new Date().toISOString() };

  const docTexto = String(formData.get("documento") ?? "");
  if (docTexto.trim()) {
    const doc = lerDocumento(docTexto);
    if (!doc.ok) redirect(volta(`erro=${encodeURIComponent(doc.motivo)}`));
    if (doc.ok && doc.valor) {
      // ficha única: o mesmo CPF/CNPJ não pode estar em duas fichas
      const { data: outro } = await db().from("clientes").select("id, nome").eq("cpf_cnpj", doc.valor).neq("id", id).limit(1).maybeSingle();
      if (outro) redirect(volta(`erro=${encodeURIComponent(`Esse documento já está na ficha de ${(outro.nome as string | null) ?? "outro cliente"} — mesclar fichas é a próxima ferramenta`)}`));
      patch.cpf_cnpj = doc.valor;
    }
  }
  if (formData.get("remover_documento") === "on") patch.cpf_cnpj = null;

  const { error } = await db().from("clientes").update(patch).eq("id", id).eq("anonimizado", false);
  if (error) redirect(volta("erro=N%C3%A3o%20foi%20poss%C3%ADvel%20salvar"));
  await auditar(u.email, "editar_cliente", "cliente", id, { campos: Object.keys(patch).filter((k) => k !== "atualizado_em") });
  revalidatePath("/painel/clientes");
  redirect(volta("ok=dados"));
}
