import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { Cabecalho } from "../../_components/ui";
import Nav from "../../_components/Nav";
import BotaoVerComo from "./BotaoVerComo";
import {
  podeAcessar,
  papelValido,
  setorValido,
  ROTULO_PAPEL,
  ROTULO_SETOR,
  type Area,
  type Papel,
  type Setor,
} from "@/lib/permissoes";

type SP = { papel?: string; setor?: string };

const FUNCOES: { papel: Papel; setores: Setor[]; descricao: string }[] = [
  { papel: "gerente", setores: ["vendas", "pecas", "oficina", "administracao"], descricao: "Supervisão do setor e das unidades autorizadas." },
  { papel: "vendedor", setores: ["vendas"], descricao: "Carteira própria e métricas pessoais de Vendas." },
  { papel: "consultor_tecnico", setores: ["oficina"], descricao: "Agenda e atendimentos próprios da Oficina." },
  { papel: "recepcao", setores: ["oficina"], descricao: "Fila coletiva e triagem da Oficina." },
  { papel: "pecas", setores: ["pecas"], descricao: "Cotações comerciais e carteira de Peças." },
  { papel: "financeiro", setores: ["administracao"], descricao: "Financeiro e custos autorizados." },
  { papel: "atendente", setores: ["oficina"], descricao: "Perfil legado equivalente à recepção." },
];

const TELAS: { href: string; rotulo: string; area: Area; descricao: string }[] = [
  { href: "/painel", rotulo: "Visão geral", area: "inicio", descricao: "Resumo do dia e indicadores permitidos para a função." },
  { href: "/painel/busca", rotulo: "Buscar cliente", area: "busca", descricao: "Busca de clientes conforme o escopo do cargo." },
  { href: "/painel/clientes", rotulo: "Clientes", area: "clientes", descricao: "Carteira e ficha compartilhada, com os limites do setor." },
  { href: "/painel/conversas", rotulo: "Atendimento WhatsApp", area: "atendimento", descricao: "Fila de triagem quando a função possui esse acesso." },
  { href: "/painel/vendas", rotulo: "Quadro de vendas", area: "vendas", descricao: "Funil de vendas e cartões autorizados." },
  { href: "/painel/metricas", rotulo: "Métricas de vendas", area: "metricas", descricao: "Métricas pessoais ou do setor, conforme o papel." },
  { href: "/painel/agendamentos", rotulo: "Agendamentos", area: "agenda", descricao: "Agenda e horários permitidos para a função." },
  { href: "/painel/oficina", rotulo: "Fila e triagem", area: "oficina", descricao: "Fila essencial da Oficina." },
  { href: "/painel/pecas", rotulo: "Cotações de Peças", area: "pecas", descricao: "Cotações comerciais do setor de Peças." },
  { href: "/painel/campanhas", rotulo: "Campanhas e eventos", area: "campanhas", descricao: "Campanhas do setor autorizado." },
  { href: "/painel/financeiro", rotulo: "Financeiro", area: "financeiro", descricao: "Custos e dados financeiros autorizados." },
  { href: "/painel/usuarios", rotulo: "Usuários", area: "configuracoes", descricao: "Administração da equipe e convites." },
];

/**
 * Prévia segura das telas de uma função. Não troca a sessão do administrador e
 * não executa páginas/actions como outra pessoa; serve para revisar o menu e o
 * recorte aprovado antes de liberar uma impersonação real somente leitura.
 */
export default async function VerComo({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await exigirAcesso("configuracoes");
  const sp = await searchParams;
  const alvo = papelValido(sp.papel) && setorValido(sp.setor) ? { papel: sp.papel, setor: sp.setor } : null;
  const telas = alvo ? TELAS.filter((t) => podeAcessar(alvo, t.area)) : [];

  return (
    <>
      <Cabecalho titulo="Ver telas por função" sub="Prévia administrativa do menu e das telas autorizadas">
        <Link className="btn" href="/painel/usuarios">Voltar para Usuários</Link>
      </Cabecalho>

      <div className="alerta aviso" role="status">
        Esta é uma prévia somente leitura. A sua sessão continua sendo a de {admin.nome}; nenhuma ação, envio ou alteração será executada como outra pessoa.
      </div>

      <section className="card secao">
        <h2>Funções disponíveis</h2>
        <p className="mudo">A quantidade indica as áreas que a política atual libera para cada combinação de função e setor.</p>
        <div className="grade g3">
          {FUNCOES.map((f) => (
            <article className="card" key={f.papel}>
              <h3>{ROTULO_PAPEL[f.papel]}</h3>
              <p className="mudo">{f.descricao}</p>
              {f.setores.map((setor) => <div key={setor} className="linha-form" style={{ justifyContent: "space-between" }}>
                <span>{ROTULO_SETOR[setor]}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <strong>{TELAS.filter((t) => podeAcessar({ papel: f.papel, setor }, t.area)).length} telas</strong>
                  <BotaoVerComo papel={f.papel} setor={setor} />
                </span>
              </div>)}
            </article>
          ))}
        </div>
      </section>

      {alvo && (
        <section className="card secao">
          <h2>{ROTULO_PAPEL[alvo.papel]} · {ROTULO_SETOR[alvo.setor]}</h2>
          <p className="mudo">O menu abaixo é o conjunto de áreas que a política do servidor libera para essa função.</p>
          <div className="card secao" style={{ background: "var(--fundo, #f7f7f7)" }}>
            <Nav papel={alvo.papel} setor={alvo.setor} fila={0} />
          </div>
          <h3 className="secao">Telas autorizadas</h3>
          <div className="grade g2">
            {telas.map((t) => <article className="card" key={t.href}>
              <h3>{t.rotulo}</h3>
              <p className="mudo">{t.descricao}</p>
              <code>{t.href}</code>
            </article>)}
          </div>
        </section>
      )}
    </>
  );
}
