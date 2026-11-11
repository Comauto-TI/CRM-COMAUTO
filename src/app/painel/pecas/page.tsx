import { randomUUID } from "node:crypto";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { listarCotacoes } from "@/modulos/pecas/cotacoes";
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

export default async function PecasPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const u = await exigirAcesso("pecas");
  const { msg } = await searchParams;
  const fila = await listarCotacoes(u.unidades);

  return (
    <>
      <Cabecalho titulo="Peças" sub="Cotações e pedidos da sua unidade" />
      {msg && Object.hasOwn(MENSAGENS, msg) && <p role="status">{MENSAGENS[msg]}</p>}
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
          <h2 className="secao">Cotações recentes</h2>
          {fila.cotacoes.length === 0 ? <Vazio>Nenhuma cotação registrada.</Vazio> : (
            <div className="card tabela-wrap">
              <table>
                <thead><tr><th>Cliente</th><th>Placa</th><th>Solicitação</th><th>Unidade</th><th>Origem</th><th>Etapa</th><th>Responsável</th><th>Ações</th></tr></thead>
                <tbody>
                  {fila.cotacoes.map((c) => (
                    <tr key={c.id}>
                      <td>{c.clientes?.nome ?? "Cliente cadastrado"}</td>
                      <td>{c.veiculos?.placa ?? "—"}</td>
                      <td>{c.descricao}</td>
                      <td>{c.unidade}</td>
                      <td>{ORIGENS[c.origem]}</td>
                      <td><Status valor={c.status} /></td>
                      <td>{c.responsavel?.nome ?? "—"}</td>
                      <td>
                        <div className="acoes">
                          <Link className="btn" href={`/painel/pecas/${c.id}`} prefetch={false}>Ver cotação</Link>
                          {c.status === "novo" && (
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
        </>
      )}
    </>
  );
}
