import type { ReactNode } from "react";
import { faixa } from "@/lib/score";

const COR_FAIXA = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-amber-100 text-amber-800",
  C: "bg-zinc-200 text-zinc-700",
};

export function Faixa({ pontuacao }: { pontuacao: number }) {
  const f = faixa(pontuacao);
  return (
    <span
      title={`Pontuação ${pontuacao}/100`}
      className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-xs font-semibold ${COR_FAIXA[f]}`}
    >
      {f}
    </span>
  );
}

export function Titulo({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold">{children}</h1>
      {sub && <p className="mt-1 text-sm text-zinc-500">{sub}</p>}
    </div>
  );
}

export function Cartao({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-zinc-200 bg-white ${className}`}>{children}</div>
  );
}

export function Indicador({ rotulo, valor, nota }: { rotulo: string; valor: ReactNode; nota?: string }) {
  return (
    <Cartao className="p-4">
      <p className="text-sm text-zinc-500">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{valor}</p>
      {nota && <p className="mt-1 text-xs text-zinc-500">{nota}</p>}
    </Cartao>
  );
}

export function Tabela({ cabecalho, children }: { cabecalho: string[]; children: ReactNode }) {
  return (
    <Cartao className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-zinc-500">
            {cabecalho.map((c) => (
              <th key={c} className="px-4 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">{children}</tbody>
      </table>
    </Cartao>
  );
}

export function Celula({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-2 ${className}`}>{children}</td>;
}
