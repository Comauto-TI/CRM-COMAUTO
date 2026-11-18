import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { Cabecalho } from "../../_components/ui";
import Nav from "../../_components/Nav";
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

type Pessoa = { user_id: string; nome: string; papel: Papel; setor: Setor; unidade: string; ativo: boolean };
type SP = { usuario?: string };

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

function pessoaValida(row: unknown): row is Pessoa {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.user_id === "string" && typeof r.nome === "string" && papelValido(r.papel) && setorValido(r.setor) && typeof r.unidade === "string" && r.ativo === true;
}

/**
 * Prévia segura das telas de uma função. Não troca a sessão do administrador e
 * não executa páginas/actions como outra pessoa; serve para revisar o menu e o
 * recorte aprovado antes de liberar uma impersonação real somente leitura.
 */
export default async function VerComo({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await exigirAcesso("configuracoes");
  const sp = await searchParams;
  const { data } = await db().from("usuarios").select("user_id, nome, papel, setor, unidade, ativo").eq("ativo", true).neq("papel", "admin").order("nome");
  const pessoas = (data ?? []).filter(pessoaValida);
  const alvo = pessoas.find((p) => p.user_id === sp.usuario);
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
        <h2>Escolha uma função</h2>
        {!pessoas.length ? <p className="mudo">Não há usuários ativos não administradores para visualizar.</p> : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Pessoa</th><th>Função</th><th>Setor</th><th>Unidade</th><th /></tr></thead>
              <tbody>{pessoas.map((p) => (
                <tr key={p.user_id}>
                  <td>{p.nome}</td>
                  <td>{ROTULO_PAPEL[p.papel]}</td>
                  <td>{ROTULO_SETOR[p.setor]}</td>
                  <td>{p.unidade}</td>
                  <td><Link className="btn pequeno" href={`/painel/usuarios/ver-como?usuario=${encodeURIComponent(p.user_id)}`}>Ver telas</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {alvo && (
        <section className="card secao">
          <h2>{alvo.nome} · {ROTULO_PAPEL[alvo.papel]}</h2>
          <p className="mudo">{ROTULO_SETOR[alvo.setor]} · {alvo.unidade}. O menu abaixo é o mesmo conjunto de áreas que a política do servidor libera para esse perfil.</p>
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
