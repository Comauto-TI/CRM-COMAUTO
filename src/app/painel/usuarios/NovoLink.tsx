"use client";

import { useActionState, useState } from "react";
import { criarConviteAction, type ResultadoConvite } from "./actions";

const TIPOS = { vendas: "Vendedor (Vendas)", pecas: "Peças", agendamento: "Agendamento / Recepção (Oficina)" } as const;

/** Gera o link de cadastro. O link aparece UMA vez (o banco guarda só a impressão digital dele). */
export default function NovoLink({ unidades }: { unidades: { chave: string; nome: string }[] }) {
  const [r, acao, enviando] = useActionState(criarConviteAction, null as ResultadoConvite);
  const [copiado, setCopiado] = useState(false);
  return (
    <>
      <form action={acao} className="linha-form" onSubmit={() => setCopiado(false)}>
        <label>Cadastro de <select name="tipo" defaultValue="vendas">{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Unidade <select name="unidade">{unidades.map((x) => <option key={x.chave} value={x.chave}>{x.nome}</option>)}</select></label>
        <label>Vale por <select name="dias" defaultValue="7"><option value="1">1 dia</option><option value="3">3 dias</option><option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option></select></label>
        <label>Pessoas <select name="usos" defaultValue="1"><option value="1">1 pessoa</option><option value="5">até 5</option><option value="10">até 10</option><option value="20">até 20</option></select></label>
        <button className="btn primario" disabled={enviando}>{enviando ? "Gerando…" : "Gerar link"}</button>
      </form>
      {r && !r.ok && <div className="alerta erro">{r.motivo}</div>}
      {r?.ok && (
        <div className="alerta ok">
          <strong>Link pronto.</strong> Copie agora e mande para a pessoa (ele não aparece de novo):
          <div className="linha-form" style={{ marginTop: 8 }}>
            <input readOnly value={r.link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de cadastro" />
            <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(r.link).then(() => setCopiado(true)); }}>{copiado ? "Copiado ✓" : "Copiar"}</button>
          </div>
        </div>
      )}
    </>
  );
}
