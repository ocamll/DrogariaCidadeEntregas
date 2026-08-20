-- =====================================================================
-- RETORNO: `documentos_esperados = documentos_declarados` e o
-- `status_documental` (etapa 2B.5, parte contextual)
--
-- A migration `20260820150000` ensinou o CANÔNICO a serializar o bloco
-- `d`. Ela não sabe — e não pode saber — se um documento ERA ESPERADO:
-- isso depende do que a saída selou, e a função canônica é pura.
--
-- Esta aqui é a outra metade. `selar_romaneio_retorno_interno` tem a
-- saída em mãos, então é ela quem exige a igualdade.
--
-- AS DUAS COISAS VÊM JUNTAS DE PROPÓSITO: as duas reescrevem a mesma
-- função, e reescrever a função mais crítica do retorno duas vezes em
-- duas migrations seria pedir pras duas versões divergirem.
--
-- ---------------------------------------------------------------------
-- DE ONDE SAI O CONJUNTO ESPERADO
-- ---------------------------------------------------------------------
-- Das linhas `p` do CANÔNICO ASSINADO da saída — `romaneios.canonico`,
-- congelado na selagem. Não de `pagamentos`, não de `entregas`, não de
-- `convenios`: nenhuma tabela mutável participa da reconstrução de um
-- fato assinado.
--
--     forma = 'convenio'    → espera d/convenio
--     forma = 'crediario'   → espera d/crediario
--
-- Uma regra só, simétrica. O `convenio_id` da linha `v` é o sinal
-- redundante que hoje concorda por construção (a tela só mostra o select
-- de convênio quando a forma é convênio); se um dia discordarem, é
-- defeito, e a regra continua sendo a forma.
--
-- **`convcard` NÃO gera expectativa.** Nele o cliente manda os dados do
-- cartão e a farmácia processa — não há papel saindo com ninguém. Exigir
-- documento de volta seria pedir o que ninguém emitiu.
--
-- ---------------------------------------------------------------------
-- IGUALDADE DE CONJUNTO, NÃO CONTINÊNCIA
-- ---------------------------------------------------------------------
--     documentos_esperados = documentos_declarados
--
-- "Todo esperado apareceu" deixaria sobra passar, e sobra é o documento
-- afirmando custódia de um papel que aquela saída nunca gerou. Os dois
-- sentidos são recusa, e o conflito reporta os dois lados separados.
--
-- **AUSÊNCIA NÃO VIRA `faltante` AUTOMATICAMENTE.** Se a saída esperava
-- crediário e o retorno não traz linha `d`, isso é RECUSA — normalizar
-- pra `faltante` inventaria um fato que ninguém declarou, e o documento
-- assinado passaria a afirmar que alguém disse que o papel não voltou.
-- Normalizar só onde o fato é dedutível sem ambiguidade; recusar onde
-- seria preciso inventar.
--
-- ---------------------------------------------------------------------
-- `status_documental` POR RECOMPUTAÇÃO ABSOLUTA
-- ---------------------------------------------------------------------
--     nenhum documento esperado         → nao_aplica
--     todos os esperados recebidos      → recebido
--     pelo menos um faltante            → pendente
--
-- ABSOLUTA, e não "se faltante, deixa como está". Existem vales de
-- crediário anteriores a esta mudança gravados como `nao_aplica` (a
-- criação só marcava `pendente` para convênio); se um deles entrar num
-- retorno com `d ... faltante`, o resultado tem que ser `pendente`
-- independentemente do valor antigo. Depender do estado anterior faria a
-- correção não alcançar justamente os vales que ela existe pra
-- consertar.
--
-- **NUNCA `extraviado` automático.** `faltante` quer dizer "não voltou
-- nesta corrida e ainda precisa vir" — o processo da farmácia é que o
-- motoboy volta pra buscar. `extraviado` é conclusão posterior de que o
-- documento se perdeu, e não é o retorno que a tira.
--
-- E ELE É AGREGADO, o que precisa ficar dito: um vale pode ter convênio
-- E crediário, e `entregas.status_documental` é uma coluna só. Com um
-- recebido e um faltante, o vale fica `pendente`, porque ainda há papel
-- devendo. A conferência do gestor provavelmente vai exigir granularidade
-- por (entrega_id, tipo_documento) — quando exigir, é tabela própria, não
-- mais um valor nesta coluna.
--
-- ---------------------------------------------------------------------
-- ANTES DE APLICAR, RODE ISTO E OLHE O RESULTADO
-- ---------------------------------------------------------------------
-- Quantos vales de crediário existem hoje com `status_documental`
-- errado, e em que situação eles estão:
--
--   select e.status_entrega, e.status_documental, count(*)
--     from public.entregas e
--     join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
--    where p.forma = 'crediario'
--    group by 1, 2 order by 1, 2;
--
-- Vazio significa que nenhum crediário foi lançado ainda, e esta
-- migration nasce sem backfill — melhor assim. Se houver vale ainda
-- `pendente`/`em_rota`, ele merece virar `pendente` documental; vale já
-- fechado é histórico e **não** se reescreve em massa sem decisão.
-- Esta migration NÃO faz backfill nenhum de propósito: olhar primeiro.
-- =====================================================================


-- =====================================================================
-- 1. OS DOCUMENTOS QUE A SAÍDA ESPERAVA
--
-- Lê as linhas `p` do canônico ASSINADO e devolve os pares
-- (entrega_id, tipo_documento) que deveriam voltar.
--
-- Parsear texto em vez de consultar `pagamentos` é deliberado: o
-- canônico é o que foi assinado, e `pagamentos` é o dado de hoje — uma
-- divergência registrada depois (linha `realizado`) ou qualquer correção
-- mudaria a expectativa de um documento já selado.
-- =====================================================================

create or replace function public.romaneio_documentos_esperados(p_saida_romaneio_id uuid)
returns table (entrega_id uuid, tipo_documento text)
language sql stable security definer set search_path = public as $$
  select distinct
         (split_part(linha, e'\t', 2))::uuid as entrega_id,
         split_part(linha, e'\t', 4)          as tipo_documento
    from public.romaneios r
    cross join lateral unnest(string_to_array(r.canonico, e'\n')) as linha
   where r.id = p_saida_romaneio_id
     and r.tipo = 'saida'
     and r.canonico is not null
     -- linha `p` da saída: p <entrega_id> <pagamento_id> <forma> <valor> <troco>
     and split_part(linha, e'\t', 1) = 'p'
     -- SÓ estas duas formas geram papel. `convcard` fica de fora.
     and split_part(linha, e'\t', 4) in ('convenio', 'crediario');
$$;

revoke all on function public.romaneio_documentos_esperados(uuid)
  from public, anon, authenticated;

-- Leitura pra tela: a 2D precisa saber quais linhas `d` pedir ao
-- operador, e pedir as erradas custaria uma recusa depois das duas
-- assinaturas. Esta é a MESMA função que a transação usa — duas
-- derivações da mesma regra é como os dois lados divergem.
create or replace function public.documentos_esperados_do_retorno(p_saida_romaneio_id uuid)
returns table (entrega_id uuid, tipo_documento text)
language sql stable security invoker set search_path = public as $$
  select d.entrega_id, d.tipo_documento
    from public.romaneios r
    cross join lateral public.romaneio_documentos_esperados(r.id) d
   where r.id = p_saida_romaneio_id
   order by d.entrega_id::text collate "C", d.tipo_documento collate "C";
$$;

revoke all on function public.documentos_esperados_do_retorno(uuid) from public, anon;
grant execute on function public.documentos_esperados_do_retorno(uuid) to authenticated;


-- =====================================================================
-- 2. A TRANSAÇÃO, com a igualdade e o status
--
-- Reescrita a partir de `20260820130000`. **Parta SEMPRE da mais
-- recente** — há três definições de `selar_romaneio_interno` no
-- repositório pelo mesmo motivo, e copiar de uma antiga reintroduz bug
-- corrigido em silêncio.
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
             'de', (select pg.forma from public.pagamentos pg
                     where pg.entrega_id = v_entrega_id and pg.momento = 'previsto'
                     order by pg.id::text collate "C" limit 1),
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
