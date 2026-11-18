import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE = "comauto_sessao";
const DURACAO_MS = 8 * 60 * 60 * 1000; // um turno de trabalho

export type Sessao = {
  usuarioId: number;
  // Preenchido quando um admin está usando "Ver como".
  verComoUsuarioId?: number;
};

function chave() {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("SESSION_SECRET não definido em .env.local");
  return new TextEncoder().encode(segredo);
}

export async function lerSessao(): Promise<Sessao | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, chave(), { algorithms: ["HS256"] });
    if (typeof payload.usuarioId !== "number") return null;
    return {
      usuarioId: payload.usuarioId,
      verComoUsuarioId:
        typeof payload.verComoUsuarioId === "number" ? payload.verComoUsuarioId : undefined,
    };
  } catch {
    return null;
  }
}

export async function gravarSessao(sessao: Sessao) {
  const expira = new Date(Date.now() + DURACAO_MS);
  const token = await new SignJWT({ ...sessao })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expira)
    .sign(chave());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expira,
  });
}

export async function apagarSessao() {
  (await cookies()).delete(COOKIE);
}
