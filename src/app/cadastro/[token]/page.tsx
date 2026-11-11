import Link from "next/link";
import Marca from "../../painel/_components/Marca";
import { lerConvite, TIPOS_CONVITE } from "@/lib/convites";
import { SENHA_MINIMA } from "@/lib/conta";
import { cadastrarAction } from "./actions";

/** Página PÚBLICA do link de cadastro da equipe (fora do /painel). Sem o token certo, nada é revelado. */
export default async function Cadastro({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const conv = sp.ok ? null : await lerConvite(token);

  return (
    <main className="login">
      <div className="login-grade" style={{ gridTemplateColumns: "1fr" }}>
        <section className="card login-card" style={{ maxWidth: 440, margin: "0 auto" }}>
          <Marca nome="Comauto" sub="Plataforma" grande />
          {sp.ok ? (
            <>
              <h1>Cadastro feito!</h1>
              <p>Seu acesso está pronto. Entre com o e-mail e a senha que você acabou de criar.</p>
              <Link className="btn primario" href="/login">Ir para o login</Link>
            </>
          ) : !conv ? (
            <>
              <h1>Link indisponível</h1>
              <p className="mudo">Este link de cadastro expirou, foi cancelado ou já foi usado. Peça um novo ao administrador.</p>
            </>
          ) : (
            <form action={cadastrarAction} className="form-coluna">
              <input type="hidden" name="token" value={token} />
              <div>
                <h1>Criar seu acesso</h1>
                <p className="mudo" style={{ margin: 0 }}>Cadastro como <strong>{TIPOS_CONVITE[conv.tipo].rotulo}</strong> · unidade {conv.unidade}</p>
              </div>
              {sp.erro && <p className="alerta erro">{sp.erro.slice(0, 200)}</p>}
              <label>Seu nome <input name="nome" required maxLength={80} autoComplete="name" /></label>
              <label>E-mail <input name="email" type="email" required autoComplete="username" /></label>
              <label>Senha <input name="senha" type="password" required minLength={SENHA_MINIMA} maxLength={72} autoComplete="new-password" /></label>
              <label>Repita a senha <input name="confirmar" type="password" required minLength={SENHA_MINIMA} maxLength={72} autoComplete="new-password" /></label>
              <small className="mudo">Pelo menos {SENHA_MINIMA} caracteres.</small>
              <button className="btn primario" type="submit">Criar acesso</button>
              <p className="mudo">🔒 Acesso restrito à equipe da Comauto. Todas as ações ficam registradas.</p>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
