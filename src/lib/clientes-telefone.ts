import "server-only";
import { db } from "@/lib/supabase/admin";
import { variantesTelefone } from "@/lib/phone";

/**
 * Ficha única: acha o cliente pelo telefone em qualquer das formas (com/sem o 9º dígito).
 * Se houver mais de uma ficha (duplicata antiga), devolve a mais antiga — a que tem histórico.
 */
export async function buscarClientePorTelefone<T extends Record<string, unknown> = { id: string }>(
  telefone: string,
  colunas = "id",
): Promise<(T & { id: string; telefone: string }) | null> {
  const formas = variantesTelefone(telefone);
  if (!formas.length) return null;
  const { data } = await db()
    .from("clientes")
    .select(`${colunas}, id, telefone, criado_em`)
    .in("telefone", formas)
    .order("criado_em", { ascending: true })
    .limit(1);
  return ((data ?? [])[0] as unknown as (T & { id: string; telefone: string }) | undefined) ?? null;
}
