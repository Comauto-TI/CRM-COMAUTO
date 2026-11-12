import type { Metadata } from "next";
import { getConfig } from "@/lib/config";
import Legal from "../legal";

export const metadata: Metadata = { title: "Termos de Uso · WAGconnect CRM" };
export const dynamic = "force-dynamic";

export default async function Termos() {
  const { empresa } = await getConfig();
  return (
    <Legal titulo="Termos de Uso" atualizado="12/11/2026">
      <p>
        Estes termos valem para o atendimento da <strong>{empresa.nome}</strong> pelo WhatsApp oficial e para o uso do sistema
        WAGconnect CRM pela nossa equipe. Ao conversar conosco pelo WhatsApp, você concorda com eles e com a nossa{" "}
        <a href="/privacidade">Política de Privacidade</a>.
      </p>

      <h2>1. Atendimento pelo WhatsApp</h2>
      <ul>
        <li>O atendimento pode começar com um assistente virtual, que sempre pode transferir para um atendente humano;</li>
        <li>Agendamentos só valem depois de confirmados pelo sistema; horários dependem da disponibilidade da oficina;</li>
        <li>Preços, condições e prazos só valem quando informados por um atendente ou por proposta formal;</li>
        <li>Mensagens de eventos e ofertas só são enviadas a quem autorizou; responda <strong>SAIR</strong> para não receber mais.</li>
      </ul>

      <h2>2. Uso correto</h2>
      <p>Não é permitido usar o canal para conteúdo ilegal, ofensivo, tentativa de fraude ou para obter informações internas da empresa.</p>

      <h2>3. Sistema interno (equipe)</h2>
      <ul>
        <li>O acesso é pessoal e intransferível; cada pessoa vê somente o que a sua função permite;</li>
        <li>Os dados de clientes são usados apenas para o atendimento e seguem a LGPD;</li>
        <li>As ações no sistema ficam registradas.</li>
      </ul>

      <h2>4. Responsabilidade</h2>
      <p>Fazemos o possível para manter o atendimento disponível, mas ele pode ter interrupções por manutenção ou por falhas de terceiros (internet, WhatsApp).</p>

      <h2>5. Alterações</h2>
      <p>Estes termos podem ser atualizados; a data no topo mostra a versão em vigor.</p>

      <h2>6. Contato</h2>
      <p>{empresa.nome}{empresa.endereco ? <> — {empresa.endereco}</> : null}{empresa.telefone_humano ? <> · {empresa.telefone_humano}</> : null}</p>
    </Legal>
  );
}
