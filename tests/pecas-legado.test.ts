import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as conversaGet } from "@/app/api/painel/conversa/[id]/route";
import { GET as inboxGet } from "@/app/api/painel/inbox/route";
import { GET as filaGet } from "@/app/api/painel/fila/route";
import { puxarParaHumano, responder, enviarRetomada } from "@/app/painel/conversas/actions";
import { assumirConversa, devolverAoBot, encerrarConversa, transferirParaHumano, verificarSLA, alertarRecepcao } from "@/lib/handoff";

type Linha = Record<string, unknown>;
type Consulta = { tabela: string; operacao: string; selecao: string; filtros: [string, string, unknown][]; patch?: Linha };
const fixture = vi.hoisted(() => ({
  db: vi.fn(), usuarioApi: vi.fn(), exigirAcesso: vi.fn(), getConfig: vi.fn(), auditar: vi.fn(),
  responderLivre: vi.fn(), notificar: vi.fn(), enviarTemplate: vi.fn(), revalidatePath: vi.fn(),
  tabelas: {} as Record<string, Linha[]>, pilotos: new Set<string>(), consultas: [] as Consulta[],
  falhaUpdate: false, falhaView: false, pilotarDuranteFicha: false, pilotarAposListaSla: false, pilotarDuranteAlertaSla: false,
}));
vi.mock("@/lib/supabase/admin", () => ({ db: fixture.db }));
vi.mock("@/lib/auth", () => ({ usuarioApi: fixture.usuarioApi, exigirAcesso: fixture.exigirAcesso }));
vi.mock("@/lib/config", () => ({ getConfig: fixture.getConfig }));
vi.mock("@/lib/audit", () => ({ auditar: fixture.auditar }));
vi.mock("@/lib/messaging/outbound", () => ({ responderLivre: fixture.responderLivre, notificar: fixture.notificar }));
vi.mock("@/lib/whatsapp/client", () => ({ enviarTemplate: fixture.enviarTemplate }));
vi.mock("@/lib/env", () => ({ env: () => ({ APP_URL: "http://localhost:3000" }), valoresSecretos: () => [] }));
vi.mock("@/lib/usuarios", () => ({ tabelaUsuarios: async () => "usuarios" }));
vi.mock("@/lib/time", () => ({ dentroHorarioEnvio: () => true, janela24hAberta: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidatePath }));

const email = "recepcao@example.test";
const piloto = "10000000-0000-4000-8000-000000000001";
const legado = "10000000-0000-4000-8000-000000000002";
const clientePiloto = "10000000-0000-4000-8000-000000000101";
const clienteLegado = "10000000-0000-4000-8000-000000000102";
const quem = { email, papel: "recepcao" };

// O fake representa respostas do recorte SQL, não prova a implementação das views/trigger.
// Ele rejeita SELECT direto em conversas/mensagens para capturar um fallback indevido.
function consulta(tabela: string) {
  const c: Consulta = { tabela, operacao: "select", selecao: "", filtros: [] };
  let unica = false;
  let contar = false;
  let head = false;
  let max = Number.POSITIVE_INFINITY;
  let ordem: { campo: string; asc: boolean } | undefined;
  const b = {
    select(selecao: string, opts?: { count?: string; head?: boolean }) { c.selecao = selecao; contar = !!opts?.count; head = !!opts?.head; return b; },
    update(patch: Linha) { c.operacao = "update"; c.patch = patch; return b; },
    insert(patch: Linha) { c.operacao = "insert"; c.patch = patch; return b; },
    eq(k: string, v: unknown) { c.filtros.push([k, "eq", v]); return b; },
    neq(k: string, v: unknown) { c.filtros.push([k, "neq", v]); return b; },
    is(k: string, v: unknown) { c.filtros.push([k, "eq", v]); return b; },
    not(k: string, _op: string, v: unknown) { c.filtros.push([k, "neq", v]); return b; },
    in(k: string, v: unknown[]) { c.filtros.push([k, "in", v]); return b; },
    lte(k: string, v: unknown) { c.filtros.push([k, "lte", v]); return b; },
    gte(k: string, v: unknown) { c.filtros.push([k, "gte", v]); return b; },
    or(v: string) { c.filtros.push(["", "or", v]); return b; },
    order(campo: string, opts?: { ascending: boolean }) { ordem = { campo, asc: opts?.ascending ?? true }; return b; },
    limit(v: number) { max = v; return b; },
    single() { unica = true; return b; },
    maybeSingle() { unica = true; return b; },
    then<T>(resolve: (r: { data: Linha | Linha[] | null; error: { code: string } | null; count: number | null }) => T) {
      fixture.consultas.push(structuredClone(c));
      if (c.operacao === "select" && ["conversas", "mensagens"].includes(tabela)) throw new Error("Leitura física legada fora da view");
      if ((fixture.falhaUpdate && c.operacao === "update") || (fixture.falhaView && tabela === "conversas_legadas")) {
        return Promise.resolve(resolve({ data: null, error: { code: "55000" }, count: null }));
      }
      let linhas = fixture.tabelas[tabela] ?? [];
      if (tabela === "conversas_legadas") linhas = fixture.tabelas.conversas.filter(r => !fixture.pilotos.has(String(r.id))).map(r => {
        const cliente = fixture.tabelas.clientes.find(cl => cl.id === r.cliente_id);
        return { ...r, cliente_nome: cliente?.nome, cliente_telefone: cliente?.telefone };
      });
      if (tabela === "mensagens_legadas") linhas = fixture.tabelas.mensagens.filter(r => !fixture.pilotos.has(String(r.conversa_id)));
      linhas = linhas.filter(r => c.filtros.every(([k, op, v]) => {
        if (op === "eq") return r[k] === v;
        if (op === "neq") return r[k] !== v;
        if (op === "in") return (v as unknown[]).includes(r[k]);
        if (op === "lte") return r[k] != null && String(r[k]) <= String(v);
        if (op === "gte") return r[k] != null && String(r[k]) >= String(v);
        if (op === "or") {
          if (String(v).startsWith("assumida_por")) return r.assumida_por == null || r.assumida_por === email;
          const termo = String(v).match(/ilike\.%([^%]*)%/)?.[1].toLowerCase() ?? "";
          return String(r.cliente_nome).toLowerCase().includes(termo) || String(r.cliente_telefone).includes(termo);
        }
        return true;
      }));
      if (ordem) {
        const { campo, asc } = ordem;
        linhas = [...linhas].sort((a, z) => String(a[campo]).localeCompare(String(z[campo])) * (asc ? 1 : -1));
      }
      const count = contar ? linhas.length : null;
      linhas = linhas.slice(0, max);
      if (c.operacao === "update") for (const r of linhas) Object.assign(r, c.patch);
      if (c.operacao === "insert") { fixture.tabelas[tabela] ??= []; fixture.tabelas[tabela].push(c.patch!); }
      // SELECTs retornam snapshots como a API real, sem reter referência ao objeto da fixture.
      const data = structuredClone(head ? null : unica ? linhas[0] ?? null : linhas);
      if (fixture.pilotarDuranteFicha && tabela === "clientes") fixture.pilotos.add(legado);
      if (fixture.pilotarAposListaSla && tabela === "conversas_legadas" && c.selecao.includes("motivo_transferencia") && !unica) fixture.pilotos.add(legado);
      if (fixture.pilotarDuranteAlertaSla && c.operacao === "update" && c.patch?.alerta_reenviado_em) fixture.pilotos.add(legado);
      return Promise.resolve(resolve({ data, error: null, count }));
    },
  };
  return b;
}

beforeEach(() => {
  vi.resetAllMocks();
  fixture.consultas = [];
  fixture.pilotos = new Set([piloto]);
  fixture.falhaUpdate = fixture.falhaView = fixture.pilotarDuranteFicha = fixture.pilotarAposListaSla = fixture.pilotarDuranteAlertaSla = false;
  const base = { status: "humano", assumida_por: null, aguardando_desde: "2020-01-01T00:00:00Z", alerta_reenviado_em: null, nao_lidas: 7, encerrada_em: null, ultima_msg_em: "2026-11-11T12:00:00Z", resultado: null };
  fixture.tabelas = {
    conversas: [{ ...base, id: piloto, cliente_id: clientePiloto }, { ...base, id: legado, cliente_id: clienteLegado }],
    clientes: [{ id: clientePiloto, nome: "Lead Peças", telefone: "5511999990001" }, { id: clienteLegado, nome: "Lead Recepção", telefone: "5511999990002" }],
    mensagens: [{ id: "msg-piloto", conversa_id: piloto, conteudo: "Segredo setorial", criado_em: "2026-11-11T12:01:00Z" }, { id: "msg-legado", conversa_id: legado, conteudo: "Olá recepção", criado_em: "2026-11-11T12:00:00Z" }],
    usuarios: [{ nome: "Recepção", telefone_whatsapp: "5511999990099", ativo: true, recebe_alertas: true, consentimento_alertas_em: "2026-01-01" }],
    templates: [{ uso: "alerta_recepcao", nome: "alerta", idioma: "pt_BR", status_aprovacao: "aprovado", ativo: true }],
  };
  fixture.db.mockReturnValue({ from: consulta });
  fixture.usuarioApi.mockResolvedValue({ email });
  fixture.exigirAcesso.mockResolvedValue({ email, nome: "Recepção", papel: "recepcao", setor: "oficina" });
  fixture.getConfig.mockResolvedValue({ empresa: { nome: "Comauto" }, atendimento: { sla_min: 15, msg_sla: "Aguarde o atendimento", msg_transferencia: "Transferindo", msg_fora_horario: "Fora do horário" }, horario_envio: {}, fuso_offset: -3 });
  fixture.responderLivre.mockResolvedValue({ ok: true, wamid: "wamid.mock" });
  fixture.notificar.mockResolvedValue({ ok: true, wamid: "wamid.template" });
  fixture.enviarTemplate.mockResolvedValue({ ok: true, wamid: "wamid.alerta" });
});

const detalhe = (id: string) => conversaGet(new NextRequest("http://localhost/api/painel/conversa/" + id), { params: Promise.resolve({ id }) });
const atualizacoes = () => fixture.consultas.filter(c => c.operacao === "update");

describe("piloto Peças fora das leituras gerais", () => {
  it("ID conhecido do piloto retorna404 sem ficha, mensagens ou reset do contador", async () => {
    expect((await detalhe(piloto)).status).toBe(404);
    expect(fixture.consultas.map(c => c.tabela)).toEqual(["conversas_legadas"]);
    expect(atualizacoes()).toHaveLength(0);
    expect(fixture.tabelas.conversas[0].nao_lidas).toBe(7);
  });
  it("adesão durante a ficha retorna404 e não zera contador", async () => {
    fixture.pilotarDuranteFicha = true;
    const r = await detalhe(legado);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("Lead");
    expect(atualizacoes()).toHaveLength(0);
  });
  it("recepção continua lendo e marcando o canal que não aderiu", async () => {
    const r = await detalhe(legado);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.cliente.nome).toBe("Lead Recepção");
    expect(body.mensagens.map((m: Linha) => m.id)).toEqual(["msg-legado"]);
    expect(fixture.tabelas.conversas[1].nao_lidas).toBe(0);
    expect(fixture.tabelas.conversas[0].nao_lidas).toBe(7);
  });
  it("falha da view não recorre ao canal físico", async () => {
    fixture.falhaView = true;
    expect((await detalhe(legado)).status).toBe(503);
    expect(atualizacoes()).toHaveLength(0);
  });
  it("inbox conta e mostra só legado e mantém prévia/telefone mascarado", async () => {
    const r = await inboxGet(new NextRequest("http://localhost/api/painel/inbox?aba=espera"));
    const body = await r.json();
    expect(body.contagem.espera).toBe(1);
    expect(body.itens.map((i: Linha) => i.id)).toEqual([legado]);
    expect(body.itens[0].cliente).toBe("Lead Recepção");
    expect(body.itens[0].ultimaMsg).toBe("Olá recepção");
    expect(body.itens[0].telefone).not.toBe("5511999990002");
    expect(JSON.stringify(body)).not.toContain("Segredo setorial");
  });
  it("busca do inbox usa campos planos e não depende de embedding da view", async () => {
    const body = await (await inboxGet(new NextRequest("http://localhost/api/painel/inbox?q=Recepção"))).json();
    expect(body.itens).toHaveLength(1);
    expect(fixture.consultas.some(c => c.selecao.includes("clientes("))).toBe(false);
    expect(fixture.consultas.some(c => c.filtros.some(([, op, v]) => op === "or" && String(v).startsWith("cliente_nome.ilike")))).toBe(true);
  });
  it("fila/popup não anuncia o canal do piloto", async () => {
    const body = await (await filaGet()).json();
    expect(body.aguardando.map((i: Linha) => i.id)).toEqual([legado]);
    expect(body.emAtendimento).toEqual([]);
    expect(fixture.usuarioApi).toHaveBeenCalledExactlyOnceWith("atendimento");
  });
  it.each([detalhe, async () => filaGet(), async () => inboxGet(new NextRequest("http://localhost/api/painel/inbox"))])("mantém a autenticação geral", async get => {
    fixture.usuarioApi.mockResolvedValue(null);
    expect((await get(legado)).status).toBe(401);
    expect(fixture.consultas).toHaveLength(0);
  });
});

describe("piloto não passa pelas ações gerais", () => {
  it.each([
    () => assumirConversa(piloto, email),
    () => devolverAoBot(piloto, quem),
    () => encerrarConversa(piloto, quem, "resolvido"),
    () => puxarParaHumano(piloto),
    () => responder(piloto, "Olá, como posso ajudar?"),
    () => enviarRetomada(piloto),
    () => transferirParaHumano(clientePiloto, "motivo"),
  ])("nega sem mutação, envio ou auditoria", async executar => {
    expect(await executar()).toMatchObject({ ok: false });
    expect(atualizacoes()).toHaveLength(0);
    expect(fixture.responderLivre).not.toHaveBeenCalled();
    expect(fixture.notificar).not.toHaveBeenCalled();
    expect(fixture.auditar).not.toHaveBeenCalled();
  });
  it("não libera após devolver o slot modular: a adesão histórica permanece", async () => {
    // A view depende do atendimento persistido, e não da posse física ou do slot ativo.
    fixture.tabelas.conversas[0].status = "bot";
    expect(await puxarParaHumano(piloto)).toMatchObject({ ok: false });
    expect((await detalhe(piloto)).status).toBe(404);
  });
  it("erro do trigger não vira replay de posse bem-sucedido", async () => {
    fixture.tabelas.conversas[1].assumida_por = email;
    fixture.falhaUpdate = true;
    expect(await assumirConversa(legado, email)).toMatchObject({ ok: false });
    expect(fixture.auditar).not.toHaveBeenCalled();
  });
  it.each([() => devolverAoBot(legado, quem), () => encerrarConversa(legado, quem, "resolvido"), () => puxarParaHumano(legado)])("falha SQL impede falsa conclusão e auditoria", async executar => {
    fixture.falhaUpdate = true;
    expect(await executar()).toMatchObject({ ok: false });
    expect(fixture.auditar).not.toHaveBeenCalled();
  });
  it("recepção assume e responde no legado sem tocar o piloto", async () => {
    expect(await responder(legado, "Olá, como posso ajudar?")).toEqual({ ok: true });
    expect(fixture.tabelas.conversas[1].assumida_por).toBe(email);
    expect(fixture.tabelas.conversas[0].assumida_por).toBeNull();
    expect(fixture.responderLivre).toHaveBeenCalledExactlyOnceWith({ clienteId: clienteLegado, texto: "Olá, como posso ajudar?", autor: "atendente", metadata: { atendente: email } });
  });
  it("retomada normal continua usando o serviço compartilhado", async () => {
    expect(await enviarRetomada(legado)).toEqual({ ok: true });
    expect(fixture.notificar).toHaveBeenCalledExactlyOnceWith({ clienteId: clienteLegado, uso: "retomada_atendimento", valores: ["Lead", "Comauto"], preferirLivre: false });
  });
  it("devolução e encerramento normais continuam preservando outros canais", async () => {
    expect(await devolverAoBot(legado, quem)).toEqual({ ok: true });
    expect(fixture.tabelas.conversas[1].status).toBe("bot");
    expect(fixture.tabelas.conversas[0].status).toBe("humano");
    fixture.tabelas.conversas[1].status = "humano";
    expect(await encerrarConversa(legado, quem, "resolvido")).toEqual({ ok: true });
    expect(fixture.tabelas.conversas[1].status).toBe("encerrada");
  });
  it("transferência sem alteração efetiva não avisa nem audita", async () => {
    fixture.tabelas.conversas[1].status = "bot";
    fixture.falhaUpdate = true;
    expect(await transferirParaHumano(clienteLegado, "teste")).toMatchObject({ ok: false });
    expect(fixture.responderLivre).not.toHaveBeenCalled();
    expect(fixture.auditar).not.toHaveBeenCalled();
  });
});

describe("SLA e alertas da recepção", () => {
  it("ignora piloto antes de contar/enviar e mantém SLA do legado", async () => {
    expect(await verificarSLA()).toEqual({ reenviados: 1 });
    expect(fixture.responderLivre).toHaveBeenCalledExactlyOnceWith({ clienteId: clienteLegado, autor: "sistema", texto: "Aguarde o atendimento" });
    expect(fixture.enviarTemplate).toHaveBeenCalledTimes(1);
    expect(fixture.tabelas.conversas[0].alerta_reenviado_em).toBeNull();
    expect(fixture.tabelas.conversas[1].alerta_reenviado_em).toBeTruthy();
  });
  it("adesão depois da listagem não gera alerta ou contagem", async () => {
    fixture.pilotarAposListaSla = true;
    expect(await verificarSLA()).toEqual({ reenviados: 0 });
    expect(fixture.responderLivre).not.toHaveBeenCalled();
    expect(fixture.enviarTemplate).not.toHaveBeenCalled();
  });
  it("falha ao registrar alerta impede envio e não conta sucesso", async () => {
    fixture.falhaUpdate = true;
    expect(await verificarSLA()).toEqual({ reenviados: 0 });
    expect(fixture.responderLivre).not.toHaveBeenCalled();
    expect(fixture.enviarTemplate).not.toHaveBeenCalled();
  });
  it("adesão antes do envio final também retira o canal do SLA", async () => {
    fixture.pilotarDuranteAlertaSla = true;
    expect(await verificarSLA()).toEqual({ reenviados: 0 });
    expect(fixture.responderLivre).not.toHaveBeenCalled();
    expect(fixture.enviarTemplate).not.toHaveBeenCalled();
  });
  it("chamada direta de alerta não divulga canal do piloto à recepção", async () => {
    expect(await alertarRecepcao(piloto, clientePiloto, "Peças")).toEqual({ enviados: 0, motivo: "conversa_indisponivel" });
    expect(fixture.enviarTemplate).not.toHaveBeenCalled();
  });
});
