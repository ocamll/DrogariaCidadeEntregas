-- =====================================================================
-- DCRR1 — o bloco `d`, custódia física de documento (etapa 2B.5)
--
-- GÊMEO de `src/lib/canonicoRetorno.ts`. As duas implementações precisam
-- produzir os MESMOS BYTES e recusar as MESMAS entradas PELO MESMO
-- MOTIVO. Divergindo, o sintoma não é erro claro — é "o retorno offline
-- nunca sincroniza", meses depois, sem pista.
--
-- O CONTRATO MANDA: 16 vetores válidos e 17 inválidos em
-- `scripts/dcrr1-vetores.mts`, escritos à mão a partir da especificação.
-- Se este arquivo discordar de um vetor, o vetor ganha.
--
-- ---------------------------------------------------------------------
-- O QUE O BLOCO `d` AFIRMA, E O QUE ELE NÃO AFIRMA
-- ---------------------------------------------------------------------
-- Dois tipos de venda geram um papel que sai com o motoboy e tem que
-- voltar pra filial: CONVÊNIO e CREDIÁRIO. O do crediário é a nota do
-- aceite da dívida, que o cliente assina.
--
--     d   <entrega_id>   <tipo_documento>   <situacao>
--
--     tipo_documento ∈ { convenio, crediario }
--     situacao       ∈ { recebido, faltante }
--
-- **`convcard` NÃO É TIPO DE DOCUMENTO, e a assimetria é o ponto.** Ele
-- é forma de pagamento VÁLIDA no bloco `pr` e tipo INVÁLIDO no bloco
-- `d`: nele o cliente manda os dados do cartão e a farmácia processa a
-- compra, sem papel saindo com ninguém. Confundi-lo com convênio faria o
-- documento assinado afirmar custódia de um papel que nunca existiu.
-- Três conceitos distintos — vetor I015 existe só pra isso.
--
-- O DOMÍNIO DA SITUAÇÃO É DELIBERADAMENTE POBRE. No balcão, caixa e
-- motoboy só conseguem afirmar presença física: o papel voltou, ou o
-- papel que devia voltar não veio. Nada de `retornado_assinado`,
-- `irregular` ou `conferido` — isso depende da conferência do gestor,
-- que é outro fluxo e acontece depois. Documento que voltou sem
-- assinatura é `recebido`, porque fisicamente foi.
--
-- E `faltante` não é desfecho, é PENDÊNCIA ABERTA: o processo é que o
-- papel precisa vir, e o motoboy volta pra buscar. Se ele chegar depois,
-- noutra corrida, **isso não corrige nem reescreve este DCRR1** —
-- `faltante` descreve corretamente o estado físico no instante em que o
-- retorno foi selado, e a chegada posterior constitui evento novo sobre
-- o vale.
--
-- ---------------------------------------------------------------------
-- A FRONTEIRA: ESTA FUNÇÃO NÃO SABE O QUE ERA ESPERADO
-- ---------------------------------------------------------------------
-- O canônico é PURO. Sabe validar domínio, duplicata, normalização,
-- ordenação e serialização. **Não sabe** o que saiu naquela corrida nem
-- quais documentos eram esperados.
--
-- `documentos_esperados = documentos_declarados` é responsabilidade de
-- `selar_romaneio_retorno`, que tem a saída selada em mãos. Trazer a
-- expectativa pra cá custaria a pureza — que é justamente o que permitiu,
-- na 2A, montar um documento multi-vale quando nenhum romaneio selado
-- tinha mais de um.
--
-- ---------------------------------------------------------------------
-- DUAS REGRAS DE PRECEDÊNCIA QUE OS DOIS GÊMEOS REPRODUZEM
-- ---------------------------------------------------------------------
-- 1. DOCUMENTOS DEPOIS DE PAGAMENTOS, dentro do vale, na ordem recebida.
--    Preserva a precedência histórica: um payload que antes respondia
--    `pagamento_duplicado` continua respondendo isso mesmo trazendo
--    documento inválido. Se `d` viesse antes, acrescentar o bloco teria
--    mudado em silêncio o motivo reportado pra entradas que já existiam.
--
-- 2. A DUPLICATA É POR VALE, não global. Ao contrário do
--    `pagamento_duplicado`, cujo id é único no documento inteiro, dois
--    vales podem legitimamente ter cada um o seu crediário. O que não
--    pode repetir é o par (entrega_id, tipo).
--
-- E o bloco `d` NÃO é filtrado por desfecho, ao contrário do `pr`: o
-- papel saiu sob custódia do motoboy, então o destino dele é declarado
-- mesmo com a entrega falhada. É o vetor V014 — `insucesso` + `recebido`
-- é válido e não é contraditório.
-- =====================================================================


-- =====================================================================
-- 1. VALIDAR
-- =====================================================================

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
  v_formas_ok   text[] := array['dinheiro','credito','debito','pix',
                                'convenio','convcard','crediario','outro'];
  -- E ESTA NÃO É AQUELA. Só convênio e crediário geram papel físico;
  -- `convcard` está de fora de propósito.
  v_tipos_ok    text[] := array['convenio', 'crediario'];
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


-- =====================================================================
-- 2. O CANÔNICO — agora com o terceiro bloco
-- =====================================================================

create or replace function public.romaneio_retorno_canonico(
  p_saida_id uuid,
  p_saida_document_hash text,
  p_motoboy_id uuid,
  p_responsavel_id uuid,
  p_retorno jsonb
)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_linhas   text[];
  v_vale     jsonb;
  v_pag      jsonb;
  v_doc      jsonb;
  v_motivo   text;
  v_entregue boolean;
begin
  v_motivo := public.romaneio_retorno_validar(p_saida_document_hash, p_retorno);
  if v_motivo is not null then
    raise exception 'Retorno inválido: %', v_motivo using errcode = 'check_violation';
  end if;

  v_linhas := array[
    'DCRR1',
    'saida'       || e'\t' || lower(p_saida_id::text),
    'saida_hash'  || e'\t' || p_saida_document_hash,
    'motoboy'     || e'\t' || lower(p_motoboy_id::text),
    'responsavel' || e'\t' || lower(p_responsavel_id::text)
  ];

  for v_vale in
    select t.value from jsonb_array_elements(p_retorno) as t(value)
     order by lower(t.value ->> 'entrega_id') collate "C"
  loop
    v_entregue := (v_vale ->> 'desfecho') = 'entregue';
    v_linhas := v_linhas || (
      'v' || e'\t' || coalesce(lower(v_vale ->> 'entrega_id'), '-')
          || e'\t' || (v_vale ->> 'desfecho')
          || e'\t' || case when v_entregue then '-'
                           else public.texto_para_canonico(v_vale ->> 'motivo') end
          || e'\t' || case when v_entregue then '-'
                           else public.texto_para_canonico(v_vale ->> 'detalhe') end
    );
  end loop;

  -- Bloco 2: pagamentos, DEPOIS de todos os vales.
  for v_vale in
    select t.value from jsonb_array_elements(p_retorno) as t(value)
     order by lower(t.value ->> 'entrega_id') collate "C"
  loop
    for v_pag in
      select t.value
        from jsonb_array_elements(coalesce(v_vale -> 'pagamentos_realizados', '[]'::jsonb)) as t(value)
       order by lower(t.value ->> 'pagamento_id') collate "C"
    loop
      v_linhas := v_linhas || (
        'pr' || e'\t' || coalesce(lower(v_vale ->> 'entrega_id'), '-')
             || e'\t' || coalesce(lower(v_pag ->> 'pagamento_id'), '-')
             || e'\t' || (v_pag ->> 'forma')
             || e'\t' || (v_pag ->> 'valor_cents')
             || e'\t' || (v_pag ->> 'troco_cents')
      );
    end loop;
  end loop;

  -- Bloco 3: documentos, DEPOIS dos pagamentos. Laço aninhado pela mesma
  -- razão do `pr`: com o `entrega_id` vindo do vale de fora, "documento
  -- apontando pra vale que não está no documento" fica indescritível —
  -- um `select` plano reabriria o caso que o TypeScript fechou por
  -- construção.
  --
  -- Vales ordenados por entrega_id e documentos por tipo dentro de cada
  -- um: o achatamento produz (entrega_id, tipo_documento) sem ORDER BY
  -- composto. `tipo` e `situacao` entram CRUS, sem
  -- `texto_para_canonico`, porque são valores de domínio fechado já
  -- validados — igual à `forma` no bloco `pr`.
  --
  -- Bloco vazio não gera linha nenhuma, e nunca placeholder. É por isso
  -- que acrescentar `d` não moveu nenhum dos dez hashes anteriores.
  for v_vale in
    select t.value from jsonb_array_elements(p_retorno) as t(value)
     order by lower(t.value ->> 'entrega_id') collate "C"
  loop
    for v_doc in
      select t.value
        from jsonb_array_elements(coalesce(v_vale -> 'documentos', '[]'::jsonb)) as t(value)
       order by (t.value ->> 'tipo') collate "C"
    loop
      v_linhas := v_linhas || (
        'd' || e'\t' || coalesce(lower(v_vale ->> 'entrega_id'), '-')
            || e'\t' || (v_doc ->> 'tipo')
            || e'\t' || (v_doc ->> 'situacao')
      );
    end loop;
  end loop;

  return array_to_string(v_linhas, e'\n');
end;
$$;

revoke all on function public.romaneio_retorno_canonico(uuid, text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.romaneio_retorno_canonico(uuid, text, uuid, uuid, jsonb) to authenticated;


-- =====================================================================
-- CONFERIR CONTRA OS GOLDEN VECTORS
--
--   npx tsx scripts/dcrr1-sql.spec.mts
--
-- gera a consulta única pra colar no SQL Editor, a partir dos MESMOS
-- vetores que o lado TypeScript usa. Esperado agora: **65 de 65** —
-- 16 válidos × (texto, bytes, hash) + 17 motivos de recusa —, e nenhuma
-- linha com `ok = false`. Elas vêm primeiro justamente pra não se
-- esconderem no fim de uma lista longa.
--
-- Era 43 de 43 antes do bloco `d`. Os 30 critérios dos dez vetores
-- antigos têm que continuar passando com os MESMOS hashes: bloco vazio
-- não muda byte nenhum, e se algum deles mover, o problema é aqui.
-- =====================================================================
