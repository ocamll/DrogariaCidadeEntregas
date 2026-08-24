-- =====================================================================
-- 2D.3 — BLOCO 2, JÁ DESCOMENTADO. Cole INTEIRO e rode.
--
-- Rode DEPOIS do bloco 1 de `conferir-2d3-no-sql-editor.sql`.
--
-- **O ERRO VERMELHO É O RESULTADO.** Ele termina em `raise exception`
-- com o relatório na mensagem, e é isso que desfaz o que ele escreveu.
-- Se aparecer "Success. No rows returned", NADA executou.
--
-- ESPERADO:
--   (e) o selo levanta exceção citando o conflito de pagamento
--   (f) romaneios de retorno desta corrida = 0
--   (g) pagamentos realizados gravados     = 0
--
-- Os três juntos são o ponto: (e) prova que aborta em vez de selar,
-- (f) e (g) provam que o rollback foi COMPLETO. Sem eles, "levantou
-- exceção" não diria nada sobre o que ficou para trás.
--
-- **QUEIMA UM NÚMERO DE ROMANEIO** — o insert em `romaneios` acontece
-- antes do laço de pagamentos, e a sequência não volta com rollback.
--
-- Se vier PULADO: não há corrida ABERTA com saída selada.
-- =====================================================================

do $$
declare
  v_rel      text := E'\n\n';
  v_corrida  record;
  v_saida    record;
  v_retorno  jsonb;
  v_canonico text;
  v_hash     text;
  v_autoriz  uuid;
  v_cred     uuid;
  v_novo     uuid := gen_random_uuid();
  v_erro     text := '(NÃO LEVANTOU)';
  v_sqlstate text := '-';
  v_romaneios int;
  v_pagamentos int;
begin
  select c.id, c.tenant_id, c.mototaxista_id
    into v_corrida
    from public.corridas c
    join public.romaneios r on r.corrida_id = c.id
                           and r.tipo = 'saida' and r.status = 'selado'
   where c.status = 'aberta'
   limit 1;

  if v_corrida.id is null then
    raise exception '%', v_rel || '(e-g) PULADO — nenhuma corrida ABERTA com saída selada';
  end if;

  select r.id, r.document_hash into v_saida
    from public.romaneios r
   where r.corrida_id = v_corrida.id and r.tipo = 'saida' and r.status = 'selado';

  -- O payload defeituoso: `pagamento_id` = `entrega_id`, que é
  -- exatamente o id do pagamento previsto daquele vale.
  select jsonb_agg(jsonb_build_object(
           'entrega_id', re.entrega_id,
           'desfecho', 'entregue',
           'motivo', null,
           'detalhe', null,
           'documentos', '[]'::jsonb,
           'pagamentos_realizados', jsonb_build_array(jsonb_build_object(
             'pagamento_id', re.entrega_id,      -- <<< a colisão
             'forma', 'dinheiro',
             'valor_cents', 100,
             'troco_cents', 0))
         ) order by re.entrega_id::text collate "C")
    into v_retorno
    from public.romaneio_entregas re
   where re.romaneio_id = v_saida.id;

  -- O hash sai do gêmeo SQL, senão o selo pararia antes, em
  -- `documento_alterado`, e o teste não provaria nada.
  v_canonico := public.romaneio_retorno_canonico(
    v_saida.id, v_saida.document_hash, v_corrida.mototaxista_id,
    (select p.id from public.profiles p where p.ativo limit 1), v_retorno);
  v_hash := encode(digest(v_canonico, 'sha256'), 'hex');

  select c.id into v_cred from public.motoboy_credenciais c
   where c.motoboy_id = v_corrida.mototaxista_id and c.ativo limit 1;

  insert into public.motoboy_autorizacoes
    (tenant_id, credencial_id, motoboy_id, document_hash, expira_em)
  values (v_corrida.tenant_id, v_cred, v_corrida.mototaxista_id, v_hash,
          now() + interval '5 minutes')
  returning id into v_autoriz;

  begin
    perform public.selar_romaneio_retorno_interno(
      (select p.id from public.profiles p where p.ativo limit 1),
      v_novo, v_saida.id, v_saida.document_hash, v_corrida.mototaxista_id,
      v_retorno, v_hash, v_autoriz,
      '[{"t":"resp"}]'::jsonb, '[{"t":"moto"}]'::jsonb,
      now(), 'online', null, null);
  exception when others then
    v_erro := SQLERRM; v_sqlstate := SQLSTATE;
  end;

  v_rel := v_rel || format('(e) selo: %s | %s%s', v_sqlstate, v_erro, E'\n');

  select count(*) into v_romaneios from public.romaneios
   where id = v_novo or (corrida_id = v_corrida.id and tipo = 'retorno');
  v_rel := v_rel || format('(f) romaneios de retorno desta corrida=%s  (esperado 0)%s',
    v_romaneios, E'\n');

  select count(*) into v_pagamentos from public.pagamentos
   where momento = 'realizado'
     and entrega_id in (select entrega_id from public.romaneio_entregas
                         where romaneio_id = v_saida.id);
  v_rel := v_rel || format('(g) pagamentos realizados gravados=%s  (esperado 0)%s',
    v_pagamentos, E'\n');

  v_rel := v_rel || E'\n    (tudo desfeito por este raise; o número de romaneio, não)\n';
  raise exception '%', v_rel;
end $$;
