import { and, eq, isNull, lt } from "drizzle-orm";
import { Celula, Indicador, Tabela, Titulo } from "@/components/ui";
import { getDb, schema } from "@/db";
import { exigirFuncao } from "@/lib/acesso";
import { faixa } from "@/lib/score";

function taxa(ganhos: number, fechados: number) {
  return fechados ? `${Math.round((ganhos / fechados) * 100)}%` : "—";
}

export default async function Painel() {
  await exigirFuncao("gerente");
  const db = await getDb();

  const leads = await db.select().from(schema.leads);
  const vendedores = await db
    .select()
    .from(schema.usuarios)
    .where(eq(schema.usuarios.funcao, "vendedor"));
  const vencidas = await db
    .select({ vendedorId: schema.acoes.vendedorId })
    .from(schema.acoes)
    .where(and(isNull(schema.acoes.concluidaEm), lt(schema.acoes.venceEm, new Date())));

  const ganhos = leads.filter((l) => l.etapa === "ganho").length;
  const fechados = leads.filter((l) => l.etapa === "ganho" || l.etapa === "perdido").length;
  const faixaA = leads.filter((l) => faixa(l.pontuacao) === "A").length;

  const origens = [...new Set(leads.map((l) => l.origem))]
    .map((origem) => {
      const daOrigem = leads.filter((l) => l.origem === origem);
      return {
        origem,
        total: daOrigem.length,
        a: daOrigem.filter((l) => faixa(l.pontuacao) === "A").length,
        ganhos: daOrigem.filter((l) => l.etapa === "ganho").length,
      };
    })
    .sort((x, y) => y.total - x.total);

  return (
    <>
      <Titulo sub="Visão da loja. Dados de demonstração.">Painel</Titulo>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Indicador rotulo="Leads" valor={leads.length} />
        <Indicador rotulo="Leads A" valor={faixaA} nota="Mais chance de fechar" />
        <Indicador rotulo="Conversão" valor={taxa(ganhos, fechados)} nota="Ganhos / fechados" />
        <Indicador rotulo="Ações vencidas" valor={vencidas.length} nota="Lead esfriando" />
      </div>

      <h2 className="mt-8 mb-3 font-medium">Por vendedor</h2>
      <Tabela cabecalho={["Vendedor", "Loja", "Leads", "Leads A", "Ganhos", "Ações vencidas"]}>
        {vendedores.map((v) => {
          const deles = leads.filter((l) => l.vendedorId === v.id);
          return (
            <tr key={v.id}>
              <Celula className="font-medium">{v.nome}</Celula>
              <Celula>{v.loja}</Celula>
              <Celula className="tabular-nums">{deles.length}</Celula>
              <Celula className="tabular-nums">{deles.filter((l) => faixa(l.pontuacao) === "A").length}</Celula>
              <Celula className="tabular-nums">{deles.filter((l) => l.etapa === "ganho").length}</Celula>
              <Celula className="tabular-nums">{vencidas.filter((a) => a.vendedorId === v.id).length}</Celula>
            </tr>
          );
        })}
      </Tabela>

      <h2 className="mt-8 mb-3 font-medium">Por origem</h2>
      <Tabela cabecalho={["Origem", "Leads", "Leads A", "Ganhos"]}>
        {origens.map((o) => (
          <tr key={o.origem}>
            <Celula className="font-medium">{o.origem}</Celula>
            <Celula className="tabular-nums">{o.total}</Celula>
            <Celula className="tabular-nums">{o.a}</Celula>
            <Celula className="tabular-nums">{o.ganhos}</Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
