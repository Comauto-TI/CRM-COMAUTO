"use client";

import { useFormStatus } from "react-dom";

export default function BotaoOficina({ texto, aguardando }: { texto: string; aguardando: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn primario" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? aguardando : texto}
    </button>
  );
}
