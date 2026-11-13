import { normalizarTelefone } from "@/lib/phone";
import { lerDocumento, lerNascimento } from "@/lib/busca";

/**
 * Cadastro de cliente pela recepção/Peças (Simão 13/11).
 * Física: nome, CPF, telefone, e-mail, nascimento, nome da mãe, endereço.
 * Jurídica: razão social, CNPJ, inscrição estadual (se tiver), telefone, e-mail, endereço.
 * Só o telefone é obrigatório (é a chave do WhatsApp); o resto ajuda a filtrar e a cruzar na importação.
 */
export type DadosCliente = {
  tipo_pessoa: "fisica" | "juridica";
  telefone: string;
  nome: string | null;
  cpf_cnpj: string | null;
  email: string | null;
  data_nascimento: string | null;
  nome_mae: string | null;
  endereco: string | null;
  cidade: string | null;
  inscricao_estadual: string | null;
};

const texto = (v: unknown, max: number) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
};

export function validarCadastroCliente(form: { get(nome: string): unknown }): { ok: true; dados: DadosCliente } | { ok: false; motivo: string } {
  const tipo = form.get("tipo_pessoa") === "juridica" ? "juridica" : "fisica";
  const telefone = normalizarTelefone(String(form.get("telefone") ?? ""));
  if (!telefone) return { ok: false, motivo: "Telefone inválido. Use DDD + número." };

  const doc = lerDocumento(String(form.get("documento") ?? ""));
  if (!doc.ok) return { ok: false, motivo: doc.motivo };
  if (doc.valor && tipo === "fisica" && doc.valor.length !== 11) return { ok: false, motivo: "Pessoa física usa CPF (11 dígitos)" };
  if (doc.valor && tipo === "juridica" && doc.valor.length !== 14) return { ok: false, motivo: "Pessoa jurídica usa CNPJ (14 dígitos)" };

  const email = texto(form.get("email"), 160)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, motivo: "E-mail inválido" };

  const nasc = tipo === "fisica" ? lerNascimento(String(form.get("nascimento") ?? "")) : { ok: true as const, valor: null };
  if (!nasc.ok) return { ok: false, motivo: nasc.motivo };

  const ie = tipo === "juridica" ? texto(form.get("inscricao_estadual"), 20) : null;
  if (ie && !/^(isento|[0-9./-]{2,20})$/i.test(ie)) return { ok: false, motivo: "Inscrição estadual inválida (números ou ISENTO)" };

  return {
    ok: true,
    dados: {
      tipo_pessoa: tipo,
      telefone,
      nome: texto(form.get("nome"), 120),
      cpf_cnpj: doc.valor,
      email,
      data_nascimento: nasc.valor,
      nome_mae: tipo === "fisica" ? texto(form.get("nome_mae"), 120) : null,
      endereco: texto(form.get("endereco"), 200),
      cidade: texto(form.get("cidade"), 80),
      inscricao_estadual: ie ? ie.toUpperCase() : null,
    },
  };
}
