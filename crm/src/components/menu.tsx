"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ItemMenu } from "@/lib/funcoes";

export function Menu({ itens }: { itens: ItemMenu[] }) {
  const atual = usePathname();
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4">
      {itens.map((item) => {
        const ativo = atual === item.href || atual.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${
              ativo ? "bg-white/15 font-medium text-white" : "text-white/75 hover:text-white"
            }`}
          >
            {item.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
