-- =====================================================================
-- E3.B — O EVENTO `pagamento_alterado` PASSA A REGISTRAR TODOS OS
-- PAGAMENTOS PREVISTOS, NÃO "UM DELES"
--
-- NÃO APLICAR sem antes registrar o baseline do verificador (rodapé).
--
-- ---------------------------------------------------------------------
-- O DEFEITO
--
-- O evento gravava o lado `de` assim:
--
--     'de', (select pg.forma from public.pagamentos pg
--             where pg.entrega_id = v_entrega_id
--               and pg.momento = 'previsto'
--             order by pg.id::text collate "C" limit 1),
--
-- `limit 1`. Com dois pagamentos previstos — que é exatamente o que o E4
-- vai criar — o evento afirma que a divergência foi de UMA das formas e
-- descarta a outra em silêncio. Num registro de auditoria isso não é
-- incompleto: é ERRADO.
--
-- E o que torna o defeito traiçoeiro é o contraste: a checagem da
-- invariante do §78, vinte linhas acima, JÁ é multi-consciente
-- (`array_agg` de `forma|valor`). Quem lesse aquele bloco concluiria que
-- a função inteira lida com N.
--
-- Achado em 2026-08-26, no levantamento do E3 — antes de existir
-- qualquer caminho capaz de criar o segundo previsto. É a diferença
-- entre corrigir um defeito e descobri-lo depois de selar um documento.
--
-- ---------------------------------------------------------------------
-- POR QUE ORDEM TOTAL
--
--     order by pg.forma, pg.id::text collate "C"
--
-- `order by pg.forma` sozinho deixa empate entre dois previstos da MESMA
-- forma, e o Postgres não promete ordem útil aí. Mesmo isto não entrando
-- em hash nenhum, é um evento de auditoria: mesmos fatos têm que
-- produzir a mesma representação.
--
-- ---------------------------------------------------------------------
-- POR QUE NULL, E NÃO `[]`
--
-- Sem previsto nenhum, o `jsonb_agg` devolve NULL — e o escalar de antes
-- também acabava em NULL. Um `coalesce(..., '[]')` diria "havia
-- previsto, e ele estava vazio", que é outro fato.
--
-- ---------------------------------------------------------------------
-- READER-FIRST: ESTA MIGRATION SÓ É SEGURA PORQUE O E3.A JÁ ENTROU
--
-- O banco aceita as duas formas hoje — `payload` é jsonb, não há
-- constraint. Mas um leitor que só saiba interpretar string quebraria ao
-- receber lista, e o sintoma apareceria no Registro de Auditoria, que é
-- onde menos se pode errar.
--
-- Por isso a ordem do E3 é:
--
--     E3.A  os leitores aceitam string E lista   (feito)
--     E3.B  o SQL passa a ESCREVER lista         (esta migration)
--     E3.C  o cliente cunha id próprio do previsto
--
-- É o princípio de protocolo distribuído: todo mundo aprende a LER o
-- formato novo antes de alguém começar a escrevê-lo.
--
-- Do lado da leitura os dois formatos convivem PARA SEMPRE: `eventos` é
-- append-only (regra 6), então os antigos nunca serão reescritos. Isto
-- não é janela de compatibilidade como a da fila — é o histórico.
-- Coberto por `scripts/pagamento-alterado.spec.mts`.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA, E O QUE NÃO MUDA
--
-- Esta é a QUINTA definição de `selar_romaneio_retorno_interno`
-- (20260820130000, 20260820160000, 20260820200000, e agora esta). Ela
-- foi obtida PATCHEANDO a mais recente por script
-- (`scripts/patch-selar-retorno-e3b.mts`), e as invariantes foram
-- PROVADAS antes de o arquivo existir:
--
--     2 linhas removidas, 23 acrescentadas (19 delas comentário)
--     as 4 expressões digest(...)      byte a byte IDÊNTICAS
--     inserts em assinaturas           intocados
--     trechos do DCRR1                 intocados
--     guard do §78                     intocado
--     todo ON CONFLICT                 intocado
--     2 queries de pagamentos, e EXATAMENTE 1 mudou — a do evento
--
-- Nenhum backfill. Nenhuma constraint removida. Previstos antigos
-- continuam com `id = entrega_id` e continuam válidos.
-- =====================================================================

create or replace function public.selar_romaneio_retorno_interno(
  p_responsavel_id uuid,
  p_romaneio_id uuid,
  p_saida_romaneio_id uuid,
  p_saida_document_hash text,
  p_motoboy_id uuid,
  p_retorno jsonb,
  p_document_hash text,
  p_autorizacao_id uuid,
  p_responsavel_strokes jsonb,
  p_motoboy_strokes jsonb,
  p_ocorrido_em_local timestamptz,
  p_modo text,
  p_ip inet,
  p_geolocalizacao jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_existente     record;
  -- 2D.3: a invariante do pagamento realizado. Ver o cabeçalho.
  v_pr_assinados  int := 0;
  v_pr_gravados   int := 0;
  v_pr_linhas     int;
  v_saida         record;
  v_corrida       record;
  v_tenant        uuid;
  v_papel         text;
  v_autor_nome    text;
  v_motivo        text;
  v_canonico      text;
  v_hash          text;
  v_numero        text;
  v_agora         timestamptz := now();
  v_agora_txt     text;
  v_hash_resp     text;
  v_hash_motoboy  text;
  v_final         text;
  v_credencial_id uuid;
  v_ordem         smallint := 0;
  v_do_retorno    uuid[];
  v_da_saida      uuid[];
  v_docs_esp      text[];
  v_docs_dec      text[];
  v_vale          jsonb;
  v_pag           jsonb;
  v_entrega_id    uuid;
  v_desfecho      text;
  v_detalhe       text;
  v_previsto      text[];
  v_realizado     text[];
  v_divergiu      boolean;
  v_esperados_do_vale int;
  v_recebidos_do_vale int;
begin
  select r.status, r.numero, r.final_hash, r.conflito into v_existente
    from public.romaneios r where r.id = p_romaneio_id;

  if v_existente.status = 'selado' then
    return jsonb_build_object('ok', true, 'ja_existia', true,
                              'romaneio_id', p_romaneio_id,
                              'numero', v_existente.numero,
                              'final_hash', v_existente.final_hash);
  elsif v_existente.status = 'conflito' then
    return jsonb_build_object('ok', false, 'motivo', 'conflito', 'ja_existia', true,
                              'romaneio_id', p_romaneio_id,
                              'numero', v_existente.numero,
                              'conflitos', v_existente.conflito -> 'motivos');
  end if;

  select p.tenant_id, p.papel, p.nome into v_tenant, v_papel, v_autor_nome
    from public.profiles p where p.id = p_responsavel_id and p.ativo;
  if v_tenant is null then
    raise exception 'Responsável inexistente ou inativo.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_responsavel_strokes is null or p_motoboy_strokes is null then
    raise exception 'Romaneio de retorno exige as duas assinaturas.'
      using errcode = 'check_violation';
  end if;

  select r.id, r.tenant_id, r.loja_id, r.corrida_id, r.tipo, r.status,
         r.document_hash
    into v_saida
    from public.romaneios r
   where r.id = p_saida_romaneio_id
   for update;

  if v_saida.id is null or v_saida.tipo <> 'saida' then
    raise exception 'Romaneio de saída % não existe.', p_saida_romaneio_id
      using errcode = 'no_data_found';
  end if;
  if v_saida.tenant_id <> v_tenant then
    raise exception 'Romaneio de saída não é desta farmácia.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_saida.status <> 'selado' or v_saida.corrida_id is null then
    raise exception 'Romaneio de saída % não está selado — não há corrida pra fechar.',
      p_saida_romaneio_id using errcode = 'check_violation';
  end if;

  if v_saida.document_hash is distinct from p_saida_document_hash then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'saida_hash_nao_confere',
        'hash_assinado', p_saida_document_hash,
        'hash_da_saida', v_saida.document_hash)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  select c.id, c.status, c.mototaxista_id into v_corrida
    from public.corridas c where c.id = v_saida.corrida_id for update;

  if v_corrida.status = 'fechada' then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'corrida_ja_fechada', 'corrida_id', v_corrida.id)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  if exists (select 1 from public.romaneios r
              where r.corrida_id = v_corrida.id and r.tipo = 'retorno') then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'retorno_ja_existe', 'corrida_id', v_corrida.id)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  if v_corrida.mototaxista_id is distinct from p_motoboy_id then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'outro_motoboy',
        'motoboy_da_corrida', v_corrida.mototaxista_id,
        'motoboy_apresentado', p_motoboy_id)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  v_motivo := public.romaneio_retorno_validar(p_saida_document_hash, p_retorno);
  if v_motivo is not null then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object('motivo', 'retorno_invalido',
                                           'detalhe', v_motivo)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- ---- nem falta nem sobra VALE ---------------------------------------
  select array_agg(re.entrega_id order by re.entrega_id) into v_da_saida
    from public.romaneio_entregas re where re.romaneio_id = p_saida_romaneio_id;

  select array_agg(x order by x) into v_do_retorno
    from (select distinct (v.value ->> 'entrega_id')::uuid as x
            from jsonb_array_elements(p_retorno) as v(value)) t;

  if v_da_saida is distinct from v_do_retorno then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'vales_nao_conferem',
        'faltando', to_jsonb(array(select unnest(v_da_saida)
                                   except select unnest(coalesce(v_do_retorno, '{}'::uuid[])))),
        'sobrando', to_jsonb(array(select unnest(coalesce(v_do_retorno, '{}'::uuid[]))
                                   except select unnest(v_da_saida))))),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- ---- nem falta nem sobra DOCUMENTO ----------------------------------
  -- IGUALDADE DE CONJUNTO. "Todo esperado apareceu" deixaria sobra
  -- passar, e sobra é o documento afirmando custódia de um papel que
  -- aquela saída nunca gerou.
  --
  -- A chave é o par, serializado como `<entrega_id>|<tipo>` — é a mesma
  -- identidade que o canônico usa pra ordenar e pra recusar duplicata.
  select array_agg(lower(d.entrega_id::text) || '|' || d.tipo_documento
                   order by lower(d.entrega_id::text) || '|' || d.tipo_documento)
    into v_docs_esp
    from public.romaneio_documentos_esperados(p_saida_romaneio_id) d;

  select array_agg(x order by x) into v_docs_dec
    from (select lower(v.value ->> 'entrega_id') || '|' || (doc.value ->> 'tipo') as x
            from jsonb_array_elements(p_retorno) as v(value)
            cross join lateral jsonb_array_elements(
              coalesce(v.value -> 'documentos', '[]'::jsonb)) as doc(value)) t;

  if coalesce(v_docs_esp, '{}'::text[]) is distinct from coalesce(v_docs_dec, '{}'::text[]) then
    -- Ausência NÃO vira `faltante`: normalizar aqui inventaria um fato
    -- que ninguém declarou, e o documento assinado passaria a afirmar
    -- que alguém disse que o papel não voltou.
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'documentos_nao_conferem',
        'faltando', to_jsonb(array(select unnest(coalesce(v_docs_esp, '{}'::text[]))
                                   except select unnest(coalesce(v_docs_dec, '{}'::text[])))),
        'sobrando', to_jsonb(array(select unnest(coalesce(v_docs_dec, '{}'::text[]))
                                   except select unnest(coalesce(v_docs_esp, '{}'::text[])))))),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  perform 1 from public.entregas e
   where e.id = any(v_da_saida) order by e.id for update;

  v_canonico := public.romaneio_retorno_canonico(
    p_saida_romaneio_id, p_saida_document_hash, p_motoboy_id, p_responsavel_id,
    p_retorno);
  v_hash := encode(digest(v_canonico, 'sha256'), 'hex');

  if v_hash <> p_document_hash then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'documento_alterado',
        'hash_assinado', p_document_hash, 'hash_atual', v_hash)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  update public.motoboy_autorizacoes a
     set consumida_em = v_agora
   where a.id = p_autorizacao_id
     and a.tenant_id = v_tenant
     and a.motoboy_id = p_motoboy_id
     and a.document_hash = p_document_hash
     and a.consumida_em is null
     and a.expira_em > v_agora
  returning a.credencial_id into v_credencial_id;

  if v_credencial_id is null then
    raise exception 'Autorização inválida, expirada, já usada ou de outro documento.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, tipo, romaneio_saida_id, status, modo,
     payload, canonico, document_hash, ocorrido_em_local, selado_em,
     criado_por, ip, geolocalizacao)
  values
    (p_romaneio_id, v_tenant, v_saida.loja_id, v_corrida.id, 'retorno',
     p_saida_romaneio_id, 'selado', p_modo,
     public.romaneio_retorno_payload(p_saida_romaneio_id, p_retorno),
     v_canonico, v_hash, p_ocorrido_em_local, v_agora, p_responsavel_id,
     p_ip, p_geolocalizacao)
  returning numero into v_numero;

  update public.motoboy_autorizacoes
     set consumida_por_romaneio = p_romaneio_id
   where id = p_autorizacao_id;

  foreach v_entrega_id in array v_da_saida loop
    insert into public.romaneio_entregas (romaneio_id, entrega_id, tenant_id, ordem)
    values (p_romaneio_id, v_entrega_id, v_tenant, v_ordem);
    v_ordem := v_ordem + 1;
  end loop;

  for v_vale in select v.value from jsonb_array_elements(p_retorno) as v(value)
  loop
    v_entrega_id := (v_vale ->> 'entrega_id')::uuid;
    v_desfecho   := v_vale ->> 'desfecho';
    v_detalhe    := case when v_desfecho = 'insucesso'
                         then nullif(btrim(coalesce(v_vale ->> 'detalhe', '')), '')
                         else null end;

    -- ---- `status_documental`, RECOMPUTADO DO ZERO ---------------------
    -- Absoluto e não incremental: vale de crediário anterior a esta
    -- mudança pode estar `nao_aplica`, e um `d ... faltante` tem que
    -- deixá-lo `pendente` seja qual for o valor antigo.
    --
    -- AGREGADO por vale, porque a coluna é uma só e um vale pode ter os
    -- dois tipos. Com um recebido e um faltante o vale fica `pendente`:
    -- ainda há papel devendo. Nunca `extraviado` — isso é conclusão
    -- posterior de que se perdeu, e não é o retorno que a tira.
    select count(*), count(*) filter (where doc.value ->> 'situacao' = 'recebido')
      into v_esperados_do_vale, v_recebidos_do_vale
      from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as doc(value);

    update public.entregas
       set status_entrega  = v_desfecho,
           insucesso_motivo = case when v_desfecho = 'insucesso'
                                   then v_vale ->> 'motivo' else null end,
           observacoes = case when v_detalhe is not null then v_detalhe
                              else observacoes end,
           status_documental = case
             when v_esperados_do_vale = 0                       then 'nao_aplica'
             when v_recebidos_do_vale = v_esperados_do_vale     then 'recebido'
             else 'pendente'
           end
     where id = v_entrega_id;

    if v_detalhe is not null then
      insert into public.eventos
        (tenant_id, entrega_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
      values
        (v_tenant, v_entrega_id, v_corrida.id, 'insucesso_detalhado',
         jsonb_build_object('motivo', v_vale ->> 'motivo',
                            'motivo_detalhe', v_detalhe,
                            'autor_nome', v_autor_nome,
                            'romaneio_retorno_id', p_romaneio_id),
         p_responsavel_id, p_ocorrido_em_local);
    end if;

    -- Papel que não voltou é pendência aberta, e a gestão precisa saber
    -- sem abrir o documento. Um evento por documento faltante, no mesmo
    -- formato que o Registro de Auditoria já lê.
    insert into public.eventos
      (tenant_id, entrega_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
    select v_tenant, v_entrega_id, v_corrida.id, 'documento_faltante',
           jsonb_build_object('tipo_documento', doc.value ->> 'tipo',
                              'autor_nome', v_autor_nome,
                              'justificativa',
                                'Declarado FALTANTE no Romaneio de Retorno ' || v_numero ||
                                '. O papel precisa retornar à filial.',
                              'romaneio_retorno_id', p_romaneio_id),
           p_responsavel_id, p_ocorrido_em_local
      from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as doc(value)
     where doc.value ->> 'situacao' = 'faltante';

    for v_pag in
      select p.value
        from jsonb_array_elements(coalesce(v_vale -> 'pagamentos_realizados',
                                           '[]'::jsonb)) as p(value)
    loop
      insert into public.pagamentos
        (id, tenant_id, entrega_id, momento, forma, valor_cents, troco_cents,
         registrado_por, registrado_em_local)
      values
        ((v_pag ->> 'pagamento_id')::uuid, v_tenant, v_entrega_id, 'realizado',
         v_pag ->> 'forma', (v_pag ->> 'valor_cents')::integer,
         (v_pag ->> 'troco_cents')::integer,
         p_responsavel_id, p_ocorrido_em_local)
      on conflict (id) do nothing;

      -- Quantas o DCRR1 AFIRMA, quantas o banco de fato GRAVOU.
      get diagnostics v_pr_linhas = row_count;
      v_pr_assinados := v_pr_assinados + 1;
      v_pr_gravados  := v_pr_gravados + v_pr_linhas;
    end loop;

    if v_desfecho = 'entregue' then
      select coalesce(array_agg(pg.forma || '|' || pg.valor_cents
                                order by pg.forma || '|' || pg.valor_cents), '{}')
        into v_previsto
        from public.pagamentos pg
       where pg.entrega_id = v_entrega_id and pg.momento = 'previsto';

      select coalesce(array_agg(x order by x), '{}') into v_realizado
        from (select (p.value ->> 'forma') || '|' || (p.value ->> 'valor_cents') as x
                from jsonb_array_elements(
                       coalesce(v_vale -> 'pagamentos_realizados', '[]'::jsonb)
                     ) as p(value)) t;

      v_divergiu := v_previsto is distinct from v_realizado;

      if v_divergiu then
        update public.entregas
           set status_financeiro = 'divergente'
         where id = v_entrega_id and status_financeiro = 'na_ordem';

        insert into public.eventos
          (tenant_id, entrega_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
        values
          (v_tenant, v_entrega_id, v_corrida.id, 'pagamento_alterado',
           jsonb_build_object(
             -- E3: TODOS os previstos, não "um deles".
             --
             -- Era `limit 1`, e com dois previstos o evento afirmaria que
             -- a divergência foi de UMA das formas, descartando a outra em
             -- silêncio. Num evento de auditoria isso não é registro
             -- incompleto: é registro errado.
             --
             -- ORDEM TOTAL de propósito. `order by pg.forma` sozinho
             -- deixaria empate entre dois previstos da MESMA forma, e o
             -- Postgres não promete ordem útil aí. Mesmos fatos têm que
             -- produzir a mesma representação, mesmo isto não entrando em
             -- hash nenhum.
             --
             -- Sem `coalesce(..., '[]')`: o escalar de antes também
             -- acabava em NULL quando não havia previsto, e uma lista
             -- vazia diria "havia previsto, e ele estava vazio".
             'de', (select jsonb_agg(jsonb_build_object(
                             'forma', pg.forma,
                             'valor_cents', pg.valor_cents)
                           order by pg.forma, pg.id::text collate "C")
                      from public.pagamentos pg
                     where pg.entrega_id = v_entrega_id and pg.momento = 'previsto'),
             'para', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'forma', p.value ->> 'forma',
                        'valor_cents', (p.value ->> 'valor_cents')::integer)
                      order by p.value ->> 'forma')
                 from jsonb_array_elements(
                        coalesce(v_vale -> 'pagamentos_realizados', '[]'::jsonb)
                      ) as p(value)), '[]'::jsonb),
             'justificativa',
               'Divergência derivada do Romaneio de Retorno ' || v_numero ||
               ' — o realizado informado no balcão não bateu com o previsto. ' ||
               'Ninguém digitou esta justificativa.',
             'autor_nome', v_autor_nome,
             'origem', 'romaneio_retorno',
             'romaneio_retorno_id', p_romaneio_id,
             'previsto', to_jsonb(v_previsto),
             'realizado', to_jsonb(v_realizado)),
           p_responsavel_id, p_ocorrido_em_local);
      end if;
    end if;
  end loop;

  -- =====================================================================
  -- CADA LINHA `pr` ASSINADA = UMA LINHA DE PAGAMENTO PERSISTIDA
  --
  -- Esta é a invariante, e "o id não pode colidir com o previsto" é
  -- consequência dela.
  --
  -- O `on conflict (id) do nothing` acima existe por um bom motivo e não
  -- sai: reenvio não pode duplicar pagamento. Mas sozinho ele permite
  -- SUCESSO PARCIAL SILENCIOSO — um DCRR1 selado afirmando um pagamento
  -- realizado que a própria transação não conseguiu gravar.
  --
  -- O caso concreto, achado em 2026-08-20: o `pagamento_id` do PREVISTO é
  -- o mesmo uuid da entrega (desenho de `criarPagamentoPrevisto`, relação
  -- 1:1). Um cliente que pré-preencha o realizado copiando o previsto
  -- inteiro leva esse id junto, o insert bate no conflito, nada é
  -- gravado, e o documento sela mentindo. Sem erro nenhum.
  --
  -- O guard da TELA evita chegar aqui depois de cartão, PIN e duas
  -- assinaturas. Este aqui existe porque segurança não pode depender da
  -- UI: cliente antigo, bugado ou manipulado manda o mesmo payload.
  --
  -- É EXCEÇÃO, e não conflito registrado, de propósito. Conflito preserva
  -- prova de um ato que ACONTECEU; aqui o documento é internamente
  -- inconsistente e não deve existir de forma nenhuma — nem selado, nem
  -- como conflito que alguém possa tentar reaproveitar.
  -- =====================================================================
  if v_pr_gravados <> v_pr_assinados then
    raise exception
      'Pagamento realizado em conflito: o DCRR1 afirma % linha(s) pr e só % foi(ram) gravada(s). '
      'Algum pagamento_id já existe — provavelmente o do pagamento previsto, '
      'que compartilha o uuid da entrega.',
      v_pr_assinados, v_pr_gravados
      using errcode = 'check_violation';
  end if;

  v_agora_txt := to_char(v_agora at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US');

  if v_papel is null or v_papel not in ('caixa', 'gerente', 'admin') then
    raise exception
      'Não dá pra registrar o papel de quem recebeu (perfil % tem papel %). O retorno não foi selado.',
      p_responsavel_id, coalesce(v_papel, '(nenhum)')
      using errcode = 'insufficient_privilege';
  end if;

  v_hash_resp := encode(digest(
    v_hash || '|responsavel_loja|' || p_responsavel_id::text || '|' || v_papel
           || '|' || p_responsavel_strokes::text
           || '|' || v_agora_txt || '|sessao_autenticada', 'sha256'), 'hex');

  v_hash_motoboy := encode(digest(
    v_hash || '|motoboy|' || p_motoboy_id::text || '|' || p_motoboy_strokes::text
           || '|' || v_agora_txt || '|' || p_modo, 'sha256'), 'hex');

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, strokes, hash_sha256,
     user_id, auth_method, document_hash, signature_hash, assinado_em_local,
     ip, geolocalizacao, papel_no_momento)
  values
    (v_tenant, v_corrida.id, p_romaneio_id, 'responsavel_loja',
     p_responsavel_strokes, v_hash_resp, p_responsavel_id, 'sessao_autenticada',
     v_hash, v_hash_resp, p_ocorrido_em_local, p_ip, p_geolocalizacao, v_papel);

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, strokes, hash_sha256,
     motoboy_id, credencial_id, autorizacao_id, auth_method, document_hash,
     signature_hash, assinado_em_local, ip, geolocalizacao)
  values
    (v_tenant, v_corrida.id, p_romaneio_id, 'motoboy', p_motoboy_strokes,
     v_hash_motoboy, p_motoboy_id, v_credencial_id, p_autorizacao_id,
     case p_modo when 'online' then 'physical_card_pin_server_verified'
                 else 'physical_card_pin_offline_then_verified' end,
     v_hash, v_hash_motoboy, p_ocorrido_em_local, p_ip, p_geolocalizacao);

  v_final := encode(digest(v_hash || '|' || v_hash_resp || '|' || v_hash_motoboy,
                           'sha256'), 'hex');
  update public.romaneios set final_hash = v_final where id = p_romaneio_id;

  update public.corridas
     set status = 'fechada',
         retorno_em_local = p_ocorrido_em_local,
         retorno_por = p_responsavel_id
   where id = v_corrida.id;

  insert into public.eventos
    (tenant_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
  values
    (v_tenant, v_corrida.id, 'romaneio_retorno_selado',
     jsonb_build_object('romaneio_id', p_romaneio_id, 'numero', v_numero,
                        'saida_romaneio_id', p_saida_romaneio_id,
                        'modo', p_modo,
                        'vales', coalesce(array_length(v_da_saida, 1), 0),
                        'documentos', coalesce(array_length(v_docs_esp, 1), 0),
                        'final_hash', v_final),
     p_responsavel_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', true, 'ja_existia', false,
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'document_hash', v_hash, 'final_hash', v_final);
end;
$$;

revoke all on function public.selar_romaneio_retorno_interno(
  uuid, uuid, uuid, text, uuid, jsonb, text, uuid, jsonb, jsonb, timestamptz,
  text, inet, jsonb
) from public, anon, authenticated;


-- =====================================================================
-- CONFERIR DEPOIS DE APLICAR
--
-- 1. A derivação da expectativa funciona contra a saída de verdade.
--    Escolha uma saída selada e veja o que ela espera:
--
--   select r.numero, d.entrega_id, d.tipo_documento
--     from public.romaneios r
--     cross join lateral public.documentos_esperados_do_retorno(r.id) d
--    where r.tipo = 'saida' and r.status = 'selado'
--    order by r.numero;
--
--    Se voltar vazio, nenhuma saída selada tem vale de convênio ou
--    crediário — o que é bem possível nos dados de teste. Nesse caso o
--    conjunto esperado é vazio, e um retorno SEM linha `d` é o correto.
--
-- 2. `convcard` não gera expectativa. Esperado: zero linhas.
--
--   select r.numero, d.*
--     from public.romaneios r
--     cross join lateral public.romaneio_documentos_esperados(r.id) d
--    where d.tipo_documento not in ('convenio', 'crediario');
--
-- 3. O placar da 2B continua valendo, e agora tem um ramo a mais pra
--    exercitar: `documentos_nao_conferem`. O
--    `scripts/conferir-2b-no-sql-editor.sql` cobre as recusas antigas;
--    a de documento só é exercitável contra uma saída que ESPERE algum,
--    e por isso ela vai junto do primeiro vale de crediário lançado.
--
-- 4. `verificar_integridade_resumo()` não pode ter se mexido — esta
--    migration não encosta em saída nenhuma. Esperado: a linha `saida`
--    com o mesmo número da última medição.
-- =====================================================================


-- =====================================================================
-- CONFERÊNCIA — E3.B.6, E3.B.7, E3.B.8
--
-- (1) BASELINE, COMO ADMIN, ANTES DE APLICAR ESTA MIGRATION
--
--     select count(*)                                  as verificados,
--            count(*) filter (where divergencias = 0)  as validos,
--            coalesce(sum(divergencias), 0)            as divergencias
--       from public.verificar_romaneios_selados();
--
--     Esperado hoje: 16 · 16 · 0  (13 saídas + 3 retornos)
--
--     COMO ADMIN, senão a RLS devolve baseline parcial sem avisar.
--
--     Se vier outro número: NÃO aplicar, e não presumir regressão.
--     Registrar o resultado real e descobrir por que divergiu — o
--     baseline SOBE a cada saída nova (§64: era 9, virou 10, virou 11),
--     então um número maior pode ser normal. O gate nunca foi "é 16":
--     é "as mesmas que verificavam continuam verificando".
--
-- (2) DEPOIS DE APLICAR, o MESMO comando.
--
--     O gate é  baseline antes == baseline depois.
--     Esta migration não toca em hash nenhum, então qualquer movimento
--     aqui é sinal de que algo além dela mudou.
--
-- ---------------------------------------------------------------------
-- (3) A ESCRITA NOVA, exercitada contra dado real
--
-- Os cinco casos. Rodar como ADMIN, numa transação que se desfaz —
-- `pagamentos` não tem policy de DELETE, e a regra 4 do projeto proíbe
-- apagar; o `rollback` é o que torna isto conferência e não escrita.
--
--     begin;
--
--     -- pega um vale de cliente qualquer pra usar de cobaia
--     select id as entrega_id, tenant_id
--       from public.entregas
--      where tipo = 'cliente'
--      limit 1;
--     -- anote os dois valores e substitua abaixo
--
--     -- ---- caso 1: 0 previstos  →  de = NULL --------------------
--     -- (só rode se a cobaia não tiver previsto; senão pule)
--     select jsonb_agg(jsonb_build_object('forma', pg.forma,
--                                         'valor_cents', pg.valor_cents)
--                      order by pg.forma, pg.id::text collate "C")
--       from public.pagamentos pg
--      where pg.entrega_id = '<ENTREGA_ID>' and pg.momento = 'previsto';
--     -- esperado: NULL   (e NÃO '[]')
--
--     -- ---- caso 2: 1 previsto legado  →  lista de um --------------
--     insert into public.pagamentos (id, tenant_id, entrega_id, momento,
--                                    forma, valor_cents)
--     values ('<ENTREGA_ID>'::uuid, '<TENANT_ID>'::uuid,
--             '<ENTREGA_ID>'::uuid, 'previsto', 'dinheiro', 12345);
--     -- (id = entrega_id: é exatamente o previsto legado)
--     -- rode a query do caso 1 de novo
--     -- esperado: [{"forma":"dinheiro","valor_cents":12345}]
--
--     -- ---- caso 3: 2 previstos  →  os DOIS presentes --------------
--     insert into public.pagamentos (id, tenant_id, entrega_id, momento,
--                                    forma, valor_cents)
--     values (gen_random_uuid(), '<TENANT_ID>'::uuid,
--             '<ENTREGA_ID>'::uuid, 'previsto', 'pix', 5000);
--     -- esperado: dinheiro E pix, nesta ordem (alfabética por forma)
--
--     -- ---- caso 4: ordem de INSERÇÃO não importa ------------------
--     -- O mais valioso dos cinco: prova que o ORDER BY não está só
--     -- decorando o SQL. Repita os casos 2 e 3 num rollback novo,
--     -- inserindo 'pix' PRIMEIRO e 'dinheiro' depois.
--     -- esperado: JSON IDÊNTICO ao do caso 3.
--
--     -- ---- caso 5: mesma FORMA duas vezes  →  desempate por uuid --
--     insert into public.pagamentos (id, tenant_id, entrega_id, momento,
--                                    forma, valor_cents)
--     values ('00000000-0000-0000-0000-0000000000ff'::uuid,
--             '<TENANT_ID>'::uuid, '<ENTREGA_ID>'::uuid,
--             'previsto', 'pix', 111),
--            ('00000000-0000-0000-0000-00000000000a'::uuid,
--             '<TENANT_ID>'::uuid, '<ENTREGA_ID>'::uuid,
--             'previsto', 'pix', 222);
--     -- esperado: o de valor 222 ANTES do de valor 111 — porque
--     -- '...000a' < '...00ff' em collate "C". Sem o segundo critério
--     -- de ordenação, esta ordem seria indefinida.
--
--     rollback;   -- OBRIGATÓRIO. Nada disto pode sobrar no banco.
--
-- ---------------------------------------------------------------------
-- (4) O EVENTO INTEIRO, quando houver um retorno novo pra selar
--
--     select payload -> 'de' as de, payload -> 'para' as para
--       from public.eventos
--      where tipo = 'pagamento_alterado'
--      order by id desc
--      limit 5;
--
--     Os antigos continuam com `de` string — e é assim que fica, para
--     sempre. Os novos saem como lista.
-- =====================================================================
