import { randomUUID } from "node:crypto";
import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { listarAtendimentos } from "@/modulos/oficina/atendimentos";
import { hrefFilaOficina, lerFiltrosFila } from "@/modulos/oficina/filtros-fila";
import { Cabecalho, Vazio } from "../_components/ui";
import { criarAtendimento } from "./actions";
import QuadroOficina from "./QuadroOficina";
import BotaoOficina from "./BotaoOficina";

export const dynamic = "force-dynamic";

const MENSAGENS: Record<string, string> = {
  criado: "Solicitação registrada na fila de Oficina.",
  triagem: "Triagem iniciada.",
  indisponivel: "Esta solicitação já foi assumida ou não está disponível para triagem.",
  erro_triagem: "Não foi possível iniciar a triagem. Tente novamente.",
  invalido: "Confira o telefone, a placa e a descrição.",
  unidade: "Sua unidade principal não está habilitada para registrar solicitações.",
  cliente: "Cliente não encontrado. Confira o telefone na ficha do cliente.",
  veiculo: "Confira se a placa está vinculada ao cliente na ficha do veículo.",
  conflito: "A solicitação já foi enviada com outros dados. Atualize a página e tente novamente.",
  pendente: "A fila de Oficina está temporariamente indisponível. Tente novamente mais tarde.",
  erro: "Não foi possível registrar a solicitação. Tente novamente.",
};

type Parametros = { msg?: unknown; minhas?: unknown; antes?: unknown; antes_id?: unknown };

export default async function OficinaPage({ searchParams }: { searchParams: Promise<Parametros> }) {
  const u = await exigirAcesso("oficina");
  const sp = await searchParams;
  const filtros = lerFiltrosFila(sp);
  const topo = <Cabecalho titulo="Oficina" sub="Fila de solicitações e triagem">
    <Link href="/painel/agendamentos" className="btn">Abrir agenda</Link>
  </Cabecalho>;
  if (!filtros) return <>{topo}<Vazio>Confira os filtros da fila. <Link href="/painel/oficina">Voltar ao início</Link></Vazio></>;
  const [fila, cfg] = await Promise.all([listarAtendimentos(u, filtros), getConfig()]);
  if (!fila.ok) return <>{topo}<div role="alert"><Vazio>{fila.motivo}</Vazio></div></>;

  return (
    <>
      {topo}
      {typeof sp.msg === "string" && Object.hasOwn(MENSAGENS, sp.msg) && <p className="alerta" role="status">{MENSAGENS[sp.msg]}</p>}
      <div className="acoes" style={{ marginBottom: 12 }} aria-label="Visão da fila">
        <Link className={`btn${!filtros.minhas ? " primario" : ""}`} href="/painel/oficina" aria-current={!filtros.minhas ? "page" : undefined}>Fila geral</Link>
        <Link className={`btn${filtros.minhas ? " primario" : ""}`} href="/painel/oficina?minhas=1" aria-current={filtros.minhas ? "page" : undefined}>Minhas</Link>
        <Link className="btn" href="#nova-solicitacao">+ Nova solicitação</Link>
      </div>
      <p className="mudo">{fila.total.toLocaleString("pt-BR")} solicitações nesta visão · {fila.atendimentos.length} nesta página</p>
      <QuadroOficina atendimentos={fila.atendimentos} minhas={!!filtros.minhas} fuso={cfg.fuso_offset} />
      <nav className="acoes secao" aria-label="Páginas da fila">
        {filtros.antes && <Link className="btn" href={hrefFilaOficina({ minhas: filtros.minhas })}>Voltar ao início</Link>}
        {fila.proximo && <Link className="btn" href={hrefFilaOficina({ minhas: filtros.minhas, antes: fila.proximo })}>Ver próximas solicitações</Link>}
      </nav>
      <section className="card secao" id="nova-solicitacao">
        <h2>Nova solicitação</h2>
        <p className="mudo">Use o telefone de um cliente já cadastrado. Unidade: {u.unidade}.</p>
        <form action={criarAtendimento} className="form-coluna">
          <input type="hidden" name="solicitacao" value={randomUUID()} />
          {filtros.minhas && <input type="hidden" name="minhas" value="1" />}
          <div className="linha-form" style={{ flexWrap: "wrap" }}>
            <label style={{ flex: "1 1 200px" }}>Telefone do cliente <input name="telefone" type="tel" required maxLength={25} autoComplete="tel" /></label>
            <label style={{ flex: "1 1 200px" }}>Placa (opcional) <input name="placa" maxLength={10} /></label>
          </div>
          <label>Serviço ou problema <textarea name="descricao" required maxLength={1000} rows={3} /></label>
          <div><BotaoOficina texto="Registrar solicitação" aguardando="Registrando…" /></div>
        </form>
      </section>
    </>
  );
}
