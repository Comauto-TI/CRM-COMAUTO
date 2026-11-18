"use client";

import { useActionState } from "react";
import type { EstadoAcao } from "@/app/actions/fila";

type Props = {
  acao: (estado: EstadoAcao, formData: FormData) => Promise<EstadoAcao>;
  campo: string;
  valor: number;
  rotulo: string;
  somenteLeitura: boolean;
};

// Botão de ação de uma linha. No "Ver como" fica desativado; o servidor também bloqueia.
export function BotaoAcao({ acao, campo, valor, rotulo, somenteLeitura }: Props) {
  const [estado, executar, enviando] = useActionState(acao, undefined);

  return (
    <form action={executar} className="flex flex-col items-end gap-1">
      <input type="hidden" name={campo} value={valor} />
      <button
        type="submit"
        disabled={enviando || somenteLeitura}
        title={somenteLeitura ? "Somente leitura no modo Ver como" : undefined}
        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {enviando ? "Salvando…" : rotulo}
      </button>
      {estado?.erro && <span className="text-xs text-red-600">{estado.erro}</span>}
    </form>
  );
}
