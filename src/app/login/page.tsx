/* eslint-disable @next/next/no-img-element */
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authClient } from "@/lib/supabase/server";
import Marca from "../painel/_components/Marca";

async function entrar(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const supa = await authClient();
  const { error } = await supa.auth.signInWithPassword({ email, password: senha });
  if (error) redirect("/login?erro=1");
  // abertura WAGconnect só logo depois do login (o painel já chega com a logo por cima, sem "flash")
  (await cookies()).set("wag_abertura", "1", { path: "/painel", maxAge: 120, sameSite: "lax" });
  redirect("/painel");
}

/**
 * Login corporativo: foto final do Golf GTI na concessionária (repasse de design do Codex) à esquerda,
 * formulário à direita sobre fundo cinza; logo WAGconnect CRM transparente com sombra leve.
 */
export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="acesso">
      <section className="acesso-foto" aria-hidden="true">
        <div className="acesso-foto-texto">
          <img src="/branding/wagconnect/logo.webp" alt="WAGconnect CRM" className="acesso-logo" width={340} height={95} />
          <p>Vendas, Oficina e Peças com a mesma ficha do cliente.</p>
        </div>
      </section>
      <section className="acesso-painel">
        <form action={entrar} className="acesso-form">
          <Marca sub="Comauto" grande />
          <div className="acesso-titulo">
            <h1>Acesse sua conta</h1>
            <p>Use o e-mail e a senha cadastrados pela administração.</p>
          </div>
          {erro && <p className="alerta erro" role="alert">E-mail ou senha inválidos.</p>}
          <label>
            E-mail
            <input name="email" type="email" required autoComplete="username" placeholder="nome@comauto.com.br" />
          </label>
          <label>
            Senha
            <input name="senha" type="password" required autoComplete="current-password" />
          </label>
          <button className="btn primario acesso-botao" type="submit">Entrar</button>
          <p className="acesso-rodape">Acesso restrito à equipe autorizada. Todas as ações ficam registradas.</p>
        </form>
      </section>
    </main>
  );
}
