"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icone from "./Icone";
import { podeAcessar, type Area, type Papel, type Setor } from "@/lib/permissoes";

type Item = { href: string; rotulo: string; icone: string; area: Area; badge?: boolean; emBreve?: boolean };
type Grupo = { chave: string; rotulo: string; icone: string; itens: Item[] };

/**
 * Acesso rápido, comum a todos os setores: a ficha do cliente é ÚNICA (todos os setores enxergam a mesma).
 * O atendimento WhatsApp ainda é a central geral; vira "por setor" quando o A1 do Codex for ligado.
 */
const FIXOS: Item[] = [
  { href: "/painel", rotulo: "Visão geral", icone: "inicio", area: "inicio" },
  { href: "/painel/busca", rotulo: "Buscar cliente", icone: "busca", area: "busca" },
  { href: "/painel/clientes", rotulo: "Clientes", icone: "clientes", area: "clientes" },
  { href: "/painel/conversas", rotulo: "Atendimento WhatsApp", icone: "atendimento", area: "atendimento", badge: true },
  { href: "/painel/lembretes", rotulo: "Meus lembretes", icone: "relogio", area: "lembretes" },
];

/**
 * Menu SEPARADO POR SETOR (decisão do Simão, 11/11): cada setor com as próprias telas.
 * O filtro por papel (podeAcessar) faz cada pessoa ver só o(s) seu(s) setor(es); o admin vê todos.
 * O grupo do setor de quem entrou abre sozinho.
 */
const GRUPOS: Grupo[] = [
  {
    chave: "vendas", rotulo: "Vendas", icone: "vendas", itens: [
      { href: "/painel/vendas", rotulo: "Quadro de vendas", icone: "vendas", area: "vendas" },
      { href: "/painel/metricas", rotulo: "Métricas de vendas", icone: "metricas", area: "metricas" },
      { href: "/painel/clientes/importar", rotulo: "Importar clientes", icone: "clientes", area: "importacao" },
    ],
  },
  {
    chave: "oficina", rotulo: "Oficina", icone: "agenda", itens: [
      { href: "/painel/agendamentos", rotulo: "Agendamentos", icone: "agenda", area: "agenda" },
      { href: "/painel/oficina", rotulo: "Fila e triagem", icone: "agenda", area: "oficina" },
    ],
  },
  {
    chave: "pecas", rotulo: "Peças", icone: "pecas", itens: [
      { href: "/painel/pecas", rotulo: "Cotações", icone: "pecas", area: "pecas" },
    ],
  },
  {
    chave: "marketing", rotulo: "Marketing", icone: "campanhas", itens: [
      { href: "/painel/campanhas", rotulo: "Campanhas e eventos", icone: "campanhas", area: "campanhas" },
      { href: "/painel/links", rotulo: "QR Codes e links", icone: "qr", area: "links" },
      { href: "/painel/followups", rotulo: "Retornos automáticos", icone: "followups", area: "followups" },
    ],
  },
  {
    chave: "administracao", rotulo: "Administração", icone: "financeiro", itens: [
      { href: "/painel/usuarios", rotulo: "Usuários", icone: "clientes", area: "configuracoes" },
      { href: "/painel/financeiro", rotulo: "Financeiro", icone: "financeiro", area: "financeiro" },
      { href: "/painel/seguranca", rotulo: "Segurança", icone: "seguranca", area: "seguranca" },
      { href: "/painel/piloto", rotulo: "Prontidão do piloto", icone: "seguranca", area: "configuracoes" },
      { href: "/painel/configuracoes", rotulo: "Configurações", icone: "config", area: "custos_config" },
    ],
  },
];

const CHAVE_LOCAL = "comauto.menu.abertos";
const ativoEm = (href: string, pathname: string) => (href === "/painel" ? pathname === "/painel" : pathname.startsWith(href));

export default function Nav({ papel, setor, fila }: { papel: Papel; setor: Setor; fila: number }) {
  const pathname = usePathname();
  const pode = (i: Item) => podeAcessar({ papel, setor }, i.area);
  const grupos = GRUPOS.map((g) => ({ ...g, itens: g.itens.filter(pode) })).filter((g) => g.itens.length);
  const grupoAtual = grupos.find((g) => g.itens.some((i) => !i.emBreve && ativoEm(i.href, pathname)))?.chave;

  // grupos abertos: lembra a escolha da pessoa neste computador; o grupo da página atual e o do
  // SETOR de quem entrou abrem sozinhos
  const padrao = [setor];
  const [abertos, setAbertos] = useState<string[] | null>(null);
  useEffect(() => {
    let salvos: string[] = [];
    try { salvos = JSON.parse(localStorage.getItem(CHAVE_LOCAL) ?? "[]"); } catch { /* sem armazenamento: usa o padrão */ }
    // chaves antigas do menu por função ("relacionamento", "gestao") não valem mais
    const validos = Array.isArray(salvos) ? salvos.filter((c) => GRUPOS.some((g) => g.chave === c)) : [];
    setAbertos(validos.length ? validos : padrao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const estaAberto = (chave: string) => chave === grupoAtual || (abertos ?? padrao).includes(chave);
  function alternar(chave: string) {
    const atual = abertos ?? padrao;
    const novo = atual.includes(chave) ? atual.filter((c) => c !== chave) : [...atual, chave];
    setAbertos(novo);
    try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(novo)); } catch { /* ignora */ }
  }

  const link = (i: Item, sub = false) => {
    if (i.emBreve) {
      return (
        <span key={i.href} className={`nav-item em-breve${sub ? " sub" : ""}`} title="Em construção">
          <span className="nav-rotulo"><Icone nome={i.icone} />{i.rotulo}</span>
          <span className="nav-breve">em breve</span>
        </span>
      );
    }
    const ativo = ativoEm(i.href, pathname);
    const rotulo = i.href === "/painel/metricas" && papel === "vendedor" ? "Minhas métricas" : i.rotulo;
    return (
      <Link key={i.href} href={i.href} className={`${ativo ? "ativo" : ""}${sub ? " sub" : ""}`} prefetch aria-current={ativo ? "page" : undefined}>
        <span className="nav-rotulo"><Icone nome={i.icone} />{rotulo}</span>
        {i.badge && fila > 0 && <span className="badge">{fila}</span>}
      </Link>
    );
  };

  return (
    <nav className="nav" aria-label="Menu principal">
      {FIXOS.filter(pode).map((i) => link(i))}
      {grupos.map((g) => {
        const aberto = estaAberto(g.chave);
        const filaNoGrupo = g.itens.some((i) => i.badge) && fila > 0;
        return (
          <div key={g.chave} className={`nav-grupo${aberto ? " aberto" : ""}`}>
            <button type="button" className="nav-grupo-titulo" aria-expanded={aberto} onClick={() => alternar(g.chave)}>
              <span>{g.rotulo}</span>
              {!aberto && filaNoGrupo && <span className="badge">{fila}</span>}
              <svg className="nav-seta" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
            {aberto && <div className="nav-grupo-itens">{g.itens.map((i) => link(i, true))}</div>}
          </div>
        );
      })}
    </nav>
  );
}
