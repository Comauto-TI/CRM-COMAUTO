import { exigirAcesso } from "@/lib/auth";
import { vendedoresDaUnidade } from "@/modulos/vendas/dados";
import { Cabecalho } from "../../_components/ui";
import Importador from "./Importador";

export default async function ImportarClientes() {
  const u = await exigirAcesso("importacao");
  const vendedores = await vendedoresDaUnidade(u.unidade);
  return (
    <>
      <Cabecalho titulo="Importar clientes" sub="Planilha do Bravus ou de qualquer sistema · nada é sobrescrito · importar não autoriza mensagens automáticas (LGPD)" />
      <Importador vendedores={vendedores} />
    </>
  );
}
