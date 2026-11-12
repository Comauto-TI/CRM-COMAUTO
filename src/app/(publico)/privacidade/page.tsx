import type { Metadata } from "next";
import { getConfig } from "@/lib/config";
import Legal from "../legal";

export const metadata: Metadata = { title: "Política de Privacidade · WAGconnect CRM" };
export const dynamic = "force-dynamic";

export default async function Privacidade() {
  const { empresa } = await getConfig();
  return (
    <Legal titulo="Política de Privacidade" atualizado="12/11/2026">
      <p>
        Esta política explica como a <strong>{empresa.nome}</strong> trata os dados pessoais de clientes atendidos pelo nosso
        WhatsApp oficial e pelo sistema de atendimento WAGconnect CRM, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD).
      </p>

      <h2>1. Quais dados coletamos</h2>
      <ul>
        <li>Nome, telefone (WhatsApp) e, quando você informar, e-mail, CPF/CNPJ e data de nascimento;</li>
        <li>Dados do veículo (modelo, placa, quilometragem) e histórico de agendamentos, orçamentos e serviços;</li>
        <li>Mensagens trocadas com nosso atendimento no WhatsApp;</li>
        <li>Suas autorizações para receber mensagens (serviço, eventos e ofertas) e a data em que foram dadas ou retiradas.</li>
      </ul>
      <p>Não pedimos nem guardamos dados de cartão. Documentos como CPF aparecem mascarados nas telas internas.</p>

      <h2>2. Para que usamos</h2>
      <ul>
        <li>Agendar e confirmar revisões e serviços, enviar lembretes e avisos sobre o seu atendimento;</li>
        <li>Responder pedidos de orçamento de veículos, peças e serviços;</li>
        <li>Enviar convites de eventos e ofertas <strong>somente</strong> se você autorizou esse tipo de mensagem;</li>
        <li>Cumprir obrigações legais e melhorar o atendimento.</li>
      </ul>

      <h2>3. Assistente virtual</h2>
      <p>
        Parte do atendimento no WhatsApp é feita por um assistente virtual com inteligência artificial. Ele se identifica como
        assistente, não finge ser uma pessoa e sempre oferece falar com um atendente humano. Ele não informa preços, descontos ou
        horários que não estejam confirmados no nosso sistema.
      </p>

      <h2>4. Com quem compartilhamos</h2>
      <p>
        Usamos fornecedores que processam dados em nosso nome, com contrato e medidas de segurança: Meta (WhatsApp Business Platform),
        provedor de inteligência artificial (Anthropic), hospedagem e banco de dados (Vercel e Supabase). Não vendemos seus dados e não
        usamos listas compradas.
      </p>

      <h2>5. Seus direitos e como parar de receber mensagens</h2>
      <p>
        Envie <strong>SAIR</strong>, <strong>PARAR</strong> ou <strong>NÃO QUERO RECEBER</strong> no WhatsApp a qualquer momento:
        o envio é interrompido na hora. Você também pode pedir acesso, correção, exportação ou exclusão (anonimização) dos seus dados
        falando com nosso atendimento{empresa.telefone_humano ? <> pelo telefone <strong>{empresa.telefone_humano}</strong></> : null}.
      </p>

      <h2>6. Por quanto tempo guardamos</h2>
      <p>Pelo tempo necessário ao atendimento e às obrigações legais. Depois disso, os dados são excluídos ou anonimizados.</p>

      <h2>7. Segurança</h2>
      <p>O acesso ao sistema é individual, com senha e permissões por função; os dados ficam em servidores com criptografia e registro de acesso.</p>

      <h2>8. Contato</h2>
      <p>
        {empresa.nome}{empresa.endereco ? <> — {empresa.endereco}</> : null}
        {empresa.site ? <> · <a href={empresa.site}>{empresa.site.replace(/^https?:\/\//, "")}</a></> : null}
      </p>
    </Legal>
  );
}
