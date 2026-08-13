-- =====================================================================
-- Cidade da filial e da agência
--
-- Regra da operação (confirmada com o usuário em 2026-08-13): em cada
-- cidade UMA agência de tele atende TODAS as filiais dali. São Gabriel/RS
-- tem Matriz, Filial 02, 04 e 10, e uma única agência faz as corridas de
-- todas. Uma agência de Alegrete não pode aparecer para São Gabriel.
--
-- Por que tabela e não `cidade text` nas duas pontas: a associação
-- filial↔agência passaria a depender de duas strings baterem exatamente
-- ("São Gabriel" ≠ "Sao Gabriel" ≠ "SÃO GABRIEL"). Um acento errado
-- desassociaria a agência em silêncio, e o que quebra é o acerto de
-- dinheiro. Com FK, ou está associado ou não está.
--
-- O que esta migration NÃO faz, de propósito:
--
--   * não cria constraint de "uma agência por cidade". O usuário disse
--     "por enquanto vamos supor que é assim"; travar isso no banco criaria
--     uma migration de desfazer no dia em que a suposição cair. Quem se
--     adapta é o relatório: com uma agência só no resultado, o nível some
--     da tela; com mais de uma, ele volta.
--   * não mexe em `corridas.agencia_id`. Ela continua sendo a verdade de
--     quem fez cada corrida. Cidade serve pra filtrar e organizar, nunca
--     pra reescrever o passado — se uma agência mudar de cidade amanhã, os
--     acertos antigos continuam certos.
-- =====================================================================

create table public.cidades (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id),
  nome       text not null,
  uf         text not null check (char_length(uf) = 2),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
create index on public.cidades (tenant_id);

-- nullable nas duas: filial e agência que já existem não têm cidade até
-- alguém dizer qual é, e o app precisa continuar funcionando enquanto
-- isso não acontece (ver o seed no fim).
alter table public.lojas    add column cidade_id uuid references public.cidades(id);
alter table public.agencias add column cidade_id uuid references public.cidades(id);

-- --- RLS (regra 3: tabela nova não sai sem policy) ---------------------
-- Leitura ampla no tenant, escrita só do admin — mesmo padrão dos outros
-- cadastros. A leitura precisa ser ampla porque o caixa escolhe agência em
-- "Nova corrida", e esse dropdown passa a filtrar por cidade.
--
-- `is_admin()` nos DOIS lados: numa policy `for all`, o `using` governa
-- SELECT/UPDATE/DELETE e o `with check` governa INSERT. Restringir só o
-- `using` fecharia a edição e deixaria a criação aberta.
alter table public.cidades enable row level security;

create policy cidades_select on public.cidades for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy cidades_write on public.cidades for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

-- --- seed: São Gabriel/RS ----------------------------------------------
-- As duas filiais que existem hoje são de São Gabriel, e as agências
-- cadastradas atendem elas. Sem isto, a tela abriria com todo mundo "sem
-- cidade" e o filtro por agência não teria o que mostrar.
--
-- Quando entrarem filiais de outras cidades, o caminho é o mesmo dos
-- lojas: insert manual aqui (cidade é ainda mais rara que filial).
insert into public.cidades (tenant_id, nome, uf)
select t.id, 'São Gabriel', 'RS' from public.tenants t;

update public.lojas l
set cidade_id = c.id
from public.cidades c
where c.tenant_id = l.tenant_id and c.nome = 'São Gabriel' and l.cidade_id is null;

update public.agencias a
set cidade_id = c.id
from public.cidades c
where c.tenant_id = a.tenant_id and c.nome = 'São Gabriel' and a.cidade_id is null;
