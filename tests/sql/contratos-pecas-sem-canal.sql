-- Banco descartável: 0001/0002/0003/0005/0006; sem grants corretivos ou serviços remotos.
-- RPCs como service_role. Não prova concorrência multissessão, Auth ou transporte de mensagens.
begin;

create function pg_temp.sc_uuid(n integer) returns uuid language sql immutable as $$
  select ('de200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.sc_estado() returns jsonb language plpgsql as $$
declare tabela text; r jsonb := '{}'::jsonb; linhas jsonb;
begin
  foreach tabela in array array['clientes','usuarios','usuario_unidades','pecas_cotacoes','pecas_cotacao_itens',
    'pecas_cotacoes_historico','conversas','mensagens','atendimentos_modulares','atendimento_canais',
    'atendimento_mensagens','notificacoes','audit_log'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',tabela) into linhas;
    r := r || jsonb_build_object(tabela,linhas);
  end loop;
  return r;
end $$;
create function pg_temp.sc_ler(p_cotacao integer,p_ator integer) returns jsonb language plpgsql as $$
declare antes jsonb; r jsonb;
begin
  antes := pg_temp.sc_estado();
  set local role service_role;
  if current_user <> 'service_role' then raise exception 'RPC não executou como servidor.'; end if;
  r := public.pecas_dialogo(pg_temp.sc_uuid(p_cotacao),pg_temp.sc_uuid(p_ator));
  reset role;
  if antes is distinct from pg_temp.sc_estado() then raise exception 'GET alterou tabelas da fixture.'; end if;
  return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.sc_vazio(p_cotacao integer,p_ator integer,p_pode_assumir boolean,p_janela boolean default false)
returns void language plpgsql as $$
declare r jsonb; esperado jsonb; nome text;
begin
  select cl.nome into nome from public.pecas_cotacoes c join public.clientes cl on cl.id=c.cliente_id
    where c.id=pg_temp.sc_uuid(p_cotacao);
  r := pg_temp.sc_ler(p_cotacao,p_ator);
  esperado := jsonb_build_object('ok',true,'id',null,'cotacaoId',pg_temp.sc_uuid(p_cotacao),'versao',0,
    'clienteNome',coalesce(nome,'Cliente'),'estado','livre','podeAssumir',p_pode_assumir,'podeDevolver',false,
    'janelaAberta',p_janela,'mensagens','[]'::jsonb,'revisaoPendente',false);
  if r is distinct from esperado then raise exception 'DTO vazio incorreto para cotação % / ator %: %.',p_cotacao,p_ator,r; end if;
end $$;
create function pg_temp.sc_negar(p_cotacao integer,p_ator integer) returns void language plpgsql as $$
declare r jsonb;
begin
  r := pg_temp.sc_ler(p_cotacao,p_ator);
  if r is distinct from jsonb_build_object('ok',false,'codigo','nao_encontrado') then
    raise exception 'Cotação % / ator % deveria ser recusada sem DTO: %.',p_cotacao,p_ator,r;
  end if;
end $$;
create function pg_temp.sc_assumir(p_cotacao integer,p_ator integer) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r := public.pecas_assumir_atendimento(pg_temp.sc_uuid(p_cotacao),pg_temp.sc_uuid(p_ator),0);
  reset role;
  return r;
exception when others then reset role; raise;
end $$;
create function pg_temp.sc_negar_claim(p_cotacao integer,p_ator integer) returns void language plpgsql as $$
declare antes jsonb; r jsonb;
begin
  antes := pg_temp.sc_estado();
  r := pg_temp.sc_assumir(p_cotacao,p_ator);
  if r is distinct from jsonb_build_object('ok',false,'codigo','nao_encontrado') then
    raise exception 'Claim indevido deveria recusar: %.',r;
  end if;
  if antes is distinct from pg_temp.sc_estado() then raise exception 'Claim recusado criou canal ou efeitos parciais.'; end if;
end $$;

insert into public.unidades(chave,nome,ativa) values
  ('sc_a','Sem canal principal',true),('sc_b','Sem canal outra unidade',true),('sc_inativa','Sem canal inativa',false);
insert into auth.users(id) select pg_temp.sc_uuid(n) from generate_series(1,8)n;
insert into public.usuarios(user_id,nome,papel,setor,unidade,ativo) values
  (pg_temp.sc_uuid(1),'Peças responsável','pecas','pecas','sc_a',true),
  (pg_temp.sc_uuid(2),'Peças colega','pecas','pecas','sc_a',true),
  (pg_temp.sc_uuid(3),'Peças outra unidade','pecas','pecas','sc_b',true),
  (pg_temp.sc_uuid(4),'Peças inativo','pecas','pecas','sc_a',false),
  (pg_temp.sc_uuid(5),'Gerente Peças','gerente','pecas','sc_a',true),
  (pg_temp.sc_uuid(6),'Administrador','admin','administracao','sc_b',true),
  (pg_temp.sc_uuid(7),'Vendedor','vendedor','vendas','sc_a',true),
  (pg_temp.sc_uuid(8),'Gerente Oficina','gerente','oficina','sc_a',true);
insert into public.clientes(id,telefone,nome,unidade_origem,anonimizado,ultimo_contato_em)
select pg_temp.sc_uuid(n),'55119000'||lpad(n::text,5,'0'),'Cliente sem canal fictício '||n,'sc_a',n=104,
  case when n=102 then now() else null end
from generate_series(101,110)n;
insert into public.pecas_cotacoes(id,cliente_id,unidade,responsavel_id,descricao,status,motivo_encerramento)
select pg_temp.sc_uuid(n),pg_temp.sc_uuid(n-200),case when n=306 then 'sc_inativa' else 'sc_a' end,
  pg_temp.sc_uuid(case when n=307 then 3 when n=308 then 4 else 1 end),
  'Cotação sem canal fictícia '||n,case when n=302 then 'em_cotacao' when n=305 then 'cancelado' else 'novo' end,
  case when n=305 then 'Encerrada na fixture' else null end
from generate_series(301,310)n;
-- Controle de paridade: conversa já existe, mas ainda não há atendimento modular.
insert into public.conversas(id,cliente_id,unidade,status)
  values(pg_temp.sc_uuid(210),pg_temp.sc_uuid(110),'sc_a','bot');

-- Caso novo e em_cotacao aparecem no quadro, mas GET não cria nenhuma conversa/posse.
do $$ declare cotacao integer; r jsonb;
begin
  set local role service_role;
  r := public.pecas_quadro(pg_temp.sc_uuid(1));
  reset role;
  foreach cotacao in array array[301,302] loop
    if not exists(select 1 from jsonb_array_elements(r->'cotacoes') c where c->>'id'=pg_temp.sc_uuid(cotacao)::text) then
      raise exception 'Cotação própria sem canal não aparece no quadro.';
    end if;
  end loop;
  foreach cotacao in array array[301,302,303] loop
    if exists(select 1 from public.conversas where cliente_id=pg_temp.sc_uuid(cotacao-200)) then raise exception 'Fixture já possuía canal.'; end if;
    perform pg_temp.sc_vazio(cotacao,1,true,cotacao=302);
    perform pg_temp.sc_vazio(cotacao,5,false,cotacao=302);
    perform pg_temp.sc_vazio(cotacao,6,false,cotacao=302);
    perform pg_temp.sc_negar(cotacao,2);
    perform pg_temp.sc_negar(cotacao,3);
    perform pg_temp.sc_negar(cotacao,4);
    perform pg_temp.sc_negar(cotacao,7);
    perform pg_temp.sc_negar(cotacao,8);
  end loop;
  if exists(select 1 from public.conversas where cliente_id in(pg_temp.sc_uuid(101),pg_temp.sc_uuid(102),pg_temp.sc_uuid(103))) then
    raise exception 'Leitura própria/supervisão/recusa criou canal.';
  end if;
end $$;

-- Recusas isolam cliente, unidade, dono e atividade do usuário, sem depender só do gate de carteira.
select pg_temp.sc_negar(304,1); -- cliente anonimizado, próprio, unidade ativa
select pg_temp.sc_negar(304,5); -- supervisão também não recebe cliente anonimizado
select pg_temp.sc_negar(305,1); -- negócio encerrado, próprio, cliente válido
select pg_temp.sc_negar(305,6); -- admin não reabre negócio encerrado pelo GET
select pg_temp.sc_negar(306,6); -- unidade inativa, mesmo para administrador
select pg_temp.sc_negar(307,3); -- é dono, mas sem acesso à unidade atual da cotação
select pg_temp.sc_negar(308,4); -- é dono e está na unidade, mas usuário inativo
select pg_temp.sc_negar_claim(301,2);
select pg_temp.sc_negar_claim(307,3);
select pg_temp.sc_negar_claim(308,4);
select pg_temp.sc_negar_claim(304,1);
select pg_temp.sc_negar_claim(305,1);

-- Anonimização entre a leitura autorizada e a tentativa seguinte é revalidada, não cria canal.
select pg_temp.sc_vazio(309,1,true);
update public.clientes set anonimizado=true where id=pg_temp.sc_uuid(109);
select pg_temp.sc_negar(309,1);
select pg_temp.sc_negar(309,5);
select pg_temp.sc_negar_claim(309,1);

-- O caminho com conversa existente mantém o DTO livre e não cria atendimento no GET.
select pg_temp.sc_vazio(310,1,true);
select pg_temp.sc_vazio(310,5,false);

-- Só o claim versão zero cria canal/atendimento/slot; não há reserva nem envio de mensagem neste contrato.
do $$ declare cotacao integer; r jsonb; ticket uuid; canal uuid;
begin
  foreach cotacao in array array[301,302] loop
    r := pg_temp.sc_assumir(cotacao,1);
    if r->>'ok' is distinct from 'true' or r->>'estado' is distinct from 'minha' or (r->>'versao')::integer is distinct from 1
      or r->>'cotacaoId' is distinct from pg_temp.sc_uuid(cotacao)::text then raise exception 'Claim0 sem canal falhou: %.',r; end if;
    ticket := (r->>'id')::uuid;
    select id into canal from public.conversas where cliente_id=pg_temp.sc_uuid(cotacao-200);
    if canal is null or not exists(select 1 from public.atendimentos_modulares a
      join public.atendimento_canais s on s.atendimento_id=a.id and s.conversa_id=a.conversa_id
      where a.id=ticket and a.cotacao_id=pg_temp.sc_uuid(cotacao) and a.conversa_id=canal
        and a.assumido_por=pg_temp.sc_uuid(1) and a.dono_na_posse=pg_temp.sc_uuid(1) and a.versao=1) then
      raise exception 'Claim retornou sucesso sem criar vínculo/posse/canal coerentes.';
    end if;
    r := pg_temp.sc_ler(cotacao,1);
    if r->>'ok' is distinct from 'true' or r->>'id' is distinct from ticket::text or r->>'estado' is distinct from 'minha'
      or r->'podeAssumir' is distinct from 'false'::jsonb or r->'podeDevolver' is distinct from 'true'::jsonb or r->'mensagens' is distinct from '[]'::jsonb then
      raise exception 'Diálogo pós-claim perdeu o contrato atual: %.',r;
    end if;
    r := pg_temp.sc_ler(cotacao,5);
    if r->>'ok' is distinct from 'true' or r->>'estado' is distinct from 'outra' or r->'podeAssumir' is distinct from 'false'::jsonb then
      raise exception 'Supervisão ganhou capacidade de assumir carteira alheia.';
    end if;
    perform pg_temp.sc_negar(cotacao,2);
  end loop;
  if exists(select 1 from public.mensagens) then raise exception 'Contrato de leitura/claim criou mensagens.'; end if;
end $$;

-- Revalidado pelo harness após reaplicar 0005/0006 com esses dados ainda presentes.
create function pg_temp.sc_verificar_reaplicacao() returns void language plpgsql as $$
declare r jsonb; cotacao integer;
begin
  perform pg_temp.sc_vazio(303,1,true);
  perform pg_temp.sc_vazio(303,5,false);
  perform pg_temp.sc_vazio(310,1,true);
  perform pg_temp.sc_negar(303,2);
  perform pg_temp.sc_negar(304,1);
  perform pg_temp.sc_negar(305,1);
  perform pg_temp.sc_negar(307,3);
  perform pg_temp.sc_negar(308,4);
  perform pg_temp.sc_negar(309,1);
  foreach cotacao in array array[301,302] loop
    r := pg_temp.sc_ler(cotacao,1);
    if r->>'ok' is distinct from 'true' or r->>'estado' is distinct from 'minha' or (r->>'versao')::integer is distinct from 1 then
      raise exception 'Reaplicação perdeu o atendimento já assumido: %.',r;
    end if;
  end loop;
  if exists(select 1 from public.conversas where cliente_id in(pg_temp.sc_uuid(103),pg_temp.sc_uuid(104),pg_temp.sc_uuid(109))) then
    raise exception 'Leitura/reaplicação criou canal indevido.';
  end if;
end $$;
select pg_temp.sc_verificar_reaplicacao();
rollback;
