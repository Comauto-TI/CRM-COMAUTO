/* eslint-disable @next/next/no-img-element */
/**
 * Marca do sistema: logo WAGconnect CRM (fundo transparente, letras verde-limão e brancas).
 * Em fundo escuro (menu lateral) vai direto; em fundo claro (login) "grande" coloca a logo num selo marinho.
 * `nome` fica só como texto alternativo; `sub` mostra a empresa (Comauto).
 */
export default function Marca({ nome = "WAGconnect CRM", sub, grande = false }: { nome?: string; logoUrl?: string | null; sub?: string; grande?: boolean }) {
  return (
    <div className={`marca-sistema${grande ? " marca-selo" : ""}`}>
      <img src="/branding/wagconnect/logo.webp" alt={nome} className="marca-wordmark" width={grande ? 240 : 168} height={grande ? 67 : 47} />
      {sub && <span className="marca-empresa">{sub}</span>}
    </div>
  );
}
