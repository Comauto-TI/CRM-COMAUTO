import Link from "next/link";
import { revalidatePath } from "next/cache";
import { exigirAcesso } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { listarNotificacoes, marcarLidas, linkInternoSeguro } from "@/lib/notificacoes";
import { nucleoAplicado } from "@/lib/usuarios";
import { formatarDataHora } from "@/lib/time";
import { Cabecalho, Vazio } from "../_components/ui";

const COR_TIPO: Record<string, string> = { atendimento: "aviso", lead: "info", pecas: "aviso", alerta: "erro", aniversario: "ok", tarefa: "", sistema: "ia" };

async function marcarTodas() {
  "use server";
  const u = await exigirAcesso("notificacoes");
  await marcarLidas(u.id);
  revalidatePath("/painel", "layout");
}

export default async function Notificacoes() {
  const u = await exigirAcesso("notificacoes");
  const [lista, cfg, pronto] = await Promise.all([listarNotificacoes(u.id), getConfig(), nucleoAplicado()]);
  const naoLidas = lista.filter((n) => !n.lida_em).length;

  return (
    <>
      <Cabecalho titulo="Notificações" sub={naoLidas ? `${naoLidas} não lida(s)` : "Tudo em dia"}>
        {naoLidas > 0 && (
          <form action={marcarTodas}><button className="btn">Marcar todas como lidas</button></form>
        )}
      </Cabecalho>
      {!pronto && <div className="alerta aviso">A central de notificações será ativada quando a atualização do banco (núcleo) for aplicada.</div>}
      {pronto && lista.length === 0 && <Vazio>Nenhuma notificação por aqui. Leads novos, atendimentos e aniversários aparecem nesta tela.</Vazio>}
      {lista.length > 0 && (
        <div className="card">
          <ul className="lista-notificacoes">
            {lista.map((n) => {
              const link = linkInternoSeguro(n.link);
              return (
                <li key={n.id} className={n.lida_em ? "lida" : ""}>
                  <span className={`tag ${COR_TIPO[n.tipo] ?? ""}`}>{n.tipo}</span>
                  <div>
                    <strong>{link ? <Link href={link}>{n.titulo}</Link> : n.titulo}</strong>
                    {n.corpo && <div className="mudo">{n.corpo}</div>}
                  </div>
                  <span className="mudo">{formatarDataHora(n.criado_em, cfg.fuso_offset)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
