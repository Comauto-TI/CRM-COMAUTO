import { describe, it, expect } from "vitest";
import { gerarCodigo, montarLinkWhatsApp, extrairCodigo, removerCodigo, mensagemComCodigo, MENSAGENS_SUGERIDAS } from "@/lib/links";
import { verificarEntrada } from "@/lib/security/guard";
import { detectarOptout } from "@/lib/security/optout";

describe("links rastreados", () => {
  it("gera código de 6 caracteres sem ambíguos (0, O, 1, I, L)", () => {
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigo();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      expect(c).not.toMatch(/[01OIL]/);
    }
  });

  it("monta link wa.me com a mensagem codificada", () => {
    const url = montarLinkWhatsApp("+55 (51) 99999-8888", "Olá! Quero agendar minha revisão.", "K7M2QX");
    expect(url.startsWith("https://wa.me/5551999998888?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("Olá! Quero agendar minha revisão. (cód. K7M2QX)");
  });

  it("extrai e remove o código da mensagem recebida", () => {
    const msg = mensagemComCodigo("Olá! Quero agendar minha revisão.", "K7M2QX");
    expect(extrairCodigo(msg)).toBe("K7M2QX");
    expect(removerCodigo(msg)).toBe("Olá! Quero agendar minha revisão.");
    expect(extrairCodigo("Olá! quero agendar (cod. k7m2qx)")).toBe("K7M2QX"); // cliente editou/minúsculas
    expect(extrairCodigo("Olá! Quero agendar minha revisão.")).toBeNull();
    expect(extrairCodigo("o código da peça é 123")).toBeNull();
  });

  it("mensagens sugeridas passam pela segurança e não são confundidas com opt-out", () => {
    for (const m of MENSAGENS_SUGERIDAS) {
      const comCodigo = mensagemComCodigo(m, "K7M2QX");
      expect(verificarEntrada(removerCodigo(comCodigo)).bloqueado).toBe(false);
      expect(detectarOptout(removerCodigo(comCodigo))).toBeNull();
    }
  });
});
