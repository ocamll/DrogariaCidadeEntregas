-- =====================================================================
-- 4B.2c — O SELO DA SAÍDA PASSA A GRAVAR EVIDÊNCIA VERSÃO 2
--
-- É aqui que o cartão do gerente começa a AUTORIZAR de verdade, e é aqui
-- que o traço manuscrito sai da saída. Cinco funções são substituídas de
-- uma vez porque elas formam um contrato só: quem tira `strokes` de uma
-- tem que tirar das outras quatro no mesmo instante.
--
--   autorizar_saida              aceita o cartão do gerente, com o
--                                motoboy escolhido e o motivo
--   registrar_conflito_romaneio  guarda O QUE FOI APRESENTADO e o
--                                RESULTADO, no lugar dos traços
--   selar_romaneio_interno       grava versão 2, sem traço, e confere a
--                                filial do gerente contra a do documento
--   selar_romaneio               porta online, sem traços
--   selar_romaneio_sincronizado  porta offline, sem traços e com o modo
--                                de validação declarado
--
--
-- ISTO QUEBRA O CLIENTE DE HOJE, E É ASSIM QUE TEM QUE SER
--
-- As telas ainda mandam `p_caixa_strokes` e `p_motoboy_strokes`. Depois
-- desta migration, a chamada delas não encontra função com aquela
-- assinatura e falha ALTO — não em silêncio, não gravando metade. O
-- cliente novo (4B.4) entra logo atrás, e é por isso que estas duas
-- coisas andam na mesma sessão de trabalho.
--
-- Manter uma sobrecarga com traços "por compatibilidade" seria criar hoje
-- o caminho que a 2D.6 mandou não criar: compatibilidade com um formato
-- que só existiu durante o desenvolvimento.
--
--
-- O QUE O DOCUMENTO PASSA A AFIRMAR
--
--   farmácia   confirmou, na sessão, com ato explícito
--              auth_method = sessao_confirmacao_explicita
--   motoboy    validou com cartão e PIN — ou o GERENTE validou no lugar
--              dele, com cartão e PIN próprios, por um motivo nomeado
--
-- E ele nunca afirma que o motoboy autenticou quando quem autenticou foi
-- o gerente: na exceção, `credencial_id` é o cartão do gerente (o que de
-- fato passou pelo bcrypt), `validador_profile_id` diz de quem ele é, e
-- `motivo_excecao` diz por quê. Os três entram no digest (4B.2a), então
-- trocar qualquer um depois quebra a conferência.
--
-- O VALE CONTINUA DO MOTOBOY. `corridas.mototaxista_id` e
-- `assinaturas.motoboy_id` recebem o motoboy escolhido, não o titular do
-- cartão apresentado — é o que o desenho chama de "a autorização do
-- gerente não transfere a atribuição".
--
--
-- A FILIAL DO GERENTE É CONFERIDA NO SELO, E NÃO NA AUTORIZAÇÃO
--
-- A autorização conhece só o `document_hash`; a filial do documento é
-- conhecida aqui. E a conferência acontece de novo AGORA mesmo quando a
-- autorização nasceu dois minutos atrás: gerente desativado, transferido
-- de filial ou com cartão revogado nesse meio tempo vira CONFLITO com
-- prova preservada, nunca selo — a mesma regra que o cartão do motoboy
-- já tinha.
-- =====================================================================

begin;

do $$
declare
  v_antes jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(v) order by v.tipo, v.numero, v.romaneio_id), '[]'::jsonb)
    into v_antes
    from public.verificar_romaneios_selados() v;
  perform set_config('app.selo_v2_antes', v_antes::text, true);
  raise notice 'Placar antes: % documento(s).', jsonb_array_length(v_antes);
end $$;


-- As cinco caem juntas. A ordem é a das dependências de chamada, pra
-- nenhuma ficar apontando pra uma assinatura que não existe mais.
drop function public.selar_romaneio_sincronizado(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid[], text, text, text, jsonb, jsonb,
  timestamptz, inet, jsonb);
drop function public.selar_romaneio(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid, jsonb, jsonb, timestamptz, jsonb);
drop function public.selar_romaneio_interno(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid, jsonb, jsonb,
  timestamptz, text, inet, jsonb);
drop function public.registrar_conflito_romaneio(
  uuid, uuid, uuid, uuid, text, timestamptz, text, inet, jsonb, jsonb, uuid[], jsonb, jsonb);
drop function public.autorizar_saida(text, text, text);


-- =====================================================================
-- 1. AUTORIZAR — o cartão do motoboy, OU o do gerente
--
-- Continua sendo uma autorização de USO ÚNICO amarrada ao
-- `document_hash`, e continua não levantando exceção com PIN errado (o
-- contador de tentativas precisa commitar). O que muda é que agora ela
-- reconhece de quem é o cartão apresentado e cobra o que falta em cada
-- caso:
--
--   cartão do motoboy   o motoboy SAI da credencial. Motivo não faz
--                       sentido aqui, e mandar um é erro de quem chama
--   cartão do gerente   o motoboy é ESCOLHIDO (parâmetro) e o motivo é
--                       obrigatório. Nenhum cartão do motoboy participa
--
-- O segundo caso é o ponto inteiro do 4B: o motoboy que perdeu o cartão
-- ou esqueceu o PIN não tem o que apresentar, então exigir o cartão dele
-- seria pedir justamente o que falta.
-- =====================================================================

create function public.autorizar_saida(
  p_token text,
  p_pin text,
  p_document_hash text,
  p_motoboy_id uuid default null,
  p_motivo text default null
)
returns table (ok boolean, motivo text, autorizacao_id uuid, expira_em timestamptz)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_auth record;
  v_cred record;
  v_perfil record;
  v_motoboy_id uuid;
  v_validador uuid;
  v_motivo text;
  v_id uuid;
  v_expira timestamptz;
begin
  if v_tenant is null then
    raise exception 'Sessão sem tenant.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_auth from public.autenticar_credencial(p_token, p_pin);

  if not v_auth.ok then
    return query select false, v_auth.motivo, null::uuid, null::timestamptz;
    return;
  end if;

  select c.motoboy_id, c.profile_id into v_cred
    from public.motoboy_credenciais c where c.id = v_auth.credencial_id;

  if v_cred.motoboy_id is not null then
    -- ---- caminho normal ----------------------------------------------
    if p_motivo is not null then
      return query select false, 'motivo_sem_excecao'::text, null::uuid, null::timestamptz;
      return;
    end if;
    -- Quem escolheu um motoboy e apresentou o cartão de outro está
    -- errado sobre uma das duas coisas, e o selo recusaria depois.
    if p_motoboy_id is not null and p_motoboy_id <> v_cred.motoboy_id then
      return query select false, 'cartao_de_outro_motoboy'::text, null::uuid, null::timestamptz;
      return;
    end if;
    v_motoboy_id := v_cred.motoboy_id;
    v_validador  := null;
    v_motivo     := null;
  else
    -- ---- caminho excepcional -----------------------------------------
    if p_motoboy_id is null or p_motivo is null then
      return query select false, 'excecao_exige_motoboy_e_motivo'::text, null::uuid, null::timestamptz;
      return;
    end if;

    select p.id, p.papel, p.ativo, p.loja_id into v_perfil
      from public.profiles p
     where p.id = v_cred.profile_id and p.tenant_id = v_tenant;

    -- O cartão continua existindo depois de a pessoa deixar de ser
    -- gerente. Quem decide é o perfil de AGORA, não o de quando o cartão
    -- foi impresso.
    if v_perfil.id is null or not v_perfil.ativo or v_perfil.papel <> 'gerente' then
      return query select false, 'gerente_invalido'::text, null::uuid, null::timestamptz;
      return;
    end if;

    if not exists (
      select 1 from public.mototaxistas m
       where m.id = p_motoboy_id and m.tenant_id = v_tenant and m.ativo
    ) then
      return query select false, 'motoboy_invalido'::text, null::uuid, null::timestamptz;
      return;
    end if;

    v_motoboy_id := p_motoboy_id;
    v_validador  := v_perfil.id;
    v_motivo     := p_motivo;
  end if;

  v_expira := now() + interval '2 minutes';

  insert into public.motoboy_autorizacoes
    (tenant_id, credencial_id, motoboy_id, document_hash, expira_em,
     validador_profile_id, motivo_excecao)
  values
    (v_tenant, v_auth.credencial_id, v_motoboy_id, p_document_hash, v_expira,
     v_validador, v_motivo)
  returning id into v_id;

  return query select true, null::text, v_id, v_expira;
end;
$$;

revoke all on function public.autorizar_saida(text, text, text, uuid, text) from public, anon;
grant execute on function public.autorizar_saida(text, text, text, uuid, text) to authenticated;


-- =====================================================================
-- 2. CONFLITO — o que foi APRESENTADO e o que foi o RESULTADO
--
-- Os traços iam para cá justamente porque eram a prova de que uma
-- retirada física aconteceu. Sem eles, a prova passa a ser a validação:
-- qual credencial foi apresentada, em que modo, por qual motivo, e o que
-- o servidor respondeu.
--
-- APRESENTAR NÃO É TER SIDO ACEITO, e o registro precisa distinguir as
-- duas coisas: um conflito por PIN errado não pode ficar gravado como
-- "o gerente validou". Por isso quem chama monta `p_validacao` com o
-- resultado junto, e não só com o que veio na mão.
-- =====================================================================

create function public.registrar_conflito_romaneio(
  p_romaneio_id uuid, p_tenant uuid, p_loja_id uuid, p_caixa_id uuid,
  p_document_hash text, p_ocorrido_em_local timestamptz, p_modo text,
  p_ip inet, p_geolocalizacao jsonb, p_conflitos jsonb,
  p_entrega_ids uuid[], p_validacao jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_numero text;
begin
  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, status, modo, payload, canonico,
     document_hash, ocorrido_em_local, criado_por, ip, geolocalizacao, conflito)
  values
    (p_romaneio_id, p_tenant, p_loja_id, null, 'conflito', p_modo,
     jsonb_build_object('entrega_ids', to_jsonb(p_entrega_ids)), null,
     p_document_hash, p_ocorrido_em_local, p_caixa_id, p_ip, p_geolocalizacao,
     jsonb_build_object('motivos', p_conflitos,
                        'validacao', coalesce(p_validacao, '{}'::jsonb)))
  on conflict (id) do nothing;

  select r.numero into v_numero from public.romaneios r where r.id = p_romaneio_id;

  insert into public.eventos (tenant_id, tipo, payload, user_id, ocorrido_em_local)
  values (p_tenant, 'conflito_sincronizacao',
          jsonb_build_object('romaneio_id', p_romaneio_id, 'numero', v_numero,
                             'modo', p_modo, 'conflitos', p_conflitos),
          p_caixa_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', false, 'motivo', 'conflito',
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'conflitos', p_conflitos);
end;
$$;

revoke all on function public.registrar_conflito_romaneio(
  uuid, uuid, uuid, uuid, text, timestamptz, text, inet, jsonb, jsonb, uuid[], jsonb
) from public, anon, authenticated;


-- =====================================================================
-- 3. O SELO — quinta definição
--
-- Tudo o que já estava aqui continua: o reenvio idempotente antes do
-- lock, a competência de filial do E10.1 (o ator é o PARÂMETRO, nunca a
-- sessão), o FOR UPDATE nos vales antes de validar, o conflito que
-- COMMITA, o canônico recalculado do banco, a autorização de uso único e
-- a ordem corrida → vales → romaneio → vínculo → assinaturas.
--
-- O que sai: os dois traços e a exigência deles.
-- O que entra: a conferência da filial do gerente e a evidência v2.
-- =====================================================================

create function public.selar_romaneio_interno(
  p_caixa_id uuid,
  p_romaneio_id uuid,
  p_corrida_id uuid,
  p_loja_id uuid,
  p_agencia_id uuid,
  p_motoboy_id uuid,
  p_entrega_ids uuid[],
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
  v_tenant uuid;
  v_papel text;
  v_loja_do_ator uuid;
  v_existente record;
  v_canonico text;
  v_hash text;
  v_conflitos jsonb;
  v_numero text;
  v_agora timestamptz := now();
  v_hash_caixa text;
  v_hash_motoboy text;
  v_final text;
  v_autorizacao record;
  v_gerente record;
  v_auth_method text;
  v_validacao jsonb;
  v_ordem smallint := 0;
  v_entrega_id uuid;
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

  -- O ator é `p_caixa_id`, não a sessão (E10.1).
  select p.tenant_id, p.papel, p.loja_id
    into v_tenant, v_papel, v_loja_do_ator
    from public.profiles p
   where p.id = p_caixa_id and p.ativo;
  if v_tenant is null then
    raise exception 'Caixa inexistente ou inativo.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.lojas l where l.id = p_loja_id and l.tenant_id = v_tenant
  ) then
    raise exception 'Filial inválida para este tenant.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_papel <> 'admin' and p_loja_id is distinct from v_loja_do_ator then
    raise exception 'Sem competência sobre esta filial.'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(array_length(p_entrega_ids, 1), 0) = 0 then
    raise exception 'Romaneio sem vale nenhum.' using errcode = 'check_violation';
  end if;

  perform 1 from public.entregas e
   where e.id = any(p_entrega_ids)
   order by e.id
   for update;

  select jsonb_agg(jsonb_build_object(
           'entrega_id', e.id, 'numero_vale', e.numero_vale,
           'status_entrega', e.status_entrega, 'corrida_id', e.corrida_id,
           'motivo', case
             when e.tenant_id <> v_tenant then 'outro_tenant'
             when e.loja_id <> p_loja_id then 'outra_filial'
             when e.corrida_id is not null then 'ja_em_corrida'
             else 'status_nao_permite'
           end))
    into v_conflitos
    from public.entregas e
   where e.id = any(p_entrega_ids)
     and (e.tenant_id <> v_tenant
       or e.loja_id <> p_loja_id
       or e.corrida_id is not null
       or e.status_entrega <> 'pendente');

  if (select count(*) from public.entregas e where e.id = any(p_entrega_ids))
     <> array_length(p_entrega_ids, 1) then
    v_conflitos := coalesce(v_conflitos, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('motivo', 'vale_inexistente'));
  end if;

  -- A validação que veio na autorização entra no registro de conflito
  -- desde já: mesmo quando o conflito é dos VALES, saber qual cartão foi
  -- apresentado é o que permite reconstruir a cena depois.
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

  if v_conflitos is not null then
    return public.registrar_conflito_romaneio(
      p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
      p_ocorrido_em_local, p_modo, p_ip, p_geolocalizacao, v_conflitos,
      p_entrega_ids, v_validacao);
  end if;

  v_canonico := public.romaneio_canonico(v_tenant, p_loja_id, p_agencia_id,
                                         p_motoboy_id, p_caixa_id, p_entrega_ids);
  v_hash := encode(digest(v_canonico, 'sha256'), 'hex');

  if v_hash <> p_document_hash then
    return public.registrar_conflito_romaneio(
      p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
      p_ocorrido_em_local, p_modo, p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'documento_alterado',
        'hash_assinado', p_document_hash, 'hash_atual', v_hash)),
      p_entrega_ids, v_validacao);
  end if;

  -- ---- consome a autorização ------------------------------------------
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

  -- ---- a exceção: o gerente precisa poder autorizar AQUI ---------------
  -- Conferido AGORA, e não só quando a autorização nasceu: entre um
  -- instante e outro o gerente pode ter sido desativado, mudado de
  -- filial ou perdido o cargo. Vira conflito com prova preservada, nunca
  -- selo — e o registro diz que a autenticação foi aceita e o que
  -- faltou foi competência, que são coisas diferentes.
  if v_autorizacao.validador_profile_id is not null then
    select p.id, p.papel, p.ativo, p.loja_id into v_gerente
      from public.profiles p
     where p.id = v_autorizacao.validador_profile_id and p.tenant_id = v_tenant;

    if v_gerente.id is null or not v_gerente.ativo
       or v_gerente.papel <> 'gerente'
       or v_gerente.loja_id is distinct from p_loja_id then
      return public.registrar_conflito_romaneio(
        p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
        p_ocorrido_em_local, p_modo, p_ip, p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'gerente_sem_competencia',
          'gerente', v_autorizacao.validador_profile_id,
          'papel', v_gerente.papel,
          'ativo', v_gerente.ativo,
          'loja_do_gerente', v_gerente.loja_id,
          'loja_do_documento', p_loja_id)),
        p_entrega_ids,
        jsonb_build_object(
          'credencial_id', v_autorizacao.credencial_id,
          'validacao', 'gerente',
          'validador_profile_id', v_autorizacao.validador_profile_id,
          'motivo_excecao', v_autorizacao.motivo_excecao,
          'resultado', 'autenticada_sem_competencia'));
    end if;
  end if;

  -- ---- ORDEM DAQUI PRA BAIXO IMPORTA ----------------------------------
  insert into public.corridas
    (id, tenant_id, loja_id, mototaxista_id, agencia_id, status,
     saida_por, saida_em_local)
  values
    (p_corrida_id, v_tenant, p_loja_id, p_motoboy_id, p_agencia_id, 'aberta',
     p_caixa_id, p_ocorrido_em_local);

  update public.entregas
     set corrida_id = p_corrida_id, status_entrega = 'em_rota'
   where id = any(p_entrega_ids);

  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, status, modo, payload, canonico,
     document_hash, ocorrido_em_local, selado_em, criado_por, ip, geolocalizacao)
  values
    (p_romaneio_id, v_tenant, p_loja_id, p_corrida_id, 'selado', p_modo,
     public.romaneio_payload(p_loja_id, p_agencia_id, p_motoboy_id, p_caixa_id, p_entrega_ids),
     v_canonico, v_hash, p_ocorrido_em_local, v_agora, p_caixa_id,
     p_ip, p_geolocalizacao)
  returning numero into v_numero;

  update public.motoboy_autorizacoes
     set consumida_por_romaneio = p_romaneio_id
   where id = p_autorizacao_id;

  foreach v_entrega_id in array p_entrega_ids loop
    insert into public.romaneio_entregas (romaneio_id, entrega_id, tenant_id, ordem)
    values (p_romaneio_id, v_entrega_id, v_tenant, v_ordem);
    v_ordem := v_ordem + 1;
  end loop;

  -- ---- a checagem do papel, no único ponto onde a coluna existe -------
  -- Continua depois do caminho do conflito, pelo mesmo motivo de antes:
  -- cedo demais, derrubaria também a gravação da prova.
  if v_papel is null or v_papel not in ('caixa', 'gerente', 'admin') then
    raise exception
      'Não dá pra registrar o papel de quem confirmou (perfil % tem papel %). A saída não foi selada.',
      p_caixa_id, coalesce(v_papel, '(nenhum)')
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- evidência VERSÃO 2 ----------------------------------------------
  -- Sem traço. O que cada parte afirma:
  --
  --   farmácia  confirmou o conteúdo, na sessão, com ato explícito —
  --             `sessao_confirmacao_explicita`, e não mais
  --             `sessao_autenticada`: estar logado não é manifestação
  --   motoboy   validou com cartão e PIN, OU o gerente validou no lugar
  --             dele. `credencial_id` é sempre o cartão que passou pelo
  --             bcrypt; `validador_profile_id` diz de quem ele é
  v_auth_method := case
    when v_autorizacao.validador_profile_id is not null then
      case p_modo when 'online' then 'gerente_card_pin_server_verified'
                  else 'gerente_card_pin_offline_then_verified' end
    else
      case p_modo when 'online' then 'physical_card_pin_server_verified'
                  else 'physical_card_pin_offline_then_verified' end
  end;

  v_hash_caixa := public.evidencia_hash_v2(
    v_hash, 'caixa', p_caixa_id, v_papel, null, null, null,
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
    (v_tenant, p_corrida_id, p_romaneio_id, 'caixa', 2,
     null, v_hash_caixa, p_caixa_id, 'sessao_confirmacao_explicita', v_hash,
     v_hash_caixa, p_ocorrido_em_local, p_ip, p_geolocalizacao, v_papel);

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, versao_evidencia,
     strokes, hash_sha256, motoboy_id, credencial_id, autorizacao_id,
     validador_profile_id, motivo_excecao, auth_method, document_hash,
     signature_hash, assinado_em_local, ip, geolocalizacao)
  values
    (v_tenant, p_corrida_id, p_romaneio_id, 'motoboy', 2,
     null, v_hash_motoboy, p_motoboy_id, v_autorizacao.credencial_id, p_autorizacao_id,
     v_autorizacao.validador_profile_id, v_autorizacao.motivo_excecao, v_auth_method,
     v_hash, v_hash_motoboy, p_ocorrido_em_local, p_ip, p_geolocalizacao);

  v_final := encode(digest(v_hash || '|' || v_hash_caixa || '|' || v_hash_motoboy,
                           'sha256'), 'hex');
  update public.romaneios set final_hash = v_final where id = p_romaneio_id;

  insert into public.eventos (tenant_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
  values (v_tenant, p_corrida_id, 'romaneio_selado',
          jsonb_build_object('romaneio_id', p_romaneio_id, 'numero', v_numero,
                             'modo', p_modo, 'vales', array_length(p_entrega_ids, 1),
                             'final_hash', v_final,
                             'validacao', case when v_autorizacao.validador_profile_id is null
                                               then 'motoboy' else 'gerente' end,
                             'motivo_excecao', v_autorizacao.motivo_excecao),
          p_caixa_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', true, 'ja_existia', false,
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'document_hash', v_hash, 'final_hash', v_final,
                            'validacao', case when v_autorizacao.validador_profile_id is null
                                              then 'motoboy' else 'gerente' end);
end;
$$;

revoke all on function public.selar_romaneio_interno(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid, timestamptz, text, inet, jsonb
) from public, anon, authenticated;


-- =====================================================================
-- 4. A PORTA ONLINE — a identidade do caixa sai do JWT, nunca do corpo
-- =====================================================================

create function public.selar_romaneio(
  p_romaneio_id uuid, p_corrida_id uuid, p_loja_id uuid, p_agencia_id uuid,
  p_motoboy_id uuid, p_entrega_ids uuid[], p_document_hash text,
  p_autorizacao_id uuid, p_ocorrido_em_local timestamptz,
  p_geolocalizacao jsonb default null
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_ip inet;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = 'insufficient_privilege';
  end if;

  begin
    v_ip := trim(split_part(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1
    ))::inet;
  exception when others then
    v_ip := null;
  end;

  return public.selar_romaneio_interno(
    auth.uid(), p_romaneio_id, p_corrida_id, p_loja_id, p_agencia_id,
    p_motoboy_id, p_entrega_ids, p_document_hash, p_autorizacao_id,
    p_ocorrido_em_local, 'online', v_ip, p_geolocalizacao);
end;
$$;

revoke all on function public.selar_romaneio(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid, timestamptz, jsonb
) from public, anon;
grant execute on function public.selar_romaneio(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid, timestamptz, jsonb
) to authenticated;


-- =====================================================================
-- 5. A PORTA OFFLINE — autentica agora o que foi digitado no balcão
--
-- `p_validacao` declara QUAL cartão o envelope carrega, e o servidor
-- COMPARA em vez de acreditar: com 'motoboy', a credencial precisa ser
-- do motoboy que a saída nomeia; com 'gerente', precisa ser de um
-- gerente ativo DAQUELA filial, e o motivo é obrigatório.
--
-- Falha aqui continua sendo TERMINAL, não retentável: o PIN foi digitado
-- uma vez, no balcão, e repetir só queimaria tentativa. Vira conflito
-- registrado, que preserva a prova e chama gente.
-- =====================================================================

create function public.selar_romaneio_sincronizado(
  p_caixa_id uuid,
  p_romaneio_id uuid,
  p_corrida_id uuid,
  p_loja_id uuid,
  p_agencia_id uuid,
  p_motoboy_id uuid,
  p_entrega_ids uuid[],
  p_document_hash text,
  p_token text,
  p_pin text,
  p_ocorrido_em_local timestamptz,
  p_ip inet,
  p_geolocalizacao jsonb,
  p_validacao text default 'motoboy',
  p_motivo text default null
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_tenant uuid;
  v_auth record;
  v_cred record;
  v_gerente record;
  v_autorizacao_id uuid;
begin
  select p.tenant_id into v_tenant from public.profiles p
   where p.id = p_caixa_id and p.ativo;
  if v_tenant is null then
    raise exception 'Caixa inexistente ou inativo.' using errcode = 'insufficient_privilege';
  end if;

  if p_validacao not in ('motoboy', 'gerente') then
    raise exception 'Modo de validação desconhecido: %.', p_validacao
      using errcode = 'check_violation';
  end if;

  select * into v_auth
    from public.autenticar_credencial_interno(v_tenant, p_token, p_pin);

  if not v_auth.ok then
    return public.registrar_conflito_romaneio(
      p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
      p_ocorrido_em_local, 'offline_sincronizada', p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'autenticacao_falhou', 'detalhe', v_auth.motivo)),
      p_entrega_ids,
      -- Apresentada e RECUSADA. Sem o resultado aqui, o registro diria
      -- que um cartão validou quando ele não validou.
      jsonb_build_object('validacao', p_validacao, 'motivo_excecao', p_motivo,
                         'resultado', 'recusada', 'detalhe', v_auth.motivo));
  end if;

  select c.motoboy_id, c.profile_id into v_cred
    from public.motoboy_credenciais c where c.id = v_auth.credencial_id;

  if p_validacao = 'motoboy' then
    -- Corpo declarou motoboy e veio cartão de gerente. O envelope já
    -- compara o modo (4B.3), mas o servidor não acredita: confere.
    if v_cred.motoboy_id is null then
      return public.registrar_conflito_romaneio(
        p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
        p_ocorrido_em_local, 'offline_sincronizada', p_ip, p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'cartao_de_gerente_sem_declarar',
          'gerente', v_cred.profile_id)),
        p_entrega_ids,
        jsonb_build_object('credencial_id', v_auth.credencial_id,
                           'validacao', 'motoboy',
                           'resultado', 'autenticada_modo_incoerente'));
    end if;

    -- O cartão apresentado tem que ser do motoboy que a saída diz ser.
    if v_cred.motoboy_id is distinct from p_motoboy_id then
      return public.registrar_conflito_romaneio(
        p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
        p_ocorrido_em_local, 'offline_sincronizada', p_ip, p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'cartao_de_outro_motoboy',
          'motoboy_na_saida', p_motoboy_id, 'motoboy_do_cartao', v_cred.motoboy_id)),
        p_entrega_ids,
        jsonb_build_object('credencial_id', v_auth.credencial_id,
                           'validacao', 'motoboy', 'resultado', 'autenticada_cartao_errado'));
    end if;

    insert into public.motoboy_autorizacoes
      (tenant_id, credencial_id, motoboy_id, document_hash, expira_em)
    values
      (v_tenant, v_auth.credencial_id, p_motoboy_id, p_document_hash,
       now() + interval '1 minute')
    returning id into v_autorizacao_id;
  else
    -- ---- exceção offline ---------------------------------------------
    if p_motivo is null then
      raise exception 'Validação por gerente exige motivo.' using errcode = 'check_violation';
    end if;

    -- Corpo declarou gerente e veio cartão de motoboy: recusa própria,
    -- porque a frase "gerente sem competência" mandaria procurar filial
    -- errada onde o que houve foi outro cartão.
    if v_cred.profile_id is null then
      return public.registrar_conflito_romaneio(
        p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
        p_ocorrido_em_local, 'offline_sincronizada', p_ip, p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'cartao_nao_e_de_gerente',
          'motoboy_do_cartao', v_cred.motoboy_id)),
        p_entrega_ids,
        jsonb_build_object('credencial_id', v_auth.credencial_id,
                           'validacao', 'gerente', 'motivo_excecao', p_motivo,
                           'resultado', 'autenticada_modo_incoerente'));
    end if;

    select p.id, p.papel, p.ativo, p.loja_id into v_gerente
      from public.profiles p
     where p.id = v_cred.profile_id and p.tenant_id = v_tenant;

    if v_gerente.id is null or not v_gerente.ativo
       or v_gerente.papel <> 'gerente'
       or v_gerente.loja_id is distinct from p_loja_id then
      return public.registrar_conflito_romaneio(
        p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
        p_ocorrido_em_local, 'offline_sincronizada', p_ip, p_geolocalizacao,
        jsonb_build_array(jsonb_build_object(
          'motivo', 'gerente_sem_competencia',
          'gerente', v_cred.profile_id,
          'loja_do_gerente', v_gerente.loja_id,
          'loja_do_documento', p_loja_id)),
        p_entrega_ids,
        jsonb_build_object('credencial_id', v_auth.credencial_id,
                           'validacao', 'gerente', 'motivo_excecao', p_motivo,
                           'resultado', 'autenticada_sem_competencia'));
    end if;

    insert into public.motoboy_autorizacoes
      (tenant_id, credencial_id, motoboy_id, document_hash, expira_em,
       validador_profile_id, motivo_excecao)
    values
      (v_tenant, v_auth.credencial_id, p_motoboy_id, p_document_hash,
       now() + interval '1 minute', v_gerente.id, p_motivo)
    returning id into v_autorizacao_id;
  end if;

  return public.selar_romaneio_interno(
    p_caixa_id, p_romaneio_id, p_corrida_id, p_loja_id, p_agencia_id,
    p_motoboy_id, p_entrega_ids, p_document_hash, v_autorizacao_id,
    p_ocorrido_em_local, 'offline_sincronizada', p_ip, p_geolocalizacao);
end;
$$;

revoke all on function public.selar_romaneio_sincronizado(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid[], text, text, text, timestamptz,
  inet, jsonb, text, text
) from public, anon, authenticated;


-- =====================================================================
-- O GATE — nenhum documento existente pode ter se movido
-- =====================================================================

do $$
declare
  v_antes  jsonb := nullif(current_setting('app.selo_v2_antes', true), '')::jsonb;
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
-- (a) as assinaturas das funções, sem traço nenhum
--
--   select p.proname, pg_get_function_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('autorizar_saida','selar_romaneio',
--                        'selar_romaneio_interno','selar_romaneio_sincronizado',
--                        'registrar_conflito_romaneio')
--    order by p.proname;
--   -- esperado: nenhuma com `strokes`; autorizar_saida com p_motoboy_id e
--   -- p_motivo; selar_romaneio_sincronizado com p_validacao e p_motivo
--
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'autorizar_saida';
--   -- esperado: 1 — sobrecarga faria o PostgREST recusar por ambiguidade
--
--
-- (b) o placar continua o mesmo
--
--   select * from public.verificar_integridade_resumo();
--   -- esperado: 22 · 22 · 0. As saídas antigas continuam versão 1 e
--   -- continuam verificando pela fórmula histórica.
--
--
-- (c) a exceção é recusada quando o gerente não é daquela filial
--
--   Isto é E2E de tela (exige o cartão e o PIN na mão), e vai junto com a
--   4B.4. O que dá pra conferir aqui é a FORMA da recusa:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'motoboy_autorizacoes_excecao_coerente';
--   -- esperado: (validador_profile_id is null) = (motivo_excecao is null)
--
--
-- (d) o que o cliente de hoje faz agora
--
--   Nada. A chamada dele manda `p_caixa_strokes`, essa assinatura não
--   existe mais, e o PostgREST responde 404 (função não encontrada) —
--   alto e imediato. O cliente novo entra na 4B.4.
-- =====================================================================
