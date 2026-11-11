export type MensagemDialogo = {
  id: string; direcao: string; autor: string; tipo: string; conteudo: string | null;
  status: string; criadoEm: string; erro?: string | null; pendente?: boolean;
};

const hora = (d: string) => new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
function rotuloDia(d: string, hoje: Date) {
  const dia = new Date(d);
  const ontem = new Date(hoje.getTime() - 86400_000);
  if (dia.toDateString() === hoje.toDateString()) return "Hoje";
  if (dia.toDateString() === ontem.toDateString()) return "Ontem";
  return dia.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

function Ticks({ status, pendente }: { status: string; pendente?: boolean }) {
  if (pendente) return <span className="ticks" title="Aguardando confirmação">◷</span>;
  if (status === "falhou" || status === "bloqueada") return <span className="ticks erro" title={status}>!</span>;
  if (status === "enviada") return <span className="ticks" title="enviada">✓</span>;
  return <span className={`ticks ${status === "lida" ? "lida" : ""}`} title={status}>✓✓</span>;
}

/** Apenas apresentação: não consulta, marca leitura nem executa ações de atendimento. */
export default function DialogoMensagens({ mensagens, autorAtendente = "Recepção" }: {
  mensagens: readonly MensagemDialogo[]; autorAtendente?: string;
}) {
  const hoje = new Date();
  return mensagens.map((m, indice) => {
    const dia = rotuloDia(m.criadoEm, hoje);
    const separador = indice === 0 || rotuloDia(mensagens[indice - 1].criadoEm, hoje) !== dia;
    const saida = m.direcao === "saida";
    return (
      <div key={m.id} className="wa-linha-wrap">
        {separador && <div className="wa-dia"><span>{dia}</span></div>}
        <div className={`wa-linha ${saida ? "saida" : "entrada"}`}>
          <div className={`wa-bolha ${saida ? "saida" : "entrada"} ${m.autor === "atendente" ? "atendente" : ""} ${m.autor === "sistema" ? "sistema" : ""} ${m.status === "bloqueada" || m.status === "falhou" ? "falha" : ""}`}>
            {saida && <span className="wa-autor">{m.autor === "atendente" ? autorAtendente : m.autor === "bot" ? "Assistente" : "Sistema"}</span>}
            <span className="wa-texto">{m.conteudo}</span>
            <span className="wa-meta">
              {m.erro && <em title={m.erro}>{m.status} · </em>}
              {hora(m.criadoEm)} {saida && <Ticks status={m.status} pendente={m.pendente} />}
            </span>
          </div>
        </div>
      </div>
    );
  });
}
