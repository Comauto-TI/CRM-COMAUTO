import { desc, eq } from "drizzle-orm";
import { Celula, Faixa, Tabela, Titulo } from "@/components/ui";
import { getDb, schema } from "@/db";
import { exigirFuncao } from "@/lib/acesso";
import { NOME_ETAPA } from "@/lib/formato";

export default async function MeusLeads() {
  const { visao } = await exigirFuncao("vendedor");
  const db = await getDb();
  const lista = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.vendedorId, visao.id))
    .orderBy(desc(schema.leads.pontuacao));

  return (
    <>
      <Titulo sub="Ordenados pela pontuação: A primeiro.">Meus leads</Titulo>
      <Tabela cabecalho={["", "Cliente", "Interesse", "Origem", "Etapa", "Sinais"]}>
        {lista.map((l) => (
          <tr key={l.id}>
            <Celula>
              <Faixa pontuacao={l.pontuacao} />
            </Celula>
            <Celula className="font-medium whitespace-nowrap">{l.nome}</Celula>
            <Celula>{l.interesse}</Celula>
            <Celula>{l.origem}</Celula>
            <Celula className="whitespace-nowrap">{NOME_ETAPA[l.etapa]}</Celula>
            <Celula className="text-xs text-zinc-500">
              {[
                l.testDrive && "test drive",
                l.temTroca && "troca",
                l.querFinanciar && "financiamento",
                l.clienteDaCasa && "cliente da casa",
              ]
                .filter(Boolean)
                .join(", ")}
            </Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
