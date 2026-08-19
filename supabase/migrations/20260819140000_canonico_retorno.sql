-- =====================================================================
-- DCRR1 — o canônico do Romaneio de Retorno, lado SQL
--
-- Etapa 2A item 5. Este arquivo é o GÊMEO de
-- `src/lib/canonicoRetorno.ts`. As duas implementações precisam produzir
-- os MESMOS BYTES e recusar as MESMAS entradas PELO MESMO MOTIVO.
--
-- Se divergirem, o sintoma não é erro claro — é "o retorno offline nunca
-- sincroniza", meses depois, sem pista.
--
-- O CONTRATO MANDA. Os oito vetores válidos e os doze inválidos de
-- `scripts/dcrr1-vetores.mts` foram escritos à mão a partir da
-- especificação antes de qualquer implementação existir. Se este arquivo
-- discordar de um vetor, o vetor ganha.
--
-- ---------------------------------------------------------------------
-- OS FATOS VÊM POR PARÂMETRO, NÃO DO BANCO
-- ---------------------------------------------------------------------
-- Parece contradizer `romaneio_canonico`, que LÊ de `entregas`. Não
-- contradiz — a regra que reconcilia os dois:
--
--     o canônico LÊ DO BANCO o que PREEXISTE ao ato,
--     e recebe POR PARÂMETRO o que o ato DECLARA.
--
-- Na saída, cliente/endereço/valores já estavam lá e ninguém os digita
-- ao assinar: lê-se do banco justamente para que uma mudança entre
-- assinar e selar invalide a assinatura. No retorno, desfecho, motivo,
-- detalhe e pagamentos são DECLARADOS no ato pelas duas partes — lê-los
-- de `entregas` seria circular, porque é a própria transação que vai
-- gravá-los. E `observacoes`, onde o fechamento hoje guarda o detalhe do
-- insucesso, é coluna de uso geral que qualquer coisa reescreve.
--
-- Receber por parâmetro NÃO é confiar no cliente: o servidor reconstrói
-- o DCRR1 sozinho e compara com o `document_hash` que foi assinado. Quem
-- confere pertencimento, identidade e permissão é `selar_romaneio_retorno`
-- (etapa 2B), não este arquivo.
--
-- ---------------------------------------------------------------------
-- O ANINHAMENTO É OBRIGATÓRIO
-- ---------------------------------------------------------------------
-- `p_retorno` é um array de vales, e cada vale carrega DENTRO DE SI seus
-- pagamentos. Os laços abaixo espelham isso: vale por fora, pagamentos
-- daquele vale por dentro.
--
-- Um `select` plano de `pagamentos` reabriria um erro que o lado
-- TypeScript fechou por CONSTRUÇÃO: pagamento apontando para um vale que
-- não está no documento. Lá é indescritível porque o `entrega_id` da
-- linha `pr` vem do pai. Aqui tem que ser indescritível pelo mesmo
-- motivo.
--
-- ---------------------------------------------------------------------
-- ORDEM DE VALIDAÇÃO ≠ ORDEM DE SERIALIZAÇÃO
-- ---------------------------------------------------------------------
-- A validação percorre na ordem RECEBIDA (`with ordinality`), porque uma
-- entrada pode violar várias regras e os dois gêmeos precisam reportar o
-- MESMO motivo — senão a tela diz uma coisa e o servidor outra para a
-- mesma entrada.
--
-- Só depois de válida a entrada é ordenada (`collate "C"`) e
-- serializada. É isso que dá, ao mesmo tempo, mensagem de erro idêntica
-- e canônico invariante à ordem do input.
-- =====================================================================


-- =====================================================================
-- 1. VALIDAR — devolve o motivo, ou NULL se pode virar documento
--
-- A ordem das checagens FAZ PARTE DO CONTRATO e espelha
-- `validarRetorno` linha a linha: estrutura do documento, depois vale a
-- vale na ordem recebida, depois pagamento a pagamento.
-- =====================================================================

create or replace function public.romaneio_retorno_validar(
  p_saida_document_hash text,
  p_retorno jsonb
)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_vale        jsonb;
  v_pag         jsonb;
  v_entregas    text[] := '{}';
  v_pagamentos  text[] := '{}';
  v_desfecho    text;
  v_motivo      text;
  v_id          text;
  v_motivos_ok  text[] := array['ausente', 'endereco_errado', 'recusou', 'outro'];
  v_formas_ok   text[] := array['dinheiro','credito','debito','pix','convenio','vale','outro'];
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
  -- `jsonb_array_elements` já devolve em ordem, mas depender disso seria
  -- depender de detalhe de implementação num ponto que é contrato.
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
      -- Só espaços conta como vazio: senão a regra se contorna com a
      -- barra de espaço e o documento volta a assinar "outro" sozinho.
      if v_motivo = 'outro' and btrim(coalesce(v_vale ->> 'detalhe', '')) = '' then
        return 'motivo_sem_detalhe';
      end if;
      -- Descartar em silêncio seria sumir com dinheiro que alguém
      -- digitou. Recusa, pra a tela poder perguntar.
      if jsonb_array_length(coalesce(v_vale -> 'pagamentos_realizados', '[]'::jsonb)) > 0 then
        return 'pagamento_em_insucesso';
      end if;
    elsif v_motivo is not null and not (v_motivo = any(v_motivos_ok)) then
      -- Vale entregue com motivo LIXO ainda é recusado. A normalização
      -- só alcança valor do domínio: forçar '-' num valor desconhecido
      -- esconderia que alguém mandou algo que ninguém entende.
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

      -- REGRA 1, e aqui ela morde de dois jeitos.
      --
      -- O óbvio: 12.5 vira "12.5" no canônico, e o lado TypeScript
      -- recusa por `Number.isInteger`.
      --
      -- O NÃO ÓBVIO, e que só aparece escrevendo este lado: JSON aceita
      -- `"valor_cents": "12345"` como STRING, e `->>` devolveria os
      -- MESMOS BYTES que o número — passaria aqui e seria recusado lá,
      -- que é exatamente a divergência "TS rejeita, SQL aceita". Por
      -- isso a checagem é de TIPO JSON, não só de formato.
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
  end loop;

  return null;
end;
$$;

revoke all on function public.romaneio_retorno_validar(text, jsonb) from public, anon;
grant execute on function public.romaneio_retorno_validar(text, jsonb) to authenticated;


-- =====================================================================
-- 2. O CANÔNICO — normaliza, ordena, serializa
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
  v_motivo   text;
  v_entregue boolean;
begin
  v_motivo := public.romaneio_retorno_validar(p_saida_document_hash, p_retorno);
  if v_motivo is not null then
    raise exception 'Retorno inválido: %', v_motivo using errcode = 'check_violation';
  end if;

  -- `uuid::text` do Postgres já sai minúsculo; o `lower` está aqui pelo
  -- que vem do jsonb, onde o cliente pode ter mandado maiúscula.
  v_linhas := array[
    'DCRR1',
    'saida'       || e'\t' || lower(p_saida_id::text),
    'saida_hash'  || e'\t' || p_saida_document_hash,
    'motoboy'     || e'\t' || lower(p_motoboy_id::text),
    'responsavel' || e'\t' || lower(p_responsavel_id::text)
  ];

  -- Vales, ordenados por entrega_id. `collate "C"` porque a collation
  -- padrão do banco NÃO é a ordem de code unit do JavaScript — pra hex de
  -- UUID as duas coincidem, mas depender de coincidência aqui quebra sem
  -- ninguém achar.
  for v_vale in
    select t.value from jsonb_array_elements(p_retorno) as t(value)
     order by lower(t.value ->> 'entrega_id') collate "C"
  loop
    -- A REGRA DO V004: `entregue` não tem motivo nem detalhe POR
    -- DEFINIÇÃO, então '-' é dedução, não invenção. Vale mesmo que a
    -- entrada traga outra coisa — a fila offline pode carregar payload
    -- antigo, e o canônico não pode depender de quem chamou ter se
    -- comportado.
    v_entregue := (v_vale ->> 'desfecho') = 'entregue';
    -- `coalesce` em volta do `lower` NÃO é zelo: `lower(NULL)` é NULL, a
    -- concatenação inteira vira NULL, e `array_to_string` DESCARTA linha
    -- nula em silêncio — um vale sumiria do documento assinado. O lado
    -- TypeScript produziria '-' (é o que `idCanonico` faz), então sem
    -- isto os dois gêmeos divergiriam num campo ausente.
    v_linhas := v_linhas || (
      'v' || e'\t' || coalesce(lower(v_vale ->> 'entrega_id'), '-')
          || e'\t' || (v_vale ->> 'desfecho')
          || e'\t' || case when v_entregue then '-'
                           else public.texto_para_canonico(v_vale ->> 'motivo') end
          || e'\t' || case when v_entregue then '-'
                           else public.texto_para_canonico(v_vale ->> 'detalhe') end
    );
  end loop;

  -- TODOS os pagamentos DEPOIS de todos os vales, em bloco próprio — o
  -- lado TypeScript faz dois laços separados, então intercalar aqui já
  -- mudaria os bytes.
  --
  -- E o laço é ANINHADO: vale por fora, pagamentos daquele vale por
  -- dentro. Achatar num select só reabriria o erro que o TypeScript
  -- fechou por construção. Como os vales saem ordenados e os pagamentos
  -- de cada um também, a ordem resultante é (entrega_id, pagamento_id)
  -- sem precisar de um ORDER BY composto.
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

  -- `array_to_string` não põe separador no fim, igual ao `join` do lado
  -- TypeScript. Sem `\n` final.
  return array_to_string(v_linhas, e'\n');
end;
$$;

revoke all on function public.romaneio_retorno_canonico(uuid, text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.romaneio_retorno_canonico(uuid, text, uuid, uuid, jsonb) to authenticated;


-- =====================================================================
-- CONFERIR CONTRA OS GOLDEN VECTORS
--
-- `npx tsx scripts/dcrr1-sql.spec.mts` gera o SQL destas conferências a
-- partir dos vetores congelados, pra colar no SQL Editor. Os MESMOS
-- vetores que o lado TypeScript usa — não vetores "equivalentes".
--
-- O V001, pra conferir agora que a migration acabou de rodar:
--
--   select public.romaneio_retorno_canonico(
--     '019fe83f-1d58-70e9-8dd8-0000000000a1'::uuid,
--     'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
--     '019fe83f-1d58-70e9-8dd8-0000000000b1'::uuid,
--     '019fe83f-1d58-70e9-8dd8-0000000000c1'::uuid,
--     '[{"entrega_id":"019fe83f-1d58-70e9-8dd8-0000000000e1",
--        "desfecho":"entregue","motivo":null,"detalhe":null,
--        "pagamentos_realizados":[{"pagamento_id":"019fe83f-1d58-70e9-8dd8-0000000000f1",
--          "forma":"pix","valor_cents":12345,"troco_cents":0}]}]'::jsonb
--   );
--
-- O digest dele tem que dar
-- c6d4a10382ca1b388e0549fc90b09f78594f216c58265fd427168b22ff323089.
-- =====================================================================
