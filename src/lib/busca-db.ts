import "server-only";
import { db } from "@/lib/supabase/admin";
import { nucleoAplicado } from "@/lib/usuarios";
import type { Busca } from "@/lib/busca";

export type ClienteEncontrado = {
  id: string;
  nome: string | null;
  telefone: string;
  cidade: string | null;
  cpf_cnpj: string | null;
  vendedor_id: string | null;
  anonimizado: boolean;
  ultimo_contato_em: string | null;
  veiculos: { placa: string | null; modelo: string | null; ano: number | null }[];
};

const LIMITE = 50;

/**
 * Busca no grupo inteiro (o vendedor vê todos pela busca; a carteira é a visão principal — decisão do Simão).
 * Sempre pelo servidor, depois de exigirAcesso("busca"). Valores já saneados por interpretarBusca().
 */
export async function buscarClientes(b: Busca): Promise<ClienteEncontrado[]> {
  const nucleo = await nucleoAplicado();
  const colunas = `id, nome, telefone, cidade, anonimizado, ultimo_contato_em${nucleo ? ", cpf_cnpj, vendedor_id" : ""}`;

  let ids: string[] | null = null;
  if (b.tipo === "placa") {
    const { data } = await db().from("veiculos").select("cliente_id").ilike("placa", b.valor).limit(LIMITE);
    ids = [...new Set((data ?? []).map((v) => v.cliente_id as string))];
    if (!ids.length) return [];
  }

  let q = db()
    .from("clientes")
    .select(`${colunas}, veiculos(placa, modelo, ano)`)
    .eq("anonimizado", false)
    .order("ultimo_contato_em", { ascending: false, nullsFirst: false })
    .limit(LIMITE);

  switch (b.tipo) {
    case "placa":
      q = q.in("id", ids!);
      break;
    case "cpf":
    case "cnpj":
      if (!nucleo) return [];
      q = q.eq("cpf_cnpj", b.valor);
      break;
    case "cpf_ou_telefone":
      q = nucleo ? q.or(`cpf_cnpj.eq.${b.valor},telefone.like.%${b.valor}%`) : q.like("telefone", `%${b.valor}%`);
      break;
    case "telefone":
      q = q.like("telefone", `%${b.valor}%`);
      break;
    case "nome":
      q = q.ilike("nome", `%${b.valor}%`);
      break;
  }

  const { data } = await q;
  return ((data ?? []) as unknown as Partial<ClienteEncontrado>[]).map((c) => ({
    cpf_cnpj: null,
    vendedor_id: null,
    veiculos: [],
    ...c,
  })) as ClienteEncontrado[];
}

/** Nomes dos vendedores (para mostrar de quem é a carteira). */
export async function nomesVendedores(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length || !(await nucleoAplicado())) return new Map();
  const { data } = await db().from("usuarios").select("user_id, nome").in("user_id", unicos);
  return new Map((data ?? []).map((u) => [u.user_id as string, u.nome as string]));
}
