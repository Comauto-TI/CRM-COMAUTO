import { Eye } from "lucide-react";
import { sair } from "@/app/actions/auth";
import { encerrarVerComo } from "@/app/actions/ver-como";
import { Menu } from "@/components/menu";
import { getAcesso } from "@/lib/acesso";
import { MENU, NOME_FUNCAO } from "@/lib/funcoes";

export default async function LayoutApp({ children }: LayoutProps<"/">) {
  const { usuario, visao, somenteLeitura } = await getAcesso();

  return (
    <>
      {somenteLeitura && (
        <div className="bg-amber-400 text-amber-950">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
            <p className="flex items-center gap-2">
              <Eye className="size-4 shrink-0" aria-hidden />
              <span>
                Visualizando como <strong>{visao.nome}</strong> ({NOME_FUNCAO[visao.funcao]},{" "}
                {visao.loja}). Somente leitura.
              </span>
            </p>
            <form action={encerrarVerComo}>
              <button
                type="submit"
                className="rounded-md bg-amber-950 px-3 py-1 font-medium text-amber-50 hover:bg-amber-900"
              >
                Voltar para o admin
              </button>
            </form>
          </div>
        </div>
      )}

      <header className="bg-marca text-white">
        <div className="mx-auto max-w-6xl px-4 pt-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">CRM Comauto</span>
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-white/75 sm:inline">
                {usuario.nome} · {NOME_FUNCAO[usuario.funcao]}
              </span>
              <form action={sair}>
                <button type="submit" className="text-white/75 hover:text-white">
                  Sair
                </button>
              </form>
            </div>
          </div>
          <div className="mt-2">
            <Menu itens={MENU[visao.funcao]} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
