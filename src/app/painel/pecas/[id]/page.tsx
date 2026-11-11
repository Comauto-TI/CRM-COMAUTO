import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { formatarBRL } from "@/lib/time";
import { obterCotacao } from "@/modulos/pecas/cotacoes";
import { centavosParaCampo, uuidV4Valido } from "@/modulos/pecas/dados-cotacao";
import { Cabecalho, Status, Vazio } from "../../_components/ui";
import { adicionarItemCotacao, editarItemCotacao } from "../actions";

const MENSAGENS: Record<string, string> = {
  adicionado: "Item incluído na cotação.",
  atualizado: "Item atualizado.",
  desatualizado: "O item foi alterado em outra edição. Confira os dados atuais antes de salvar novamente.",
  erro_edicao: "Não foi possível salvar o item. Tente novamente.",
  invalido: "Confira a descrição, a quantidade e os valores.",
  indisponivel: "Este item está indisponível. Atualize a cotação e tente novamente.",
  limite: "A cotação já tem 100 itens.",
  pendente: "Os itens de Peças ainda precisam ser habilitados neste ambiente.",
  erro_item: "Não foi possível incluir o item. Tente novamente.",
};

export default async function DetalheCotacaoPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string | string[]; item?: string | string[] }>;
}) {
  const u = await exigirAcesso("pecas");
  const [{ id }, { msg, item: idItem }] = await Promise.all([params, searchParams]);
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
  const podeEditarItens = cotacao.status === "em_cotacao" && cotacao.responsavel_id === u.id;
  const itemEmEdicao = podeEditarItens && typeof idItem === "string"
    ? cotacao.itens.find((item) => item.id === idItem)
    : undefined;
  const acaoItem = itemEmEdicao ? editarItemCotacao : adicionarItemCotacao;
  const linkCotacao = `/painel/pecas/${cotacao.id}`;
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
      {podeEditarItens && (
        <section id="item-cotacao" className="card secao">
          <h2>{itemEmEdicao ? "Editar item" : "Incluir item"}</h2>
          <form
            key={itemEmEdicao ? `${itemEmEdicao.id}:${itemEmEdicao.versao}` : "novo"}
            action={acaoItem.bind(null, cotacao.id)}
            className="linha-form"
          >
            <input type="hidden" name="item" value={itemEmEdicao?.id ?? randomUUID()} />
            {itemEmEdicao && <input type="hidden" name="versao" value={itemEmEdicao.versao} />}
            <label>Descrição <input name="descricao" defaultValue={itemEmEdicao?.descricao} required maxLength={200} /></label>
            <label>
              Quantidade
              <input name="quantidade" type="number" defaultValue={itemEmEdicao?.quantidade} min={1} max={9999} step={1} required />
            </label>
            <label>
              Preço unitário (R$)
              <input
                name="preco" inputMode="decimal" placeholder="149,90" maxLength={9} required
                defaultValue={centavosParaCampo(itemEmEdicao?.preco_unitario_centavos ?? null)}
              />
            </label>
            <label>
              Custo unitário opcional (R$)
              <input name="custo" inputMode="decimal" maxLength={9} defaultValue={centavosParaCampo(itemEmEdicao?.custo_unitario_centavos ?? null)} />
            </label>
            <div className="acoes">
              <button className="btn primario" type="submit">{itemEmEdicao ? "Salvar item" : "Incluir item"}</button>
              {itemEmEdicao && <Link className="btn" href={`${linkCotacao}#item-cotacao`}>Cancelar edição</Link>}
            </div>
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
                {podeEditarItens && <th scope="col">Ação</th>}
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
                  {podeEditarItens && (
                    <td><Link className="btn pequeno" href={`${linkCotacao}?item=${item.id}#item-cotacao`} prefetch={false}>Editar</Link></td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>Total cotado</th>
                <td>{formatarBRL(totalCentavos / 100)}</td>
                {podeEditarItens && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
