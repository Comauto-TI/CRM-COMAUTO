import "server-only";
import { db } from "@/lib/supabase/admin";

/** Vincula o cliente ao link/QR de onde ele veio (primeiro toque + todas as conversas por link). */
export async function vincularLink(codigo: string, clienteId: string): Promise<boolean> {
  const { data: link } = await db().from("links_rastreados").select("id, canal").eq("codigo", codigo).eq("ativo", true).maybeSingle();
  if (!link) return false;
  await db().from("link_conversas").upsert({ link_id: link.id, cliente_id: clienteId }, { onConflict: "link_id,cliente_id", ignoreDuplicates: true });
  await db().from("clientes").update({ link_origem_id: link.id, origem: `link:${link.canal}` }).eq("id", clienteId).is("link_origem_id", null);
  return true;
}
