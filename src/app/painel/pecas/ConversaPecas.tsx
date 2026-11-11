"use client";

import ConversaAtendimento, { type ConfigConversa } from "../_components/ConversaAtendimento";
import { assumirAtendimentoPecas, devolverAtendimentoPecas, responderAtendimentoPecas } from "./atendimento-actions";

const config: ConfigConversa = { setor: "pecas", chave: "cotacaoId", nome: "Peças", registro: "Cotação",
  assumirSemResponsavel: true, assumir: assumirAtendimentoPecas, devolver: devolverAtendimentoPecas, responder: responderAtendimentoPecas };
export default function ConversaPecas({ cotacaoId, ...props }: { cotacaoId: string; onMudou?: () => void; onVoltar?: () => void }) {
  return <ConversaAtendimento registroId={cotacaoId} config={config} {...props} />;
}
