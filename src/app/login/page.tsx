import { redirect } from "next/navigation";
import { authClient } from "@/lib/supabase/server";
import Marca from "../painel/_components/Marca";
import { IlustracaoLogin } from "../painel/_components/Ilustracoes";

async function entrar(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const supa = await authClient();
  const { error } = await supa.auth.signInWithPassword({ email, password: senha });
  if (error) redirect("/login?erro=1");
  redirect("/painel");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="login">
      <div className="login-grade">
        <section className="login-arte" aria-hidden="true">
          <IlustracaoLogin />
          <h2>Agendamentos, atendimento e campanhas num só lugar.</h2>
          <ul>
            <li>Assistente no WhatsApp 24h, com regras de segurança</li>
            <li>Recepção avisada na hora quando o cliente pede atendente</li>
            <li>Custos de cada mensagem e de cada agendamento</li>
          </ul>
        </section>
        <form action={entrar} className="card login-card">
          <Marca nome="Comauto" sub="Painel do assistente" grande />
          <div>
            <h1>Entrar</h1>
            <p className="mudo" style={{ margin: 0 }}>Use o e-mail cadastrado pela administração.</p>
          </div>
          {erro && <p className="alerta erro">E-mail ou senha inválidos.</p>}
          <label>
            E-mail
            <input name="email" type="email" required autoComplete="username" />
          </label>
          <label>
            Senha
            <input name="senha" type="password" required autoComplete="current-password" />
          </label>
          <button className="btn primario" type="submit">Entrar no painel</button>
          <p className="mudo">🔒 Acesso restrito à equipe autorizada. Todas as ações ficam registradas.</p>
        </form>
      </div>
    </main>
  );
}
