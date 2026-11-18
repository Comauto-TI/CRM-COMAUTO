"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { exigirEscrita, SomenteLeituraError } from "@/lib/acesso";

export type EstadoAcao = { erro?: string } | undefined;

export async function concluirAcao(_: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const acaoId = Number(formData.get("acaoId"));
  try {
    const { usuario } = await exigirEscrita(`Concluir ação #${acaoId}`, "vendedor");
    const db = await getDb();
    await db
      .update(schema.acoes)
      .set({ concluidaEm: new Date() })
      .where(and(eq(schema.acoes.id, acaoId), eq(schema.acoes.vendedorId, usuario.id)));
  } catch (e) {
    if (e instanceof SomenteLeituraError) return { erro: e.message };
    throw e;
  }
  revalidatePath("/fila");
}
