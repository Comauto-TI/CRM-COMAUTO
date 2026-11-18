"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { exigirEscrita, SomenteLeituraError } from "@/lib/acesso";
import type { EstadoAcao } from "./fila";

export async function marcarContatado(_: EstadoAcao, formData: FormData): Promise<EstadoAcao> {
  const revisaoId = Number(formData.get("revisaoId"));
  try {
    await exigirEscrita(`Marcar revisão #${revisaoId} como contatada`, "posvenda");
    const db = await getDb();
    await db
      .update(schema.revisoes)
      .set({ status: "contatado", atualizadoEm: new Date() })
      .where(eq(schema.revisoes.id, revisaoId));
  } catch (e) {
    if (e instanceof SomenteLeituraError) return { erro: e.message };
    throw e;
  }
  revalidatePath("/revisoes");
}
