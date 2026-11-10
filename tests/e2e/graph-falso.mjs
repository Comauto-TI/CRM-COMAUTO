import { randomUUID } from "node:crypto";

const fetchOriginal = globalThis.fetch;
globalThis.fetch = async function fetchComGraphFalso(input, init) {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://graph.facebook.com/")) return fetchOriginal(input, init);

  // Todo tráfego para o Graph é interceptado neste processo de teste.
  const corpo = JSON.parse(init?.body ?? "{}");
  if (init?.method !== "POST" || corpo.type !== "text" || !/^55119000000\d{2}$/.test(corpo.to ?? "")) {
    return Response.json({ error: { message: "Graph de teste só aceita resposta ao cliente demo" } }, { status: 400 });
  }

  return Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.e2e." + randomUUID() }] });
};

