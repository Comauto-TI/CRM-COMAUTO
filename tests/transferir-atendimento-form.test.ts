import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TransferirAtendimento, { type PropsTransferirAtendimento } from "@/app/painel/_components/TransferirAtendimento";

const registroId = "a1000000-0000-4000-8000-000000000001";
const pessoa = { id: "a1000000-0000-4000-8000-000000000002", nome: "Pessoa fictícia" };
function render(patch: Partial<PropsTransferirAtendimento> = {}) {
  const transferirAction = vi.fn();
  const props: PropsTransferirAtendimento = { origem: "vendas", registroId, versao: 7,
    destinos: [{ setor: "vendas", funis: ["novos"], responsaveis: [pessoa] }, { setor: "pecas" }, { setor: "oficina" }], transferirAction, ...patch };
  return { html: renderToStaticMarkup(createElement(TransferirAtendimento, props)), transferirAction };
}

describe("formulário de transferência — SSR real isolado", () => {
  it("apresenta apenas os setores fornecidos e explica preservação/reuso", () => {
    const { html, transferirAction } = render({ destinos: [{ setor: "pecas" }] });
    expect(html).toContain('value="pecas"');
    expect(html).not.toContain('value="vendas"');
    expect(html).not.toContain('value="oficina"');
    expect(html).toContain("O negócio de origem será mantido");
    expect(html).toContain("responsável atual será preservado");
    expect(transferirAction).not.toHaveBeenCalled();
  });

  it.each(["vendas", "pecas", "oficina"] as const)("não oferece o próprio setor de origem %s", origem => {
    const { html } = render({ origem });
    expect(html).not.toContain(`value="${origem}"`);
  });

  it("não inventa funil quando Vendas não tem opção autorizada", () => {
    const { html } = render({ origem: "oficina", destinos: [{ setor: "vendas", funis: [] }, { setor: "pecas" }] });
    expect(html).not.toContain('value="vendas"');
    expect(html).toContain('value="pecas"');
  });

  it.each(["central", "fora_do_contrato"])("origem %s é recusada em runtime sem oferecer ação", origem => {
    const { html, transferirAction } = render({ origem: origem as PropsTransferirAtendimento["origem"] });
    expect(html).toContain("disponível pelos cartões dos setores");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="submit"');
    expect(transferirAction).not.toHaveBeenCalled();
  });

  it("sem opções não renderiza submissão ou chamada de ação", () => {
    const { html, transferirAction } = render({ destinos: [] });
    expect(html).toContain("Nenhum setor disponível");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="submit"');
    expect(transferirAction).not.toHaveBeenCalled();
  });

  it("renderizar não gera operação nem expõe identidade/contexto como campos livres", () => {
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID");
    try {
      const { html, transferirAction } = render();
      expect(randomUUID).not.toHaveBeenCalled();
      expect(transferirAction).not.toHaveBeenCalled();
      for (const name of ["ator", "email", "ator_email", "cliente", "unidade", "registro", "versao", "operacao"]) {
        expect(html).not.toContain(`name="${name}"`);
      }
      expect(html).not.toContain(registroId);
    } finally { randomUUID.mockRestore(); }
  });

  it("usa campos acessíveis sem limitar Unicode pelo maxlength de unidades UTF-16", () => {
    const { html } = render();
    expect(html).toContain("Setor de destino");
    expect(html).toContain("Responsável no destino");
    expect(html).toContain("Fila do setor");
    expect(html).toContain('name="nota"');
    expect(html).toContain("aria-describedby=");
    expect(html).toContain("0 / 1.000 caracteres");
    expect(html).not.toContain('maxLength="1000"');
    expect(html).not.toContain('maxlength="1000"');
  });
});
