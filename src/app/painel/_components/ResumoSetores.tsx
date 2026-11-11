import Link from "next/link";
import { db } from "@/lib/supabase/admin";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";

/**
 * Visão geral por setor (F6 — visão do admin): um cartão por setor que a pessoa acessa.
 * Admin vê todos; gerente vê o setor dele; vendedor/peças veem só o que é deles + o que está sem dono.
 * Só contagens (head: true), sempre nas unidades do usuário. Setor sem tabela no banco simplesmente não aparece.
 */

type Numero = { rotulo: string; valor: number; destaque?: boolean };
type CartaoSetor = { chave: string; titulo: string; href: string; numeros: Numero[] };

const ENCERRADAS_PECAS = "(entregue,perdido,cancelado)";

async function contar(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  const r = await q;
  return r.error ? null : r.count ?? 0;
}

async function setorVendas(u: Usuario, iniMes: string): Promise<CartaoSetor | null> {
  const soMeu = u.papel === "vendedor";
  const base = () => {
    const q = db().from("vendas_oportunidades").select("id", { count: "exact", head: true }).in("unidade", u.unidades);
    return soMeu ? q.eq("vendedor_id", u.id) : q;
  };
  const { data: ganho, error } = await db().from("vendas_etapas").select("id").eq("tipo", "ganho");
  if (error) return null; // Vendas ainda não instalado no banco
  const idsGanho = (ganho ?? []).map((e) => e.id as string);
  const [abertas, semDono, ganhasMes] = await Promise.all([
    contar(base().is("fechado_em", null)),
    contar(db().from("vendas_oportunidades").select("id", { count: "exact", head: true }).in("unidade", u.unidades).is("fechado_em", null).is("vendedor_id", null)),
    idsGanho.length ? contar(base().in("etapa_id", idsGanho).gte("fechado_em", iniMes)) : Promise.resolve(0),
  ]);
  if (abertas === null) return null;
  return {
    chave: "vendas", titulo: soMeu ? "Vendas · sua carteira" : "Vendas", href: "/painel/vendas",
    numeros: [
      { rotulo: soMeu ? "suas oportunidades abertas" : "oportunidades abertas", valor: abertas },
      { rotulo: "leads sem vendedor", valor: semDono ?? 0, destaque: (semDono ?? 0) > 0 },
      { rotulo: soMeu ? "suas vendas no mês" : "vendas no mês", valor: ganhasMes ?? 0 },
    ],
  };
}

async function setorPecas(u: Usuario, iniMes: string): Promise<CartaoSetor | null> {
  const soMeu = u.papel === "pecas";
  const base = () => db().from("pecas_cotacoes").select("id", { count: "exact", head: true }).in("unidade", u.unidades);
  const abertasQ = base().not("status", "in", ENCERRADAS_PECAS);
  const [abertas, semResp, vendasMes] = await Promise.all([
    contar(soMeu ? abertasQ.eq("responsavel_id", u.id) : abertasQ),
    contar(base().not("status", "in", ENCERRADAS_PECAS).is("responsavel_id", null)),
    contar((soMeu ? base().eq("responsavel_id", u.id) : base()).gte("venda_confirmada_em", iniMes)),
  ]);
  if (abertas === null) return null; // Peças ainda não instalado no banco
  return {
    chave: "pecas", titulo: soMeu ? "Peças · suas cotações" : "Peças", href: "/painel/pecas",
    numeros: [
      { rotulo: soMeu ? "suas cotações abertas" : "cotações abertas", valor: abertas },
      { rotulo: "sem responsável", valor: semResp ?? 0, destaque: (semResp ?? 0) > 0 },
      { rotulo: soMeu ? "suas vendas no mês" : "vendas confirmadas no mês", valor: vendasMes ?? 0 },
    ],
  };
}

async function setorOficina(u: Usuario, iniHoje: string, fimHoje: string): Promise<CartaoSetor | null> {
  const base = () => db().from("agendamentos").select("id", { count: "exact", head: true }).in("unidade", u.unidades);
  const [hoje, pendentesHoje, futuros] = await Promise.all([
    contar(base().gte("inicio", iniHoje).lt("inicio", fimHoje).in("status", ["pendente", "confirmado"])),
    contar(base().gte("inicio", iniHoje).lt("inicio", fimHoje).eq("status", "pendente")),
    contar(base().gte("inicio", fimHoje).in("status", ["pendente", "confirmado"])),
  ]);
  if (hoje === null) return null;
  return {
    chave: "oficina", titulo: "Oficina", href: "/painel/agendamentos",
    numeros: [
      { rotulo: "agendamentos hoje", valor: hoje },
      { rotulo: "pendentes de confirmar hoje", valor: pendentesHoje ?? 0, destaque: (pendentesHoje ?? 0) > 0 },
      { rotulo: "próximos agendados", valor: futuros ?? 0 },
    ],
  };
}

/** Cartões dos setores que a pessoa acessa (só consulta o que o perfil pode ver). */
export async function cartoesDosSetores(u: Usuario, iniHoje: string, fimHoje: string, iniMes: string): Promise<CartaoSetor[]> {
  return (await Promise.all([
    podeAcessar(u, "vendas") ? setorVendas(u, iniMes).catch(() => null) : null,
    podeAcessar(u, "pecas") ? setorPecas(u, iniMes).catch(() => null) : null,
    podeAcessar(u, "agenda") ? setorOficina(u, iniHoje, fimHoje).catch(() => null) : null,
  ])).filter((c): c is CartaoSetor => !!c);
}

export default async function ResumoSetores({ u, iniHoje, fimHoje, iniMes }: { u: Usuario; iniHoje: string; fimHoje: string; iniMes: string }) {
  const cartoes = await cartoesDosSetores(u, iniHoje, fimHoje, iniMes);
  if (!cartoes.length) return null;

  return (
    <section className="secao">
      <h2 className="setores-titulo">{cartoes.length > 1 ? "Seus setores" : "Seu setor"}</h2>
      <div className={`grade ${cartoes.length >= 3 ? "g3" : cartoes.length === 2 ? "g2" : ""}`}>
        {cartoes.map((c) => (
          <Link key={c.chave} href={c.href} className="card setor-cartao">
            <div className="setor-cabeca"><strong>{c.titulo}</strong><span className="mudo">abrir →</span></div>
            <ul className="setor-numeros">
              {c.numeros.map((n) => (
                <li key={n.rotulo}><strong className={n.destaque ? "texto-aviso" : ""}>{n.valor}</strong><span className="mudo">{n.rotulo}</span></li>
              ))}
            </ul>
          </Link>
        ))}
      </div>
    </section>
  );
}
