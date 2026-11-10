"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icone from "./Icone";

const ITENS = [
  { href: "/painel", rotulo: "Visão geral", icone: "inicio", papeis: ["admin", "atendente", "financeiro"] },
  { href: "/painel/conversas", rotulo: "Atendimento", icone: "atendimento", papeis: ["admin", "atendente"], badge: true },
  { href: "/painel/agendamentos", rotulo: "Agendamentos", icone: "agenda", papeis: ["admin", "atendente"] },
  { href: "/painel/clientes", rotulo: "Clientes", icone: "clientes", papeis: ["admin", "atendente"] },
  { href: "/painel/links", rotulo: "Links e QR Code", icone: "qr", papeis: ["admin", "atendente"] },
  { href: "/painel/campanhas", rotulo: "Eventos e campanhas", icone: "campanhas", papeis: ["admin"] },
  { href: "/painel/followups", rotulo: "Follow-ups", icone: "followups", papeis: ["admin", "atendente"] },
  { href: "/painel/financeiro", rotulo: "Financeiro", icone: "financeiro", papeis: ["admin", "financeiro"] },
  { href: "/painel/seguranca", rotulo: "Segurança", icone: "seguranca", papeis: ["admin"] },
  { href: "/painel/configuracoes", rotulo: "Configurações", icone: "config", papeis: ["admin"] },
];

export default function Nav({ papel, fila }: { papel: string; fila: number }) {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {ITENS.filter((i) => i.papeis.includes(papel)).map((i) => {
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
