import { chromium, expect } from '@playwright/test';

const ROTAS = {
  vendas: ['/painel/vendas', 'Vendas'], pecas: ['/painel/pecas', 'Peças'],
  metricas: ['/painel/metricas', 'Métricas'], importar: ['/painel/clientes/importar', 'Importar clientes'],
  agenda: ['/painel/agendamentos', 'Agendamentos'], financeiro: ['/painel/financeiro', 'Financeiro'],
};
export const PERFIS_QA = {
  admin: { prefixo: /^admin(?:\.teste)?$/, titulo: 'Administrador · Administração', areas: ['vendas','pecas','metricas','importar','agenda','financeiro'] },
  gerente_vendas: { prefixo: /^gerente\.vendas(?:\.teste)?$/, titulo: 'Gerente · Vendas', areas: ['vendas','metricas','importar'], meuDia: true },
  vendedor: { prefixo: /^vendedor\.teste$/, titulo: 'Vendedor · Vendas', areas: ['vendas','metricas'], meuDia: true },
  gerente_pecas: { prefixo: /^gerente\.pecas(?:\.teste)?$/, titulo: 'Gerente · Peças', areas: ['pecas'] },
  pecas: { prefixo: /^pecas\.teste$/, titulo: 'Peças · Peças', areas: ['pecas'] },
  recepcao: { prefixo: /^recepcao\.teste$/, titulo: 'Recepção · Oficina', areas: ['agenda'] },
  consultor: { prefixo: /^consultor\.teste$/, titulo: 'Consultor técnico · Oficina', areas: ['agenda'] },
  financeiro: { prefixo: /^financeiro\.teste$/, titulo: 'Financeiro · Administração', areas: ['financeiro','metricas'] },
};

/** QA de leitura em servidor já iniciado. Nunca cria dados, assume cartões ou envia mensagens. */
export async function executarPerfil({ perfil, email, senha, baseURL = 'http://localhost:3000', executablePath, somenteTela }) {
  const cfg = PERFIS_QA[perfil];
  const base = new URL(baseURL);
  if (!cfg || base.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(base.hostname) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw Error('configuracao_qa_invalida');
  const casos = [], bloqueadas = [];
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  let loginPermitido = false;
  await context.route('**/*', async route => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== base.origin) return route.abort();
    if (/^\/api\/painel\/conversa\//.test(url.pathname)) { bloqueadas.push('GET contador geral'); return route.abort(); }
    if (['GET','HEAD'].includes(r.method())) return route.continue();
    if (loginPermitido && r.method() === 'POST' && url.pathname === '/login') return route.continue();
    bloqueadas.push(r.method() + ' ' + url.pathname); return route.abort();
  });
  const page = await context.newPage();
  const limpar = e => String(e?.message ?? 'Falha na verificação').split(senha).join('[OMITIDO]').split(email).join('[LOGIN OMITIDO]').replace(/\x1b\[[0-9;]*m/g,'').slice(0,700);
  async function caso(nome, fn) {
    if (somenteTela && nome !== somenteTela) return;
    try { const nota = await fn(); casos.push({ tela: nome, resultado: nota?.skip ? 'skip' : 'passou', observacao: nota?.observacao ?? null }); }
    catch(e) { casos.push({ tela: nome, resultado: 'falhou', observacao: limpar(e) }); }
  }
  try {
    await page.goto(base.origin + '/login', { waitUntil: 'domcontentloaded' });
    // Erros de fill são substituídos: o call log do Playwright pode conter o valor preenchido.
    try { await page.getByLabel('E-mail',{exact:true}).fill(email); await page.getByLabel('Senha',{exact:true}).fill(senha); }
    catch { throw Error('formulario_login_indisponivel'); }
    loginPermitido = true;
    try { await page.getByRole('button',{name:/^(Entrar|Entrar no painel)$/,exact:true}).click(); await expect(page).toHaveURL(u=>u.pathname==='/painel',{timeout:20000}); }
    finally { loginPermitido = false; }
    await expect(page.locator('.lateral-usuario > span[title]')).toHaveAttribute('title',cfg.titulo,{timeout:10000});
    casos.push({tela:'Login e identidade do perfil',resultado:'passou',observacao:null});
    await caso('Menu esperado e URLs proibidas', async () => {
      const menu = page.getByRole('navigation',{name:'Menu principal'});
      while (await menu.locator('button[aria-expanded="false"]').count()) await menu.locator('button[aria-expanded="false"]').first().click();
      for (const [area,[rota]] of Object.entries(ROTAS)) {
        await expect(menu.locator(`a[href="${rota}"]`)).toHaveCount(cfg.areas.includes(area)?1:0);
      }
      for (const [area,[rota]] of Object.entries(ROTAS)) if (!cfg.areas.includes(area)) {
        await page.goto(base.origin+rota,{waitUntil:'domcontentloaded'});
        await expect(page).toHaveURL(u=>u.pathname==='/painel'&&u.searchParams.get('erro')==='sem_permissao');
      }
    });
    await caso('Visão geral / Meu dia / setores', async () => {
      await page.goto(base.origin+'/painel',{waitUntil:'domcontentloaded'});
      await expect(page.getByRole('heading',{name:/^Olá,/})).toBeVisible();
      await expect(page.getByRole('heading',{name:'Meu dia',exact:true})).toHaveCount(cfg.meuDia?1:0);
      for (const [area,rota] of [['vendas','/painel/vendas'],['pecas','/painel/pecas'],['agenda','/painel/agendamentos']]) {
        await expect(page.locator(`a.setor-cartao[href="${rota}"]`)).toHaveCount(cfg.areas.includes(area)?1:0);
      }
    });
    for (const setor of ['vendas','pecas']) {
      if (!cfg.areas.includes(setor)) continue;
      await caso(`Quadro ${setor}`, async () => {
        await page.goto(base.origin+ROTAS[setor][0],{waitUntil:'domcontentloaded'});
        await expect(page.getByRole('heading',{name:ROTAS[setor][1],exact:true})).toBeVisible();
        await expect(page.locator('.kanban:visible').first()).toBeVisible();
      });
      await caso(`Painel de conversa ${setor}`, async () => {
        const card = page.locator('a.kanban-cartao:visible').first();
        if (!await card.count()) return {skip:true,observacao:'Quadro autorizado sem cartão visível; nenhum registro criado para o teste.'};
        const href = await card.getAttribute('href');
        if (!href || !href.startsWith('/painel/'+setor)) throw Error('link_cartao_invalido');
        const destino = new URL(href,base.origin), id = destino.searchParams.get(setor==='vendas'?'op':'cotacao');
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw Error('identidade_cartao_invalida');
        await page.goto(destino.href,{waitUntil:'domcontentloaded'});
        await expect(page.getByRole('region',{name:'Conversa de '+(setor==='vendas'?'Vendas':'Peças'),exact:true})).toBeVisible();
        // Apenas as APIs modulares de leitura; a API geral que marca contador nunca é chamada.
        const r=await page.request.get(base.origin+`/api/painel/${setor}/${id}/conversa`);
        const d=await r.json();
        if (d?.codigo==='sem_responsavel') return {skip:true,observacao:'Cartão sem responsável: painel abriu, mas conversa exige assumir o domínio; ação fora da rodada readonly.'};
        if(r.status()!==200 || d?.ok!==true || !Array.isArray(d.mensagens)) throw Error('dialogo_modular_nao_carregou');
        return {observacao:d.mensagens.length?'Painel e diálogo autorizado abriram; nenhuma mensagem enviada.':'Painel abriu com diálogo autorizado vazio; nenhuma mensagem enviada.'};
      });
    }
    for (const area of ['metricas','importar','agenda','financeiro']) if (cfg.areas.includes(area)) {
      await caso(ROTAS[area][1],async()=>{
        await page.goto(base.origin+ROTAS[area][0],{waitUntil:'domcontentloaded'});
        await expect(page.getByRole('heading',{name:area==='metricas'?/^(Métricas|Minhas métricas)/:ROTAS[area][1],exact:area!=='metricas'})).toBeVisible();
        if(area==='metricas'&&perfil==='vendedor') {
          await expect(page.locator('select[name="vendedor"]')).toHaveCount(0);
          await expect(page.getByText(/só seus resultados|suas oportunidades|Sua carteira|Seus resultados/i).first()).toBeVisible();
          return {observacao:'Tela pessoal e filtro de terceiros ausente; isolamento quantitativo entre carteiras depende de fixtures comparáveis.'};
        }
      });
    }
    if(bloqueadas.length) casos.push({tela:'Ausência de escritas/contador',resultado:'falhou',observacao:bloqueadas.join('; ')});
    else casos.push({tela:'Ausência de escritas/contador',resultado:'passou',observacao:'Somente login POST; navegação e APIs modulares GET.'});
  } catch(e) { casos.push({tela:'Login e identidade do perfil',resultado:'falhou',observacao:limpar(e)}); }
  finally { await context.close(); await browser.close(); }
  return {perfil,casos,registroUtc:new Date().toISOString(),ambiente:base.origin};
}
