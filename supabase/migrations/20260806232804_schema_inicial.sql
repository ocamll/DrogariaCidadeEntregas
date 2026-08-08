-- =====================================================================
-- Sistema de Tele-entrega — Schema inicial
-- Postgres 15+ / Supabase
--
-- Rodar como migration:
--   supabase migration new schema_inicial
--   (colar este conteúdo no arquivo gerado)
--   supabase db reset
--
-- CONVENÇÕES
--   - Dinheiro sempre em centavos, integer. Nunca float/numeric.
--   - tenant_id em toda tabela, mesmo com uma farmácia só.
--   - IDs de entregas/corridas vêm do CLIENTE (UUID v7). O default abaixo
--     é só rede de segurança — o frontend deve sempre enviar o próprio id.
--   - Nada é deletado. Cancelamento é mudança de status.
-- =====================================================================

create extension if not exists pgcrypto;


-- =====================================================================
-- 1. TABELAS BASE
-- =====================================================================

create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  cnpj        text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

create table public.lojas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  nome        text not null,
  endereco    text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create index on public.lojas (tenant_id);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id),
  loja_id     uuid references public.lojas(id),
  nome        text not null,
  papel       text not null check (papel in ('caixa','gerente','admin','agencia','superadmin')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create index on public.profiles (tenant_id);
-- 'agencia' e 'superadmin' existem no check para não exigir migration depois.
-- Nenhuma policy os contempla ainda — isso é v2.


-- =====================================================================
-- 2. FUNÇÕES AUXILIARES DE CONTEXTO
--
-- SECURITY DEFINER para não causar recursão de RLS ao ler profiles.
-- Otimização futura: mover para custom claim no JWT via access token hook.
-- =====================================================================

create or replace function public.current_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid() and ativo;
$$;

create or replace function public.current_loja_id()
returns uuid language sql stable security definer set search_path = public as $$
  select loja_id from public.profiles where id = auth.uid() and ativo;
$$;

create or replace function public.current_papel()
returns text language sql stable security definer set search_path = public as $$
  select papel from public.profiles where id = auth.uid() and ativo;
$$;

-- gerente e admin têm os mesmos direitos de escrita ampla no MVP
create or replace function public.is_gerente()
returns boolean language sql stable as $$
  select public.current_papel() in ('gerente', 'admin');
$$;


-- =====================================================================
-- 3. CADASTROS
-- =====================================================================

create table public.agencias (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  nome        text not null,
  cnpj        text,
  contato     text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create index on public.agencias (tenant_id) where ativo;

create table public.mototaxistas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  agencia_id  uuid references public.agencias(id),
  nome        text not null,
  cpf         text,
  telefone    text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create index on public.mototaxistas (tenant_id) where ativo;
create index on public.mototaxistas (agencia_id);

create table public.convenios (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id),
  nome               text not null,
  cnpj               text,
  exige_assinatura   boolean not null default true,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now()
);
create index on public.convenios (tenant_id) where ativo;


-- =====================================================================
-- 4. CORRIDAS
--
-- Uma saída do mototaxista. Pode conter 1 ou N entregas.
-- A ASSINATURA PENDURA AQUI, não na entrega.
-- =====================================================================

create table public.corridas (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  loja_id         uuid not null references public.lojas(id),
  mototaxista_id  uuid not null references public.mototaxistas(id),
  agencia_id      uuid references public.agencias(id),

  status          text not null default 'aberta'
                    check (status in ('aberta','fechada','cancelada')),

  saida_em        timestamptz,
  saida_por       uuid references public.profiles(id),
  retorno_em      timestamptz,
  retorno_por     uuid references public.profiles(id),

  -- relógio do dispositivo (fila offline) vs. relógio do servidor
  saida_em_local  timestamptz,
  registrado_em   timestamptz not null default now()
);
create index on public.corridas (tenant_id, loja_id, registrado_em desc);
create index on public.corridas (tenant_id, status) where status = 'aberta';
create index on public.corridas (tenant_id, mototaxista_id, registrado_em desc);


-- =====================================================================
-- 5. ENTREGAS
--
-- Três eixos de status independentes. Não colapsar em um enum linear.
-- =====================================================================

create table public.entregas (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id),
  loja_id            uuid not null references public.lojas(id),
  corrida_id         uuid references public.corridas(id),

  numero_vale        text not null,
  romaneio_numero    text,              -- conferência com o Trier

  cliente_nome       text not null,
  cliente_endereco   text not null,
  cliente_telefone   text,

  valor_compra_cents   integer not null check (valor_compra_cents  >= 0),
  valor_entrega_cents  integer not null default 0 check (valor_entrega_cents >= 0),

  convenio_id        uuid references public.convenios(id),
  observacoes        text,

  status_entrega     text not null default 'pendente'
                       check (status_entrega in
                         ('pendente','em_rota','entregue','insucesso','cancelada')),

  status_financeiro  text not null default 'na_ordem'
                       check (status_financeiro in
                         ('na_ordem','divergente','conferido')),

  status_documental  text not null default 'nao_aplica'
                       check (status_documental in
                         ('nao_aplica','pendente','recebido','extraviado')),

  insucesso_motivo   text check (insucesso_motivo is null or insucesso_motivo in
                         ('ausente','endereco_errado','recusou','outro')),

  documento_recebido_em   timestamptz,
  documento_recebido_por  uuid references public.profiles(id),

  criado_por         uuid not null references public.profiles(id),
  ocorrido_em_local  timestamptz,        -- relógio do PC do caixa
  registrado_em      timestamptz not null default now(),  -- relógio do servidor
  atualizado_em      timestamptz not null default now(),

  cancelado_em            timestamptz,
  cancelado_por           uuid references public.profiles(id),
  motivo_cancelamento     text,

  constraint entrega_cancelada_tem_motivo check (
    status_entrega <> 'cancelada' or motivo_cancelamento is not null
  ),
  constraint entrega_insucesso_tem_motivo check (
    status_entrega <> 'insucesso' or insucesso_motivo is not null
  )
);

create index on public.entregas (tenant_id, loja_id, registrado_em desc);
create index on public.entregas (tenant_id, status_entrega)
  where status_entrega in ('pendente','em_rota');
create index on public.entregas (tenant_id, corrida_id);
create index on public.entregas (tenant_id, status_documental)
  where status_documental = 'pendente';
create index on public.entregas (tenant_id, cliente_telefone);  -- autocomplete

-- CONFIRMAR COM O CAIXA: o número do vale reinicia (diário? mensal?)?
-- Se for único por loja para sempre, este índice está correto:
create unique index entregas_vale_unico
  on public.entregas (tenant_id, loja_id, numero_vale)
  where status_entrega <> 'cancelada';
-- Se reinicia por dia, trocar pela linha abaixo:
-- create unique index entregas_vale_unico
--   on public.entregas (tenant_id, loja_id, numero_vale, (registrado_em::date))
--   where status_entrega <> 'cancelada';


-- =====================================================================
-- 6. PAGAMENTOS
--
-- Tabela, não coluna. Previsto vs. realizado.
-- A UI da v1 grava só o 'previsto' e libera 'realizado' quando diverge.
-- =====================================================================

create table public.pagamentos (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id),
  entrega_id      uuid not null references public.entregas(id),

  momento         text not null check (momento in ('previsto','realizado')),
  forma           text not null check (forma in
                    ('dinheiro','credito','debito','pix','convenio','vale','outro')),

  valor_cents     integer not null check (valor_cents >= 0),
  troco_cents     integer not null default 0 check (troco_cents >= 0),
  nsu             text,   -- autorização do cartão; guardar desde já, usar em v2

  registrado_por  uuid references public.profiles(id),
  registrado_em   timestamptz not null default now()
);
create index on public.pagamentos (tenant_id, entrega_id);


-- =====================================================================
-- 7. ASSINATURAS
--
-- Guardar OS TRAÇOS, não só a imagem. ~3-8 KB em JSONB.
-- Formato de strokes:
--   { "strokes": [ { "points": [[x, y, t], ...] } ],
--     "canvas": { "w": 600, "h": 200 },
--     "duracao_ms": 1840 }
-- =====================================================================

create table public.assinaturas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id),
  corrida_id     uuid not null references public.corridas(id),

  strokes        jsonb not null,
  png_path       text,          -- Storage, gerado só quando precisar imprimir
  hash_sha256    text not null, -- hash do JSON canônico da corrida no ato

  capturado_em   timestamptz not null default now(),
  dispositivo    text,
  user_agent     text
);
create unique index on public.assinaturas (corrida_id);
create index on public.assinaturas (tenant_id);


-- =====================================================================
-- 8. EVENTOS — append-only
-- =====================================================================

create table public.eventos (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants(id),
  entrega_id   uuid references public.entregas(id),
  corrida_id   uuid references public.corridas(id),
  tipo         text not null,
  payload      jsonb not null default '{}'::jsonb,
  user_id      uuid,
  ocorrido_em  timestamptz not null default now()
);
create index on public.eventos (tenant_id, entrega_id, ocorrido_em);
create index on public.eventos (tenant_id, corrida_id, ocorrido_em);


-- =====================================================================
-- 9. TRIGGERS
-- =====================================================================

-- 9.1 atualizado_em
create or replace function public.fn_touch_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

create trigger trg_entregas_touch
  before update on public.entregas
  for each row execute function public.fn_touch_atualizado_em();


-- 9.2 Imutabilidade após assinatura
-- Assinou = valor, cliente e vale congelam. Correção vira evento, não UPDATE.
create or replace function public.fn_entrega_imutavel()
returns trigger language plpgsql as $$
declare
  tem_assinatura boolean := false;
begin
  if old.corrida_id is not null then
    select exists (select 1 from public.assinaturas a where a.corrida_id = old.corrida_id)
      into tem_assinatura;
  end if;

  if not tem_assinatura then
    return new;
  end if;

  if new.valor_compra_cents  is distinct from old.valor_compra_cents
  or new.valor_entrega_cents is distinct from old.valor_entrega_cents
  or new.cliente_nome        is distinct from old.cliente_nome
  or new.cliente_endereco    is distinct from old.cliente_endereco
  or new.numero_vale         is distinct from old.numero_vale
  then
    raise exception
      'Entrega % já assinada: valor, cliente e vale são imutáveis. Registre uma correção.',
      old.numero_vale using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_entregas_imutavel
  before update on public.entregas
  for each row execute function public.fn_entrega_imutavel();


-- 9.3 Log automático de criação e mudança de status
create or replace function public.fn_log_entrega()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.eventos (tenant_id, entrega_id, tipo, payload, user_id)
    values (new.tenant_id, new.id, 'entrega_criada',
            jsonb_build_object('numero_vale', new.numero_vale,
                               'valor_compra_cents', new.valor_compra_cents),
            auth.uid());

  elsif new.status_entrega is distinct from old.status_entrega
     or new.status_financeiro is distinct from old.status_financeiro
     or new.status_documental is distinct from old.status_documental then
    insert into public.eventos (tenant_id, entrega_id, tipo, payload, user_id)
    values (new.tenant_id, new.id, 'status_alterado',
            jsonb_build_object(
              'de', jsonb_build_object('entrega', old.status_entrega,
                                       'financeiro', old.status_financeiro,
                                       'documental', old.status_documental),
              'para', jsonb_build_object('entrega', new.status_entrega,
                                         'financeiro', new.status_financeiro,
                                         'documental', new.status_documental)),
            auth.uid());
  end if;

  return new;
end;
$$;

create trigger trg_entregas_log
  after insert or update on public.entregas
  for each row execute function public.fn_log_entrega();


-- =====================================================================
-- 10. ROW LEVEL SECURITY
--
-- Regra de leitura: caixa vê só a própria loja; gerente/admin veem o tenant.
-- Ausência de policy = negado. Não há policy de DELETE em lugar nenhum.
-- =====================================================================

alter table public.tenants      enable row level security;
alter table public.lojas        enable row level security;
alter table public.profiles     enable row level security;
alter table public.agencias     enable row level security;
alter table public.mototaxistas enable row level security;
alter table public.convenios    enable row level security;
alter table public.corridas     enable row level security;
alter table public.entregas     enable row level security;
alter table public.pagamentos   enable row level security;
alter table public.assinaturas  enable row level security;
alter table public.eventos      enable row level security;

-- --- tenants / lojas / profiles ---------------------------------------
create policy tenants_select on public.tenants for select to authenticated
  using (id = public.current_tenant_id());

create policy lojas_select on public.lojas for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy profiles_select on public.profiles for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy profiles_update_admin on public.profiles for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_gerente())
  with check (tenant_id = public.current_tenant_id());

-- --- cadastros: leitura ampla, escrita só gerente ----------------------
create policy agencias_select on public.agencias for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy agencias_write on public.agencias for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_gerente())
  with check (tenant_id = public.current_tenant_id());

create policy mototaxistas_select on public.mototaxistas for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy mototaxistas_write on public.mototaxistas for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_gerente())
  with check (tenant_id = public.current_tenant_id());

create policy convenios_select on public.convenios for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy convenios_write on public.convenios for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_gerente())
  with check (tenant_id = public.current_tenant_id());

-- --- corridas ---------------------------------------------------------
create policy corridas_select on public.corridas for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_gerente() or loja_id = public.current_loja_id())
  );

create policy corridas_insert on public.corridas for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (public.is_gerente() or loja_id = public.current_loja_id())
  );

create policy corridas_update on public.corridas for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_gerente() or loja_id = public.current_loja_id())
  )
  with check (tenant_id = public.current_tenant_id());

-- --- entregas ---------------------------------------------------------
create policy entregas_select on public.entregas for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_gerente() or loja_id = public.current_loja_id())
  );

create policy entregas_insert on public.entregas for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (public.is_gerente() or loja_id = public.current_loja_id())
    and criado_por = auth.uid()
  );

create policy entregas_update on public.entregas for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_gerente() or loja_id = public.current_loja_id())
  )
  with check (tenant_id = public.current_tenant_id());

-- --- pagamentos -------------------------------------------------------
create policy pagamentos_select on public.pagamentos for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy pagamentos_insert on public.pagamentos for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

-- Sem policy de UPDATE: pagamento registrado não se altera.
-- Correção = novo registro 'realizado' + evento.

-- --- assinaturas: insert e select, nunca update ------------------------
create policy assinaturas_select on public.assinaturas for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy assinaturas_insert on public.assinaturas for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

-- --- eventos: append-only ---------------------------------------------
create policy eventos_select on public.eventos for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy eventos_insert on public.eventos for insert to authenticated
  with check (tenant_id = public.current_tenant_id());


-- =====================================================================
-- 11. GRANTS E REALTIME
-- =====================================================================

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- Nenhum DELETE concedido em lugar nenhum. Proposital.

-- Realtime para a lista do dia (PC ↔ tablet)
alter publication supabase_realtime add table public.entregas;
alter publication supabase_realtime add table public.corridas;


-- =====================================================================
-- 12. SEED — desenvolvimento apenas
--
-- Criar o usuário no Supabase Auth primeiro, depois rodar o insert de
-- profiles com o UUID real de auth.users.
-- =====================================================================

insert into public.tenants (id, nome, cnpj)
values ('11111111-1111-1111-1111-111111111111', 'Farmácia Exemplo', null);

insert into public.lojas (id, tenant_id, nome, endereco)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'Matriz', 'Rua Exemplo, 100');

insert into public.agencias (id, tenant_id, nome, contato)
values ('33333333-3333-3333-3333-333333333333',
        '11111111-1111-1111-1111-111111111111',
        'Ágil Motos', '(55) 99999-0000');

insert into public.mototaxistas (tenant_id, agencia_id, nome, telefone)
values ('11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333',
        'João Silva', '(55) 98888-0000'),
       ('11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333',
        'Pedro Souza', '(55) 98888-1111');

insert into public.convenios (tenant_id, nome, exige_assinatura)
values ('11111111-1111-1111-1111-111111111111', 'Unimed', true),
       ('11111111-1111-1111-1111-111111111111', 'Prefeitura', true);

-- Depois de criar o usuário no Auth, rodar:
-- insert into public.profiles (id, tenant_id, loja_id, nome, papel)
-- values ('<uuid-do-auth.users>',
--         '11111111-1111-1111-1111-111111111111',
--         '22222222-2222-2222-2222-222222222222',
--         'Camilo', 'admin');


-- =====================================================================
-- FORA DESTE SCHEMA — v2 em diante, não criar agora
--
--   fechamentos          fechamento mensal por agência + PDF
--   tarifas_bairro       tarifário automático de entrega
--   policy 'agencia'     portal de leitura para a agência (view com
--                        colunas restritas: SEM endereço, SEM telefone)
--   assinaturas.cadeia   encadeamento de hash diário
--   mototaxistas.pin     PIN de confirmação de identidade
-- =====================================================================
