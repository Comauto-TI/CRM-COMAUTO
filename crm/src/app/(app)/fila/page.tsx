import { and, asc, eq, isNull } from "drizzle-orm";
import { concluirAcao } from "@/app/actions/fila";
import { BotaoAcao } from "@/components/botao-acao";
import { Cartao, Faixa, Titulo } from "@/components/ui";
import { getDb, schema } from "@/db";
import { exigirFuncao } from "@/lib/acesso";
import { dataHora, linkWhatsApp } from "@/lib/formato";

export default async function Fila() {
  const { visao, somenteLeitura } = await exigirFuncao("vendedor");
  const db = await getDb();

  const pendentes = await db
    .select({
      id: schema.acoes.id,
      tipo: schema.acoes.tipo,
      descricao: schema.acoes.descricao,
      venceEm: schema.acoes.venceEm,
      lead: schema.leads,
    })
    .from(schema.acoes)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.acoes.leadId))
    .where(and(eq(schema.acoes.vendedorId, visao.id), isNull(schema.acoes.concluidaEm)))
    .orderBy(asc(schema.acoes.venceEm));

  const agora = new Date();
  const vencidas = pendentes.filter((p) => p.venceEm < agora).length;

  return (
    <>
      <Titulo
        sub={`${pendentes.length} ações pendentes${vencidas ? `, ${vencidas} vencidas` : ""}. Comece pelas vencidas e pelos leads A.`}
      >
        Minha fila
      </Titulo>

      {pendentes.length === 0 ? (
        <p className="text-sm text-zinc-500">Tudo em dia.</p>
      ) : (
        <ul className="space-y-3">
          {pendentes.map((p) => {
            const vencida = p.venceEm < agora;
            return (
              <li key={p.id}>
                <Cartao className={`p-4 ${vencida ? "border-red-300" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <Faixa pontuacao={p.lead.pontuacao} />
                      <div className="min-w-0">
                        <p className="font-medium">{p.lead.nome}</p>
                        <p className="text-sm text-zinc-500">
                          {p.lead.interesse} · {p.lead.origem}
                        </p>
                        <p className="mt-2 text-sm">
                          <span className="font-medium">{p.tipo}:</span> {p.descricao}
                        </p>
                        <p className={`mt-1 text-xs ${vencida ? "font-medium text-red-600" : "text-zinc-500"}`}>
                          {vencida ? "Venceu " : "Vence "}
                          {dataHora(p.venceEm)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <a
                        href={linkWhatsApp(p.lead.telefone)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                      >
                        WhatsApp
                      </a>
                      <BotaoAcao
                        acao={concluirAcao}
                        campo="acaoId"
                        valor={p.id}
                        rotulo="Concluir"
                        somenteLeitura={somenteLeitura}
                      />
                    </div>
                  </div>
                </Cartao>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
