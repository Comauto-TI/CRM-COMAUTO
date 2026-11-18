import { redirect } from "next/navigation";
import { getAcesso } from "@/lib/acesso";
import { inicioDaFuncao } from "@/lib/funcoes";

export default async function Inicio() {
  const { visao } = await getAcesso();
  redirect(inicioDaFuncao(visao.funcao));
}
