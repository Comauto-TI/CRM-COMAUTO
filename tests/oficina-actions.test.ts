import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { assumirAtendimento, criarAtendimento } from "@/app/painel/oficina/actions";

const f = vi.hoisted(() => ({
  exigirAcesso: vi.fn(), registrarAtendimento: vi.fn(), iniciarTriagem: vi.fn(),
  revalidatePath: vi.fn(), redirect: vi.fn(), eventos: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ exigirAcesso: f.exigirAcesso }));
vi.mock("@/modulos/oficina/atendimentos", () => ({ registrarAtendimento: f.registrarAtendimento, iniciarTriagem: f.iniciarTriagem }));
vi.mock("next/cache", () => ({ revalidatePath: f.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: f.redirect }));

const ID = "ab000000-0000-4000-8000-000000000001";
const OUTRO = "ab000000-0000-4000-8000-000000000002";
const USUARIO: Usuario = {
  id: "ac000000-0000-4000-8000-000000000001", nome: "Consultor fictício", email: "oficina@example.invalid",
  papel: "consultor_tecnico", setor: "oficina", unidade: "comauto", unidades: ["comauto"],
};
type Acao = (form: FormData) => Promise<void>;
const ACOES: Array<[string, Acao, string]> = [["criar", criarAtendimento, "criado"], ["assumir", assumirAtendimento, "triagem"]];

function formulario() {
  const form = new FormData();
  form.set("solicitacao", ID);
  form.set("telefone", "(51) 99999-0000");
  form.set("descricao", "  Ruído na suspensão  ");
  form.set("placa", "abc-1d23");
  return form;
}

async function destino(promessa: Promise<unknown>, href: string) {
  await expect(promessa).rejects.toThrow(`REDIRECT:${href}`);
  expect(f.redirect).toHaveBeenCalledExactlyOnceWith(href);
}

beforeEach(() => {
  vi.resetAllMocks();
  f.eventos = [];
  f.exigirAcesso.mockImplementation(async () => { f.eventos.push("acesso"); return USUARIO; });
  f.registrarAtendimento.mockImplementation(async () => { f.eventos.push("registro"); return "criado"; });
  f.iniciarTriagem.mockImplementation(async () => { f.eventos.push("triagem"); return "triagem"; });
  f.revalidatePath.mockImplementation(() => { f.eventos.push("revalidate"); });
  f.redirect.mockImplementation((href: string): never => { f.eventos.push("redirect"); throw new Error(`REDIRECT:${href}`); });
});

describe("ações Oficina: autenticação e autorização", () => {
  it.each(ACOES)("%s aguarda o guard de Oficina antes de ler o formulário", async (_nome, acao, resultado) => {
    let liberar!: (usuario: Usuario) => void;
    f.exigirAcesso.mockImplementation(() => new Promise<Usuario>(resolve => { liberar = resolve; }));
    const form = formulario();
    const leitura = vi.spyOn(form, "get");
    const promessa = acao(form);
    expect(f.exigirAcesso).toHaveBeenCalledExactlyOnceWith("oficina");
    expect(leitura).not.toHaveBeenCalled();
    expect(f.registrarAtendimento).not.toHaveBeenCalled();
    expect(f.iniciarTriagem).not.toHaveBeenCalled();
    liberar(USUARIO);
    await destino(promessa, `/painel/oficina?msg=${resultado}`);
  });

  it.each(ACOES)("%s interrompe sem leitura, escrita ou revalidação quando o guard recusa", async (_nome, acao) => {
    f.exigirAcesso.mockRejectedValue(new Error("acesso_recusado"));
    const form = new FormData();
    const leitura = vi.spyOn(form, "get");
    await expect(acao(form)).rejects.toThrow("acesso_recusado");
    expect(f.exigirAcesso).toHaveBeenCalledExactlyOnceWith("oficina");
    expect(leitura).not.toHaveBeenCalled();
    expect(f.registrarAtendimento).not.toHaveBeenCalled();
    expect(f.iniciarTriagem).not.toHaveBeenCalled();
    expect(f.revalidatePath).not.toHaveBeenCalled();
    expect(f.redirect).not.toHaveBeenCalled();
  });
});

describe("ações Oficina: entrada validada e identidade da sessão", () => {
  it("cria somente com dados do parser existente e o usuário integral da sessão", async () => {
    const form = formulario();
    for (const campo of ["id", "ator", "p_ator", "usuario", "owner", "responsavel"]) form.set(campo, OUTRO);
    form.set("unidade", "unidade_forjada");
    form.set("unidades", "todas");
    form.set("papel", "admin");
    form.set("status", "entregue");
    await destino(criarAtendimento(form), "/painel/oficina?msg=criado");
    expect(f.registrarAtendimento).toHaveBeenCalledExactlyOnceWith(USUARIO, {
      id: ID, telefone: "5551999990000", descricao: "Ruído na suspensão", placa: "ABC1D23",
    });
    expect(f.registrarAtendimento.mock.calls[0][0]).toBe(USUARIO);
    expect(f.iniciarTriagem).not.toHaveBeenCalled();
    expect(f.eventos).toEqual(["acesso", "registro", "revalidate", "redirect"]);
    expect(f.revalidatePath).toHaveBeenCalledExactlyOnceWith("/painel/oficina");
  });

  it("assume pelo ID validado e ignora ator, unidade, dono, status e capacidade forjados", async () => {
    const form = formulario();
    for (const campo of ["ator", "p_ator", "owner", "responsavel"]) form.set(campo, OUTRO);
    form.set("unidade", "unidade_forjada");
    form.set("status", "concluido");
    form.set("podeAssumir", "true");
    await destino(assumirAtendimento(form), "/painel/oficina?msg=triagem");
    expect(f.iniciarTriagem).toHaveBeenCalledExactlyOnceWith(USUARIO, ID);
    expect(f.iniciarTriagem.mock.calls[0][0]).toBe(USUARIO);
    expect(f.registrarAtendimento).not.toHaveBeenCalled();
    expect(f.eventos).toEqual(["acesso", "triagem", "revalidate", "redirect"]);
    expect(f.revalidatePath).toHaveBeenCalledExactlyOnceWith("/painel/oficina");
  });

  it.each([
    ["solicitacao", "sem-id"], ["telefone", "123"], ["descricao", " "],
    ["descricao", "x".repeat(1001)], ["placa", "veículo desconhecido"],
  ])("criação com %s inválido não escreve nem revalida", async (campo, valor) => {
    const form = formulario();
    form.set(campo, valor);
    await destino(criarAtendimento(form), "/painel/oficina?msg=invalido");
    expect(f.exigirAcesso).toHaveBeenCalledExactlyOnceWith("oficina");
    expect(f.registrarAtendimento).not.toHaveBeenCalled();
    expect(f.iniciarTriagem).not.toHaveBeenCalled();
    expect(f.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["", "sem-id", "ab000000-0000-1000-8000-000000000001"])("ID de triagem inválido %j não escreve nem revalida", async id => {
    const form = formulario();
    form.set("solicitacao", id);
    await destino(assumirAtendimento(form), "/painel/oficina?msg=indisponivel");
    expect(f.exigirAcesso).toHaveBeenCalledExactlyOnceWith("oficina");
    expect(f.registrarAtendimento).not.toHaveBeenCalled();
    expect(f.iniciarTriagem).not.toHaveBeenCalled();
    expect(f.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("ações Oficina: resultados e retorno à fila", () => {
  it.each(["unidade", "cliente", "veiculo", "conflito", "pendente", "erro"])("preserva falha de registro %s sem revalidar", async resultado => {
    f.registrarAtendimento.mockResolvedValue(resultado);
    await destino(criarAtendimento(formulario()), `/painel/oficina?msg=${resultado}`);
    expect(f.revalidatePath).not.toHaveBeenCalled();
    expect(f.iniciarTriagem).not.toHaveBeenCalled();
  });

  it.each(["indisponivel", "pendente", "erro_triagem"])("preserva falha de triagem %s sem revalidar", async resultado => {
    f.iniciarTriagem.mockResolvedValue(resultado);
    await destino(assumirAtendimento(formulario()), `/painel/oficina?msg=${resultado}`);
    expect(f.revalidatePath).not.toHaveBeenCalled();
    expect(f.registrarAtendimento).not.toHaveBeenCalled();
  });

  it.each(ACOES)("%s só preserva minhas=1 literal e remove cursor e destinos forjados", async (_nome, acao, resultado) => {
    for (const minhas of ["1", "0", "true", "on", " 1 ", "1\n", "", null]) {
      f.redirect.mockClear();
      const form = formulario();
      if (minhas !== null) form.set("minhas", minhas);
      form.set("antes", "2026-11-12T13:45:59.123456Z");
      form.set("antes_id", OUTRO);
      for (const campo of ["returnURL", "returnTo", "return_url", "next", "redirect"]) form.set(campo, "https://outro.invalid/");
      const href = `/painel/oficina?${minhas === "1" ? "minhas=1&" : ""}msg=${resultado}`;
      await destino(acao(form), href);
    }
  });

  it.each(ACOES)("%s mantém minhas literal mesmo quando a entrada é inválida", async (nome, acao) => {
    const form = new FormData();
    form.set("minhas", "1");
    form.set("antes", "2026-11-12T13:45:59.123456Z");
    form.set("antes_id", OUTRO);
    await destino(acao(form), `/painel/oficina?minhas=1&msg=${nome === "criar" ? "invalido" : "indisponivel"}`);
    expect(f.revalidatePath).not.toHaveBeenCalled();
  });
});
