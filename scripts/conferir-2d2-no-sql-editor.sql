-- =====================================================================
-- ETAPA 2D.2 — CONFERÊNCIA DEPOIS DE APLICAR
--
-- Migration: 20260820190000_contexto_do_retorno.sql
--
-- UM BLOCO SÓ, e ele **NÃO ESCREVE NADA** — nem cria romaneio, nem
-- consome número de sequência, nem toca em vale. É leitura pura.
--
-- **O ERRO VERMELHO É O RESULTADO.** O bloco termina em `raise
-- exception` com o relatório na mensagem: é assim que ele aparece no
-- editor, que só mostra o último statement.
--
-- ---------------------------------------------------------------------
-- ESPERADO
--
--   (a) instalada=t  anon=f  authenticated=t
--   (b) versao=CTXR1, hash com 64 chars, número da saída preenchido
--   (c) vales no contexto = vales em romaneio_entregas
--   (d) vales sem previstos/esperados = 0
--   (e) cliente do CONTEXTO ao lado do cliente que está em `entregas`
--
-- ---------------------------------------------------------------------
-- O CASO (e) É O QUE MAIS VALE, E ELE PODE PARECER FALHA
--
-- Ele imprime os dois lado a lado. **Se diferirem, o contexto está
-- CERTO**: ele mostra o que foi assinado, não o que o cadastro diz hoje.
--
-- É a regra 7 visível numa linha — a mesma decisão que governa o PDF do
-- romaneio desde 18/08. Um contexto que "acompanhasse" a correção faria
-- o caixa conferir o retorno contra um endereço que o motoboy nunca
-- recebeu.
--
-- Nos dados de teste os dois provavelmente vão COINCIDIR, porque
-- ninguém corrigiu nada. Coincidir não prova nada nem contradiz nada; o
-- que a linha existe pra fazer é deixar a diferença visível no dia em
-- que ela aparecer.
-- =====================================================================

do $$
declare
  v_rel       text := E'\n\n';
  v_corrida   uuid;
  v_saida     uuid;
  v_ctx       jsonb;
  v_vales_ctx int;
  v_vales_re  int;
  v_sem_campo int;
  v_no_ctx    text;
  v_hoje      text;
begin
  -- (a) existe e quem alcança
  v_rel := v_rel || format(
    '(a) instalada=%s  anon=%s  authenticated=%s   (esperado t/f/t)%s',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'obter_contexto_retorno'),
    has_function_privilege('anon',          'public.obter_contexto_retorno(uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.obter_contexto_retorno(uuid)', 'execute'),
    E'\n');

  -- uma saída selada qualquer, dentro do alcance da RLS de quem roda
  select r.corrida_id, r.id into v_corrida, v_saida
    from public.romaneios r
   where r.tipo = 'saida' and r.status = 'selado' and r.corrida_id is not null
   order by r.numero
   limit 1;

  if v_corrida is null then
    raise exception '%', v_rel ||
      '(b-e) PULADO — nenhuma saída selada no alcance da sua RLS.' || E'\n' ||
      '      Rode como admin, ou depois da próxima Nova Corrida.' || E'\n';
  end if;

  v_ctx := public.obter_contexto_retorno(v_corrida);

  if v_ctx is null then
    raise exception '%', v_rel ||
      format('(b) contexto VEIO NULO para a corrida %s  <-- ERRADO%s', v_corrida, E'\n');
  end if;

  -- (b) a forma
  v_rel := v_rel || format(
    '(b) versao=%s  hash=%s chars  saida=%s  motoboy=%s%s',
    v_ctx ->> 'versao',
    length(v_ctx ->> 'saida_document_hash'),
    v_ctx ->> 'saida_numero',
    coalesce(v_ctx ->> 'motoboy_nome', '(sem nome)'),
    E'\n');

  -- (c) o conjunto de vales é o da saída — nem falta nem sobra
  v_vales_ctx := jsonb_array_length(v_ctx -> 'vales');
  select count(*) into v_vales_re
    from public.romaneio_entregas where romaneio_id = v_saida;

  v_rel := v_rel || format(
    '(c) vales no contexto=%s  em romaneio_entregas=%s   %s%s',
    v_vales_ctx, v_vales_re,
    case when v_vales_ctx = v_vales_re then 'ok' else '<-- ERRADO' end,
    E'\n');

  -- (d) todo vale traz as duas listas, mesmo vazias
  select count(*) into v_sem_campo
    from jsonb_array_elements(v_ctx -> 'vales') v
   where v -> 'pagamentos_previstos' is null
      or v -> 'documentos_esperados' is null;

  v_rel := v_rel || format(
    '(d) vales sem previstos/esperados=%s   (esperado 0)%s', v_sem_campo, E'\n');

  -- (e) o snapshot contra o dado vigente
  v_no_ctx := v_ctx #>> '{vales,0,cliente_nome}';
  select e.cliente_nome into v_hoje
    from public.entregas e
   where e.id = (v_ctx #>> '{vales,0,entrega_id}')::uuid;

  v_rel := v_rel || format('(e) cliente no CONTEXTO : %s%s', coalesce(v_no_ctx, '(nulo)'), E'\n');
  v_rel := v_rel || format('    cliente em entregas  : %s%s', coalesce(v_hoje, '(nulo)'), E'\n');
  v_rel := v_rel || '    ' ||
    case when v_no_ctx is not distinct from v_hoje
         then 'iguais — ninguém corrigiu este vale (não prova nem contradiz nada)'
         else 'DIFEREM — e o contexto está CERTO: ele mostra o que foi assinado'
    end || E'\n';

  -- o primeiro vale por extenso, pra conferir a olho
  v_rel := v_rel || E'\n    primeiro vale do contexto:\n    ' ||
           jsonb_pretty(v_ctx -> 'vales' -> 0) || E'\n';

  raise exception '%', v_rel;
end $$;
