"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import Copiar from "../_components/Copiar";
import { criarMembroAction, definirPermissaoSenhasAction, redefinirSenhaAction } from "./actions";
import { PAPEIS, SETORES, ROTULO_PAPEL, ROTULO_SETOR } from "@/lib/permissoes";

type Resultado = { ok: true; mensagem: string; senhaProvisoria?: string } | { ok: false; motivo: string } | null;

function Retorno({ r }: { r: Resultado }) {
  if (!r) return null;
  if (!r.ok) return <div className="alerta erro" role="alert">{r.motivo}</div>;
  return (
    <div className="alerta ok" role="status">
      {r.mensagem}
      {r.senhaProvisoria && (
        <div className="senha-provisoria">
          <code>{r.senhaProvisoria}</code>
          <Copiar texto={r.senhaProvisoria} rotulo="Copiar senha" />
        </div>
      )}
    </div>
  );
}

/** Cadastro de pessoa da equipe. A senha provisória volta só aqui (nunca na URL) e some ao recarregar. */
export function NovoMembro({ unidades }: { unidades: { chave: string; nome: string }[] }) {
  const [r, acao, enviando] = useActionState(criarMembroAction, null as Resultado);
  return (
    <form action={acao} className="form grade-form novo-membro">
      <label>Nome<input name="nome" required maxLength={80} /></label>
      <label>E-mail (login)<input name="email" type="email" required maxLength={120} /></label>
      <label>Papel<select name="papel" defaultValue="vendedor">
        {PAPEIS.filter((p) => p !== "atendente").map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
      </select></label>
      <label>Setor<select name="setor" defaultValue="vendas">
        {SETORES.map((s) => <option key={s} value={s}>{ROTULO_SETOR[s]}</option>)}
      </select></label>
      <label>Unidade<select name="unidade" defaultValue={unidades[0]?.chave}>
        {unidades.map((u) => <option key={u.chave} value={u.chave}>{u.nome}</option>)}
      </select></label>
      <div className="acoes largo"><button className="btn primario" disabled={enviando}>{enviando ? "Cadastrando…" : "Cadastrar pessoa"}</button></div>
      <div className="largo"><Retorno r={r} /></div>
    </form>
  );
}

export function RedefinirSenha({ userId, permitido = false }: { userId: string; permitido?: boolean }) {
  return permitido ? <FormularioRedefinirSenha key={userId} userId={userId} /> : null;
}

function FormularioRedefinirSenha({ userId }: { userId: string }) {
  const [r, acao, enviando] = useActionState(redefinirSenhaAction, null as Resultado);
  return (
    <div className="redefinir">
      <form action={acao}>
        <input type="hidden" name="user_id" value={userId} />
        <button className="btn pequeno" disabled={enviando}>Nova senha</button>
      </form>
      <Retorno r={r} />
    </div>
  );
}

/** A capacidade vem da página no servidor; a action revalida principal, alvo e permissão atual. */
export function PermissaoSenhas({ userId, liberado, permitido = false }: { userId: string; liberado: boolean; permitido?: boolean }) {
  return permitido ? <FormularioPermissaoSenhas key={`${userId}:${liberado}`} userId={userId} liberado={liberado} /> : null;
}

function FormularioPermissaoSenhas({ userId, liberado }: { userId: string; liberado: boolean }) {
  const [marcado, setMarcado] = useState(liberado);
  const trava = useRef(false);
  const [r, acao, enviando] = useActionState(async (_anterior: Resultado, form: FormData) => {
    try { return await definirPermissaoSenhasAction(form); }
    finally { trava.current = false; }
  }, null as Resultado);
  return <div className="secao">
    <form onSubmit={evento => {
      evento.preventDefault();
      if (trava.current || enviando) return;
      const form = new FormData(evento.currentTarget);
      form.set("permitir", marcado ? "1" : "0");
      trava.current = true;
      startTransition(() => acao(form));
    }}>
      <fieldset className="linha-form" disabled={enviando} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, flexWrap: "wrap" }}>
        <input type="hidden" name="user_id" value={userId} />
        <label className="check"><input type="checkbox" name="permitir" value="1" checked={marcado} onChange={evento => setMarcado(evento.target.checked)} /> Pode redefinir senhas de outras pessoas</label>
        <button type="submit" className="btn pequeno">{enviando ? "Salvando…" : "Salvar permissão"}</button>
      </fieldset>
    </form>
    <Retorno r={r} />
  </div>;
}
