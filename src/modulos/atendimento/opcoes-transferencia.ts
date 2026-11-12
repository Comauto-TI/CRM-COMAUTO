import "server-only";
import type { Usuario } from "@/lib/auth";
import { podeAcessar } from "@/lib/permissoes";
import { db } from "@/lib/supabase/admin";
import { filtrarSaida, mascararDadosSensiveis } from "@/lib/security/guard";
import { valoresSecretos } from "@/lib/env";
import type { OpcaoDestinoTransferencia } from "@/app/painel/_components/TransferirAtendimento";
import type { DestinoTransferencia, FunilTransferencia } from "./dados-transferencia";
import type { FalhaTransferencia } from "./transferencias";
import { objeto, uuid } from "./contrato-leitura";

export type ResultadoOpcoesTransferencia =
  | { ok: true; versao: number; destinos: OpcaoDestinoTransferencia[] }
  | FalhaTransferencia;
const setores: DestinoTransferencia[] = ["vendas", "pecas", "oficina"];
const fonte = {
  vendas: { tabela: "vendas_oportunidades", dono: "vendedor_id", atendimento: "oportunidade_id" },
  pecas: { tabela: "pecas_cotacoes", dono: "responsavel_id", atendimento: "cotacao_id" },
  oficina: { tabela: "oficina_atendimentos", dono: "responsavel_id", atendimento: null },
} as const;

function falha(status: 400 | 403 | 404 | 503): FalhaTransferencia {
  return { ok: false, status, erro: status === 400 ? "Confira o atendimento selecionado."
    : status === 403 ? "Seu perfil não tem acesso a esta transferência."
      : status === 404 ? "Atendimento não encontrado ou fora do seu acesso."
        : "Não foi possível carregar os destinos. Tente novamente." };
}

function nomeSeguro(nome: unknown): string {
  if (typeof nome !== "string" || !nome.trim() || !filtrarSaida(nome, valoresSecretos()).ok) return "Pessoa da equipe";
  return Array.from(mascararDadosSensiveis(nome.trim()).texto).slice(0, 200).join("");
}

/** Só metadados do cartão e da equipe. Não consulta mensagens, cliente ou histórico para projetar o formulário.
 * As opções e a versão não autorizam a escrita: a RPC de transferência revalida todo o contexto na transação. */
export async function obterOpcoesTransferencia(u: Usuario, origem: unknown, registroId: unknown, unidade: unknown): Promise<ResultadoOpcoesTransferencia> {
  if (!objeto(u) || !uuid(u.id) || !uuid(registroId) || !setores.includes(origem as DestinoTransferencia)
    || typeof unidade !== "string" || !/^[a-z0-9_]+$/.test(unidade)) return falha(400);
  const setor = origem as DestinoTransferencia;
  if (!podeAcessar(u, setor) || (u.papel !== "admin" && !u.unidades.includes(unidade))) return falha(403);
  const cfg = fonte[setor];
  const supervisor = u.papel === "admin" || (u.papel === "gerente" && (u.setor === setor || u.setor === "administracao"));
  try {
    const funilOrigem = setor === "vendas" ? ",funil:vendas_funis!inner(ativo),etapa:vendas_etapas!inner(ativo,tipo)" : "";
    const versaoOrigem = cfg.atendimento ? `,atendimento:atendimentos_modulares!${cfg.atendimento}(versao)` : "";
    let q = db().from(cfg.tabela).select(`id,unidade,cliente:clientes!inner(anonimizado),loja:unidades!inner(ativa)${funilOrigem}${versaoOrigem}`)
      .eq("id", registroId.toLowerCase()).eq("unidade", unidade).eq("cliente.anonimizado", false).eq("loja.ativa", true);
    if (!supervisor) q = q.eq(cfg.dono, u.id);
    if (setor === "vendas") q = q.is("fechado_em", null).eq("funil.ativo", true).eq("etapa.ativo", true).eq("etapa.tipo", "aberta");
    else if (setor === "pecas") q = q.not("status", "in", "(entregue,perdido,cancelado)");
    else q = q.in("status", ["novo", "em_triagem"]);
    const { data: cartao, error: erroCartao } = await q.maybeSingle();
    if (erroCartao) return falha(503);
    if (!objeto(cartao) || cartao.id !== registroId.toLowerCase() || cartao.unidade !== unidade) return falha(404);
    let versao = 0;
    if (cfg.atendimento) {
      const vinculo = Array.isArray(cartao.atendimento) && cartao.atendimento.length <= 1 ? cartao.atendimento[0] ?? null : cartao.atendimento;
      if (vinculo !== null) {
        if (!objeto(vinculo) || !Number.isSafeInteger(vinculo.versao) || (vinculo.versao as number) < 0 || (vinculo.versao as number) > 2147483646) return falha(503);
        versao = vinculo.versao as number;
      }
    }
    // Diretório mínimo da unidade já permitida à sessão; IDs desta lista não conferem posse nem acesso ao destino.
    const { data: extras, error: erroExtras } = await db().from("usuario_unidades").select("user_id").eq("unidade", unidade);
    if (erroExtras || !Array.isArray(extras) || extras.some(e => !uuid(e.user_id))) return falha(503);
    const idsExtras = [...new Set(extras.map(e => e.user_id as string))];
    let equipe = db().from("usuarios").select("user_id,nome,papel,setor,unidade").eq("ativo", true);
    equipe = idsExtras.length ? equipe.or(`unidade.eq.${unidade},user_id.in.(${idsExtras.join(",")})`) : equipe.eq("unidade", unidade);
    const [{ data: pessoas, error: erroPessoas }, { data: funis, error: erroFunis }] = await Promise.all([
      equipe.order("nome"),
      db().from("vendas_funis").select("chave,etapas:vendas_etapas!inner(ativo,tipo)").eq("unidade", unidade)
        .eq("ativo", true).eq("etapas.ativo", true).eq("etapas.tipo", "aberta").in("chave", ["novos", "seminovos"]),
    ]);
    if (erroPessoas || erroFunis || !Array.isArray(pessoas) || !Array.isArray(funis)) return falha(503);
    const funisAtivos = [...new Set(funis.map(f => f.chave).filter((f): f is FunilTransferencia => f === "novos" || f === "seminovos"))];
    const destinos: OpcaoDestinoTransferencia[] = [];
    for (const destino of setores) {
      if (destino === setor || (destino === "vendas" && !funisAtivos.length)) continue;
      const responsaveis: { id: string; nome: string }[] = [];
      const vistos = new Set<string>();
      for (const pessoa of pessoas) {
        const elegivel = destino === "vendas" ? pessoa.papel === "vendedor" || (pessoa.papel === "gerente" && pessoa.setor === "vendas")
          : destino === "pecas" ? pessoa.papel === "pecas" || (pessoa.papel === "gerente" && pessoa.setor === "pecas")
            : ["recepcao", "atendente", "consultor_tecnico"].includes(pessoa.papel) || (pessoa.papel === "gerente" && pessoa.setor === "oficina");
        if (!elegivel || (pessoa.unidade !== unidade && !idsExtras.includes(pessoa.user_id))) continue;
        if (!uuid(pessoa.user_id)) return falha(503);
        const id = pessoa.user_id.toLowerCase();
        if (!vistos.has(id)) { vistos.add(id); responsaveis.push({ id, nome: nomeSeguro(pessoa.nome) }); }
      }
      destinos.push({ setor: destino, ...(destino === "vendas" ? { funis: funisAtivos } : {}), responsaveis });
    }
    return { ok: true, versao, destinos };
  } catch { return falha(503); }
}
