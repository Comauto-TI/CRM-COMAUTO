/** Pequenos componentes de servidor reutilizados nas páginas do painel. */
import { IlustracaoVazio } from "./Ilustracoes";

export function Kpi({ rotulo, valor, sub }: { rotulo: string; valor: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card kpi">
      <div className="rotulo">{rotulo}</div>
      <div className="valor">{valor}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Cabecalho({ titulo, sub, children }: { titulo: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="cabecalho">
      <div>
        <h1>{titulo}</h1>
        {sub && <div className="mudo">{sub}</div>}
      </div>
      {children && <div className="acoes">{children}</div>}
    </div>
  );
}

const COR_STATUS: Record<string, string> = {
  confirmado: "ok", compareceu: "info", pendente: "aviso", cancelado: "erro", nao_compareceu: "erro",
  // bot = assistente virtual (ciano); humano = aguardando gente (atenção)
  bot: "ia", humano: "aviso", encerrada: "",
  enviado: "info", entregue: "ok", lido: "ok", respondido: "ok", falhou: "erro", fila: "", ignorado: "",
  rascunho: "", teste: "aviso", pronta: "info", enviando: "ok", pausada: "erro", concluida: "",
  aprovado: "ok", reprovado: "erro", sem_consentimento: "aviso", ativo: "ok", revogado: "erro",
};

export function Status({ valor }: { valor: string }) {
  return <span className={`tag ${COR_STATUS[valor] ?? ""}`}>{valor.replace(/_/g, " ")}</span>;
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <div className="card vazio">
      <IlustracaoVazio />
      <div className="mudo">{children}</div>
    </div>
  );
}
