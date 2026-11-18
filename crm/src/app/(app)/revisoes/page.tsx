import { asc } from "drizzle-orm";
import { marcarContatado } from "@/app/actions/revisoes";
import { BotaoAcao } from "@/components/botao-acao";
import { Cartao, Titulo } from "@/components/ui";
import { getDb, schema } from "@/db";
import { exigirFuncao } from "@/lib/acesso";
import { data, diasAte, linkWhatsApp } from "@/lib/formato";

const NOME_STATUS = { pendente: "Pendente", contatado: "Contatado", agendado: "Agendado" };

function prazo(dias: number) {
  if (dias < 0) return { texto: `Atrasada há ${-dias} dias`, cor: "text-red-600 font-medium" };
  if (dias <= 30) return { texto: `Em ${dias} dias`, cor: "text-amber-700 font-medium" };
  return { texto: `Em ${dias} dias`, cor: "text-zinc-500" };
}

export default async function Revisoes() {
  const { somenteLeitura } = await exigirFuncao("posvenda");
  const db = await getDb();
  const lista = await db.select().from(schema.revisoes).orderBy(asc(schema.revisoes.proximaRevisao));

  return (
    <>
      <Titulo sub="Clientes com revisão chegando ou atrasada. A garantia VW depende da revisão na rede.">
        Revisões
      </Titulo>
      <ul className="space-y-3">
        {lista.map((r) => {
          const p = prazo(diasAte(r.proximaRevisao));
          const garantiaDias = r.garantiaAte ? diasAte(r.garantiaAte) : null;
          return (
            <li key={r.id}>
              <Cartao className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{r.clienteNome}</p>
                    <p className="text-sm text-zinc-500">
                      {r.veiculo} · {r.placa}
                    </p>
                    <p className={`mt-2 text-sm ${p.cor}`}>
                      Revisão {data(r.proximaRevisao)} · {p.texto}
                    </p>
                    {garantiaDias !== null && garantiaDias >= 0 && garantiaDias <= 120 && (
                      <p className="mt-1 text-xs font-medium text-red-600">
                        Garantia acaba em {garantiaDias} dias
                      </p>
                    )}
                    <p className="mt-1 text-xs text-zinc-500">Status: {NOME_STATUS[r.status]}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <a
                      href={linkWhatsApp(r.telefone)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      WhatsApp
                    </a>
                    {r.status === "pendente" && (
                      <BotaoAcao
                        acao={marcarContatado}
                        campo="revisaoId"
                        valor={r.id}
                        rotulo="Marcar contatado"
                        somenteLeitura={somenteLeitura}
                      />
                    )}
                  </div>
                </div>
              </Cartao>
            </li>
          );
        })}
      </ul>
    </>
  );
}
