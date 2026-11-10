import { Suspense } from "react";
import { exigirPapel } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import Inbox from "../_components/Inbox";

/** Atendimento estilo WhatsApp Web: abas Em espera / Em atendimento / Finalizados / Assistente. */
export default async function Atendimento() {
  await exigirPapel(["atendente"]);
  const cfg = await getConfig();
  return (
    <div className="pagina-cheia">
      <Suspense fallback={null}>
        <Inbox slaMin={cfg.atendimento.sla_min} />
      </Suspense>
    </div>
  );
}
