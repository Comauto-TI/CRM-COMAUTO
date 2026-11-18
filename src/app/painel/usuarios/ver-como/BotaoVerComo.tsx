"use client";

import { useActionState } from "react";
import { iniciarVerComoAction, type ResultadoVisualizacao } from "./actions";

export default function BotaoVerComo({ papel, setor }: { papel: string; setor: string }) {
  const [resultado, acao, enviando] = useActionState(iniciarVerComoAction, null as ResultadoVisualizacao);
  return <>
    <form action={acao}>
      <input type="hidden" name="papel" value={papel} />
      <input type="hidden" name="setor" value={setor} />
      <button className="btn pequeno" disabled={enviando}>{enviando ? "Abrindo…" : "Ver como"}</button>
    </form>
    {resultado && !resultado.ok && <small className="alerta erro" role="alert">{resultado.motivo}</small>}
  </>;
}
