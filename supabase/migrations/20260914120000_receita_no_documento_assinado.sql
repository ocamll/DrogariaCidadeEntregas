-- =====================================================================
-- A RECEITA NO DOCUMENTO ASSINADO — 2026-09-14
--
-- Decisão do usuário (item 111 do NOTAS), em duas partes:
--
--   1. a receita é conferida no RETORNO, dentro do documento assinado —
--      confirmada com cartão e PIN, como convênio e crediário;
--   2. a expectativa dela sai da SAÍDA, que passa a afirmá-la numa linha
--      `r`. Até aqui `tem_receita` não estava em documento nenhum e mudava
--      depois da saída — e a expectativa do retorno só lê documento assinado.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA
-- ---------------------------------------------------------------------
--   romaneio_canonico               DCR1 ganha o bloco `r`, depois dos `p`:
--                                   uma linha `r <entrega_id>` por vale com
--                                   receita, nenhuma sem
--   fn_entrega_imutavel             `tem_receita` congela com o documento
--                                   (regra 7: tudo que entrou nele)
--   romaneio_retorno_validar        'receita' entra no domínio do bloco `d`
--   romaneio_documentos_esperados   a linha `r` espera d/receita — a MESMA
--                                   função serve o selo e o contexto da tela
--   selar_romaneio_retorno_interno  a receita fica FORA do
--                                   `status_documental` (recebê-la não quita
--                                   o convênio), e a declarada recebida
--                                   entra em `receita_recebida_*`, sem
--                                   sobrescrever quem recebeu antes
--
-- Assinaturas idênticas: ninguém que chama estas funções é reaberto.
--
-- ---------------------------------------------------------------------
-- O QUE NÃO MUDA, e por que é seguro
-- ---------------------------------------------------------------------
--   * NENHUM DOCUMENTO GRAVADO. O verificador confere `digest(canonico)`
--     sobre os bytes armazenados, e nenhum canônico existente tem linha `r`
--     — logo nenhuma saída selada passa a esperar receita. Os dois gates no
--     fim desta transação provam as duas coisas antes do commit.
--   * NENHUMA SAÍDA SEM RECEITA muda um byte: bloco vazio é ausência de
--     linha (vetor S001 de `scripts/dcr1-vetores.mts`, conferido contra a
--     implementação anterior).
--   * NENHUM RETORNO SEM RECEITA muda um byte: o bloco `d` só ganha um
--     valor de domínio.
--
-- ---------------------------------------------------------------------
-- ANTES DE APLICAR — a transição
-- ---------------------------------------------------------------------
--   * nenhuma SAÍDA OFFLINE pendente nas filas dos navegadores. Uma saída
--     com vale de receita assinada pelo código antigo chegaria sem a linha
--     `r` e seria recusada na sincronização;
--   * recarregar as abas com o código novo. Online, a Nova Corrida compara
--     o canônico local com o do servidor ANTES do cartão e do PIN — com
--     código antigo ela recusa ali, de forma legível;
--   * retorno pendente de uma saída ANTERIOR a esta migration não é
--     afetado: aquela saída não tem linha `r` e não espera receita.
--
-- Gerada por scripts/patch-receita-no-documento.mts, que extrai as
-- definições vigentes e PROVA que, tirando os trechos trocados, cada uma
-- volta byte a byte à original. Não edite à mão: rode o script.
-- =====================================================================

begin;

-- O BASELINE: o placar do verificador e a expectativa de TODA saída selada.
do $$
declare
  v_placar    jsonb;
  v_esperados jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(v) order by v.tipo, v.numero, v.romaneio_id), '[]'::jsonb)
    into v_placar
    from public.verificar_romaneios_selados() v;

  select coalesce(jsonb_agg(jsonb_build_array(r.id, d.entrega_id, d.tipo_documento)
                            order by r.id, d.entrega_id, d.tipo_documento), '[]'::jsonb)
    into v_esperados
    from public.romaneios r
    cross join lateral public.romaneio_documentos_esperados(r.id) d
   where r.tipo = 'saida' and r.status = 'selado';

  perform set_config('app.receita_placar_antes', v_placar::text, true);
  perform set_config('app.receita_esperados_antes', v_esperados::text, true);
  raise notice 'Antes: % documento(s) no placar, % documento(s) esperado(s).',
    jsonb_array_length(v_placar), jsonb_array_length(v_esperados);
end $$;


-- (1) O CANÔNICO DA SAÍDA — gerado pelo script -------------------------
create or replace function public.romaneio_canonico(
  p_tenant_id uuid,
  p_loja_id uuid,
  p_agencia_id uuid,
  p_motoboy_id uuid,
  p_caixa_id uuid,
  p_entrega_ids uuid[]
)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_linhas text[];
  v_registro record;
begin
  v_linhas := array[
    'DCR1',
    'tenant'  || e'\t' || p_tenant_id::text,
    'loja'    || e'\t' || p_loja_id::text,
    'agencia' || e'\t' || coalesce(p_agencia_id::text, '-'),
    'motoboy' || e'\t' || p_motoboy_id::text,
    'caixa'   || e'\t' || p_caixa_id::text,
    'vales'   || e'\t' || coalesce(array_length(p_entrega_ids, 1), 0)::text
  ];

  for v_registro in
    select e.id, e.numero_vale, e.tipo, e.cliente_nome, e.cliente_endereco,
           e.quantidade_vales, e.valor_compra_cents, e.valor_entrega_cents,
           e.entrega_paga_cliente_cents, e.loja_origem_id, e.convenio_id
      from public.entregas e
     where e.id = any(p_entrega_ids)
     order by e.id::text collate "C"
  loop
    v_linhas := v_linhas || (
      'v' || e'\t' || v_registro.id::text
          || e'\t' || public.texto_para_canonico(v_registro.numero_vale)
          || e'\t' || v_registro.tipo
          || e'\t' || public.texto_para_canonico(v_registro.cliente_nome)
          || e'\t' || public.texto_para_canonico(v_registro.cliente_endereco)
          || e'\t' || v_registro.quantidade_vales::text
          || e'\t' || v_registro.valor_compra_cents::text
          || e'\t' || v_registro.valor_entrega_cents::text
          || e'\t' || v_registro.entrega_paga_cliente_cents::text
          || e'\t' || coalesce(v_registro.loja_origem_id::text, '-')
          || e'\t' || coalesce(v_registro.convenio_id::text, '-')
    );
  end loop;

  -- Uma linha por pagamento previsto, e não "o previsto" no singular:
  -- pagamentos é 1:N de verdade (ver CLAUDE.md), e escolher um de vários
  -- deixaria dado fora do hash sem ninguém notar.
  for v_registro in
    select pg.entrega_id, pg.id, pg.forma, pg.valor_cents, pg.troco_cents
      from public.pagamentos pg
     where pg.entrega_id = any(p_entrega_ids)
       and pg.momento = 'previsto'
     order by pg.entrega_id::text collate "C", pg.id::text collate "C"
  loop
    v_linhas := v_linhas || (
      'p' || e'\t' || v_registro.entrega_id::text
          || e'\t' || v_registro.id::text
          || e'\t' || v_registro.forma
          || e'\t' || v_registro.valor_cents::text
          || e'\t' || v_registro.troco_cents::text
    );
  end loop;

  -- O bloco `r` — a receita que tem que VOLTAR —, depois de TODOS os
  -- pagamentos. 2026-09-14. Uma linha por vale com `tem_receita`, nenhuma
  -- sem: bloco vazio é ausência de linha, então toda saída sem receita
  -- continua produzindo os mesmos bytes. Gêmeo do laço de `canonico.ts`.
  --
  -- Só a PRESENÇA: nada de medicamento nem de tipo de receita (regra 9).
  for v_registro in
    select e.id
      from public.entregas e
     where e.id = any(p_entrega_ids)
       and e.tem_receita
     order by e.id::text collate "C"
  loop
    v_linhas := v_linhas || ('r' || e'\t' || v_registro.id::text);
  end loop;

  return array_to_string(v_linhas, e'\n');
end;
$$;

revoke all on function public.romaneio_canonico(uuid, uuid, uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;


-- (2) A TRAVA DE IMUTABILIDADE — gerada pelo script ---------------------
create or replace function public.fn_entrega_imutavel()
returns trigger language plpgsql set search_path = public as $$
declare
  v_congelada boolean;
begin
  select exists (
    select 1 from public.romaneio_entregas re
      join public.romaneios r on r.id = re.romaneio_id
     where re.entrega_id = old.id and r.status = 'selado'
  ) or (old.corrida_id is not null and exists (
    -- Caminho legado: as assinaturas anteriores ao romaneio. Elas não têm
    -- documento, mas congelam a entrega do mesmo jeito.
    select 1 from public.assinaturas a where a.corrida_id = old.corrida_id
  )) into v_congelada;

  if not v_congelada then
    return new;
  end if;

  if new.numero_vale                 is distinct from old.numero_vale
  or new.cliente_nome                is distinct from old.cliente_nome
  or new.cliente_endereco            is distinct from old.cliente_endereco
  or new.valor_compra_cents          is distinct from old.valor_compra_cents
  or new.valor_entrega_cents         is distinct from old.valor_entrega_cents
  or new.quantidade_vales            is distinct from old.quantidade_vales
  or new.entrega_paga_cliente_cents  is distinct from old.entrega_paga_cliente_cents
  or new.tipo                        is distinct from old.tipo
  or new.loja_id                     is distinct from old.loja_id
  or new.loja_origem_id              is distinct from old.loja_origem_id
  or new.convenio_id                 is distinct from old.convenio_id
  or new.corrida_id                  is distinct from old.corrida_id
  -- 2026-09-14: a receita entrou no documento assinado (linha `r` do DCR1).
  or new.tem_receita                 is distinct from old.tem_receita
  then
    raise exception
      'Vale % está num romaneio selado: o que foi assinado não muda. Registre um evento de correção.',
      old.numero_vale using errcode = 'check_violation';
  end if;

  return new;
end;
$$;


-- (3) O VALIDADOR DO RETORNO — gerado pelo script -----------------------
create or replace function public.romaneio_retorno_validar(
  p_saida_document_hash text,
  p_retorno jsonb
)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_vale        jsonb;
  v_pag         jsonb;
  v_doc         jsonb;
  v_entregas    text[] := '{}';
  v_pagamentos  text[] := '{}';
  v_tipos       text[];
  v_desfecho    text;
  v_motivo      text;
  v_id          text;
  v_tipo        text;
  v_motivos_ok  text[] := array['ausente', 'endereco_errado', 'recusou', 'outro'];
  -- ESTA LISTA É O CHECK DE `pagamentos.forma`. Mexeu aqui, mexa junto
  -- nos outros três lugares (vetores, spec dos vetores, TS).
  --
  -- `outro` SAIU em 2026-09-10 — daqui e do CHECK, na mesma migration.
  -- Continua em `v_motivos_ok`, logo acima: lá é motivo de insucesso,
  -- outro campo com o mesmo nome.
  v_formas_ok   text[] := array['dinheiro','credito','debito','pix',
                                'convenio','convcard','crediario'];
  -- E ESTA NÃO É AQUELA. Só convênio e crediário geram papel físico;
  -- `convcard` está de fora de propósito.
  --
  -- `receita` entrou em 2026-09-14: é conferida no retorno, dentro do
  -- documento assinado, e a expectativa dela vem da linha `r` da saída.
  v_tipos_ok    text[] := array['convenio', 'crediario', 'receita'];
  v_situacoes_ok text[] := array['recebido', 'faltante'];
begin
  if p_retorno is null
     or jsonb_typeof(p_retorno) <> 'array'
     or jsonb_array_length(p_retorno) = 0 then
    return 'sem_vales';
  end if;

  if p_saida_document_hash is null or p_saida_document_hash !~ '^[0-9a-f]{64}$' then
    return 'saida_hash_invalido';
  end if;

  -- `with ordinality` + `order by ord`: a ordem RECEBIDA, explicitamente.
  for v_vale in
    select t.value from jsonb_array_elements(p_retorno) with ordinality as t(value, ord)
     order by t.ord
  loop
    v_desfecho := v_vale ->> 'desfecho';
    if v_desfecho is distinct from 'entregue' and v_desfecho is distinct from 'insucesso' then
      return 'desfecho_invalido';
    end if;

    v_id := coalesce(v_vale ->> 'entrega_id', '');
    if v_id = any(v_entregas) then return 'entrega_duplicada'; end if;
    v_entregas := v_entregas || v_id;

    v_motivo := v_vale ->> 'motivo';

    if v_desfecho = 'insucesso' then
      if v_motivo is null then return 'insucesso_sem_motivo'; end if;
      if not (v_motivo = any(v_motivos_ok)) then return 'motivo_invalido'; end if;
      if v_motivo = 'outro' and btrim(coalesce(v_vale ->> 'detalhe', '')) = '' then
        return 'motivo_sem_detalhe';
      end if;
      if jsonb_array_length(coalesce(v_vale -> 'pagamentos_realizados', '[]'::jsonb)) > 0 then
        return 'pagamento_em_insucesso';
      end if;
    elsif v_motivo is not null and not (v_motivo = any(v_motivos_ok)) then
      return 'motivo_invalido';
    end if;

    for v_pag in
      select t.value
        from jsonb_array_elements(coalesce(v_vale -> 'pagamentos_realizados', '[]'::jsonb))
             with ordinality as t(value, ord)
       order by t.ord
    loop
      v_id := coalesce(v_pag ->> 'pagamento_id', '');
      if v_id = any(v_pagamentos) then return 'pagamento_duplicado'; end if;
      v_pagamentos := v_pagamentos || v_id;

      if not (coalesce(v_pag ->> 'forma', '') = any(v_formas_ok)) then
        return 'forma_invalida';
      end if;

      -- REGRA 1, e a checagem é de TIPO JSON: `"valor_cents": "12345"`
      -- como STRING daria os MESMOS BYTES por `->>` e passaria aqui,
      -- sendo recusada no TS por `Number.isInteger`.
      if jsonb_typeof(v_pag -> 'valor_cents') is distinct from 'number'
         or jsonb_typeof(v_pag -> 'troco_cents') is distinct from 'number'
         or (v_pag ->> 'valor_cents') !~ '^-?[0-9]+$'
         or (v_pag ->> 'troco_cents') !~ '^-?[0-9]+$' then
        return 'valor_nao_inteiro';
      end if;

      if (v_pag ->> 'valor_cents')::numeric < 0
         or (v_pag ->> 'troco_cents')::numeric < 0 then
        return 'valor_negativo';
      end if;
    end loop;

    -- ---- DOCUMENTOS, DEPOIS DOS PAGAMENTOS -----------------------------
    -- A ordem entre os dois laços é contrato: ver a regra 1 no cabeçalho.
    -- E `v_tipos` é reiniciado A CADA VALE, porque a duplicata é do par
    -- (entrega_id, tipo) — dois vales podem ter cada um o seu crediário.
    v_tipos := '{}';
    for v_doc in
      select t.value
        from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb))
             with ordinality as t(value, ord)
       order by t.ord
    loop
      v_tipo := coalesce(v_doc ->> 'tipo', '');
      if not (v_tipo = any(v_tipos_ok)) then return 'tipo_documento_invalido'; end if;
      if not (coalesce(v_doc ->> 'situacao', '') = any(v_situacoes_ok)) then
        return 'situacao_documento_invalida';
      end if;
      if v_tipo = any(v_tipos) then return 'documento_duplicado'; end if;
      v_tipos := v_tipos || v_tipo;
    end loop;
  end loop;

  return null;
end;
$$;

revoke all on function public.romaneio_retorno_validar(text, jsonb) from public, anon;
grant execute on function public.romaneio_retorno_validar(text, jsonb) to authenticated;


-- (4) A EXPECTATIVA — gerada pelo script ---------------------------------
create or replace function public.romaneio_documentos_esperados(p_saida_romaneio_id uuid)
returns table (entrega_id uuid, tipo_documento text)
language sql stable security definer set search_path = public as $$
  select distinct
         (split_part(linha, e'\t', 2))::uuid as entrega_id,
         -- 2026-09-14: a linha `r` da saída espera a RECEITA de volta.
         case split_part(linha, e'\t', 1)
           when 'r' then 'receita'
           else split_part(linha, e'\t', 4)
         end                                  as tipo_documento
    from public.romaneios r
    cross join lateral unnest(string_to_array(r.canonico, e'\n')) as linha
   where r.id = p_saida_romaneio_id
     and r.tipo = 'saida'
     and r.canonico is not null
     and (
       -- linha `p` da saída: p <entrega_id> <pagamento_id> <forma> <valor> <troco>
       (split_part(linha, e'\t', 1) = 'p'
        -- SÓ estas duas formas geram papel. `convcard` fica de fora.
        and split_part(linha, e'\t', 4) in ('convenio', 'crediario'))
       -- linha `r` da saída: r <entrega_id> — a receita que tem que voltar
       or split_part(linha, e'\t', 1) = 'r'
     );
$$;

revoke all on function public.romaneio_documentos_esperados(uuid)
  from public, anon, authenticated;


-- (5) O SELO DO RETORNO — gerado pelo script -----------------------------
create or replace function public.selar_romaneio_retorno_interno(
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
    --
    -- 2026-09-14: a RECEITA fica FORA desta conta. É documento distinto do
    -- convênio e do crediário, com custódia própria (`receita_recebida_*`,
    -- logo abaixo): recebê-la não quita o papel do convênio, e a falta
    -- dela não o deixa pendente.
    select count(*), count(*) filter (where doc.value ->> 'situacao' = 'recebido')
      into v_esperados_do_vale, v_recebidos_do_vale
      from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as doc(value)
     where doc.value ->> 'tipo' <> 'receita';

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
           end,
           -- 2026-09-14: a receita declarada RECEBIDA neste retorno entra na
           -- custódia dela, e só se ninguém a recebeu antes — o primeiro
           -- recebedor não é sobrescrito. O relógio do servidor
           -- (`receita_recebida_em`) é carimbado por `trg_entregas_custodia`
           -- a partir do `_local`. `faltante` não escreve nada: a pendência
           -- continua, e o `documento_faltante` logo abaixo a anuncia.
           receita_recebida_em_local = case
             when receita_recebida_em is null and receita_recebida_em_local is null
                  and exists (select 1
                                from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as doc(value)
                               where doc.value ->> 'tipo' = 'receita'
                                 and doc.value ->> 'situacao' = 'recebido')
             then p_ocorrido_em_local
             else receita_recebida_em_local
           end,
           receita_recebida_por = case
             when receita_recebida_em is null and receita_recebida_em_local is null
                  and exists (select 1
                                from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as doc(value)
                               where doc.value ->> 'tipo' = 'receita'
                                 and doc.value ->> 'situacao' = 'recebido')
             then p_responsavel_id
             else receita_recebida_por
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


-- OS GATES: nenhuma sobrecarga nasceu, e nada existente se moveu.
do $$
declare
  v_placar_antes    jsonb := nullif(current_setting('app.receita_placar_antes', true), '')::jsonb;
  v_esperados_antes jsonb := nullif(current_setting('app.receita_esperados_antes', true), '')::jsonb;
  v_placar          jsonb;
  v_esperados       jsonb;
  v_funcoes         int;
begin
  if v_placar_antes is null or v_esperados_antes is null then
    raise exception 'Baseline não encontrado — o bloco do começo não rodou nesta transação.';
  end if;

  select count(*) into v_funcoes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('romaneio_canonico', 'fn_entrega_imutavel', 'romaneio_retorno_validar',
                       'romaneio_documentos_esperados', 'selar_romaneio_retorno_interno');
  if v_funcoes <> 5 then
    raise exception 'Esperava 5 funções, uma de cada; achei %. Alguma virou sobrecarga — transação desfeita.',
      v_funcoes;
  end if;

  select coalesce(jsonb_agg(to_jsonb(v) order by v.tipo, v.numero, v.romaneio_id), '[]'::jsonb)
    into v_placar
    from public.verificar_romaneios_selados() v;

  select coalesce(jsonb_agg(jsonb_build_array(r.id, d.entrega_id, d.tipo_documento)
                            order by r.id, d.entrega_id, d.tipo_documento), '[]'::jsonb)
    into v_esperados
    from public.romaneios r
    cross join lateral public.romaneio_documentos_esperados(r.id) d
   where r.tipo = 'saida' and r.status = 'selado';

  if v_placar is distinct from v_placar_antes then
    raise exception 'O placar do verificador MOVEU — transação desfeita. antes: %  depois: %',
      v_placar_antes, v_placar;
  end if;

  if v_esperados is distinct from v_esperados_antes then
    raise exception 'A expectativa de documentos de uma saída selada MUDOU — transação desfeita. antes: %  depois: %',
      v_esperados_antes, v_esperados;
  end if;

  raise notice 'Gates ok: % documento(s) no placar, % documento(s) esperado(s), nada movido.',
    jsonb_array_length(v_placar), jsonb_array_length(v_esperados);
end $$;

commit;


-- =====================================================================
-- CONFERÊNCIAS — no SQL Editor, depois de aplicar
--
-- (a) as cinco funções, uma de cada
--
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('romaneio_canonico', 'fn_entrega_imutavel', 'romaneio_retorno_validar',
--                        'romaneio_documentos_esperados', 'selar_romaneio_retorno_interno')
--    order by p.proname;
--   -- esperado: 5 linhas
--
-- (b) nenhuma saída já selada passou a esperar receita
--
--   select r.numero, d.entrega_id
--     from public.romaneios r
--     cross join lateral public.romaneio_documentos_esperados(r.id) d
--    where r.tipo = 'saida' and r.status = 'selado' and d.tipo_documento = 'receita';
--   -- esperado: zero linhas
--
-- (c) a trava recusa mudar a receita de um vale já selado. O bloco termina
--     SEMPRE em erro, de propósito, para desfazer o que tentou:
--
--   do $$
--   declare
--     v_id        uuid;
--     v_resultado text;
--   begin
--     select re.entrega_id into v_id
--       from public.romaneio_entregas re
--       join public.romaneios r on r.id = re.romaneio_id
--      where r.status = 'selado' and r.tipo = 'saida'
--      limit 1;
--     begin
--       update public.entregas set tem_receita = not tem_receita where id = v_id;
--       v_resultado := 'ACEITOU — a trava NÃO congela tem_receita';
--     exception when check_violation then
--       v_resultado := 'recusou, como esperado';
--     end;
--     raise exception 'RESULTADO — %', v_resultado;
--   end $$;
--   -- esperado: ERROR: RESULTADO — recusou, como esperado
--
-- (d) o validador contra os golden vectors do DCRR1, que agora trazem a
--     receita (V017 e V018):
--
--       npx tsx scripts/dcrr1-sql.spec.mts > conferir.sql
--
--     e colar no SQL Editor. Esperado: 72 de 72, e nenhuma linha
--     com `ok = false`.
--
-- (e) o canônico da saída, TS × SQL, em dado real: marcar "Precisa de
--     receita" num vale pendente e rodar
--     `scripts/conferir-canonico-no-console.js` no console do app. Esperado:
--     "OK — os dois lados concordam", com uma linha `r` no fim.
--
-- (f) o placar, o mesmo de antes de aplicar:
--
--   select * from public.verificar_integridade_resumo();
-- =====================================================================
