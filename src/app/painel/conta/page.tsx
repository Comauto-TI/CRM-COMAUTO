import { exigirAcesso } from "@/lib/auth";
import { contaDaPlataforma, SENHA_MINIMA } from "@/lib/conta";
import { ROTULO_PAPEL, ROTULO_SETOR } from "@/lib/permissoes";
import { Cabecalho } from "../_components/ui";
import { trocarSenhaAction } from "./actions";

export default async function MinhaConta({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirAcesso();
  const sp = await searchParams;
  const podeTrocar = await contaDaPlataforma(u.id);
  return (
    <>
      <Cabecalho titulo="Minha conta" sub={`${u.nome} · ${u.email} · ${ROTULO_PAPEL[u.papel]} · ${ROTULO_SETOR[u.setor]}`} />
      {sp.ok && <div className="alerta ok">Senha trocada. Use a nova no próximo login.</div>}
      {sp.erro && <div className="alerta erro">{sp.erro.slice(0, 200)}</div>}
      <section className="card" style={{ maxWidth: 460 }}>
        <h2>Trocar senha</h2>
        {!podeTrocar ? (
          <p className="mudo">Seu login é o mesmo de outro sistema do grupo. Para não mudar a senha de lá, troque a senha no sistema de origem.</p>
        ) : (
          <form action={trocarSenhaAction} className="form-coluna">
            <label>Senha atual <input name="atual" type="password" autoComplete="current-password" required /></label>
            <label>Nova senha <input name="nova" type="password" autoComplete="new-password" minLength={SENHA_MINIMA} maxLength={72} required /></label>
            <label>Repita a nova senha <input name="confirmar" type="password" autoComplete="new-password" minLength={SENHA_MINIMA} maxLength={72} required /></label>
            <small className="mudo">Pelo menos {SENHA_MINIMA} caracteres. A troca vale só para este sistema.</small>
            <button className="btn primario">Trocar senha</button>
          </form>
        )}
      </section>
    </>
  );
}
