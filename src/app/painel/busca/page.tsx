import Link from "next/link";
import { exigirAcesso } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { getConfig } from "@/lib/config";
import { interpretarBusca, mascararDocumento } from "@/lib/busca";
import { buscarClientes, nomesVendedores } from "@/lib/busca-db";
import { mascararTelefone } from "@/lib/phone";
import { formatarDataHora } from "@/lib/time";
import { auditar } from "@/lib/audit";
import { Cabecalho, Vazio } from "../_components/ui";

const ROTULO_TIPO: Record<string, string> = {
  cpf: "CPF", cnpj: "CNPJ", telefone: "telefone", cpf_ou_telefone: "CPF ou telefone", placa: "placa", nome: "nome",
};

export default async function BuscaGlobal({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await exigirAcesso("busca");
  const { q = "" } = await searchParams;
  const cfg = await getConfig();
  const busca = interpretarBusca(q);
  const resultados = busca ? await buscarClientes(busca) : [];
  const vendedores = await nomesVendedores(resultados.map((r) => r.vendedor_id ?? ""));
  // LGPD: consulta por documento fica registrada (quem procurou, tipo — nunca o número)
  if (busca && (busca.tipo === "cpf" || busca.tipo === "cnpj" || busca.tipo === "cpf_ou_telefone")) {
    await auditar(u.email, "busca_documento", "clientes", null, { tipo: busca.tipo, resultados: resultados.length });
  }

  return (
    <>
      <Cabecalho titulo="Buscar cliente" sub="Procura no grupo inteiro por CPF/CNPJ, telefone, placa ou nome">
        <form className="linha-form" role="search">
          <input name="q" defaultValue={q} placeholder="CPF, telefone, placa ou nome" autoFocus aria-label="Buscar cliente" />
          <button className="btn primario">Buscar</button>
        </form>
      </Cabecalho>

      {!q && <Vazio>Digite pelo menos 2 caracteres. A sua carteira continua sendo a visão principal; a busca serve para achar qualquer cliente do grupo.</Vazio>}
      {q && !busca && <div className="alerta aviso">Busca muito curta. Use pelo menos 2 caracteres.</div>}
      {busca && (
        <p className="mudo" style={{ margin: "0 0 12px" }}>
          {resultados.length === 50 ? "Mostrando os 50 primeiros" : `${resultados.length} encontrado(s)`} por {ROTULO_TIPO[busca.tipo]}
        </p>
      )}
      {busca && resultados.length === 0 && <Vazio>Nenhum cliente encontrado. Confira o número ou tente pelo nome.</Vazio>}

      {resultados.length > 0 && (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Cliente</th><th>Documento</th><th>Veículos</th><th>Carteira</th><th>Último contato</th></tr></thead>
            <tbody>
              {resultados.map((c) => {
                const meu = c.vendedor_id === u.id;
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.nome ?? "—"}</strong>
                      <div className="mudo">{mascararTelefone(c.telefone)}{c.cidade ? ` · ${c.cidade}` : ""}</div>
                    </td>
                    <td className="mudo">{mascararDocumento(c.cpf_cnpj) || "—"}</td>
                    <td>
                      <div className="acoes">
                        {c.veiculos.length ? c.veiculos.map((v, i) => (
                          <span key={i} className="tag">{[v.modelo, v.ano, v.placa].filter(Boolean).join(" · ")}</span>
                        )) : <span className="mudo">—</span>}
                      </div>
                    </td>
                    <td>
                      {meu ? <span className="tag ok">sua carteira</span>
                        : c.vendedor_id ? <span className="tag">{vendedores.get(c.vendedor_id) ?? "outro vendedor"}</span>
                        : <span className="tag aviso">sem vendedor</span>}
                    </td>
                    <td className="mudo">{c.ultimo_contato_em ? formatarDataHora(c.ultimo_contato_em, cfg.fuso_offset) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mudo secao">Documento e telefone aparecem mascarados (LGPD).{podeAcessar(u, "atendimento") && <> Para ver a conversa, abra o <Link href="/painel/conversas">Atendimento</Link>.</>}</p>
    </>
  );
}
