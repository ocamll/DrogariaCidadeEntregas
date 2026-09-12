-- =====================================================================
-- 4B — O SELO DO RETORNO PASSA A GRAVAR EVIDÊNCIA VERSÃO 2
--
-- A segunda metade do 4B, espelho do que `20260911180000` fez na saída e
-- que o usuário aceitou em 2026-09-12 (online e offline, motoboy e
-- gerente, 28 · 28 · 0). Quatro funções trocam juntas, porque formam um
-- contrato só:
--
--   registrar_conflito_retorno            guarda o que foi APRESENTADO e o
--                                         RESULTADO, no lugar dos traços
--   selar_romaneio_retorno_interno        grava versão 2 e confere a filial
--                                         do gerente contra a da SAÍDA
--   selar_romaneio_retorno                porta online, sem traços
--   selar_romaneio_retorno_sincronizado   porta offline, com o modo de
--                                         validação declarado e conferido
--
-- `autorizar_saida` NÃO muda: a da 4B.2c já aceita o cartão do gerente com
-- motoboy e motivo, e o retorno a chama com o motoboy DA CORRIDA.
--
--
-- ESCRITA A PARTIR DAS DEFINIÇÕES MAIS RECENTES, E NÃO DA 2B
--
-- O interno do retorno já foi redefinido duas vezes depois da 2B (bloco
-- `d`, invariante do pagamento realizado, `pagamento_alterado` com todos os
-- previstos). Esta migration parte de `20260826120000`; o conflito e a
-- porta online de `20260820130000`; a offline de `20260820170000`. Cada
-- trecho alterado foi substituído por texto EXATO, com a contagem de
-- ocorrências conferida — o resto do corpo é byte a byte o que estava no ar:
-- validação do DCRR1, igualdade de vales e de documentos, pagamentos com a
-- invariante, status_documental, eventos, e a ordem que o gatilho da 2C.2
-- exige (os desfechos são gravados ANTES de a corrida fechar; é a corrida
-- fechada que marca o documento como pronto).
--
--
-- NO RETORNO O MOTOBOY NÃO É ESCOLHIDO
--
-- Ele vem da saída. Na exceção, o gerente autentica no lugar dele, mas o
-- interno continua recusando `outro_motoboy` contra a corrida — quem
-- devolve a corrida é quem a levou, com ou sem cartão.
--
--
-- ISTO QUEBRA O RETORNO DO CLIENTE DE HOJE, de propósito, como a saída
-- quebrou: as telas ainda mandam os traços, a assinatura deixa de existir
-- e a chamada falha alto. Aplicar junto com o cliente novo e a
-- sync-romaneio republicada, com a fila de retornos vazia.
-- =====================================================================

begin;

do $$
declare
  v_antes jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(v) order by v.tipo, v.numero, v.romaneio_id), '[]'::jsonb)
    into v_antes
    from public.verificar_romaneios_selados() v;
  perform set_config('app.retorno_v2_antes', v_antes::text, true);
  raise notice 'Placar antes: % documento(s).', jsonb_array_length(v_antes);
end $$;


-- As quatro caem juntas, na ordem das chamadas.
drop function public.selar_romaneio_retorno_sincronizado(
  uuid, uuid, uuid, text, uuid, jsonb, text, text, text, jsonb, jsonb, timestamptz, inet, jsonb);
drop function public.selar_romaneio_retorno(
  uuid, uuid, text, uuid, jsonb, text, uuid, jsonb, jsonb, timestamptz, jsonb);
drop function public.selar_romaneio_retorno_interno(
  uuid, uuid, uuid, text, uuid, jsonb, text, uuid, jsonb, jsonb, timestamptz, text, inet, jsonb);
drop function public.registrar_conflito_retorno(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, inet, jsonb, jsonb, jsonb, jsonb, jsonb);


create function public.registrar_conflito_retorno(
  p_romaneio_id uuid, p_saida_romaneio_id uuid, p_tenant uuid, p_loja_id uuid,
  p_responsavel_id uuid, p_document_hash text, p_ocorrido_em_local timestamptz,
  p_modo text, p_ip inet, p_geolocalizacao jsonb, p_conflitos jsonb,
  p_retorno jsonb, p_validacao jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_numero text;
begin
  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, tipo, romaneio_saida_id, status, modo,
     payload, canonico, document_hash, ocorrido_em_local, criado_por, ip,
     geolocalizacao, conflito)
  values
    (p_romaneio_id, p_tenant, p_loja_id, null, 'retorno', p_saida_romaneio_id,
     'conflito', p_modo,
     -- O payload cru, sem join: se o conflito for justamente "vale que
     -- não é deste romaneio", montar o snapshot bonito falharia ou
     -- esconderia o vale estranho. Aqui interessa o que foi DECLARADO.
     jsonb_build_object('retorno_declarado', p_retorno),
     null, p_document_hash, p_ocorrido_em_local, p_responsavel_id, p_ip,
     p_geolocalizacao,
     -- 4B: o que foi APRESENTADO e o RESULTADO, no lugar dos traços.
     -- Apresentar cartão não é ter sido aceito, e quem chama monta isto com
     -- o resultado junto.
     jsonb_build_object('motivos', p_conflitos,
                        'validacao', coalesce(p_validacao, '{}'::jsonb)))
  on conflict (id) do nothing;

  select r.numero into v_numero from public.romaneios r where r.id = p_romaneio_id;

  insert into public.eventos (tenant_id, tipo, payload, user_id, ocorrido_em_local)
  values (p_tenant, 'conflito_retorno',
          jsonb_build_object('romaneio_id', p_romaneio_id, 'numero', v_numero,
                             'saida_romaneio_id', p_saida_romaneio_id,
                             'modo', p_modo, 'conflitos', p_conflitos),
          p_responsavel_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', false, 'motivo', 'conflito',
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'conflitos', p_conflitos);
end;
$$;

revoke all on function public.registrar_conflito_retorno(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, inet, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;


create function public.selar_romaneio_retorno_interno(
  p_responsavel_id uuid,
  p_romaneio_id uuid,
  p_saida_romaneio_id uuid,
  p_saida_document_hash text,
  p_motoboy_id uuid,
  p_retorno jsonb,
  p_document_hash text,
  p_autorizacao_id uuid,
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
  v_hash_resp     text;
  v_hash_motoboy  text;
  v_final         text;
  -- 4B: a autorização carrega QUEM validou (motoboy ou gerente) e por quê.
  v_autorizacao   record;
  v_gerente       record;
  v_auth_method   text;
  v_validacao     jsonb;
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

  -- ---- 4B: sem traço; a validação que veio na autorização ----------------
  -- Lida já aqui, e não só no consumo, porque TODO registro de conflito
  -- abaixo precisa dela: saber qual cartão foi apresentado — o do motoboy
  -- ou o do gerente no lugar dele — é o que permite reconstruir a cena.
  -- "Autenticada" porque só se chega a ter autorização passando pelo PIN.
  select a.credencial_id, a.validador_profile_id, a.motivo_excecao
    into v_autorizacao
    from public.motoboy_autorizacoes a where a.id = p_autorizacao_id;

  v_validacao := jsonb_build_object(
    'credencial_id', v_autorizacao.credencial_id,
    'validacao', case when v_autorizacao.validador_profile_id is null
                      then 'motoboy' else 'gerente' end,
    'validador_profile_id', v_autorizacao.validador_profile_id,
    'motivo_excecao', v_autorizacao.motivo_excecao,
    'resultado', 'autenticada');

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
      p_retorno, v_validacao);
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
      p_retorno, v_validacao);
  end if;

  if exists (select 1 from public.romaneios r
              where r.corrida_id = v_corrida.id and r.tipo = 'retorno') then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'retorno_ja_existe', 'corrida_id', v_corrida.id)),
      p_retorno, v_validacao);
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
      p_retorno, v_validacao);
  end if;

  v_motivo := public.romaneio_retorno_validar(p_saida_document_hash, p_retorno);
  if v_motivo is not null then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object('motivo', 'retorno_invalido',
                                           'detalhe', v_motivo)),
      p_retorno, v_validacao);
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
      p_retorno, v_validacao);
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
      p_retorno, v_validacao);
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
      p_retorno, v_validacao);
  end if;

  update public.motoboy_autorizacoes a
     set consumida_em = v_agora
   where a.id = p_autorizacao_id
     and a.tenant_id = v_tenant
     and a.motoboy_id = p_motoboy_id
     and a.document_hash = p_document_hash
     and a.consumida_em is null
     and a.expira_em > v_agora
  returning a.credencial_id, a.validador_profile_id, a.motivo_excecao
    into v_autorizacao;

  if v_autorizacao.credencial_id is null then
    raise exception 'Autorização inválida, expirada, já usada ou de outro documento.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- 4B: a exceção — o gerente precisa poder autorizar AQUI ------------
  -- Conferido AGORA, contra a filial da SAÍDA (o retorno não tem loja
  -- própria: ela vem do documento que ele fecha). Gerente desativado,
  -- transferido ou sem o cargo desde a autorização vira conflito com prova
  -- preservada, nunca selo — e o registro diz que a autenticação foi aceita
  -- e o que faltou foi competência.
  if v_autorizacao.validador_profile_id is not null then
    select p.id, p.papel, p.ativo, p.loja_id into v_gerente
      from public.profiles p
     where p.id = v_autorizacao.validador_profile_id and p.tenant_id = v_tenant;

    if v_gerente.id is null or not v_gerente.ativo
       or v_gerente.papel <> 'gerente'
       or v_gerente.loja_id is distinct from v_saida.loja_id then
      return public.registrar_conflito_retorno(
        p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
        p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
        p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'gerente_sem_competencia',
          'gerente', v_autorizacao.validador_profile_id,
          'papel', v_gerente.papel,
          'ativo', v_gerente.ativo,
          'loja_do_gerente', v_gerente.loja_id,
          'loja_da_saida', v_saida.loja_id)),
        p_retorno,
        jsonb_build_object(
          'credencial_id', v_autorizacao.credencial_id,
          'validacao', 'gerente',
          'validador_profile_id', v_autorizacao.validador_profile_id,
          'motivo_excecao', v_autorizacao.motivo_excecao,
          'resultado', 'autenticada_sem_competencia'));
    end if;
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

  if v_papel is null or v_papel not in ('caixa', 'gerente', 'admin') then
    raise exception
      'Não dá pra registrar o papel de quem recebeu (perfil % tem papel %). O retorno não foi selado.',
      p_responsavel_id, coalesce(v_papel, '(nenhum)')
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- evidência VERSÃO 2 (4B) ------------------------------------------
  -- A mesma fórmula EV2 da saída, congelada na 4B.2a. O que diferencia os
  -- dois documentos já está no `document_hash` (DCR1 × DCRR1).
  --
  --   farmácia  `sessao_confirmacao_explicita`: quem RECEBEU confirmou o
  --             conteúdo com um ato, e estar logado não é manifestação
  --   motoboy   o método diz quem autenticou; `credencial_id` é sempre o
  --             cartão que passou pelo bcrypt, e `validador_profile_id` diz
  --             de quem ele é quando foi o do gerente
  v_auth_method := case
    when v_autorizacao.validador_profile_id is not null then
      case p_modo when 'online' then 'gerente_card_pin_server_verified'
                  else 'gerente_card_pin_offline_then_verified' end
    else
      case p_modo when 'online' then 'physical_card_pin_server_verified'
                  else 'physical_card_pin_offline_then_verified' end
  end;

  v_hash_resp := public.evidencia_hash_v2(
    v_hash, 'responsavel_loja', p_responsavel_id, v_papel, null, null, null,
    v_agora, 'sessao_confirmacao_explicita');

  v_hash_motoboy := public.evidencia_hash_v2(
    v_hash, 'motoboy', p_motoboy_id, null, v_autorizacao.credencial_id,
    v_autorizacao.validador_profile_id, v_autorizacao.motivo_excecao,
    v_agora, v_auth_method);

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, versao_evidencia,
     strokes, hash_sha256, user_id, auth_method, document_hash, signature_hash,
     assinado_em_local, ip, geolocalizacao, papel_no_momento)
  values
    (v_tenant, v_corrida.id, p_romaneio_id, 'responsavel_loja', 2,
     null, v_hash_resp, p_responsavel_id, 'sessao_confirmacao_explicita',
     v_hash, v_hash_resp, p_ocorrido_em_local, p_ip, p_geolocalizacao, v_papel);

  -- O motoboy da CORRIDA, sempre — conferido lá em cima contra
  -- `outro_motoboy`. Na exceção, o cartão registrado é o do gerente.
  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, versao_evidencia,
     strokes, hash_sha256, motoboy_id, credencial_id, autorizacao_id,
     validador_profile_id, motivo_excecao, auth_method, document_hash,
     signature_hash, assinado_em_local, ip, geolocalizacao)
  values
    (v_tenant, v_corrida.id, p_romaneio_id, 'motoboy', 2,
     null, v_hash_motoboy, p_motoboy_id, v_autorizacao.credencial_id, p_autorizacao_id,
     v_autorizacao.validador_profile_id, v_autorizacao.motivo_excecao, v_auth_method,
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
                        'final_hash', v_final,
                        'validacao', case when v_autorizacao.validador_profile_id is null
                                          then 'motoboy' else 'gerente' end,
                        'motivo_excecao', v_autorizacao.motivo_excecao),
     p_responsavel_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', true, 'ja_existia', false,
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'document_hash', v_hash, 'final_hash', v_final,
                            'validacao', case when v_autorizacao.validador_profile_id is null
                                              then 'motoboy' else 'gerente' end);
end;
$$;

revoke all on function public.selar_romaneio_retorno_interno(
  uuid, uuid, uuid, text, uuid, jsonb, text, uuid, timestamptz, text, inet, jsonb
) from public, anon, authenticated;


create function public.selar_romaneio_retorno(
  p_romaneio_id uuid, p_saida_romaneio_id uuid, p_saida_document_hash text,
  p_motoboy_id uuid, p_retorno jsonb, p_document_hash text,
  p_autorizacao_id uuid,
  p_ocorrido_em_local timestamptz, p_geolocalizacao jsonb default null
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_ip inet;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = 'insufficient_privilege';
  end if;

  -- O IP não pode vir do cliente (ele diria o que quisesse). Mesma
  -- extração da saída: se não vier, ou vier em formato que não é IP,
  -- fica nulo — registrar nulo é honesto, inventar não é.
  begin
    v_ip := trim(split_part(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1
    ))::inet;
  exception when others then
    v_ip := null;
  end;

  return public.selar_romaneio_retorno_interno(
    auth.uid(), p_romaneio_id, p_saida_romaneio_id, p_saida_document_hash,
    p_motoboy_id, p_retorno, p_document_hash, p_autorizacao_id,
    p_ocorrido_em_local, 'online',
    v_ip, p_geolocalizacao);
end;
$$;

revoke all on function public.selar_romaneio_retorno(
  uuid, uuid, text, uuid, jsonb, text, uuid, timestamptz, jsonb
) from public, anon;
grant execute on function public.selar_romaneio_retorno(
  uuid, uuid, text, uuid, jsonb, text, uuid, timestamptz, jsonb
) to authenticated;


create function public.selar_romaneio_retorno_sincronizado(
  p_responsavel_id       uuid,
  p_romaneio_id          uuid,
  p_saida_romaneio_id    uuid,
  p_saida_document_hash  text,
  p_motoboy_id           uuid,
  p_retorno              jsonb,
  p_document_hash        text,
  p_token                text,
  p_pin                  text,
  p_ocorrido_em_local    timestamptz,
  p_ip                   inet,
  p_geolocalizacao       jsonb,
  -- 4B: QUAL cartão o envelope carrega, e por quê. A Edge Function já
  -- conferiu os dois contra o envelope; aqui eles são conferidos contra o
  -- cartão que de fato autenticou.
  p_validacao            text default 'motoboy',
  p_motivo               text default null
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_existente         record;
  v_tenant            uuid;
  v_papel             text;
  v_loja_do_perfil    uuid;
  v_saida             record;
  v_auth              record;
  v_cred              record;
  v_gerente           record;
  v_autorizacao_id    uuid;
begin
  -- ---- 1. reenvio, ANTES de qualquer credencial -------------------------
  -- Olha o STATUS, não só a existência: um romaneio em conflito também
  -- tem número, e devolvê-lo como "ok, já existia" esconderia o conflito
  -- justamente de quem precisa resolvê-lo.
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

  -- ---- 2. quem é o responsável ------------------------------------------
  -- Vem do `p_responsavel_id`, que a Edge Function tira do JWT validado —
  -- NUNCA do corpo do request. É essa cadeia que torna `papel_no_momento`
  -- um registro de auditoria e não uma afirmação do cliente.
  select p.tenant_id, p.papel, p.loja_id
    into v_tenant, v_papel, v_loja_do_perfil
    from public.profiles p
   where p.id = p_responsavel_id and p.ativo;

  if v_tenant is null then
    raise exception 'Responsável inexistente ou inativo.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_validacao not in ('motoboy', 'gerente') then
    raise exception 'Modo de validação desconhecido: %.', p_validacao
      using errcode = 'check_violation';
  end if;

  -- ---- 3. a saída, pela loja --------------------------------------------
  -- Sem `for update` de propósito — ver o cabeçalho. O interno relê com
  -- lock e é ele quem decide; isto aqui é só pra o conflito ter loja.
  --
  -- NÃO confere `status = 'selado'`, e isso é escolha: se a saída não
  -- estiver selada e a autenticação passar, o interno levanta exceção
  -- (correto, não há corrida pra fechar); se a autenticação falhar, o
  -- conflito grava a prova, que é melhor que perdê-la.
  select r.id, r.tenant_id, r.loja_id, r.tipo into v_saida
    from public.romaneios r where r.id = p_saida_romaneio_id;

  if v_saida.id is null or v_saida.tipo <> 'saida' then
    raise exception 'Romaneio de saída % não existe.', p_saida_romaneio_id
      using errcode = 'no_data_found';
  end if;
  if v_saida.tenant_id <> v_tenant then
    raise exception 'Romaneio de saída não é desta farmácia.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- 4. competência sobre a loja da saída -----------------------------
  -- `v_papel <> 'admin'` espelha `is_admin()`, que é ESTRITAMENTE
  -- `papel = 'admin'`. `superadmin` existe no CHECK de `profiles.papel`
  -- desde o schema inicial e **não entra em `is_admin()`** — logo não
  -- atravessa filial em policy nenhuma, e não pode atravessar aqui.
  -- Acrescentá-lo neste literal abriria um escopo que a RLS fecha.
  if v_papel <> 'admin' and v_loja_do_perfil is distinct from v_saida.loja_id then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local,
      'offline_sincronizada', p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'responsavel_sem_competencia_na_loja',
        'loja_da_saida', v_saida.loja_id,
        'loja_do_responsavel', v_loja_do_perfil,
        'papel', v_papel)),
      p_retorno,
      -- Ainda ninguém autenticou: a recusa é do RESPONSÁVEL, antes do PIN.
      jsonb_build_object('validacao', p_validacao, 'motivo_excecao', p_motivo,
                         'resultado', 'nao_autenticada'));
  end if;

  -- ---- 5. cartão + PIN ---------------------------------------------------
  -- Cartão e PIN DE NOVO, e não é redundância: são duas transferências de
  -- custódia em sentidos opostos. O bloqueio progressivo (30s → 2min →
  -- 5min, teto de 15min, zerado por um acerto) é o mesmo, e é por isso
  -- que a recusa aqui tem que virar item TERMINAL na fila — retentar
  -- queimaria tentativa e derrubaria o motoboy sozinho.
  select * into v_auth
    from public.autenticar_credencial_interno(v_tenant, p_token, p_pin);

  if not v_auth.ok then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local,
      'offline_sincronizada', p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'autenticacao_falhou', 'detalhe', v_auth.motivo,
        'bloqueado_ate', v_auth.bloqueado_ate)),
      p_retorno,
      -- Apresentada e RECUSADA. Sem o resultado aqui o registro diria que
      -- um cartão validou quando não validou.
      jsonb_build_object('validacao', p_validacao, 'motivo_excecao', p_motivo,
                         'resultado', 'recusada', 'detalhe', v_auth.motivo));
  end if;

  select c.motoboy_id, c.profile_id into v_cred
    from public.motoboy_credenciais c where c.id = v_auth.credencial_id;

  if p_validacao = 'motoboy' then
    -- ---- 6a. o cartão é do motoboy que o documento nomeia? ---------------
    -- Corpo declarou motoboy e veio cartão de gerente: motivo próprio. O
    -- envelope já compara o modo; o servidor não acredita, confere.
    if v_cred.motoboy_id is null then
      return public.registrar_conflito_retorno(
        p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
        p_responsavel_id, p_document_hash, p_ocorrido_em_local,
        'offline_sincronizada', p_ip, p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'cartao_de_gerente_sem_declarar', 'gerente', v_cred.profile_id)),
        p_retorno,
        jsonb_build_object('credencial_id', v_auth.credencial_id, 'validacao', 'motoboy',
                           'resultado', 'autenticada_modo_incoerente'));
    end if;

    if v_cred.motoboy_id is distinct from p_motoboy_id then
      return public.registrar_conflito_retorno(
        p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
        p_responsavel_id, p_document_hash, p_ocorrido_em_local,
        'offline_sincronizada', p_ip, p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'cartao_de_outro_motoboy',
          'motoboy_no_retorno', p_motoboy_id,
          'motoboy_do_cartao', v_cred.motoboy_id)),
        p_retorno,
        jsonb_build_object('credencial_id', v_auth.credencial_id, 'validacao', 'motoboy',
                           'resultado', 'autenticada_cartao_errado'));
    end if;

    insert into public.motoboy_autorizacoes
      (tenant_id, credencial_id, motoboy_id, document_hash, expira_em)
    values
      (v_tenant, v_auth.credencial_id, p_motoboy_id, p_document_hash,
       now() + interval '1 minute')
    returning id into v_autorizacao_id;
  else
    -- ---- 6b. a exceção offline: o cartão é de um gerente DAQUELA filial? --
    -- O motoboy continua sendo o do documento (e o interno confere que é o
    -- da corrida). Quem autenticou foi o gerente, e é contra a filial da
    -- SAÍDA que a competência dele é conferida.
    if p_motivo is null then
      raise exception 'Validação por gerente exige motivo.' using errcode = 'check_violation';
    end if;

    if v_cred.profile_id is null then
      return public.registrar_conflito_retorno(
        p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
        p_responsavel_id, p_document_hash, p_ocorrido_em_local,
        'offline_sincronizada', p_ip, p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'cartao_nao_e_de_gerente', 'motoboy_do_cartao', v_cred.motoboy_id)),
        p_retorno,
        jsonb_build_object('credencial_id', v_auth.credencial_id, 'validacao', 'gerente',
                           'motivo_excecao', p_motivo, 'resultado', 'autenticada_modo_incoerente'));
    end if;

    select p.id, p.papel, p.ativo, p.loja_id into v_gerente
      from public.profiles p
     where p.id = v_cred.profile_id and p.tenant_id = v_tenant;

    if v_gerente.id is null or not v_gerente.ativo
       or v_gerente.papel <> 'gerente'
       or v_gerente.loja_id is distinct from v_saida.loja_id then
      return public.registrar_conflito_retorno(
        p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
        p_responsavel_id, p_document_hash, p_ocorrido_em_local,
        'offline_sincronizada', p_ip, p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'gerente_sem_competencia',
          'gerente', v_cred.profile_id,
          'loja_do_gerente', v_gerente.loja_id,
          'loja_da_saida', v_saida.loja_id)),
        p_retorno,
        jsonb_build_object('credencial_id', v_auth.credencial_id, 'validacao', 'gerente',
                           'motivo_excecao', p_motivo, 'resultado', 'autenticada_sem_competencia'));
    end if;

    insert into public.motoboy_autorizacoes
      (tenant_id, credencial_id, motoboy_id, document_hash, expira_em,
       validador_profile_id, motivo_excecao)
    values
      (v_tenant, v_auth.credencial_id, p_motoboy_id, p_document_hash,
       now() + interval '1 minute', v_gerente.id, p_motivo)
    returning id into v_autorizacao_id;
  end if;

  -- ---- 8. o selo, o mesmo dos dois caminhos ------------------------------
  return public.selar_romaneio_retorno_interno(
    p_responsavel_id, p_romaneio_id, p_saida_romaneio_id, p_saida_document_hash,
    p_motoboy_id, p_retorno, p_document_hash, v_autorizacao_id,
    p_ocorrido_em_local,
    'offline_sincronizada', p_ip, p_geolocalizacao);
end;
$$;

-- Só a Edge Function alcança isto, como antes: o `p_responsavel_id` é
-- confiável justamente porque quem chama já provou a identidade contra o JWT.
revoke all on function public.selar_romaneio_retorno_sincronizado(
  uuid, uuid, uuid, text, uuid, jsonb, text, text, text, timestamptz, inet, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.selar_romaneio_retorno_sincronizado(
  uuid, uuid, uuid, text, uuid, jsonb, text, text, text, timestamptz, inet, jsonb, text, text
) to service_role;


-- =====================================================================
-- O GATE — nenhum documento existente pode ter se movido
-- =====================================================================

do $$
declare
  v_antes  jsonb := nullif(current_setting('app.retorno_v2_antes', true), '')::jsonb;
  v_depois jsonb;
begin
  if v_antes is null then
    raise exception 'Baseline não encontrado — o bloco do começo não rodou nesta transação.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(v) order by v.tipo, v.numero, v.romaneio_id), '[]'::jsonb)
    into v_depois
    from public.verificar_romaneios_selados() v;

  if v_antes is distinct from v_depois then
    raise exception E'O placar MOVEU durante a troca das funções — transação desfeita.\nantes:  %\ndepois: %',
      v_antes, v_depois;
  end if;

  raise notice 'Placar idêntico: % documento(s).', jsonb_array_length(v_depois);
end $$;

commit;


-- =====================================================================
-- CONFERÊNCIAS — no SQL Editor, depois de aplicar
--
-- (a) as quatro assinaturas, sem traço nenhum
--
--   select p.proname, pg_get_function_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('registrar_conflito_retorno','selar_romaneio_retorno',
--                        'selar_romaneio_retorno_interno','selar_romaneio_retorno_sincronizado')
--    order by p.proname;
--   -- esperado: nenhuma com `strokes`; a sincronizada com p_validacao e p_motivo
--
-- (b) o placar continua o mesmo — 28 · 28 · 0
--
--   select * from public.verificar_integridade_resumo();
-- =====================================================================
