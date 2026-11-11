import { Suspense } from "react";
import Link from "next/link";
import { contarNaoLidas } from "@/lib/notificacoes";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/auth";
import { authClient } from "@/lib/supabase/server";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import Nav from "./_components/Nav";
import Marca from "./_components/Marca";
import Icone from "./_components/Icone";
import AlertaFila from "./_components/AlertaFila";
import AlertaNotificacoes from "./_components/AlertaNotificacoes";
import { atendeFila, ROTULO_PAPEL, ROTULO_SETOR } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

async function sair() {
  "use server";
  const supa = await authClient();
  await supa.auth.signOut();
  redirect("/login");
}

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const u = await exigirAcesso();
  const [{ count }, cfg, naoLidas] = await Promise.all([
    db().from("conversas").select("id", { count: "exact", head: true }).eq("status", "humano").is("assumida_por", null),
    getConfig(),
    contarNaoLidas(u.id),
  ]);
  const atende = atendeFila(u);

  return (
    <div className="app">
      <aside className="lateral">
        <Marca nome={cfg.empresa.nome} logoUrl={cfg.empresa.logo_url} />
        <Nav papel={u.papel} setor={u.setor} fila={count ?? 0} />
        <div className="lateral-rodape">
          <div className="avatar">{u.nome.slice(0, 1).toUpperCase()}</div>
          <div className="lateral-usuario">
            <div><Link href="/painel/conta" title="Minha conta: trocar senha" className="link-conta">{u.nome}</Link></div>
            <span className="mudo" title={`${ROTULO_PAPEL[u.papel]} · ${ROTULO_SETOR[u.setor]}`}>{ROTULO_PAPEL[u.papel]}</span>
          </div>
          <Link href="/painel/notificacoes" className="sino" title="Notificações" aria-label={`Notificações${naoLidas ? ` (${naoLidas} não lidas)` : ""}`}>
            <Icone nome="sino" />
            {naoLidas > 0 && <span className="sino-contador">{naoLidas > 99 ? "99+" : naoLidas}</span>}
          </Link>
          <form action={sair}>
            <button type="submit" title="Sair" aria-label="Sair"><Icone nome="sair" /></button>
          </form>
        </div>
      </aside>
      <main className="conteudo">{children}</main>
      <AlertaNotificacoes />
      {atende && (
        <Suspense fallback={null}>
          <AlertaFila />
        </Suspense>
      )}
    </div>
  );
}
