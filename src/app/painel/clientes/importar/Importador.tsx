"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CAMPOS, LIMITE_LINHAS, lerCSV, sugerirMapeamento, prepararClientes, type Campo, type Mapeamento } from "@/modulos/importacao/regras";
import { previa, importar } from "./actions";

type Preparado = ReturnType<typeof prepararClientes>;
type Previa = Awaited<ReturnType<typeof previa>>;
type Resultado = Awaited<ReturnType<typeof importar>>;

/** Lê o arquivo como UTF-8; se vier do Excel antigo (acentos quebrados), relê como Windows-1252. */
async function lerArquivo(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}

export default function Importador({ vendedores }: { vendedores: { user_id: string; nome: string }[] }) {
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<string[][]>([]);
  const [temCabecalho, setTemCabecalho] = useState(true);
  const [mapa, setMapa] = useState<Mapeamento>({});
  const [prep, setPrep] = useState<Preparado | null>(null);
  const [prev, setPrev] = useState<Previa | null>(null);
  const [vendedor, setVendedor] = useState("");
  const [completar, setCompletar] = useState(true);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  async function escolher(f: File | undefined) {
    setPrep(null); setPrev(null); setResultado(null); setErro(null);
    if (!f) return;
    if (/\.xlsx?$/i.test(f.name)) { setErro("Planilha do Excel: abra no Excel e use Arquivo → Salvar como → CSV, depois envie o CSV aqui."); return; }
    const l = lerCSV(await lerArquivo(f));
    if (l.length < 2) { setErro("Não encontrei linhas nesse arquivo. Confira se é um CSV com cabeçalho."); return; }
    setNomeArquivo(f.name);
    setLinhas(l);
    setMapa(sugerirMapeamento(l[0]!));
  }

  const colunas = (linhas[0] ?? []).map((c, i) => (temCabecalho ? c || `Coluna ${i + 1}` : `Coluna ${i + 1}`));
  const exemplo = (i: number | undefined) => (i === undefined ? "" : linhas[temCabecalho ? 1 : 0]?.[i] ?? "");

  function verPrevia() {
    setResultado(null); setErro(null);
    if (mapa.telefone === undefined) { setErro("Escolha qual coluna é o telefone: sem telefone o cliente não entra."); return; }
    const p = prepararClientes(linhas, mapa, temCabecalho);
    setPrep(p);
    setPrev(null);
    if (!p.clientes.length) return;
    iniciar(async () => setPrev(await previa(p.clientes)));
  }

  function rodar() {
    if (!prep) return;
    iniciar(async () => {
      const r = await importar(prep.clientes, vendedor || null, completar);
      setResultado(r);
      if (r.ok) { setPrev(null); }
    });
  }

  return (
    <div className="importador">
      {erro && <div className="alerta erro" role="alert">{erro}</div>}

      <section className="card">
        <h2>1. Arquivo</h2>
        <p className="mudo">CSV separado por ponto e vírgula ou vírgula (o Bravus e o Excel exportam assim). Até {LIMITE_LINHAS.toLocaleString("pt-BR")} linhas por vez; planilha maior, divida em partes.</p>
        <input type="file" accept=".csv,.txt,text/csv" onChange={(e) => escolher(e.target.files?.[0])} aria-label="Arquivo CSV" />
        {nomeArquivo && <p className="mudo">{nomeArquivo}: {Math.max(0, linhas.length - (temCabecalho ? 1 : 0)).toLocaleString("pt-BR")} linhas</p>}
      </section>

      {linhas.length > 0 && (
        <section className="card secao">
          <h2>2. Qual coluna é cada informação</h2>
          <label className="linha-check"><input type="checkbox" checked={temCabecalho} onChange={(e) => { setTemCabecalho(e.target.checked); setPrep(null); setPrev(null); }} /> A primeira linha é o cabeçalho</label>
          <div className="importar-mapa">
            {(Object.keys(CAMPOS) as Campo[]).map((campo) => (
              <label key={campo}>
                <span>{CAMPOS[campo]}{campo === "telefone" ? " *" : ""}</span>
                <select value={mapa[campo] ?? ""} onChange={(e) => { setMapa((m) => ({ ...m, [campo]: e.target.value === "" ? undefined : Number(e.target.value) })); setPrep(null); setPrev(null); }}>
                  <option value="">— não importar —</option>
                  {colunas.map((c, i) => <option key={i} value={i}>{c}</option>)}
                </select>
                <small className="mudo">{exemplo(mapa[campo]) ? `ex.: ${exemplo(mapa[campo]).slice(0, 40)}` : " "}</small>
              </label>
            ))}
          </div>
          <button className="btn primario" onClick={verPrevia} disabled={pendente}>Ver prévia</button>
        </section>
      )}

      {prep && (
        <section className="card secao">
          <h2>3. Prévia</h2>
          <ul className="lista-simples">
            <li><span>Prontas para importar</span><strong>{prep.clientes.length}</strong></li>
            {prev?.ok && <li><span>· clientes novos</span><strong>{prev.novos}</strong></li>}
            {prev?.ok && <li><span>· já têm ficha (só completa o que estiver vazio)</span><strong>{prev.existentes}</strong></li>}
            <li><span>Repetidas no próprio arquivo (fica a primeira)</span><strong>{prep.duplicadas}</strong></li>
            <li><span>Com erro (não entram)</span><strong className={prep.erros.length ? "texto-aviso" : ""}>{prep.erros.length}</strong></li>
            <li><span>Entram sem algum dado (CPF, e-mail ou data inválidos)</span><strong>{prep.avisos.length}</strong></li>
            {prep.ignoradasPorLimite > 0 && <li><span>Acima do limite deste lote (envie em outra parte)</span><strong className="texto-aviso">{prep.ignoradasPorLimite}</strong></li>}
          </ul>
          {pendente && !prev && <p className="mudo">Conferindo a base…</p>}
          {prev && !prev.ok && <div className="alerta erro">{prev.motivo}</div>}
          {prep.erros.length > 0 && (
            <details><summary>Ver linhas com erro</summary>
              <ul className="mudo">{prep.erros.slice(0, 30).map((e) => <li key={e.linha}>Linha {e.linha}: {e.motivo}</li>)}</ul>
            </details>
          )}
          {prep.avisos.length > 0 && (
            <details><summary>Ver avisos</summary>
              <ul className="mudo">{prep.avisos.slice(0, 30).map((a, i) => <li key={i}>Linha {a.linha}: {a.motivo}</li>)}</ul>
            </details>
          )}
          {prev?.ok && prev.exemplos.length > 0 && (
            <details><summary>Ver quem já tem ficha</summary>
              <ul className="mudo">{prev.exemplos.map((x) => <li key={x.linha}>Linha {x.linha}: {x.nome ?? "sem nome"} → ficha {x.ficha ?? "sem nome"} (mesmo {x.por})</li>)}</ul>
            </details>
          )}

          {prep.clientes.length > 0 && prev?.ok && (
            <div className="importar-opcoes">
              <label>
                <span>Carteira</span>
                <select value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
                  <option value="">Sem vendedor (distribuir depois)</option>
                  {vendedores.map((v) => <option key={v.user_id} value={v.user_id}>{v.nome}</option>)}
                </select>
                <small className="mudo">Fichas que já têm vendedor continuam com ele.</small>
              </label>
              <label className="linha-check"><input type="checkbox" checked={completar} onChange={(e) => setCompletar(e.target.checked)} /> Completar fichas existentes (só campos vazios, nunca sobrescreve)</label>
              <button className="btn primario" onClick={rodar} disabled={pendente}>{pendente ? "Importando…" : `Importar ${prep.clientes.length} clientes`}</button>
            </div>
          )}
        </section>
      )}

      {resultado && (
        <section className="card secao">
          {resultado.ok ? (
            <div className="alerta ok">
              Importação concluída: <strong>{resultado.criados}</strong> clientes novos, <strong>{resultado.completados}</strong> fichas completadas, {resultado.semMudanca} sem mudança{resultado.recusados ? `, ${resultado.recusados} recusados (conferência do servidor ou erro de gravação: rode de novo, quem já entrou não duplica)` : ""}.{" "}
              <Link href="/painel/clientes">Abrir clientes</Link>
            </div>
          ) : <div className="alerta erro">{resultado.motivo}</div>}
          <p className="mudo">Lembrete LGPD: quem foi importado não autorizou mensagens do assistente. O vendedor pode contatar pessoalmente; o envio automático continua bloqueado até o cliente autorizar.</p>
        </section>
      )}
    </div>
  );
}
