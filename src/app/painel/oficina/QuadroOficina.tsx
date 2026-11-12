import type { AtendimentoOficina } from "@/modulos/oficina/atendimentos";
import { formatarDataHora } from "@/lib/time";
import { assumirAtendimento } from "./actions";
import BotaoOficina from "./BotaoOficina";
import TransferirCartao from "../_components/TransferirCartao";

const ETAPAS = [
  { status: "novo", nome: "Novas solicitações" },
  { status: "em_triagem", nome: "Em triagem" },
] as const;

/** Ação explícita: a triagem atribui responsável e não permite arrastar de volta. */
export default function QuadroOficina({ atendimentos, minhas, fuso }: {
  atendimentos: AtendimentoOficina[]; minhas: boolean; fuso: string;
}) {
  return (
    <div className="kanban" aria-label="Fila de Oficina">
      {ETAPAS.map(etapa => {
        const cartoes = atendimentos.filter(item => item.status === etapa.status);
        return (
          <section key={etapa.status} className="kanban-coluna tipo-aberta" aria-label={`Etapa ${etapa.nome}`}>
            <header className="kanban-cabeca">
              <h2 style={{ fontSize: 13, margin: 0 }}><strong>{etapa.nome}</strong></h2>
              <span>{cartoes.length} nesta página</span>
            </header>
            <div className="kanban-cartoes">
              {cartoes.map(item => (
                <article key={item.id} className="kanban-cartao" aria-labelledby={`solicitacao-${item.id}`} style={{ overflowWrap: "anywhere" }}>
                  <h3 id={`solicitacao-${item.id}`} style={{ fontSize: 15, margin: "0 0 6px" }}>{item.clienteNome}</h3>
                  {item.veiculo && <p className="mudo" style={{ margin: "0 0 8px" }}>
                    {[item.veiculo.modelo, item.veiculo.placa].filter(Boolean).join(" · ") || "Veículo cadastrado"}
                  </p>}
                  <p style={{ whiteSpace: "pre-wrap", margin: "0 0 10px" }}>{item.descricao}</p>
                  <p className="mudo" style={{ margin: "0 0 6px" }}>
                    {item.unidade} · <time dateTime={item.criadoEm}>{formatarDataHora(item.criadoEm, fuso)}</time>
                  </p>
                  <p style={{ margin: "0 0 10px" }}>
                    {item.responsavel ? <>Responsável: <strong>{item.responsavel.nome}</strong></> : <span className="tag aviso">Sem responsável</span>}
                  </p>
                  {item.podeAssumir && (
                    <form action={assumirAtendimento}>
                      <input type="hidden" name="solicitacao" value={item.id} />
                      {minhas && <input type="hidden" name="minhas" value="1" />}
                      <BotaoOficina texto="Iniciar triagem" aguardando="Iniciando…" />
                    </form>
                  )}
                  <TransferirCartao origem="oficina" registroId={item.id} unidade={item.unidade} />
                </article>
              ))}
              {!cartoes.length && <p className="kanban-vazio mudo">Nenhuma solicitação nesta etapa.</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
