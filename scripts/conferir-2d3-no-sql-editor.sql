-- =====================================================================
-- 2D.3 (pré-condição) — CONFERÊNCIA DEPOIS DE APLICAR
--
-- Migration: 20260820200000_pagamento_realizado_invariante.sql
--
-- DOIS BLOCOS, RODE UM DE CADA VEZ.
--
--   BLOCO 1  instalação. Não escreve nada.
--   BLOCO 2  o comportamento, e é ele que vale. Escreve e desfaz, mas
--            QUEIMA UM NÚMERO DE ROMANEIO.
--
-- **O ERRO VERMELHO É O RESULTADO** nos dois.
-- =====================================================================


-- =====================================================================
-- BLOCO 1 — a função foi trocada e a fórmula do hash não mudou
--
-- ESPERADO: contadores=t  digest_intacto=t  on_conflict=t
-- =====================================================================

do $$
declare
  v_src text;
  v_rel text := E'\n\n';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'selar_romaneio_retorno_interno';

  if v_src is null then
    raise exception '%', v_rel || 'selar_romaneio_retorno_interno NÃO EXISTE';
  end if;

  v_rel := v_rel || format('(a) contadores instalados      %s   (esperado t)%s',
    v_src like '%v_pr_gravados%' and v_src like '%get diagnostics%', E'\n');

  v_rel := v_rel || format('(b) a comparação existe        %s   (esperado t)%s',
    v_src like '%v_pr_gravados <> v_pr_assinados%', E'\n');

  -- O `on conflict` CONTINUA lá: ele é o que impede reenvio de duplicar
  -- pagamento. Tirá-lo trocaria um defeito silencioso por outro.
  v_rel := v_rel || format('(c) on conflict preservado     %s   (esperado t)%s',
    v_src like '%on conflict (id) do nothing%', E'\n');

  -- A fórmula do hash não pode ter encostado nesta migration.
  v_rel := v_rel || format('(d) linhas de digest           %s   (esperado 4)%s',
    (length(v_src) - length(replace(v_src, 'digest(', ''))) / length('digest('), E'\n');

  raise exception '%', v_rel;
end $$;


-- =====================================================================
-- BLOCO 2 — a invariante, contra dado real
--
-- Monta um DCRR1 VÁLIDO cujo único defeito é o `pagamento_id` de uma
-- linha `pr` já existir — usando exatamente o id do pagamento PREVISTO,
-- que é o uuid da entrega. É o payload que um cliente produziria ao
-- pré-preencher o realizado copiando o previsto inteiro.
--
-- Pra chegar ao laço de pagamentos é preciso atravessar tudo: saída
-- selada, hash da saída, corrida aberta, conjunto de vales exato,
-- motoboy da custódia e o `document_hash` batendo com o DCRR1
-- reconstruído. A autorização é cunhada à mão aqui — no SQL Editor dá,
-- e é isso que permite exercitar o que a 2B não conseguiu.
--
-- ESPERADO:
--   (e) o selo LEVANTA EXCEÇÃO (não devolve conflito, não sela)
--   (f) nenhum romaneio de retorno ficou para esta corrida
--   (g) nenhum pagamento 'realizado' ficou gravado
--
-- **QUEIMA UM NÚMERO DE ROMANEIO** — o insert em `romaneios` acontece
-- antes do laço de pagamentos, e a sequência não volta atrás com
-- rollback. Ver a nota do item 69 no NOTAS.
-- =====================================================================

-- do $$
-- declare
--   v_rel      text := E'\n\n';
--   v_corrida  record;
--   v_saida    record;
--   v_retorno  jsonb;
--   v_canonico text;
--   v_hash     text;
--   v_autoriz  uuid;
--   v_cred     uuid;
--   v_novo     uuid := gen_random_uuid();
--   v_erro     text := '(NÃO LEVANTOU)';
--   v_sqlstate text := '-';
--   v_romaneios int;
--   v_pagamentos int;
-- begin
--   select c.id, c.tenant_id, c.mototaxista_id
--     into v_corrida
--     from public.corridas c
--     join public.romaneios r on r.corrida_id = c.id
--                            and r.tipo = 'saida' and r.status = 'selado'
--    where c.status = 'aberta'
--    limit 1;
--
--   if v_corrida.id is null then
--     raise exception '%', v_rel || '(e-g) PULADO — nenhuma corrida ABERTA com saída selada';
--   end if;
--
--   select r.id, r.document_hash into v_saida
--     from public.romaneios r
--    where r.corrida_id = v_corrida.id and r.tipo = 'saida' and r.status = 'selado';
--
--   -- O payload defeituoso: `pagamento_id` = `entrega_id`, que é
--   -- exatamente o id do pagamento previsto daquele vale.
--   select jsonb_agg(jsonb_build_object(
--            'entrega_id', re.entrega_id,
--            'desfecho', 'entregue',
--            'motivo', null,
--            'detalhe', null,
--            'documentos', '[]'::jsonb,
--            'pagamentos_realizados', jsonb_build_array(jsonb_build_object(
--              'pagamento_id', re.entrega_id,      -- <<< a colisão
--              'forma', 'dinheiro',
--              'valor_cents', 100,
--              'troco_cents', 0))
--          ) order by re.entrega_id::text collate "C")
--     into v_retorno
--     from public.romaneio_entregas re
--    where re.romaneio_id = v_saida.id;
--
--   -- O hash sai do gêmeo SQL, senão o selo pararia antes, em
--   -- `documento_alterado`, e o teste não provaria nada.
--   v_canonico := public.romaneio_retorno_canonico(
--     v_saida.id, v_saida.document_hash, v_corrida.mototaxista_id,
--     (select p.id from public.profiles p where p.ativo limit 1), v_retorno);
--   v_hash := encode(digest(v_canonico, 'sha256'), 'hex');
--
--   select c.id into v_cred from public.motoboy_credenciais c
--    where c.motoboy_id = v_corrida.mototaxista_id and c.ativo limit 1;
--
--   insert into public.motoboy_autorizacoes
--     (tenant_id, credencial_id, motoboy_id, document_hash, expira_em)
--   values (v_corrida.tenant_id, v_cred, v_corrida.mototaxista_id, v_hash,
--           now() + interval '5 minutes')
--   returning id into v_autoriz;
--
--   begin
--     perform public.selar_romaneio_retorno_interno(
--       (select p.id from public.profiles p where p.ativo limit 1),
--       v_novo, v_saida.id, v_saida.document_hash, v_corrida.mototaxista_id,
--       v_retorno, v_hash, v_autoriz,
--       '[{"t":"resp"}]'::jsonb, '[{"t":"moto"}]'::jsonb,
--       now(), 'online', null, null);
--   exception when others then
--     v_erro := SQLERRM; v_sqlstate := SQLSTATE;
--   end;
--
--   v_rel := v_rel || format('(e) selo: %s | %s%s', v_sqlstate, v_erro, E'\n');
--
--   select count(*) into v_romaneios from public.romaneios
--    where id = v_novo or (corrida_id = v_corrida.id and tipo = 'retorno');
--   v_rel := v_rel || format('(f) romaneios de retorno desta corrida=%s  (esperado 0)%s',
--     v_romaneios, E'\n');
--
--   select count(*) into v_pagamentos from public.pagamentos
--    where momento = 'realizado'
--      and entrega_id in (select entrega_id from public.romaneio_entregas
--                          where romaneio_id = v_saida.id);
--   v_rel := v_rel || format('(g) pagamentos realizados gravados=%s  (esperado 0)%s',
--     v_pagamentos, E'\n');
--
--   v_rel := v_rel || E'\n    (tudo desfeito por este raise; o número de romaneio, não)\n';
--   raise exception '%', v_rel;
-- end $$;
