import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Celula, Tabela, Titulo } from "@/components/ui";
import { getDb, schema } from "@/db";
import { exigirFuncao } from "@/lib/acesso";
import { dataHora } from "@/lib/formato";

const NOME_ACAO: Record<string, string> = {
  ver_como_inicio: "Entrou no Ver como",
  ver_como_fim: "Saiu do Ver como",
  acao_bloqueada: "Tentativa bloqueada",
};

export default async function Auditoria() {
  await exigirFuncao("admin");
  const db = await getDb();
  const autor = alias(schema.usuarios, "autor");
  const alvo = alias(schema.usuarios, "alvo");

  const registros = await db
    .select({
      id: schema.auditoria.id,
      acao: schema.auditoria.acao,
      detalhe: schema.auditoria.detalhe,
      criadoEm: schema.auditoria.criadoEm,
      autor: autor.nome,
      alvo: alvo.nome,
    })
    .from(schema.auditoria)
    .innerJoin(autor, eq(autor.id, schema.auditoria.usuarioId))
    .leftJoin(alvo, eq(alvo.id, schema.auditoria.alvoUsuarioId))
    .orderBy(desc(schema.auditoria.criadoEm))
    .limit(200);

  return (
    <>
      <Titulo sub="Quem usou o Ver como, de quem eram as telas e o que tentou fazer.">Auditoria</Titulo>
      {registros.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum registro ainda.</p>
      ) : (
        <Tabela cabecalho={["Quando", "Quem", "O quê", "Telas de", "Detalhe"]}>
          {registros.map((r) => (
            <tr key={r.id}>
              <Celula className="whitespace-nowrap tabular-nums">{dataHora(r.criadoEm)}</Celula>
              <Celula>{r.autor}</Celula>
              <Celula>{NOME_ACAO[r.acao] ?? r.acao}</Celula>
              <Celula>{r.alvo ?? "—"}</Celula>
              <Celula className="text-zinc-500">{r.detalhe ?? ""}</Celula>
            </tr>
          ))}
        </Tabela>
      )}
    </>
  );
}
