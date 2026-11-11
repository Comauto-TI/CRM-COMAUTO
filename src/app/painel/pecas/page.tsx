import { randomUUID } from "node:crypto";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { obterQuadroPecas } from "@/modulos/pecas/quadro";
import { Cabecalho, Vazio } from "../_components/ui";
import { criarCotacao } from "./actions";
import QuadroPecas from "./QuadroPecas";

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
  searchParams: Promise<{ msg?: string | string[]; cotacao?: string | string[] }>;
}) {
  const u = await exigirAcesso("pecas");
  const { msg, cotacao } = await searchParams;
  const quadro = await obterQuadroPecas(u);
  const selecionado = typeof cotacao === "string" && cotacao.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cotacao) ? cotacao.toLowerCase() : undefined;

  return (
    <>
      <Cabecalho titulo="Peças" sub="Atendimento e cotações da sua unidade">
        {quadro.ok && <Link className="btn primario" href="#nova-cotacao">+ Nova cotação</Link>}
      </Cabecalho>
      {typeof msg === "string" && Object.hasOwn(MENSAGENS, msg) && <p role="status">{MENSAGENS[msg]}</p>}
      {!quadro.ok ? (
        <Vazio>{quadro.pendente ? MENSAGENS.pendente : "Não foi possível carregar o quadro de Peças."}</Vazio>
      ) : (
        <>
          <QuadroPecas cotacoes={quadro.cotacoes} selecionado={selecionado} />
          <section className="card secao" id="nova-cotacao">
            <h2>Nova cotação de balcão</h2>
            <form action={criarCotacao} className="linha-form">
              <input type="hidden" name="solicitacao" value={randomUUID()} />
              <label>Telefone do cliente <input name="telefone" type="tel" required maxLength={25} /></label>
              <label>Placa (opcional) <input name="placa" maxLength={10} /></label>
              <label>Peça ou solicitação <input name="descricao" required maxLength={1000} /></label>
              <button className="btn primario" type="submit">Registrar cotação</button>
            </form>
          </section>
        </>
      )}
    </>
  );
}
