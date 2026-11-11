"use client";

import ConversaAtendimento, { type ConfigConversa } from "../_components/ConversaAtendimento";
import { assumirAtendimentoVendas, devolverAtendimentoVendas, responderAtendimentoVendas } from "./atendimento-actions";

const config: ConfigConversa = { setor: "vendas", chave: "oportunidadeId", nome: "Vendas", registro: "Oportunidade",
  assumirSemResponsavel: false, assumir: assumirAtendimentoVendas, devolver: devolverAtendimentoVendas, responder: responderAtendimentoVendas };
export default function ConversaVendas({ oportunidadeId, ...props }: { oportunidadeId: string; onMudou?: () => void; onVoltar?: () => void }) {
  return <ConversaAtendimento registroId={oportunidadeId} config={config} {...props} />;
}
