import "server-only";
import { db } from "@/lib/supabase/admin";

/**
 * TRANSIÇÃO F0-2: a migration 0002_nucleo renomeia admin_usuarios → usuarios e cria as colunas do núcleo
 * (cpf_cnpj, vendedor_id, notificacoes...). Enquanto ela não estiver aplicada, o código cai para o modo antigo.
 * Remover este arquivo (e usar "usuarios" direto) quando todos os bancos estiverem na 0002.
 */
let cache: "usuarios" | "admin_usuarios" | null = null;

export async function tabelaUsuarios(): Promise<"usuarios" | "admin_usuarios"> {
  if (cache) return cache;
  const { error } = await db().from("usuarios").select("user_id").limit(1);
  const nome = error?.code === "PGRST205" || error?.code === "42P01" ? "admin_usuarios" : "usuarios";
  if (!error) cache = "usuarios"; // só memoriza o estado final (pós-migration)
  return nome;
}

/** true quando a 0002_nucleo já está no banco. */
export async function nucleoAplicado(): Promise<boolean> {
  return (await tabelaUsuarios()) === "usuarios";
}
