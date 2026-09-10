-- =====================================================================
-- `outro` sai das FORMAS DE PAGAMENTO — e só delas
--
-- Decidido em 2026-09-08 (docs/escopo-pre-v1-revisado.md, seção 3) e
-- escrito em 2026-09-10 como passo PRÓPRIO, separado do passo 1.
--
-- Mesmo método da 20260820120000, que já foi uma troca de domínio de
-- forma: o CHECK de `pagamentos.forma` e `romaneio_retorno_validar`
-- mudam JUNTOS, e `romaneio_retorno_canonico` NÃO é tocada.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA: operações NOVAS deixam de aceitar `outro` como forma
-- ---------------------------------------------------------------------
--   cadastro e divergência   inserem em `pagamentos` → o CHECK recusa
--   retorno                  passa por `romaneio_retorno_validar` →
--                            `forma_invalida`, antes de qualquer escrita
--
-- ---------------------------------------------------------------------
-- O QUE NÃO MUDA, e por que é seguro
-- ---------------------------------------------------------------------
--   * nenhum byte de documento válido: só encolhe o conjunto ACEITO
--   * a verificação do histórico: `verificar_romaneio` confere
--     `digest(canonico)` sobre os bytes GRAVADOS e não chama o validador
--   * nenhum caminho de leitura chama o validador — só o selo do retorno
--     e a ferramenta pura `conferir_canonico_retorno`
--   * `outro` como MOTIVO DE INSUCESSO (`v_motivos_ok`): outro campo,
--     mesmo nome
--   * nenhum pagamento é convertido. Se existir algum `outro`, o bloco 1
--     PARA a migration em vez de reescrever o passado
--
-- CENSO de 2026-09-10, lido pela aplicação antes de escrever isto: zero
-- pagamentos `outro` (previsto ou realizado), zero documentos com
-- `outro` numa linha de pagamento, zero eventos `pagamento_alterado`.
--
-- CHECK VALIDADO, e não `NOT VALID`. Com o censo zerado os dois têm o
-- mesmo efeito hoje; o validado deixa uma invariante conferível
-- (`convalidated = true`) em vez de uma constraint permanentemente não
-- verificada, que um `VALIDATE CONSTRAINT` futuro ou um restore
-- tropeçariam. Se o censo mudar antes de aplicar, o bloco 1 recusa e a
-- decisão volta pro usuário.
--
-- Gerada por `scripts/patch-validar-retorno-outro.mts`, que extrai a
-- definição vigente (20260820150000), faz a troca mínima e PROVA que nada
-- fora da lista de formas mudou. Não edite o bloco 3 à mão: rode o script.
-- =====================================================================


-- (1) PRÉ-VOO — parar, nunca converter -------------------------------
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.pagamentos where forma = 'outro';
  if v_n > 0 then
    raise exception 'Existem % pagamento(s) com forma "outro". Esta migration não converte histórico: decida o destino deles antes de aplicar.', v_n;
  end if;
end $$;


-- (2) O CHECK — a trava do cadastro e da divergência ------------------
alter table public.pagamentos drop constraint if exists pagamentos_forma_check;
alter table public.pagamentos add constraint pagamentos_forma_check
  check (forma in ('dinheiro','credito','debito','pix','convenio','convcard','crediario'));


-- (3) O VALIDADOR DO RETORNO — gerado pelo script ---------------------
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
-- CONFERIR DEPOIS DE APLICAR
--
-- 1. O CHECK não tem mais `outro`, e está validado. Esperado: uma linha,
--    sem 'outro', `convalidated = true`.
--
--   select pg_get_constraintdef(oid) as definicao, convalidated
--     from pg_constraint where conname = 'pagamentos_forma_check';
--
-- 2. O validador. Esperado, nesta ordem:
--    forma_invalida · (vazio) · (vazio)
--
--   select 'forma outro' as caso, public.romaneio_retorno_validar(
--     'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
--     '[{"entrega_id":"e1","desfecho":"entregue","motivo":null,"detalhe":null,
--        "pagamentos_realizados":[{"pagamento_id":"p1","forma":"outro",
--          "valor_cents":100,"troco_cents":0}]}]'::jsonb) as resultado
--   union all
--   select 'forma pix', public.romaneio_retorno_validar(
--     'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
--     '[{"entrega_id":"e1","desfecho":"entregue","motivo":null,"detalhe":null,
--        "pagamentos_realizados":[{"pagamento_id":"p1","forma":"pix",
--          "valor_cents":100,"troco_cents":0}]}]'::jsonb)
--   union all
--   select 'motivo outro com detalhe', public.romaneio_retorno_validar(
--     'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
--     '[{"entrega_id":"e1","desfecho":"insucesso","motivo":"outro",
--        "detalhe":"portão fechado","pagamentos_realizados":[]}]'::jsonb);
--
-- 3. A conferência completa contra os golden vectors, que agora trazem
--    o I018 (`outro` como forma, recusado):
--
--       npx tsx scripts/dcrr1-sql.spec.mts > conferir.sql
--
--    e colar no SQL Editor. Esperado: **66 de 66** — 16
--    válidos × texto/bytes/hash + 18 motivos de recusa —, e nenhuma
--    linha com `ok = false`.
--
-- 4. O verificador de integridade, como admin, ANTES e DEPOIS: o conjunto
--    de documentos que verificam não pode mudar. Esta migration não toca
--    em documento, então qualquer diferença é sinal de outra coisa.
-- =====================================================================
