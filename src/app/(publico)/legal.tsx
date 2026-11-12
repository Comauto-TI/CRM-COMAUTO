/* eslint-disable @next/next/no-img-element */
import Link from "next/link";

/** Moldura simples das páginas públicas (privacidade e termos). Sem login. */
export default function Legal({ titulo, atualizado, children }: { titulo: string; atualizado: string; children: React.ReactNode }) {
  return (
    <main className="legal">
      <header className="legal-topo">
        <img src="/branding/wagconnect/logo.webp" alt="WAGconnect CRM" width={168} height={47} />
      </header>
      <article className="legal-corpo">
        <h1>{titulo}</h1>
        <p className="mudo">Última atualização: {atualizado}</p>
        {children}
        <p className="legal-links"><Link href="/privacidade">Política de Privacidade</Link> · <Link href="/termos">Termos de Uso</Link></p>
      </article>
    </main>
  );
}
