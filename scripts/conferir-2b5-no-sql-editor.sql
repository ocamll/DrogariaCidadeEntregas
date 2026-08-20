-- =====================================================================
-- 2B.5 — CONFERÊNCIA DEPOIS DE APLICAR `20260820160000`
--
-- Só leitura. Uma consulta só, porque o SQL Editor mostra apenas o
-- resultado do último statement.
--
-- ESPERADO: 8 linhas, todas com ok = true. As que falharem vêm primeiro.
--
-- As duas últimas não são asserção, são CENSO: elas não podem falhar,
-- devolvem número pra você ver. Aparecem com ok = true sempre, e o que
-- interessa nelas é a coluna `observado`.
-- =====================================================================

with instaladas as (
  select p.proname,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_executa
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('romaneio_documentos_esperados',
                       'documentos_esperados_do_retorno',
                       'romaneio_retorno_payload',
                       'selar_romaneio_retorno_interno')
),
-- O que cada saída selada espera de papel de volta.
esperado as (
  select r.id, r.numero, d.entrega_id, d.tipo_documento
    from public.romaneios r
    cross join lateral public.romaneio_documentos_esperados(r.id) d
   where r.tipo = 'saida' and r.status = 'selado'
),
baseline as (
  select documentos, integros, divergencias
    from public.verificar_integridade_resumo() where escopo = 'saida'
),
-- Vale cujo previsto gera papel mas que está marcado como se não
-- gerasse. Era o caso de TODO crediário até esta migration.
documental_errado as (
  select e.id, e.numero_vale, e.status_entrega, p.forma
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   where p.forma in ('convenio', 'crediario')
     and e.status_documental = 'nao_aplica'
),
conferencia(ordem, o_que, ok, observado) as (
      select 1, 'as 4 funções da 2B.5 estão instaladas',
             (select count(*) from instaladas) = 4,
             (select count(*)::text || ' de 4' from instaladas)

  -- Só a de leitura é alcançável pela tela. A que a transação usa roda
  -- com SECURITY DEFINER e não pode ser chamada direto.
  union all select 2, 'só `documentos_esperados_do_retorno` é executável por authenticated',
             (select count(*) from instaladas where auth_executa) = 1,
             coalesce((select string_agg(proname, ', ' order by proname)
                         from instaladas where auth_executa), '(nenhuma)')

  -- `convcard` não gera papel. Se aparecer aqui, a derivação pegou uma
  -- forma que não devia — e o retorno passaria a exigir de volta um
  -- documento que ninguém emitiu.
  union all select 3, 'nenhuma expectativa fora de {convenio, crediario}',
             not exists (select 1 from esperado
                          where tipo_documento not in ('convenio', 'crediario')),
             coalesce((select string_agg(distinct tipo_documento, ', ') from esperado),
                      '(nenhuma expectativa ainda)')

  -- Esta migration não encosta em saída nenhuma. Mexeu, alguma coisa ao
  -- lado mexeu junto.
  union all select 4, 'baseline das saídas: íntegros = documentos',
             (select integros from baseline) = (select documentos from baseline),
             (select documentos || ' · ' || integros || ' · ' || divergencias from baseline)
  union all select 5, 'baseline das saídas: 0 divergências',
             (select divergencias from baseline) = 0,
             (select divergencias::text from baseline)

  -- O cadastro passou a marcar crediário como pendente. Um vale de
  -- convênio ou crediário em `nao_aplica` é justamente a inconsistência
  -- que a 2B.5 veio impedir: o DCRR1 diria que falta papel e o banco
  -- diria que não há questão documental.
  union all select 6, 'nenhum vale de convênio/crediário com status_documental = nao_aplica',
             not exists (select 1 from documental_errado),
             coalesce((select string_agg(numero_vale || ' (' || forma || ', ' || status_entrega || ')', ', ')
                         from documental_errado), 'nenhum')

  -- CENSO, não asserção.
  union all select 7, 'saídas seladas que esperam papel de volta', true,
             (select count(distinct id)::text || ' de ' ||
                     (select count(*)::text from public.romaneios
                       where tipo = 'saida' and status = 'selado')
                from esperado)
  union all select 8, 'documentos esperados no total, por tipo', true,
             coalesce((select string_agg(tipo_documento || ': ' || n, ' · ' order by tipo_documento)
                         from (select tipo_documento, count(*) as n
                                 from esperado group by 1) t), 'nenhum')
)
select ordem, o_que, ok, observado from conferencia order by ok, ordem;
