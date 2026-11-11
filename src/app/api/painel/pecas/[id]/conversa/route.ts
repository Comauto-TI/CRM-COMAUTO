import { NextResponse, type NextRequest } from "next/server";
import { usuarioApi } from "@/lib/auth";
import { obterDialogoPecas } from "@/modulos/pecas/atendimento";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const usuario = await usuarioApi("pecas");
  if (!usuario) return NextResponse.json({ ok: false, erro: "Acesso não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const resultado = await obterDialogoPecas(usuario, id);
  return NextResponse.json(resultado, {
    status: resultado.ok ? 200 : resultado.status,
    headers: { "Cache-Control": "no-store" },
  });
}
