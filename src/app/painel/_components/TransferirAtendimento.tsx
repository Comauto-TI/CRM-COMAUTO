"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { parsearTransferencia, type DadosTransferencia, type DestinoTransferencia, type FunilTransferencia } from "@/modulos/atendimento/dados-transferencia";
import type { ResultadoTransferencia } from "@/modulos/atendimento/transferencias";
import { mascararDadosSensiveis } from "@/lib/security/guard";

export type OpcaoDestinoTransferencia = {
  setor: DestinoTransferencia;
  funis?: readonly FunilTransferencia[];
  responsaveis?: readonly { id: string; nome: string }[];
};
export type PropsTransferirAtendimento = {
  origem: DestinoTransferencia;
  registroId: string;
  versao: number;
  destinos: readonly OpcaoDestinoTransferencia[];
  transferirAction: (dados: DadosTransferencia) => Promise<ResultadoTransferencia>;
};
type Resultado = { tipo: "erro"; texto: string } | { tipo: "incerto" } | { tipo: "sucesso"; reutilizado: boolean; nomeMantido: string | null } | null;
const NOMES: Record<DestinoTransferencia, string> = { vendas: "Vendas", pecas: "Peças", oficina: "Oficina" };
const FUNIS: Record<FunilTransferencia, string> = { novos: "Novos", seminovos: "Seminovos" };

/** Opções vêm do servidor; nenhuma escolha apresentada substitui autorização na ação/RPC. */
export default function TransferirAtendimento(props: PropsTransferirAtendimento) {
  if (!Object.hasOwn(NOMES, props.origem)) return <p className="mudo">Transferência disponível pelos cartões dos setores.</p>;
  const contexto = `${props.origem}:${props.registroId.toLowerCase()}:${props.versao}`;
  return <Formulario key={contexto} {...props} />;
}

function Formulario({ origem, registroId, versao, destinos, transferirAction }: PropsTransferirAtendimento) {
  const id = useId();
  const [setor, setSetor] = useState<DestinoTransferencia | "">("");
  const [funil, setFunil] = useState<FunilTransferencia | "">("");
  const [responsavel, setResponsavel] = useState("");
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado>(null);
  const vivo = useRef(true);
  const trava = useRef(false);
  const encerrado = useRef(false);
  const operacao = useRef<string | null>(null);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const disponiveis = destinos.filter((opcao, index) => opcao.setor !== origem
    && Object.hasOwn(NOMES, opcao.setor) && destinos.findIndex(outro => outro.setor === opcao.setor) === index
    && (opcao.setor !== "vendas" || opcao.funis?.some(chave => chave === "novos" || chave === "seminovos")));
  const opcao = disponiveis.find(destino => destino.setor === setor);
  const funis = [...new Set(opcao?.funis?.filter(chave => chave === "novos" || chave === "seminovos") ?? [])];
  const pessoas = opcao?.responsaveis ?? [];
  const bloqueado = resultado?.tipo === "sucesso" || resultado?.tipo === "incerto";
  const tamanhoNota = Array.from(nota).length;

  async function submeter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vivo.current || trava.current || encerrado.current) return;
    let dados: DadosTransferencia | null;
    try {
      operacao.current ??= crypto.randomUUID();
      const form = new FormData(event.currentTarget);
      form.set("operacao", operacao.current);
      form.set("origem", origem);
      form.set("registro", registroId);
      form.set("versao", String(versao));
      dados = parsearTransferencia(form);
    } catch {
      setResultado({ tipo: "erro", texto: "Não foi possível preparar a transferência. Atualize a página e tente novamente." });
      operacao.current = null;
      return;
    }
    if (!dados || !opcao || dados.destino !== opcao.setor
      || (dados.funil !== null && !funis.includes(dados.funil))
      || (dados.responsavelId !== null && !pessoas.some(pessoa => pessoa.id.toLowerCase() === dados.responsavelId))) {
      setResultado({ tipo: "erro", texto: "Confira o setor, o funil, o responsável e a nota de 1 a 1.000 caracteres." });
      operacao.current = null;
      return;
    }
    trava.current = true;
    setEnviando(true);
    setResultado(null);
    try {
      const resposta = await transferirAction(dados);
      if (!vivo.current) return;
      if (resposta.ok) {
        encerrado.current = true;
        setResultado({ tipo: "sucesso", reutilizado: resposta.reutilizado,
          nomeMantido: resposta.avisoResponsavel === null ? null : mascararDadosSensiveis(resposta.avisoResponsavel.nome).texto });
      } else if (resposta.status === 503) {
        encerrado.current = true;
        setResultado({ tipo: "incerto" });
      } else {
        operacao.current = null;
        setResultado({ tipo: "erro", texto: mascararDadosSensiveis(resposta.erro).texto });
      }
    } catch {
      if (vivo.current) {
        encerrado.current = true;
        setResultado({ tipo: "incerto" });
      }
    } finally {
      trava.current = false;
      if (vivo.current) setEnviando(false);
    }
  }

  return (
    <section className="secao" aria-labelledby={`${id}-titulo`}>
      <h3 id={`${id}-titulo`}>Transferir para setor</h3>
      <p className="mudo">O negócio de origem será mantido. Se já existir uma solicitação aberta no destino, ela será reaproveitada e o responsável atual será preservado.</p>
      {!disponiveis.length ? <p className="mudo">Nenhum setor disponível para este atendimento.</p> : (
        <form onSubmit={submeter} noValidate aria-busy={enviando}>
          <fieldset disabled={enviando || bloqueado} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="linha-form" style={{ flexWrap: "wrap" }}>
              <label htmlFor={`${id}-setor`}>Setor de destino
                <select id={`${id}-setor`} name="destino" value={setor} required onChange={event => {
                  setSetor(event.target.value as DestinoTransferencia | ""); setFunil(""); setResponsavel("");
                }}>
                  <option value="">Selecione o setor</option>
                  {disponiveis.map(destino => <option key={destino.setor} value={destino.setor}>{NOMES[destino.setor]}</option>)}
                </select>
              </label>
              {setor === "vendas" && <label htmlFor={`${id}-funil`}>Funil
                <select id={`${id}-funil`} name="funil" value={funil} required onChange={event => setFunil(event.target.value as FunilTransferencia | "")}>
                  <option value="">Selecione o funil</option>
                  {funis.map(chave => <option key={chave} value={chave}>{FUNIS[chave]}</option>)}
                </select>
              </label>}
              <label htmlFor={`${id}-responsavel`}>Responsável no destino
                <select id={`${id}-responsavel`} name="responsavel" value={responsavel} disabled={!opcao} onChange={event => setResponsavel(event.target.value)}>
                  <option value="">Fila do setor</option>
                  {pessoas.map(pessoa => <option key={pessoa.id} value={pessoa.id}>{mascararDadosSensiveis(pessoa.nome).texto}</option>)}
                </select>
              </label>
            </div>
            <label htmlFor={`${id}-nota`} style={{ display: "block", marginTop: 12 }}>Nota para a equipe de destino
              <textarea id={`${id}-nota`} name="nota" rows={3} value={nota} required aria-describedby={`${id}-limite`}
                onChange={event => setNota(event.target.value)} style={{ width: "100%", resize: "vertical" }} />
            </label>
            <p id={`${id}-limite`} className="mudo">{tamanhoNota} / 1.000 caracteres. Esta nota é interna.</p>
            <div className="acoes">
              <button className="btn primario" type="submit" disabled={!opcao || enviando || bloqueado}>{enviando ? "Transferindo…" : "Transferir para setor"}</button>
            </div>
          </fieldset>
        </form>
      )}
      {resultado?.tipo === "erro" && <p className="alerta erro" role="alert">{resultado.texto}</p>}
      {resultado?.tipo === "incerto" && <p className="alerta aviso" role="alert">Não foi possível confirmar o resultado. Confira o atendimento e atualize a página antes de iniciar outra transferência. Esta tentativa não será reenviada automaticamente.</p>}
      {resultado?.tipo === "sucesso" && <div className="alerta ok" role="status">
        <p>Encaminhamento concluído.{resultado.reutilizado ? " A solicitação aberta no destino foi reaproveitada." : " A solicitação entrou no setor de destino."}</p>
        {resultado.nomeMantido !== null && <p>Responsável mantido no destino: <strong>{resultado.nomeMantido}</strong>.</p>}
      </div>}
    </section>
  );
}
