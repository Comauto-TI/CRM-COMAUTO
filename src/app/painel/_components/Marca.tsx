/* eslint-disable @next/next/no-img-element */
/** Logo + nome. Usa o logo oficial da empresa se configurado (Configurações → logo), senão o monograma Comauto. */
export default function Marca({ nome, logoUrl, sub = "Assistente WhatsApp", grande = false }: { nome: string; logoUrl?: string | null; sub?: string; grande?: boolean }) {
  const t = grande ? 44 : 34;
  return (
    <div className={`marca ${grande ? "marca-grande" : ""}`}>
      <img src={logoUrl || "/marca/logo.svg"} alt={nome} width={t} height={t} className="marca-logo" />
      <div className="marca-texto">
        <strong>{nome}</strong>
        <span>{sub}</span>
      </div>
      <span className="marca-ponto" title="WhatsApp conectado" />
    </div>
  );
}
