"use client";

import { useState } from "react";

export default function Copiar({ texto, rotulo = "Copiar link" }: { texto: string; rotulo?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn pequeno"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          window.prompt("Copie o link:", texto);
        }
      }}
    >
      {ok ? "Copiado ✓" : rotulo}
    </button>
  );
}
