-- =====================================================================
-- E10.1 — OS CENÁRIOS DE COMPETÊNCIA
--
-- Rode COMO ADMIN, depois de aplicar
-- `20260902120000_admin_operando_por_filial_saida.sql`.
--
-- ⚠️ UM BLOCO POR VEZ. **Todo caso termina em exceção** — é esse o
-- ponto: a guarda recusa, ou deixa passar e a função morre adiante por
-- falta de vale. Rodando o arquivo inteiro, o editor para no primeiro.
--
-- Sem placeholder: cada bloco resolve o ator e a filial sozinho.
--
-- ---------------------------------------------------------------------
-- COMO LER O RESULTADO
-- ---------------------------------------------------------------------
--   RECUSA   'Filial inválida para este tenant.'
--            'Sem competência sobre esta filial.'
--
--   ACEITE   QUALQUER OUTRA mensagem — tipicamente sobre vale/romaneio.
--            Aceitar NÃO é selar: é a guarda ter deixado passar.
--
-- Nada é gravado em nenhum caso: a guarda está antes de qualquer
-- escrita, e os casos de aceite morrem antes de inserir romaneio.
--
-- ---------------------------------------------------------------------
-- AS TRÊS ARMADILHAS DO PLANO ORIGINAL, RESOLVIDAS
-- ---------------------------------------------------------------------
-- 1. "admin → loja de outro tenant" não é montável: só existe um tenant.
--    Um uuid que não é loja nenhuma dispara a MESMA linha da guarda
--    (`not exists ... l.tenant_id = v_tenant`).
--
-- 2. "caixa → outra filial" e "→ própria filial": a `caixateste` não
--    consegue mais logar (ficou no domínio antigo no E5). Mas a guarda
--    lê o perfil de **p_caixa_id**, não da sessão — dá pra testá-la
--    passando o uuid dela, sem logar. É a mesma propriedade que quase
--    quebrou a selagem offline.
--
-- 3. "admin com loja_id NULL": o `camiloadmin` não alcança a Nova
--    Corrida pela tela (ela bloqueia com `!lojaId`). Aqui, sim.
-- =====================================================================


-- =====================================================================
-- PASSO 0 · QUEM OS BLOCOS VÃO USAR
--
-- Rode PRIMEIRO. Se algum `uuid` vier NULL, aquele cenário NÃO é
-- rodável — marque como NÃO EXERCITADO, nunca como aprovado.
-- =====================================================================

select 'admin sem filial' as papel_no_teste,
       (select p.id from public.profiles p
         where p.papel = 'admin' and p.loja_id is null and p.ativo
         order by p.id limit 1) as uuid
union all
select 'caixa com filial',
       (select p.id from public.profiles p
         where p.papel = 'caixa' and p.loja_id is not null and p.ativo
         order by p.id limit 1)
union all
select 'uma filial qualquer',
       (select l.id from public.lojas l order by l.id limit 1);


-- =====================================================================
-- (1) ADMIN SEM FILIAL  →  LOJA VÁLIDA   →  a guarda DEIXA PASSAR
--
--     esperado: mensagem que NÃO fala em competência nem em filial
--
--     Se vier 'Sem competência sobre esta filial', o E10 falhou: admin
--     não pode ficar preso por não ter filial no perfil. É o caso que o
--     `camiloadmin` existe pra provar.
-- =====================================================================

with ator as (
  select p.id, p.tenant_id from public.profiles p
   where p.papel = 'admin' and p.loja_id is null and p.ativo
   order by p.id limit 1
)
select public.selar_romaneio_interno(
  (select id from ator),
  gen_random_uuid(), gen_random_uuid(),
  (select l.id from public.lojas l
    where l.tenant_id = (select tenant_id from ator) order by l.id limit 1),
  null, null, '{}'::uuid[], 'hash-de-teste', gen_random_uuid(),
  '[]'::jsonb, '[]'::jsonb, now(), 'online', null, null
);


-- =====================================================================
-- (2) ADMIN  →  UUID QUE NÃO É LOJA NENHUMA   →  RECUSA
--
--     esperado: 'Filial inválida para este tenant.'
--     Mesma linha que protege contra loja de outro tenant.
-- =====================================================================

select public.selar_romaneio_interno(
  (select p.id from public.profiles p
    where p.papel = 'admin' and p.ativo order by p.id limit 1),
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(),                       -- não existe em `lojas`
  null, null, '{}'::uuid[], 'hash-de-teste', gen_random_uuid(),
  '[]'::jsonb, '[]'::jsonb, now(), 'online', null, null
);


-- =====================================================================
-- (3) CAIXA  →  OUTRA FILIAL   →  RECUSA
--
--     esperado: 'Sem competência sobre esta filial.'
-- =====================================================================

with ator as (
  select p.id, p.tenant_id, p.loja_id from public.profiles p
   where p.papel = 'caixa' and p.loja_id is not null and p.ativo
   order by p.id limit 1
)
select public.selar_romaneio_interno(
  (select id from ator),
  gen_random_uuid(), gen_random_uuid(),
  (select l.id from public.lojas l
    where l.tenant_id = (select tenant_id from ator)
      and l.id is distinct from (select loja_id from ator)
    order by l.id limit 1),
  null, null, '{}'::uuid[], 'hash-de-teste', gen_random_uuid(),
  '[]'::jsonb, '[]'::jsonb, now(), 'online', null, null
);


-- =====================================================================
-- (4) CAIXA  →  A PRÓPRIA FILIAL   →  a guarda DEIXA PASSAR
--
--     esperado: mensagem que NÃO fala em competência nem em filial
--
--     CONTROLE NEGATIVO DO (3). Sem ele, uma guarda que recusasse TUDO
--     passaria no (3) e ninguém notaria.
-- =====================================================================

with ator as (
  select p.id, p.loja_id from public.profiles p
   where p.papel = 'caixa' and p.loja_id is not null and p.ativo
   order by p.id limit 1
)
select public.selar_romaneio_interno(
  (select id from ator),
  gen_random_uuid(), gen_random_uuid(),
  (select loja_id from ator),
  null, null, '{}'::uuid[], 'hash-de-teste', gen_random_uuid(),
  '[]'::jsonb, '[]'::jsonb, now(), 'online', null, null
);


-- =====================================================================
-- (5) ATOR INEXISTENTE   →  RECUSA
--
--     esperado: 'Caixa inexistente ou inativo.'
--     Confirma que a guarda nova não passou na frente da que já existia.
-- =====================================================================

select public.selar_romaneio_interno(
  gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  (select l.id from public.lojas l order by l.id limit 1),
  null, null, '{}'::uuid[], 'hash-de-teste', gen_random_uuid(),
  '[]'::jsonb, '[]'::jsonb, now(), 'online', null, null
);


-- =====================================================================
-- O QUE ESTES CINCO **NÃO** PROVAM
--
-- (6) OFFLINE VIA EDGE/service_role  →  CONTINUA SELANDO
--
-- O mais importante do conjunto, e nenhum SQL o alcança. A prova
-- estática mostra que o código não usa `auth.uid()`; só uma saída
-- offline REAL, sincronizando pela Edge Function, mostra que ela
-- continua conseguindo selar. Era exatamente aqui que a primeira versão
-- da guarda (com `is_admin()`) teria quebrado tudo em silêncio.
--
-- Roteiro: Nova Corrida com a rede desligada → religar → a fila
-- sincroniza → o romaneio nasce `offline_sincronizada` e o verificador
-- o aceita.
--
-- (7) ONLINE, ponta a ponta, pela tela.
-- =====================================================================


-- =====================================================================
-- DEPOIS DE TUDO — registre o novo estado da sequência
--
-- `nextval` NÃO faz rollback: as chamadas acima que chegaram a puxar
-- número deixaram vazios novos em `R-0000XX`. É esperado e inofensivo,
-- mas precisa estar registrado — senão a próxima conferência acusa
-- "documento perdido" onde só houve teste.
-- =====================================================================

select right(numero, 6)::int as n, numero, tipo, status
  from public.romaneios order by n;

select * from public.verificar_integridade_resumo();
