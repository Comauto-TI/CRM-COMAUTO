import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { formatarBRL } from "@/lib/time";
import { obterCotacao } from "@/modulos/pecas/cotacoes";
import { uuidV4Valido } from "@/modulos/pecas/dados-cotacao";
import { Cabecalho, Status, Vazio } from "../../_components/ui";
import { adicionarItemCotacao } from "../actions";

const MENSAGENS: Record<string, string> = {
  adicionado: "Item incluído na cotação.",
  invalido: "Confira a descrição, a quantidade e os valores.",
  indisponivel: "Não foi possível incluir o item nesta cotação. Atualize a página e tente novamente.",
  limite: "A cotação já tem 100 itens.",
  pendente: "Os itens de Peças ainda precisam ser habilitados neste ambiente.",
  erro_item: "Não foi possível incluir o item. Tente novamente.",
};

export default async function DetalheCotacaoPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string | string[] }>;
}) {
  const u = await exigirAcesso("pecas");
  const [{ id }, { msg }] = await Promise.all([params, searchParams]);
  if (!uuidV4Valido(id)) notFound();

  const consulta = await obterCotacao(u.unidades, id);
  const voltar = <Link className="btn" href="/painel/pecas">Voltar para Peças</Link>;
  if (!consulta.ok) {
    return (
      <>
        <Cabecalho titulo="Cotação de peças">{voltar}</Cabecalho>
        <Vazio>{consulta.pendente ? MENSAGENS.pendente : "Não foi possível carregar a cotação."}</Vazio>
      </>
    );
  }
  const { cotacao } = consulta;
  if (!cotacao) notFound();

  const sub = [cotacao.clientes?.nome ?? "Cliente cadastrado", cotacao.veiculos?.placa, cotacao.unidade]
    .filter(Boolean).join(" · ");
  const podeIncluir = cotacao.status === "em_cotacao" && cotacao.responsavel_id === u.id;
  const totalCentavos = cotacao.itens.reduce((total, item) => total + item.quantidade * item.preco_unitario_centavos, 0);

  return (
    <>
      <Cabecalho titulo="Cotação de peças" sub={sub}>{voltar}</Cabecalho>
      {typeof msg === "string" && Object.hasOwn(MENSAGENS, msg) && <p role="status">{MENSAGENS[msg]}</p>}
      <section className="card">
        <h2>Solicitação</h2>
        <p>{cotacao.descricao}</p>
        <div className="acoes">
          <Status valor={cotacao.status} />
          <span className="mudo">Responsável · {cotacao.responsavel?.nome ?? "A definir"}</span>
        </div>
      </section>
      {podeIncluir && (
        <section className="card secao">
          <h2>Incluir item</h2>
          <form action={adicionarItemCotacao.bind(null, cotacao.id)} className="linha-form">
            <input type="hidden" name="item" value={randomUUID()} />
            <label>Descrição <input name="descricao" required maxLength={200} /></label>
            <label>Quantidade <input name="quantidade" type="number" min={1} max={9999} step={1} required /></label>
            <label>Preço unitário (R$) <input name="preco" inputMode="decimal" placeholder="149,90" maxLength={9} required /></label>
            <label>Custo unitário opcional (R$) <input name="custo" inputMode="decimal" maxLength={9} /></label>
            <button className="btn primario" type="submit">Incluir item</button>
          </form>
        </section>
      )}
      <h2 className="secao">Itens cotados</h2>
      {cotacao.itens.length === 0 ? <Vazio>Nenhum item na cotação.</Vazio> : (
        <div className="card tabela-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Peça</th>
                <th scope="col">Quantidade</th>
                <th scope="col">Preço unitário</th>
                <th scope="col">Custo unitário</th>
                <th scope="col">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {cotacao.itens.map((item) => (
                <tr key={item.id}>
                  <td>{item.descricao}</td>
                  <td>{item.quantidade}</td>
                  <td>{formatarBRL(item.preco_unitario_centavos / 100)}</td>
                  <td>{item.custo_unitario_centavos === null ? "—" : formatarBRL(item.custo_unitario_centavos / 100)}</td>
                  <td>{formatarBRL(item.quantidade * item.preco_unitario_centavos / 100)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>Total cotado</th>
                <td>{formatarBRL(totalCentavos / 100)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
