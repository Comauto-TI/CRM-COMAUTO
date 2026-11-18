import { asc, eq, ne, and } from "drizzle-orm";
import { iniciarVerComo } from "@/app/actions/ver-como";
import { Cartao, Titulo } from "@/components/ui";
import { getDb, schema } from "@/db";
import type { Funcao } from "@/db/schema";
import { exigirFuncao } from "@/lib/acesso";
import { NOME_FUNCAO } from "@/lib/funcoes";

const ORDEM: Funcao[] = ["gerente", "vendedor", "posvenda"];

export default async function VerComo() {
  await exigirFuncao("admin");
  const db = await getDb();
  const pessoas = await db
    .select()
    .from(schema.usuarios)
    .where(and(ne(schema.usuarios.funcao, "admin"), eq(schema.usuarios.ativo, true)))
    .orderBy(asc(schema.usuarios.nome));

  return (
    <>
      <Titulo sub="Abra as telas de qualquer função exatamente como a pessoa vê. Nada pode ser alterado nesse modo, e cada uso fica registrado na auditoria.">
        Ver como
      </Titulo>

      <div className="grid gap-4 md:grid-cols-3">
        {ORDEM.map((funcao) => (
          <Cartao key={funcao} className="p-4">
            <h2 className="font-medium">{NOME_FUNCAO[funcao]}</h2>
            <ul className="mt-3 space-y-2">
              {pessoas
                .filter((p) => p.funcao === funcao)
                .map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{p.nome}</p>
                      <p className="text-xs text-zinc-500">{p.loja}</p>
                    </div>
                    <form action={iniciarVerComo}>
                      <input type="hidden" name="usuarioId" value={p.id} />
                      <button
                        type="submit"
                        className="rounded-md bg-marca px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                      >
                        Ver como
                      </button>
                    </form>
                  </li>
                ))}
            </ul>
          </Cartao>
        ))}
      </div>
    </>
  );
}
