-- =====================================================================
-- 2D.3 — BLOCO 2, JÁ DESCOMENTADO. Cole INTEIRO e rode.
--
-- Rode DEPOIS do bloco 1 de `conferir-2d3-no-sql-editor.sql`.
--
-- **O ERRO VERMELHO É O RESULTADO.** Ele termina em `raise exception`
-- com o relatório na mensagem, e é isso que desfaz o que ele escreveu.
-- Se aparecer "Success. No rows returned", NADA executou.
--
-- ---------------------------------------------------------------------
-- CORRIGIDO depois da primeira rodada, que foi INCONCLUSIVA
--
-- A primeira versão tinha DUAS chamadas `(select p.id from profiles
-- where ativo limit 1)` — uma pra calcular o hash, outra pra passar à
-- função. Sem `order by`, `limit 1` não promete a mesma linha nas duas
-- avaliações. Bastava caírem perfis diferentes pro canônico reconstruído
-- divergir do hash, e o selo devolver CONFLITO (`documento_alterado`)
-- em vez de chegar ao laço de pagamentos.
--
-- O sintoma foi exatamente esse: `(e)` não levantou, `(f)` contou 1 e
-- `(g)` contou 0 — o "1" era o romaneio de CONFLITO, que a condição
-- `id = v_novo` capturava.
--
-- Agora o responsável é resolvido UMA vez, com ordem determinística, e o
-- relatório imprime o que a função devolveu. Um resultado que não seja
-- exceção passa a dizer POR QUÊ.
--
-- ---------------------------------------------------------------------
-- ESPERADO:
--   (e) selo levanta exceção citando o conflito de pagamento
--   (f) sealed=0  conflito=0   ← nada ficou
--   (g) pagamentos realizados gravados = 0
--
-- Os três juntos são o ponto: (e) prova que aborta em vez de selar,
-- (f) e (g) provam que o rollback foi COMPLETO.
--
-- **QUEIMA UM NÚMERO DE ROMANEIO** — o insert em `romaneios` acontece
-- antes do laço de pagamentos, e a sequência não volta com rollback.
--
-- Se vier PULADO: não há corrida ABERTA com saída selada.
-- =====================================================================

do $$
declare
  v_rel        text := E'\n\n';
  v_corrida    record;
  v_saida      record;
  v_resp       uuid;
  v_retorno    jsonb;
  v_canonico   text;
  v_hash       text;
  v_autoriz    uuid;
  v_cred       uuid;
  v_novo       uuid := gen_random_uuid();
  v_resultado  jsonb;
  v_erro       text := '(NÃO LEVANTOU)';
  v_sqlstate   text := '-';
  v_selados    int;
  v_conflitos  int;
  v_pagamentos int;
begin
  select c.id, c.tenant_id, c.mototaxista_id
    into v_corrida
    from public.corridas c
    join public.romaneios r on r.corrida_id = c.id
                           and r.tipo = 'saida' and r.status = 'selado'
   where c.status = 'aberta'
   order by c.id
   limit 1;

  if v_corrida.id is null then
    raise exception '%', v_rel || '(e-g) PULADO — nenhuma corrida ABERTA com saída selada';
  end if;

  select r.id, r.document_hash into v_saida
    from public.romaneios r
   where r.corrida_id = v_corrida.id and r.tipo = 'saida' and r.status = 'selado';

  -- UMA vez, e com ordem. Era daqui que vinha a inconclusão anterior.
  select p.id into v_resp
    from public.profiles p
   where p.ativo and p.tenant_id = v_corrida.tenant_id
   order by p.criado_em, p.id
   limit 1;

  -- O payload defeituoso: `pagamento_id` = `entrega_id`, que é
  -- exatamente o id do pagamento previsto daquele vale.
  select jsonb_agg(jsonb_build_object(
           'entrega_id', re.entrega_id,
           'desfecho', 'entregue',
           'motivo', null,
           'detalhe', null,
           -- DERIVADOS, não vazios. Se a saída esperar um convênio ou um
           -- crediário e o payload mandar `[]`, o selo recusa por
           -- `documentos_nao_conferem` e nunca alcança o laço de
           -- pagamentos — um dos candidatos ao que travou a 2ª rodada.
           'documentos', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'tipo', d.tipo_documento, 'situacao', 'recebido'))
               from public.documentos_esperados_do_retorno(v_saida.id) d
              where d.entrega_id = re.entrega_id
           ), '[]'::jsonb),
           'pagamentos_realizados', jsonb_build_array(jsonb_build_object(
             'pagamento_id', re.entrega_id,      -- <<< a colisão
             'forma', 'dinheiro',
             'valor_cents', 100,
             'troco_cents', 0))
         ) order by re.entrega_id::text collate "C")
    into v_retorno
    from public.romaneio_entregas re
   where re.romaneio_id = v_saida.id;

  -- O hash sai do gêmeo SQL, com EXATAMENTE os mesmos argumentos que vão
  -- pra função. Se divergirem, o selo para em `documento_alterado` e o
  -- laço de pagamentos nem é alcançado.
  v_canonico := public.romaneio_retorno_canonico(
    v_saida.id, v_saida.document_hash, v_corrida.mototaxista_id, v_resp, v_retorno);
  v_hash := encode(digest(v_canonico, 'sha256'), 'hex');

  select c.id into v_cred
    from public.motoboy_credenciais c
   where c.motoboy_id = v_corrida.mototaxista_id and c.ativo
   order by c.id
   limit 1;

  if v_cred is null then
    raise exception '%', v_rel ||
      '(e-g) PULADO — o motoboy desta corrida não tem credencial ativa';
  end if;

  insert into public.motoboy_autorizacoes
    (tenant_id, credencial_id, motoboy_id, document_hash, expira_em)
  values (v_corrida.tenant_id, v_cred, v_corrida.mototaxista_id, v_hash,
          now() + interval '5 minutes')
  returning id into v_autoriz;

  begin
    v_resultado := public.selar_romaneio_retorno_interno(
      v_resp, v_novo, v_saida.id, v_saida.document_hash, v_corrida.mototaxista_id,
      v_retorno, v_hash, v_autoriz,
      '[{"t":"resp"}]'::jsonb, '[{"t":"moto"}]'::jsonb,
      now(), 'online', null, null);
  exception when others then
    v_erro := SQLERRM; v_sqlstate := SQLSTATE;
  end;

  v_rel := v_rel || format('(e) selo: %s | %s%s', v_sqlstate, v_erro, E'\n');

  -- Sem exceção, o que a função DEVOLVEU diz por quê. Sem isto, "não
  -- levantou" e "recusou por outro motivo" ficam indistinguíveis — foi
  -- exatamente o que aconteceu na primeira rodada.
  if v_resultado is not null then
    -- OS DOIS MOTIVOS, SEMPRE. `registrar_conflito_retorno` devolve
    -- `motivo: 'conflito'` (genérico) E `conflitos[]` (específico), e um
    -- `coalesce` entre os dois para no genérico — foi exatamente o que
    -- escondeu a causa na segunda rodada. Aqui sai o array inteiro.
    v_rel := v_rel || format('    devolveu: ok=%s motivo=%s%s',
      coalesce(v_resultado ->> 'ok', '-'),
      coalesce(v_resultado ->> 'motivo', '-'), E'\n');
    v_rel := v_rel || format('    conflitos: %s%s',
      coalesce(v_resultado ->> 'conflitos', '(nenhum)'), E'\n');
    v_rel := v_rel || format('    <-- ERRADO: era pra ter levantado exceção%s', E'\n');
  end if;

  -- SELADO e CONFLITO contados separados. Juntá-los foi o que tornou o
  -- primeiro relatório ambíguo.
  select count(*) filter (where status = 'selado'),
         count(*) filter (where status = 'conflito')
    into v_selados, v_conflitos
    from public.romaneios
   where id = v_novo or (corrida_id = v_corrida.id and tipo = 'retorno');

  v_rel := v_rel || format('(f) retorno selado=%s  conflito=%s   (esperado 0 e 0)%s',
    v_selados, v_conflitos, E'\n');

  select count(*) into v_pagamentos
    from public.pagamentos
   where momento = 'realizado'
     and entrega_id in (select entrega_id from public.romaneio_entregas
                         where romaneio_id = v_saida.id);
  v_rel := v_rel || format('(g) pagamentos realizados gravados=%s  (esperado 0)%s',
    v_pagamentos, E'\n');

  v_rel := v_rel || E'\n    (tudo desfeito por este raise; o número de romaneio, não)\n';
  raise exception '%', v_rel;
end $$;
