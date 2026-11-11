import { randomUUID } from "node:crypto";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { listarCotacoes } from "@/modulos/pecas/cotacoes";
import { etapaCotacao, ETAPAS_ABERTAS, formatarPrazo, lerFiltrosFila } from "@/modulos/pecas/dados-cotacao";
import { Cabecalho, Status, Vazio } from "../_components/ui";
import { assumirCotacao, criarCotacao } from "./actions";

const ORIGENS = {
  balcao: "Balcão",
  oficina: "Oficina",
  whatsapp: "WhatsApp",
};

const MENSAGENS: Record<string, string> = {
  criada: "Cotação registrada.",
  iniciada: "Cotação em andamento.",
  indisponivel: "Esta cotação já foi assumida ou está indisponível para sua unidade.",
  erro_inicio: "Não foi possível assumir a cotação. Tente novamente.",
  invalida: "Confira o telefone, a placa e a descrição.",
  cliente: "Cliente não encontrado. Confira o telefone na ficha do cliente.",
  veiculo: "A placa informada não está vinculada a esse cliente.",
  unidade: "Sua unidade ainda não está habilitada para registrar cotações.",
  pendente: "A fila de Peças ainda precisa ser habilitada neste ambiente.",
  erro: "Não foi possível registrar a cotação. Tente novamente.",
};

export default async function PecasPage({ searchParams }: {
  searchParams: Promise<{ msg?: string | string[]; fila?: string | string[]; pagina?: string | string[] }>;
}) {
  const u = await exigirAcesso("pecas");
  const busca = await searchParams;
  const { msg } = busca;
  const filtros = lerFiltrosFila(busca);
  const fila = await listarCotacoes(u.unidades, filtros);

  return (
    <>
      <Cabecalho titulo="Peças" sub="Cotações e pedidos da sua unidade" />
      {typeof msg === "string" && Object.hasOwn(MENSAGENS, msg) && <p role="status">{MENSAGENS[msg]}</p>}
      {!fila.ok ? (
        <Vazio>{fila.pendente ? MENSAGENS.pendente : "Não foi possível carregar a fila de Peças."}</Vazio>
      ) : (
        <>
          <section className="card">
            <h2>Nova cotação de balcão</h2>
            <form action={criarCotacao} className="linha-form">
              <input type="hidden" name="solicitacao" value={randomUUID()} />
              <label>Telefone do cliente <input name="telefone" type="tel" required maxLength={25} /></label>
              <label>Placa (opcional) <input name="placa" maxLength={10} /></label>
              <label>Peça ou solicitação <input name="descricao" required maxLength={1000} /></label>
              <button className="btn primario" type="submit">Registrar cotação</button>
            </form>
          </section>
          <h2 className="secao">Cotações {filtros.fila === "abertas" ? "em aberto" : "encerradas"}</h2>
          <nav className="acoes" aria-label="Filtrar cotações">
            <Link className={filtros.fila === "abertas" ? "btn primario" : "btn"} href="/painel/pecas?fila=abertas">Em aberto</Link>
            <Link className={filtros.fila === "encerradas" ? "btn primario" : "btn"} href="/painel/pecas?fila=encerradas">Encerradas</Link>
          </nav>
          {fila.cotacoes.length === 0 ? <Vazio>Nenhuma cotação nesta página.</Vazio> : (
            <div className="card tabela-wrap">
              <table>
                <thead><tr><th>Cliente</th><th>Placa</th><th>Solicitação</th><th>Unidade</th><th>Origem</th><th>Etapa</th><th>Responsável</th><th>Próxima ação</th><th>Ações</th></tr></thead>
                <tbody>
                  {fila.cotacoes.map((c) => (
                    <tr key={c.id}>
                      <td>{c.clientes?.nome ?? "Cliente cadastrado"}</td>
                      <td>{c.veiculos?.placa ?? "—"}</td>
                      <td>{c.descricao}</td>
                      <td>{c.unidade}</td>
                      <td>{ORIGENS[c.origem]}</td>
                      <td><Status valor={etapaCotacao(c.status, c.tipo_preparo, c.venda_confirmada_em !== null)} /></td>
                      <td>{c.responsavel?.nome ?? "—"}</td>
                      <td>
                        {c.proxima_acao ?? "A definir"}
                        {c.prazo && <div className="mudo">Prazo · <time dateTime={c.prazo}>{formatarPrazo(c.prazo)}</time></div>}
                      </td>
                      <td>
                        <div className="acoes">
                          <Link className="btn" href={`/painel/pecas/${c.id}`} prefetch={false}>Ver cotação</Link>
                          {c.responsavel_id === null && ETAPAS_ABERTAS.includes(c.status) && (
                            <form action={assumirCotacao}>
                              <input type="hidden" name="solicitacao" value={c.id} />
                              <button className="btn" type="submit">Assumir cotação</button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <nav className="acoes secao" aria-label="Páginas de cotações">
            {filtros.pagina > 1 && (
              <Link className="btn" href={`/painel/pecas?fila=${filtros.fila}&pagina=${filtros.pagina - 1}`}>Anterior</Link>
            )}
            <span>Página {filtros.pagina}</span>
            {fila.temMais && (
              <Link className="btn" href={`/painel/pecas?fila=${filtros.fila}&pagina=${filtros.pagina + 1}`}>Próxima</Link>
            )}
          </nav>
        </>
      )}
    </>
  );
}
