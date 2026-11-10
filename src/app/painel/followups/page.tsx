import Link from "next/link";
import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import { formatarDataHora } from "@/lib/time";
import { mascararTelefone } from "@/lib/phone";
import { auditar } from "@/lib/audit";
import { Cabecalho, Status } from "../_components/ui";

const TIPOS: Record<string, string> = {
  pos_servico: "Pesquisa pós-serviço",
  nao_compareceu: "Não compareceu",
  revisao_periodica: "Revisão periódica",
  lead_sem_agendamento: "Lead sem agendamento",
  pos_evento: "Pós-evento",
};

async function cancelar(formData: FormData) {
  "use server";
  const u = await exigirAcesso("followups");
  const id = String(formData.get("id"));
  await db().from("followups").update({ status: "cancelado", resultado: `cancelado por ${u.email}` }).eq("id", id).eq("status", "pendente");
  await auditar(u.email, "cancelar_followup", "followup", id);
  revalidatePath("/painel/followups");
}

export default async function Followups({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await exigirAcesso("followups");
  const cfg = await getConfig();
  const { s = "pendente" } = await searchParams;
  const { data } = await db()
    .from("followups")
    .select("id, tipo, agendar_para, status, tentativas, enviado_em, resultado, clientes(nome, telefone)")
    .eq("status", s)
    .order("agendar_para", { ascending: s === "pendente" })
    .limit(200);

  return (
    <>
      <Cabecalho
        titulo="Follow-ups"
        sub={`Automáticos: pós-serviço em ${cfg.followup.pos_servico_dias} dia(s), não compareceu em ${cfg.followup.nao_compareceu_horas}h, revisão ${cfg.followup.revisao_aviso_dias} dias antes, lead em ${cfg.followup.lead_horas}h. Máx. ${cfg.followup.max_tentativas} tentativa(s), sem insistência.`}
      />
      <div className="filtros">
        {["pendente", "enviado", "respondido", "sem_consentimento", "falhou", "cancelado"].map((x) => (
          <Link key={x} href={`/painel/followups?s=${x}`} className={s === x ? "ativo" : ""}>{x.replace("_", " ")}</Link>
        ))}
      </div>
      <div className="tabela-wrap">
        <table className="tabela">
          <thead><tr><th>Cliente</th><th>Tipo</th><th>Quando</th><th>Status</th><th>Detalhe</th><th></th></tr></thead>
          <tbody>
            {((data ?? []) as unknown as { id: string; tipo: string; agendar_para: string; status: string; tentativas: number; enviado_em: string | null; resultado: string | null; clientes: { nome: string | null; telefone: string } | null }[]).map((f) => (
              <tr key={f.id}>
                <td>{f.clientes?.nome ?? "—"}<div className="mudo">{mascararTelefone(f.clientes?.telefone ?? "")}</div></td>
                <td>{TIPOS[f.tipo] ?? f.tipo}</td>
                <td className="num">{formatarDataHora(f.enviado_em ?? f.agendar_para, cfg.fuso_offset)}</td>
                <td><Status valor={f.status} /></td>
                <td className="mudo">{f.resultado ?? "—"}</td>
                <td className="dir">
                  {f.status === "pendente" && (
                    <form action={cancelar}><input type="hidden" name="id" value={f.id} /><button className="btn pequeno">Cancelar</button></form>
                  )}
                </td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={6} className="mudo">Nada aqui.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
