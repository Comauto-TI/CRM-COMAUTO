"use client";

import { useActionState } from "react";
import { entrar } from "@/app/actions/auth";

export function FormLogin() {
  const [estado, acao, enviando] = useActionState(entrar, undefined);

  return (
    <form action={acao} className="mt-6 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-marca"
        />
      </div>
      <div>
        <label htmlFor="senha" className="block text-sm font-medium">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-marca"
        />
      </div>
      {estado?.erro && <p className="text-sm text-red-600">{estado.erro}</p>}
      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-md bg-marca px-3 py-2 font-medium text-white disabled:opacity-60"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
