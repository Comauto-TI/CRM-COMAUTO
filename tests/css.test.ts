import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Junções de branch já deixaram uma chave aberta no globals.css e todo o CSS seguinte passou a valer só
// dentro de um @media (login "quebrado"). Este teste pega isso antes de chegar na tela.
describe("globals.css", () => {
  it("tem chaves balanceadas e nenhum marcador de conflito", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
    let d = 0;
    for (const ch of semComentarios) {
      if (ch === "{") d++;
      else if (ch === "}") d--;
      expect(d).toBeGreaterThanOrEqual(0);
    }
    expect(d).toBe(0);
  });
});
