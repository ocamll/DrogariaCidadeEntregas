-- =====================================================================
-- E1.1 — BUSCA SEM ACENTO
--
-- O E1 congelou dois contratos opostos:
--
--     normalizarNome()       melhora a ENTRADA, preserva semântica
--     normalizarParaBusca()  melhora a PESQUISA, ignora diferença
--                            visual irrelevante
--
-- A regra: **persistência preserva o que foi digitado; busca é
-- tolerante.** O E1 não inventa acento porque isso alteraria o dado; o
-- filtro pode ignorá-lo porque não altera nada — só decide quais
-- registros correspondem.
--
-- O lado do navegador já existe (`normalizarParaBusca`, `casaComBusca`).
-- Esta migration é o lado do SERVIDOR, e ele é o que importa: a tela de
-- Histórico filtra pelo banco, paginado, então nenhuma função de front
-- alcança aquele resultado.
--
-- ---------------------------------------------------------------------
-- O DEFEITO QUE JÁ ESTÁ NO APP
--
-- `src/data/entregas.ts` filtra com `ilike`, que ignora CAIXA e não
-- ignora ACENTO. Hoje, procurar "joao" no Histórico **não acha** "João
-- da Silva" — e o resultado vazio é indistinguível de "não existe
-- cadastro", que é a pior forma de errar numa busca.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. A EXTENSÃO
--
-- No schema `extensions`, como o `pgcrypto` — é onde o Supabase as põe,
-- e é por isso que as funções deste projeto declaram
-- `search_path = public, extensions`.
-- ---------------------------------------------------------------------
create extension if not exists unaccent with schema extensions;


-- ---------------------------------------------------------------------
-- 2. A CHAVE DE BUSCA, E A MENTIRA CONTROLADA DO `immutable`
--
-- `unaccent()` é **STABLE, não IMMUTABLE** — ela depende de um
-- dicionário de texto que, em tese, pode ser alterado. E coluna gerada e
-- índice EXIGEM `immutable`.
--
-- O contorno é padrão e conhecido: um invólucro declarado `immutable`
-- que chama a forma de DOIS ARGUMENTOS, com o dicionário EXPLÍCITO.
--
-- **O dicionário explícito é o que torna a declaração honesta.** Sem
-- ele, a função dependeria do `search_path` de quem chama pra resolver
-- qual dicionário usar — e aí `immutable` seria falso de verdade: a
-- mesma entrada poderia dar saídas diferentes. Com ele, o único jeito de
-- o resultado mudar é alguém rodar `ALTER TEXT SEARCH DICTIONARY`, o que
-- não acontece por acidente.
--
-- Se isso um dia acontecer, o que se paga é: reindexar e regerar a
-- coluna. Nenhum dado de negócio se perde — a coluna é DERIVADA.
-- ---------------------------------------------------------------------
create or replace function public.sem_acento(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public, extensions
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, t))
$$;

comment on function public.sem_acento(text) is
  'Chave de comparação para busca. NUNCA é exibida, NUNCA é gravada como '
  'dado de negócio, e NUNCA entra em DCR1/DCRR1, PDF, auditoria ou hash. '
  'Gêmea conceitual de normalizarParaBusca() em src/lib/texto.ts.';


-- ---------------------------------------------------------------------
-- 3. AS COLUNAS DERIVADAS
--
-- `generated always as ... stored`, e não uma coluna comum mantida por
-- trigger. A diferença é o que interessa: coluna gerada **não pode ser
-- escrita**, então ela não tem como divergir do original. Uma coluna
-- comum precisaria de trigger, e trigger precisa estar certo em INSERT,
-- UPDATE e em todo backfill.
--
-- ---------------------------------------------------------------------
-- POR QUE ISTO NÃO CONTAMINA O DOCUMENTO ASSINADO — medido, não suposto
--
-- `romaneio_canonico` e `romaneio_payload` leem COLUNAS EXPLÍCITAS
-- (`select e.id, e.numero_vale, e.tipo, e.cliente_nome, ...`), nunca
-- `to_jsonb(e)`. Conferido no fonte antes de escrever esta migration: não
-- há um único `to_jsonb` sobre a linha de `entregas` no projeto.
--
-- Se algum dia alguém trocar aquilo por `to_jsonb(e)`, estas colunas
-- entram no snapshot e no canônico sozinhas — e o hash de todo romaneio
-- novo passa a incluir uma chave de busca. Fica o aviso aqui, que é onde
-- alguém procuraria.
--
-- ---------------------------------------------------------------------
-- E A TRIGGER DE IMUTABILIDADE NÃO PRECISA SABER DELAS
--
-- `fn_entrega_imutavel` congela `cliente_nome` e `cliente_endereco`.
-- Coluna gerada não é atribuível, então ela não é porta dos fundos: para
-- mudá-la seria preciso mudar a origem, e a origem já está congelada.
--
-- `ALTER TABLE ... ADD COLUMN ... GENERATED` reescreve a tabela, mas é
-- DDL — não dispara trigger de linha. As 46 linhas existentes ganham o
-- valor sem passar pela trigger.
-- ---------------------------------------------------------------------
alter table public.entregas
  add column if not exists cliente_nome_busca text
    generated always as (public.sem_acento(cliente_nome)) stored;

alter table public.entregas
  add column if not exists cliente_endereco_busca text
    generated always as (public.sem_acento(cliente_endereco)) stored;


-- ---------------------------------------------------------------------
-- 4. ÍNDICE: DELIBERADAMENTE NENHUM, E O MOTIVO IMPORTA
--
-- A tentação é `create index on entregas (cliente_nome_busca)`. Isso
-- seria **cargo cult**: a busca da tela é `ilike '%termo%'`, com curinga
-- à ESQUERDA, e um índice btree não serve pra nada nesse caso. O
-- planejador o ignora e faz seq scan do mesmo jeito — só que agora com
-- um índice pra manter em cada INSERT.
--
-- O que serviria é `pg_trgm` + GIN:
--
--     create extension if not exists pg_trgm with schema extensions;
--     create index entregas_cliente_nome_busca_trgm
--       on public.entregas using gin (cliente_nome_busca extensions.gin_trgm_ops);
--
-- Fica COMENTADO de propósito. Com 46 linhas — e com uma farmácia de
-- oito filiais por cidade — o seq scan é mais rápido que o índice. Ele
-- entra quando o volume justificar, e a hora de saber é medindo o
-- `explain analyze` da consulta real, não agora.
-- ---------------------------------------------------------------------


-- =====================================================================
-- ANTES DE APLICAR
--
--   select extname from pg_extension where extname = 'unaccent';
--   esperado: zero linhas (se já vier uma, a extensão já existe e o
--   `if not exists` cuida disso)
--
--   select count(*) from public.entregas;
--   guarde este número: o passo 3 reescreve a tabela.
--
-- ---------------------------------------------------------------------
-- DEPOIS DE APLICAR
--
-- (a) a função é mesmo IMMUTABLE, e resolve o dicionário
--
--   select public.sem_acento('João da Silva')   as com_acento,
--          public.sem_acento('Joao da Silva')   as sem_acento,
--          public.sem_acento('CONCEIÇÃO')       as cedilha,
--          public.sem_acento('São Gabriel')     as til;
--
--   esperado: 'joao da silva', 'joao da silva', 'conceicao', 'sao gabriel'
--   As duas PRIMEIRAS têm que ser IGUAIS — é o ponto da migration.
--
-- (b) as colunas nasceram preenchidas, e batem com a origem
--
--   select count(*) as total,
--          count(*) filter (where cliente_nome_busca is not null) as com_chave,
--          count(*) filter (where cliente_nome_busca <> public.sem_acento(cliente_nome)) as divergentes
--     from public.entregas;
--
--   esperado: total = com_chave, divergentes = 0
--
-- (c) A PROVA QUE MOTIVOU TUDO — rode como ADMIN, com um cliente real
--     que tenha acento no nome:
--
--   select numero_vale, cliente_nome
--     from public.entregas
--    where cliente_nome_busca like '%' || public.sem_acento('DAIANA') || '%';
--
--   Compare com o que a busca ANTIGA daria:
--
--   select numero_vale, cliente_nome
--     from public.entregas
--    where cliente_nome ilike '%DAIANA%';
--
--   Se algum cliente do banco tiver acento, a primeira acha e a segunda
--   não. Se as duas derem igual, é porque nenhum nome cadastrado tem
--   acento ainda — e aí o teste real é cadastrar um.
--
-- (d) o documento assinado NÃO mudou — o gate de sempre, como ADMIN
--
--   select count(*) as verificados,
--          count(*) filter (where divergencias = 0) as validos,
--          coalesce(sum(divergencias), 0) as divergencias
--     from public.verificar_romaneios_selados();
--
--   esperado: 16 · 16 · 0  (13 saídas + 3 retornos)
--
--   Este é o número que prova que uma coluna nova em `entregas` não
--   contaminou canônico nenhum. Se ele mudar, PARE: significa que algum
--   payload lê a linha inteira em vez de colunas explícitas.
--
-- ---------------------------------------------------------------------
-- O QUE FALTA DEPOIS DESTA MIGRATION
--
-- O cliente ainda filtra pelas colunas ANTIGAS. Em `src/data/entregas.ts`:
--
--     .ilike('cliente_nome', `%${termo}%`)
--        vira
--     .ilike('cliente_nome_busca', `%${normalizarParaBusca(termo)}%`)
--
-- Os dois lados normalizados, sempre: normalizar só o termo faz "João"
-- não achar "João" (o termo perde o acento e a coluna também já perdeu,
-- mas o termo cru não casaria). É o mesmo defeito que `casaComBusca`
-- existe pra impedir no front.
--
-- `numero_vale` NÃO precisa: "V-000046" não tem acento nem caixa.
-- =====================================================================
