"use client";

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { criarConviteAction, type ResultadoConvite } from "./actions";

const TIPOS = { vendas: "Vendedor (Vendas)", pecas: "Peças", agendamento: "Agendamento / Recepção (Oficina)", administrador: "Administrador (acesso global)" } as const;

/** Gera o link de cadastro. O link aparece UMA vez (o banco guarda só a impressão digital dele). */
export default function NovoLink({ unidades }: { unidades: { chave: string; nome: string }[] }) {
  const trava = useRef(false);
  const [r, acao, enviando] = useActionState(async (anterior: ResultadoConvite, form: FormData) => {
    try { return await criarConviteAction(anterior, form); }
    finally { trava.current = false; }
  }, null as ResultadoConvite);
  const [copiado, setCopiado] = useState(false);
  const [tipo, setTipo] = useState<keyof typeof TIPOS>("vendas");
  const [tipoEnviado, setTipoEnviado] = useState<keyof typeof TIPOS>("vendas");
  const administrativo = tipo === "administrador";
  function submeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (trava.current || enviando) return;
    const form = new FormData(evento.currentTarget);
    const escolhido = form.get("tipo");
    if (typeof escolhido !== "string" || !Object.hasOwn(TIPOS, escolhido)) return;
    setCopiado(false);
    setTipoEnviado(escolhido as keyof typeof TIPOS);
    trava.current = true;
    startTransition(() => acao(form));
  }
  return (
    <>
      <form onSubmit={submeter}>
        <fieldset className="linha-form" disabled={enviando} style={{ flexWrap: "wrap", border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label>Cadastro de <select name="tipo" value={tipo} onChange={e => setTipo(e.target.value as keyof typeof TIPOS)}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Unidade <select name="unidade">{unidades.map((x) => <option key={x.chave} value={x.chave}>{x.nome}</option>)}</select></label>
        {administrativo ? <>
          <label>Vale por <input name="dias" type="hidden" value="1" /><span>24 horas</span></label>
          <label>Pessoas <input name="usos" type="hidden" value="1" /><span>1 pessoa</span></label>
        </> : <>
          <label>Vale por <select name="dias" defaultValue="7"><option value="1">1 dia</option><option value="3">3 dias</option><option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option></select></label>
          <label>Pessoas <select name="usos" defaultValue="1"><option value="1">1 pessoa</option><option value="5">até 5</option><option value="10">até 10</option><option value="20">até 20</option></select></label>
        </>}
        <button className="btn primario" disabled={enviando}>{enviando ? "Gerando…" : "Gerar link"}</button>
        </fieldset>
      </form>
      {administrativo && <p className="alerta aviso">Administrador tem acesso global à plataforma, além da unidade selecionada. O link vale por 24 horas para uma única pessoa: repasse somente à pessoa pretendida.</p>}
      {r && !r.ok && <div className="alerta erro">{r.motivo}</div>}
      {r?.ok && !enviando && (
        <div className="alerta ok">
          <strong>Link pronto: {TIPOS[tipoEnviado]}.</strong> Copie agora e mande para a pessoa (ele não aparece de novo):
          <div className="linha-form" style={{ marginTop: 8 }}>
            <input readOnly value={r.link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de cadastro" />
            <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(r.link).then(() => setCopiado(true)); }}>{copiado ? "Copiado ✓" : "Copiar"}</button>
          </div>
        </div>
      )}
    </>
  );
}
