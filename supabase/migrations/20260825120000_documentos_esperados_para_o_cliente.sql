-- =====================================================================
-- A PORTA DO CLIENTE ESTAVA TRANCADA POR DENTRO
--
-- Achado em 2026-08-25, no primeiro uso real da tela do Romaneio de
-- Retorno: escolher uma corrida devolvia "Não consegui carregar".
--
-- A cadeia:
--
--     obter_contexto_retorno          security INVOKER
--       └─ romaneio_documentos_esperados   revoke ... from authenticated
--
-- `SECURITY DEFINER` no calado NÃO dispensa o EXECUTE: o privilégio de
-- CHAMAR é conferido contra quem chama, e só depois a função passa a
-- rodar como dona. Com o `revoke`, todo caller `authenticated` leva
-- `42501 permission denied for function romaneio_documentos_esperados`.
--
-- E o mesmo vale para `documentos_esperados_do_retorno`, que a 2D.1
-- registrou como "a porta do lado do cliente, já pronta, com grant para
-- authenticated". O grant DELA existia; o da função que ela chama, não.
-- Ela nunca tinha sido exercitada como `authenticated` — as conferências
-- da 2B.5 (65/65) rodaram no SQL Editor, como `postgres`, que ignora
-- grant. **Grant conferido só por leitura não é grant conferido.**
--
-- ---------------------------------------------------------------------
-- POR QUE NÃO SIMPLESMENTE DAR O GRANT NA FUNÇÃO DE DENTRO
--
-- Porque o `revoke` está certo. `romaneio_documentos_esperados` é
-- `SECURITY DEFINER` e lê `romaneios` por id, ignorando a RLS — liberá-la
-- deixaria qualquer autenticado perguntar, sobre um romaneio de outra
-- filial, quais vales esperam qual papel. É a classe de buraco que este
-- projeto já abriu antes, e o `revoke` foi quem a fechou.
--
-- E o corpo dela também não pode ganhar um filtro de tenant: ela é a
-- MESMA função que `selar_romaneio_retorno_interno` usa, inclusive pelo
-- caminho offline, onde quem chama é a `service_role` e não há JWT —
-- `current_tenant_id()` seria nulo, a expectativa viria vazia, e o selo
-- passaria a discordar do documento assinado. Silenciosamente.
--
-- ---------------------------------------------------------------------
-- O QUE ESTA MIGRATION FAZ
--
-- Conserta no ANDAR DE CIMA, que é onde há como conferir escopo sem
-- quebrar o caminho da transação:
--
--   1. `documentos_esperados_do_retorno` passa a `SECURITY DEFINER` —
--      assim ela PODE chamar a função de dentro — e ganha o gate à mão
--      que a RLS fazia de graça, com `pode_ver_romaneio()`. Não é regra
--      duplicada: aquela função já existe desde 2026-08-16 e é o espelho
--      declarado da policy `romaneios_select`, criada exatamente para o
--      caso "a tabela filha não tem loja_id, o escopo vem do romaneio
--      dono".
--
--   2. `obter_contexto_retorno` passa a chamar a de CIMA. Ela continua
--      `security invoker`, então o `join` dela com `romaneios` continua
--      filtrado pela RLS — o gate passa a existir duas vezes, e as duas
--      são a mesma regra escrita num lugar só.
--
-- A função de dentro NÃO É TOCADA. Nem corpo, nem grant, nem
-- `SECURITY DEFINER`. É ela que a transação do selo usa, e é a única
-- derivação da regra — duas seria como os dois lados divergem.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. O wrapper de leitura, agora capaz de chamar a de dentro
-- ---------------------------------------------------------------------
create or replace function public.documentos_esperados_do_retorno(p_saida_romaneio_id uuid)
returns table (entrega_id uuid, tipo_documento text)
language sql stable security definer set search_path = public as $$
  select d.entrega_id, d.tipo_documento
    from public.romaneios r
    cross join lateral public.romaneio_documentos_esperados(r.id) d
   where r.id = p_saida_romaneio_id
     -- O gate que a RLS fazia sozinha quando esta função era `invoker`.
     -- `SECURITY DEFINER` ignora policy, então cada checagem que a policy
     -- fazia de graça precisa ser reescrita à mão — e aqui ela já estava
     -- escrita: `pode_ver_romaneio` É a `romaneios_select`.
     and public.pode_ver_romaneio(r.id)
   order by d.entrega_id::text collate "C", d.tipo_documento collate "C";
$$;

revoke all on function public.documentos_esperados_do_retorno(uuid) from public, anon;
grant execute on function public.documentos_esperados_do_retorno(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 2. O contexto passa a entrar pela porta de cima
--
-- Idêntica à de `20260820190000`, com UMA linha diferente: a chamada
-- interna. Está reproduzida inteira porque `create or replace function`
-- não aceita patch — e não porque algo mais tenha mudado.
-- ---------------------------------------------------------------------
create or replace function public.obter_contexto_retorno(p_corrida_id uuid)
returns jsonb
language sql stable security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'versao', 'CTXR1',
    'corrida_id', c.id,
    'saida_romaneio_id', r.id,
    'saida_numero', r.numero,
    'saida_document_hash', r.document_hash,
    'motoboy_id', c.mototaxista_id,
    'motoboy_nome', m.nome,
    'agencia_nome', a.nome,
    'saida_em', c.saida_em,
    'vales', coalesce((
      select jsonb_agg(
               vale || jsonb_build_object(
                 'documentos_esperados', coalesce((
                   select jsonb_agg(d.tipo_documento order by d.tipo_documento collate "C")
                     -- AQUI. Era `romaneio_documentos_esperados(r.id)`,
                     -- que `authenticated` não pode executar.
                     from public.documentos_esperados_do_retorno(r.id) d
                    where d.entrega_id = (vale ->> 'entrega_id')::uuid
                 ), '[]'::jsonb)
               )
               order by vale ->> 'entrega_id' collate "C"
             )
        from jsonb_array_elements(r.payload -> 'vales') as vale
    ), '[]'::jsonb)
  )
    from public.corridas c
    join public.romaneios r
      on r.corrida_id = c.id and r.tipo = 'saida' and r.status = 'selado'
    left join public.mototaxistas m on m.id = c.mototaxista_id
    left join public.agencias a on a.id = c.agencia_id
   where c.id = p_corrida_id;
$$;

revoke all on function public.obter_contexto_retorno(uuid) from public, anon;
grant execute on function public.obter_contexto_retorno(uuid) to authenticated;


-- =====================================================================
-- ANTES DE APLICAR — confirma o diagnóstico em uma linha
--
--   select has_function_privilege('authenticated',
--            'public.romaneio_documentos_esperados(uuid)', 'execute') as interna,
--          has_function_privilege('authenticated',
--            'public.documentos_esperados_do_retorno(uuid)', 'execute') as wrapper;
--
--   esperado ANTES:  interna = false   wrapper = true
--   ou seja: a de fora abre, a de dentro barra. É esse par que quebra.
--
-- ---------------------------------------------------------------------
-- DEPOIS DE APLICAR — as três que importam
--
-- (a) a de dentro CONTINUA fechada (se abrir, esta migration errou o alvo)
--
--   select has_function_privilege('authenticated',
--            'public.romaneio_documentos_esperados(uuid)', 'execute') as deve_ser_false;
--
-- (b) o wrapper virou definer e o contexto continua invoker
--
--   select p.proname, p.prosecdef
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('documentos_esperados_do_retorno',
--                        'obter_contexto_retorno',
--                        'romaneio_documentos_esperados')
--    order by p.proname;
--
--   esperado:  documentos_esperados_do_retorno   t
--              obter_contexto_retorno            f
--              romaneio_documentos_esperados     t
--
-- (c) a expectativa NÃO MUDOU para os romaneios que já existem — é o que
--     prova que o andar de cima não alterou a regra, só o caminho até
--     ela. Roda como ADMIN, senão a RLS devolve um recorte parcial.
--
--   select r.numero,
--          (select count(*) from public.romaneio_documentos_esperados(r.id)) as pela_interna,
--          (select count(*) from public.documentos_esperados_do_retorno(r.id)) as pelo_wrapper
--     from public.romaneios r
--    where r.tipo = 'saida' and r.status = 'selado'
--    order by r.numero;
--
--   esperado: as duas colunas IGUAIS em toda linha. Pelo censo da 2B.5,
--             exatamente uma das saídas seladas espera papel (um
--             convênio) — então espere um único `1` e o resto `0`.
--
-- ---------------------------------------------------------------------
-- E O TESTE QUE NENHUMA QUERY DAQUI FAZ
--
-- Tudo acima roda no SQL Editor, como `postgres` — que foi justamente
-- quem escondeu o defeito por cinco dias. O que fecha isto é abrir a
-- tela de Retorno de corrida LOGADO COMO CAIXA e escolher uma corrida.
-- =====================================================================
