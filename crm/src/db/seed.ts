import bcrypt from "bcryptjs";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { calcularPontuacao } from "@/lib/score";
import * as schema from "./schema";

// Dados fictícios para a demonstração. Nenhum dado real de cliente.
export const SENHA_DEMO = "comauto123";

const DIA = 24 * 60 * 60 * 1000;

function diasAPartirDeHoje(dias: number): string {
  return new Date(Date.now() + dias * DIA).toISOString().slice(0, 10);
}

export async function popularDemonstracao(db: PgliteDatabase<typeof schema>) {
  const existentes = await db.select({ id: schema.usuarios.id }).from(schema.usuarios).limit(1);
  if (existentes.length > 0) return;

  const senhaHash = await bcrypt.hash(SENHA_DEMO, 10);

  const usuarios = await db
    .insert(schema.usuarios)
    .values([
      { nome: "Administrador", email: "admin@comauto.demo", funcao: "admin", loja: "Montenegro", senhaHash },
      { nome: "Marcos Gerente", email: "gerente@comauto.demo", funcao: "gerente", loja: "Montenegro", senhaHash },
      { nome: "Carla Souza", email: "carla@comauto.demo", funcao: "vendedor", loja: "Montenegro", senhaHash },
      { nome: "Diego Schmitt", email: "diego@comauto.demo", funcao: "vendedor", loja: "Montenegro", senhaHash },
      { nome: "Paula Becker", email: "paula@comauto.demo", funcao: "vendedor", loja: "Portão", senhaHash },
      { nome: "Rafael Pós-venda", email: "posvenda@comauto.demo", funcao: "posvenda", loja: "Montenegro", senhaHash },
    ])
    .returning();

  const vendedores = usuarios.filter((u) => u.funcao === "vendedor");

  const base: Omit<typeof schema.leads.$inferInsert, "pontuacao" | "vendedorId">[] = [
    { nome: "João Pereira", telefone: "(51) 99811-2201", origem: "Site VW", loja: "Montenegro", interesse: "T-Cross Highline 0km", etapa: "em_atendimento", testDrive: true, querFinanciar: true },
    { nome: "Ana Lima", telefone: "(51) 99702-3312", origem: "Instagram", loja: "Montenegro", interesse: "Polo Track 0km", etapa: "novo" },
    { nome: "Carlos Weber", telefone: "(51) 98123-4455", origem: "Indicação", loja: "Montenegro", interesse: "Amarok V6", etapa: "proposta", temTroca: true, testDrive: true },
    { nome: "Fernanda Rocha", telefone: "(51) 99654-1100", origem: "Webmotors", loja: "Portão", interesse: "Onix 2021 (seminovo)", etapa: "em_atendimento", querFinanciar: true },
    { nome: "Lucas Kunz", telefone: "(51) 99300-8877", origem: "WhatsApp", loja: "Montenegro", interesse: "Nivus Comfortline", etapa: "novo", temTroca: true },
    { nome: "Mariana Hoff", telefone: "(51) 98442-6620", origem: "Oficina", loja: "Montenegro", interesse: "Tera 0km", etapa: "em_atendimento", clienteDaCasa: true, temTroca: true },
    { nome: "Pedro Alves", telefone: "(51) 99121-0099", origem: "Instagram", loja: "Montenegro", interesse: "Saveiro Robust", etapa: "novo" },
    { nome: "Juliana Matte", telefone: "(51) 99876-5544", origem: "OLX", loja: "Portão", interesse: "HB20 2020 (seminovo)", etapa: "novo", querFinanciar: true },
    { nome: "Roberto Klein", telefone: "(51) 98765-1234", origem: "Loja", loja: "Montenegro", interesse: "Virtus Exclusive", etapa: "proposta", testDrive: true, querFinanciar: true },
    { nome: "Camila Dias", telefone: "(51) 99555-7788", origem: "Site Comauto", loja: "Montenegro", interesse: "Polo Highline", etapa: "em_atendimento" },
    { nome: "Thiago Brum", telefone: "(51) 99444-3322", origem: "Instagram", loja: "Portão", interesse: "Gol 2019 (seminovo)", etapa: "perdido" },
    { nome: "Beatriz Fuhr", telefone: "(51) 98333-2211", origem: "Telefone", loja: "Montenegro", interesse: "Taos Highline", etapa: "ganho", testDrive: true, temTroca: true },
    { nome: "Gustavo Reis", telefone: "(51) 99222-1100", origem: "Site VW", loja: "Montenegro", interesse: "Jetta GLI", etapa: "novo", clienteDaCasa: true },
    { nome: "Larissa Prates", telefone: "(51) 99111-0022", origem: "Webmotors", loja: "Portão", interesse: "T-Cross 2022 (seminovo)", etapa: "em_atendimento", temTroca: true },
    { nome: "Eduardo Lenz", telefone: "(51) 98999-4433", origem: "Instagram", loja: "Montenegro", interesse: "Polo Track 0km", etapa: "novo" },
    { nome: "Patrícia Sauer", telefone: "(51) 98888-7766", origem: "Indicação", loja: "Portão", interesse: "Nivus 2023 (seminovo)", etapa: "proposta", querFinanciar: true },
  ];

  const leads = await db
    .insert(schema.leads)
    .values(
      base.map((l, i) => {
        // Portão vai para a vendedora de lá; Montenegro alterna entre os dois.
        const daLoja = vendedores.filter((v) => v.loja === l.loja);
        const vendedor = daLoja[i % daLoja.length];
        return {
          ...l,
          vendedorId: vendedor.id,
          criadoEm: new Date(Date.now() - (i % 6) * DIA),
          pontuacao: calcularPontuacao({
            origem: l.origem,
            testDrive: l.testDrive ?? false,
            temTroca: l.temTroca ?? false,
            querFinanciar: l.querFinanciar ?? false,
            clienteDaCasa: l.clienteDaCasa ?? false,
          }),
        };
      }),
    )
    .returning();

  const tipos = ["WhatsApp", "Ligação", "Visita"];
  const descricoes = [
    "Enviar proposta com simulação de financiamento",
    "Confirmar horário do test drive",
    "Retornar sobre avaliação do usado",
    "Primeiro contato: apresentar condições",
    "Follow-up D+1: tirar dúvidas",
  ];

  await db.insert(schema.acoes).values(
    leads
      .filter((l) => l.etapa !== "ganho" && l.etapa !== "perdido")
      .map((l, i) => ({
        leadId: l.id,
        vendedorId: l.vendedorId!,
        tipo: tipos[i % tipos.length],
        descricao: descricoes[i % descricoes.length],
        // Algumas vencidas, outras para hoje e amanhã.
        venceEm: new Date(Date.now() + ((i % 4) - 1) * 4 * 60 * 60 * 1000),
      })),
  );

  await db.insert(schema.revisoes).values([
    { clienteNome: "Sandra Möller", telefone: "(51) 99700-1111", veiculo: "Polo 2023", placa: "IYT-2A31", ultimaRevisao: diasAPartirDeHoje(-350), proximaRevisao: diasAPartirDeHoje(15), garantiaAte: diasAPartirDeHoje(380) },
    { clienteNome: "Jorge Hendges", telefone: "(51) 99700-2222", veiculo: "T-Cross 2022", placa: "JAB-4C12", ultimaRevisao: diasAPartirDeHoje(-400), proximaRevisao: diasAPartirDeHoje(-35), garantiaAte: diasAPartirDeHoje(90) },
    { clienteNome: "Rita Engel", telefone: "(51) 99700-3333", veiculo: "Virtus 2024", placa: "JCD-9E87", ultimaRevisao: diasAPartirDeHoje(-180), proximaRevisao: diasAPartirDeHoje(185), garantiaAte: diasAPartirDeHoje(900), status: "agendado" },
    { clienteNome: "Mauro Petry", telefone: "(51) 99700-4444", veiculo: "Nivus 2022", placa: "IZZ-1F45", ultimaRevisao: diasAPartirDeHoje(-370), proximaRevisao: diasAPartirDeHoje(-5), garantiaAte: diasAPartirDeHoje(30) },
    { clienteNome: "Helena Zimmer", telefone: "(51) 99700-5555", veiculo: "Saveiro 2023", placa: "JBX-7G02", ultimaRevisao: diasAPartirDeHoje(-330), proximaRevisao: diasAPartirDeHoje(35), garantiaAte: diasAPartirDeHoje(420), status: "contatado" },
    { clienteNome: "Otávio Rauber", telefone: "(51) 99700-6666", veiculo: "Amarok 2021", placa: "IXW-3H66", ultimaRevisao: diasAPartirDeHoje(-500), proximaRevisao: diasAPartirDeHoje(-135) },
    { clienteNome: "Cláudia Wolf", telefone: "(51) 99700-7777", veiculo: "Taos 2024", placa: "JDE-5J19", ultimaRevisao: diasAPartirDeHoje(-355), proximaRevisao: diasAPartirDeHoje(10), garantiaAte: diasAPartirDeHoje(760) },
  ]);
}
