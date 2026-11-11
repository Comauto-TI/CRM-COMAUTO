import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next 16: "proxy" (antigo middleware). Só renova a sessão e faz a checagem OTIMISTA
 * de login. A autorização de verdade é feita no servidor por exigirAcesso().
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Desempenho: getClaims valida o JWT localmente quando o projeto usa chaves assimétricas (sem ida ao Supabase);
  // com chave antiga (HS256) ele mesmo cai para a consulta ao servidor. Continua renovando a sessão.
  // A autorização de verdade segue no servidor (exigirAcesso → getUser + tabela usuarios).
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && request.nextUrl.pathname.startsWith("/painel")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/painel/:path*", "/api/painel/:path*", "/login"],
};
