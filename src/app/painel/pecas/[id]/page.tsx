import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { formatarBRL } from "@/lib/time";
import { obterCotacao } from "@/modulos/pecas/cotacoes";
import { centavosParaCampo, etapaCotacao, totalizarCotacao, uuidV4Valido } from "@/modulos/pecas/dados-cotacao";
import { Cabecalho, Status, Vazio } from "../../_components/ui";
import { adicionarItemCotacao, confirmarVenda, editarItemCotacao, registrarApresentacao, registrarAtendimento, registrarAprovacao } from "../actions";

const MENSAGENS: Record<string, string> = {
  adicionado: "Item incluído na cotação.",
  atualizado: "Item atualizado.",
  desatualizado: "O item foi alterado em outra edição. Confira os dados atuais antes de salvar novamente.",
  erro_edicao: "Não foi possível salvar o item. Tente novamente.",
  invalido: "Confira a descrição, a quantidade e os valores.",
  indisponivel: "A ação está indisponível para esta cotação. Atualize a página e tente novamente.",
  apresentada: "Apresentação registrada. Aguardando resposta do cliente.",
  aprovada: "Aprovação do cliente registrada.",
  erro_aprovacao: "Não foi possível registrar a aprovação. Tente novamente.",
  venda_confirmada: "Venda confirmada.",
  erro_venda: "Não foi possível confirmar a venda. Tente novamente.",
  preparo_registrado: "Preparo do pedido registrado.",
  entrega_registrada: "Entrega registrada.",
  erro_atendimento: "Não foi possível atualizar o pedido. Tente novamente.",
  sem_itens: "Inclua pelo menos um item para registrar a apresentação.",
  desatualizada: "Os itens da cotação mudaram. Confira o total atual antes de registrar a apresentação.",
  erro_apresentacao: "Não foi possível registrar a apresentação. Tente novamente.",
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
  const responsavel = cotacao.responsavel_id === u.id;
  const podeEditarItens = cotacao.status === "em_cotacao" && responsavel;
  const itemEmEdicao = podeEditarItens && typeof idItem === "string"
    ? cotacao.itens.find((item) => item.id === idItem)
    : undefined;
  const acaoItem = itemEmEdicao ? editarItemCotacao : adicionarItemCotacao;
  const linkCotacao = `/painel/pecas/${cotacao.id}`;
  const vendaConfirmada = cotacao.venda_confirmada_em !== null;
  const { totalCentavos, margemCentavos } = totalizarCotacao(cotacao.itens, vendaConfirmada);
  const versoesItens = Object.fromEntries(cotacao.itens.map((item) => [item.id, item.versao]));

  return (
    <>
      <Cabecalho titulo="Cotação de peças" sub={sub}>{voltar}</Cabecalho>
      {typeof msg === "string" && Object.hasOwn(MENSAGENS, msg) && <p role="status">{MENSAGENS[msg]}</p>}
      <section className="card">
        <h2>Solicitação</h2>
        <p>{cotacao.descricao}</p>
        <div className="acoes">
          <Status valor={etapaCotacao(cotacao.status, cotacao.tipo_preparo)} />
          {vendaConfirmada && <span>Venda confirmada</span>}
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
                <th scope="row" colSpan={4}>{vendaConfirmada ? "Total da venda" : "Total cotado"}</th>
                <td>{formatarBRL(totalCentavos / 100)}</td>
                {podeEditarItens && <td />}
              </tr>
              {margemCentavos !== null && (
                <tr>
                  <th scope="row" colSpan={4}>Margem bruta</th>
                  <td>{formatarBRL(margemCentavos / 100)}</td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
      {podeEditarItens && !itemEmEdicao && cotacao.itens.length > 0 && (
        <section className="card secao">
          <h2>Apresentação da cotação</h2>
          <p className="mudo">Registre após apresentar os itens e valores ao cliente. A cotação fica bloqueada para edição enquanto aguarda o retorno.</p>
          <form action={registrarApresentacao.bind(null, cotacao.id, versoesItens)}>
            <button className="btn primario" type="submit">Registrar apresentação</button>
          </form>
        </section>
      )}
      {cotacao.status === "aguardando_cliente" && responsavel && (
        <section className="card secao">
          <h2>Aprovação da cotação</h2>
          <p className="mudo">Registre quando o cliente aprovar os itens e valores. A confirmação da venda é uma etapa separada.</p>
          <form action={registrarAprovacao.bind(null, cotacao.id)}>
            <button className="btn primario" type="submit">Registrar aprovação</button>
          </form>
        </section>
      )}
      {cotacao.status === "aprovado" && !vendaConfirmada && responsavel && cotacao.itens.length > 0 && (
        <section className="card secao">
          <h2>Confirmação da venda</h2>
          <p className="mudo">Registre após confirmar a venda no sistema atual.</p>
          <form action={confirmarVenda.bind(null, cotacao.id)}>
            <button className="btn primario" type="submit">Confirmar venda</button>
          </form>
        </section>
      )}
      {cotacao.status === "aprovado" && vendaConfirmada && responsavel && (
        <section className="card secao">
          <h2>Preparo do pedido</h2>
          <form action={registrarAtendimento.bind(null, cotacao.id)} className="linha-form">
            <label>
              Tipo de preparo
              <select name="acao" defaultValue="" required>
                <option value="" disabled>Selecione</option>
                <option value="separacao">Separação</option>
                <option value="encomenda">Encomenda</option>
              </select>
            </label>
            <button className="btn primario" type="submit">Registrar preparo</button>
          </form>
        </section>
      )}
      {cotacao.status === "em_separacao" && cotacao.tipo_preparo && vendaConfirmada && responsavel && (
        <section className="card secao">
          <h2>Entrega do pedido</h2>
          <form action={registrarAtendimento.bind(null, cotacao.id)}>
            <input type="hidden" name="acao" value="entrega" />
            <button className="btn primario" type="submit">Registrar entrega</button>
          </form>
        </section>
      )}
    </>
  );
}
