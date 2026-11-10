import { Suspense } from "react";
import { redirect } from "next/navigation";
import { exigirPapel } from "@/lib/auth";
import { authClient } from "@/lib/supabase/server";
import { db } from "@/lib/supabase/admin";
import { getConfig } from "@/lib/config";
import Nav from "./_components/Nav";
import Marca from "./_components/Marca";
import Icone from "./_components/Icone";
import AlertaFila from "./_components/AlertaFila";

export const dynamic = "force-dynamic";

async function sair() {
  "use server";
  const supa = await authClient();
  await supa.auth.signOut();
  redirect("/login");
}

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const u = await exigirPapel();
  const [{ count }, cfg] = await Promise.all([
    db().from("conversas").select("id", { count: "exact", head: true }).eq("status", "humano").is("assumida_por", null),
    getConfig(),
  ]);
  const atende = u.papel === "admin" || u.papel === "atendente";

  return (
    <div className="app">
      <aside className="lateral">
        <Marca nome={cfg.empresa.nome} logoUrl={cfg.empresa.logo_url} />
        <Nav papel={u.papel} fila={count ?? 0} />
        <div className="lateral-rodape">
          <div className="avatar">{u.nome.slice(0, 1).toUpperCase()}</div>
          <div className="lateral-usuario">
            <div>{u.nome}</div>
            <span className="mudo">{u.papel}</span>
          </div>
          <form action={sair}>
            <button type="submit" title="Sair" aria-label="Sair"><Icone nome="sair" /></button>
          </form>
        </div>
      </aside>
      <main className="conteudo">{children}</main>
      {atende && (
        <Suspense fallback={null}>
          <AlertaFila />
        </Suspense>
      )}
    </div>
  );
}
