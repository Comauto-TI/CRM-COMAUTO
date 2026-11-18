import { asc } from "drizzle-orm";
import { Celula, Tabela, Titulo } from "@/components/ui";
import { getDb, schema } from "@/db";
import { exigirFuncao } from "@/lib/acesso";
import { NOME_FUNCAO } from "@/lib/funcoes";

export default async function Usuarios() {
  await exigirFuncao("admin");
  const db = await getDb();
  const lista = await db.select().from(schema.usuarios).orderBy(asc(schema.usuarios.nome));

  return (
    <>
      <Titulo>Usuários</Titulo>
      <Tabela cabecalho={["Nome", "E-mail", "Função", "Loja", "Situação"]}>
        {lista.map((u) => (
          <tr key={u.id}>
            <Celula className="font-medium">{u.nome}</Celula>
            <Celula className="text-zinc-500">{u.email}</Celula>
            <Celula>{NOME_FUNCAO[u.funcao]}</Celula>
            <Celula>{u.loja}</Celula>
            <Celula>{u.ativo ? "Ativo" : "Inativo"}</Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
