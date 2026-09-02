-- =====================================================================
-- E10.1 — OS CENÁRIOS DE COMPETÊNCIA
--
-- Rode COMO ADMIN no SQL Editor, DEPOIS de aplicar
-- `20260902120000_admin_operando_por_filial_saida.sql`.
--
-- ---------------------------------------------------------------------
-- COMO ELES FUNCIONAM, E POR QUE NADA É SELADO
-- ---------------------------------------------------------------------
-- A guarda está no TOPO de `selar_romaneio_interno`, antes de qualquer
-- escrita, antes do canônico e antes do primeiro `digest()`. Então:
--
--   caso de RECUSA   → a guarda levanta e nada é gravado
--   caso de ACEITE   → a guarda deixa passar, e a função morre logo
--                      adiante por outro motivo (romaneio sem vale,
--                      autorização inválida)
--
-- **É a MENSAGEM que distingue os dois.** Aceitar não significa selar:
-- significa que o erro que volta NÃO é de competência.
--
-- Tudo dentro de `begin … rollback`, e nenhum caso chega perto de gravar
-- romaneio. Ainda assim, veja o aviso da sequência no fim do arquivo.
--
-- ---------------------------------------------------------------------
-- AS TRÊS ARMADILHAS DO PLANO ORIGINAL, RESOLVIDAS
-- ---------------------------------------------------------------------
-- 1. "admin → loja de outro tenant": só existe UM tenant. Não dá pra
--    montar. Mas um uuid que não é loja nenhuma dispara a MESMA linha
--    (`not exists ... l.tenant_id = v_tenant`), que é justamente a que
--    protege contra tenant alheio. Mesmo ramo, sem fabricar tenant.
--
-- 2. "caixa → outra filial" e "caixa → própria filial": a `caixateste`
--    não consegue mais logar (ficou no domínio antigo no E5). Mas a
--    guarda lê o perfil de **p_caixa_id**, não da sessão — então dá pra
--    testá-la passando o uuid dela como parâmetro, sem logar como ela.
--    É a mesma propriedade que quase quebrou a selagem offline.
--
-- 3. "admin com loja_id NULL": o `camiloadmin` é o sujeito, e ele não
--    alcança a Nova Corrida pela tela (ela bloqueia com `!lojaId`). Aqui
--    ele é alcançável direto.
-- =====================================================================


-- =====================================================================
-- PASSO 0 · OS ATORES E AS FILIAIS
--
-- Anote os uuids: os blocos abaixo os usam. Se algum papel não existir
-- (ex.: nenhum caixa ativo), o cenário correspondente não é rodável e
-- deve ser marcado como NÃO EXERCITADO — nunca como aprovado.
-- =====================================================================

select p.id, p.nome, p.papel, p.loja_id, l.nome as filial, p.ativo
  from public.profiles p
  left join public.lojas l on l.id = p.loja_id
 order by p.papel, p.nome;

select id, nome, tenant_id from public.lojas order by nome;


-- =====================================================================
-- OS CENÁRIOS
--
-- Troque só os uuids marcados. Todo bloco é `begin … rollback`.
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) ADMIN COM loja_id NULL  →  a guarda DEIXA PASSAR
--
--     esperado: erro que NÃO fala em competência nem em filial
--     (algo como romaneio sem vale / autorização inválida)
--
--     Se vier 'Sem competência sobre esta filial', o E10 falhou: um
--     admin não pode ficar preso por não ter filial no perfil.
-- ---------------------------------------------------------------------
begin;
select public.selar_romaneio_interno(
  '<UUID_DO_ADMIN_SEM_LOJA>'::uuid,          -- p_caixa_id   (camiloadmin)
  gen_random_uuid(),                          -- p_romaneio_id
  gen_random_uuid(),                          -- p_corrida_id
  '<UUID_DE_UMA_LOJA_VALIDA>'::uuid,          -- p_loja_id    (Matriz)
  null, null,                                 -- agencia, motoboy
  '{}'::uuid[],                               -- p_entrega_ids (vazio)
  'hash-de-teste',
  gen_random_uuid(),                          -- p_autorizacao_id
  '[]'::jsonb, '[]'::jsonb,
  now(), 'online', null, null
);
rollback;

-- ---------------------------------------------------------------------
-- (2) ADMIN  →  LOJA QUE NÃO É DO TENANT   →  RECUSA
--
--     esperado: 'Filial inválida para este tenant.'
--     (uuid aleatório: não é loja nenhuma, logo não é loja deste tenant)
-- ---------------------------------------------------------------------
begin;
select public.selar_romaneio_interno(
  '<UUID_DO_ADMIN_SEM_LOJA>'::uuid,
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(),                          -- p_loja_id INEXISTENTE
  null, null, '{}'::uuid[], 'hash-de-teste', gen_random_uuid(),
  '[]'::jsonb, '[]'::jsonb, now(), 'online', null, null
);
rollback;

-- ---------------------------------------------------------------------
-- (3) CAIXA  →  OUTRA FILIAL   →  RECUSA
--
--     esperado: 'Sem competência sobre esta filial.'
--     Use uma loja REAL do tenant que NÃO seja a do caixa.
-- ---------------------------------------------------------------------
begin;
select public.selar_romaneio_interno(
  '<UUID_DO_CAIXA>'::uuid,                    -- caixateste (Filial 02)
  gen_random_uuid(), gen_random_uuid(),
  '<UUID_DE_OUTRA_FILIAL>'::uuid,             -- Matriz
  null, null, '{}'::uuid[], 'hash-de-teste', gen_random_uuid(),
  '[]'::jsonb, '[]'::jsonb, now(), 'online', null, null
);
rollback;

-- ---------------------------------------------------------------------
-- (4) CAIXA  →  A PRÓPRIA FILIAL   →  a guarda DEIXA PASSAR
--
--     esperado: erro que NÃO fala em competência nem em filial
--
--     Este é o controle negativo do (3): sem ele, uma guarda que
--     recusasse TUDO passaria no (3) e ninguém notaria.
-- ---------------------------------------------------------------------
begin;
select public.selar_romaneio_interno(
  '<UUID_DO_CAIXA>'::uuid,
  gen_random_uuid(), gen_random_uuid(),
  '<UUID_DA_FILIAL_DO_CAIXA>'::uuid,          -- a loja_id do perfil dele
  null, null, '{}'::uuid[], 'hash-de-teste', gen_random_uuid(),
  '[]'::jsonb, '[]'::jsonb, now(), 'online', null, null
);
rollback;

-- ---------------------------------------------------------------------
-- (5) ATOR INEXISTENTE OU INATIVO   →  RECUSA
--
--     esperado: 'Caixa inexistente ou inativo.'
--     Checagem que já existia; confirma que a guarda nova não passou na
--     frente dela.
-- ---------------------------------------------------------------------
begin;
select public.selar_romaneio_interno(
  gen_random_uuid(),                          -- ator que não existe
  gen_random_uuid(), gen_random_uuid(),
  '<UUID_DE_UMA_LOJA_VALIDA>'::uuid,
  null, null, '{}'::uuid[], 'hash-de-teste', gen_random_uuid(),
  '[]'::jsonb, '[]'::jsonb, now(), 'online', null, null
);
rollback;


-- =====================================================================
-- O QUE ESTES CINCO **NÃO** PROVAM
--
-- (6) OFFLINE VIA EDGE/service_role  →  CONTINUA SELANDO
--
-- É o cenário mais importante do conjunto, e nenhum SQL o alcança.
--
-- A prova estática mostra que o código não usa `auth.uid()`; só uma
-- saída offline REAL, sincronizando pela Edge Function, mostra que ela
-- continua conseguindo selar. Era exatamente aqui que a primeira versão
-- da guarda (com `is_admin()`) teria quebrado tudo em silêncio.
--
-- Roteiro: Nova Corrida com a rede desligada → religar → a fila
-- sincroniza → conferir que o romaneio nasceu `offline_sincronizada` e
-- que o verificador o aceita.
--
-- (7) ONLINE, USUÁRIO NORMAL, ponta a ponta — pela tela, como sempre.
-- =====================================================================


-- =====================================================================
-- DEPOIS DE TUDO — a sequência vai ter buracos NOVOS
--
-- `nextval` NÃO faz rollback. Cada chamada acima que chegou a puxar
-- número deixou um vazio em `R-0000XX`, mesmo com o `rollback`.
--
-- Isso é esperado e inofensivo, mas precisa estar previsto: sem isto,
-- a próxima conferência da sequência acusa "documento perdido" onde só
-- houve teste.
-- =====================================================================

select right(numero, 6)::int as n, numero, tipo, status
  from public.romaneios
 order by n;

select * from public.verificar_integridade_resumo();
