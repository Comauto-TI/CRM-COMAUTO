/* eslint-disable @next/next/no-img-element */
/** Logo + nome do sistema (ShiftUP). Logo padrão em /marca/logo.svg — trocar pelo logo oficial do ShiftUP quando chegar. */
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
