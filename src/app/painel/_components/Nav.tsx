"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icone from "./Icone";
import { podeAcessar, type Area, type Papel, type Setor } from "@/lib/permissoes";

const ITENS: { href: string; rotulo: string; icone: string; area: Area; badge?: boolean }[] = [
  { href: "/painel", rotulo: "Visão geral", icone: "inicio", area: "inicio" },
  { href: "/painel/busca", rotulo: "Buscar cliente", icone: "busca", area: "busca" },
  { href: "/painel/vendas", rotulo: "Vendas", icone: "vendas", area: "vendas" },
  { href: "/painel/conversas", rotulo: "Atendimento", icone: "atendimento", area: "atendimento", badge: true },
  { href: "/painel/agendamentos", rotulo: "Agendamentos", icone: "agenda", area: "agenda" },
  { href: "/painel/clientes", rotulo: "Clientes", icone: "clientes", area: "clientes" },
  { href: "/painel/links", rotulo: "Links e QR Code", icone: "qr", area: "links" },
  { href: "/painel/campanhas", rotulo: "Eventos e campanhas", icone: "campanhas", area: "campanhas" },
  { href: "/painel/followups", rotulo: "Follow-ups", icone: "followups", area: "followups" },
  { href: "/painel/financeiro", rotulo: "Financeiro", icone: "financeiro", area: "financeiro" },
  { href: "/painel/seguranca", rotulo: "Segurança", icone: "seguranca", area: "seguranca" },
  { href: "/painel/configuracoes", rotulo: "Configurações", icone: "config", area: "custos_config" },
];

export default function Nav({ papel, setor, fila }: { papel: Papel; setor: Setor; fila: number }) {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {ITENS.filter((i) => podeAcessar({ papel, setor }, i.area)).map((i) => {
        const ativo = i.href === "/painel" ? pathname === "/painel" : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={ativo ? "ativo" : ""} prefetch>
            <span className="nav-rotulo"><Icone nome={i.icone} />{i.rotulo}</span>
            {i.badge && fila > 0 && <span className="badge">{fila}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
