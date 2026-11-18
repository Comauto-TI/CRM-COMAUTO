import { desc, eq } from "drizzle-orm";
import { Celula, Faixa, Tabela, Titulo } from "@/components/ui";
import { getDb, schema } from "@/db";
import { exigirFuncao } from "@/lib/acesso";
import { NOME_ETAPA } from "@/lib/formato";

export default async function TodosLeads() {
  await exigirFuncao("gerente");
  const db = await getDb();
  const lista = await db
    .select({ lead: schema.leads, vendedor: schema.usuarios.nome })
    .from(schema.leads)
    .leftJoin(schema.usuarios, eq(schema.usuarios.id, schema.leads.vendedorId))
    .orderBy(desc(schema.leads.pontuacao));

  return (
    <>
      <Titulo sub={`${lista.length} leads em todas as lojas.`}>Todos os leads</Titulo>
      <Tabela cabecalho={["", "Cliente", "Interesse", "Origem", "Loja", "Vendedor", "Etapa"]}>
        {lista.map(({ lead, vendedor }) => (
          <tr key={lead.id}>
            <Celula>
              <Faixa pontuacao={lead.pontuacao} />
            </Celula>
            <Celula className="font-medium whitespace-nowrap">{lead.nome}</Celula>
            <Celula>{lead.interesse}</Celula>
            <Celula>{lead.origem}</Celula>
            <Celula>{lead.loja}</Celula>
            <Celula className="whitespace-nowrap">{vendedor ?? "Sem vendedor"}</Celula>
            <Celula className="whitespace-nowrap">{NOME_ETAPA[lead.etapa]}</Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
