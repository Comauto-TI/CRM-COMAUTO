"use client";

import { useActionState } from "react";
import Copiar from "../_components/Copiar";
import { criarMembroAction, redefinirSenhaAction } from "./actions";
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

export function RedefinirSenha({ userId }: { userId: string }) {
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
