import { SENHA_DEMO } from "@/db/seed";
import { FormLogin } from "./form-login";

const CONTAS_DEMO = [
  ["admin@comauto.demo", "Administrador"],
  ["gerente@comauto.demo", "Gerente"],
  ["carla@comauto.demo", "Vendedora"],
  ["posvenda@comauto.demo", "Pós-venda"],
];

export default function Login() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-marca">CRM Comauto</h1>
        <p className="mt-1 text-sm text-zinc-500">Entre com seu e-mail e senha.</p>

        <FormLogin />

        <div className="mt-8 rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-sm">
          <p className="font-medium">Protótipo: contas de demonstração</p>
          <p className="mt-1 text-zinc-500">
            Senha de todas: <code className="font-mono">{SENHA_DEMO}</code>. Dados fictícios.
          </p>
          <ul className="mt-2 space-y-1">
            {CONTAS_DEMO.map(([email, papel]) => (
              <li key={email} className="flex justify-between gap-2">
                <code className="font-mono text-xs">{email}</code>
                <span className="text-zinc-500">{papel}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
