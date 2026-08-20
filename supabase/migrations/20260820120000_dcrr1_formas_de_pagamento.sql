-- =====================================================================
-- DCRR1 — o domínio de `forma` passa a ser o CHECK de `pagamentos.forma`
--
-- CORREÇÃO DE UM CONTRATO CONGELADO, e ela só é barata hoje.
--
-- ---------------------------------------------------------------------
-- O QUE ESTAVA ERRADO
-- ---------------------------------------------------------------------
-- O DCRR1 foi congelado em 2026-08-19 com esta lista:
--
--     dinheiro, credito, debito, pix, convenio, vale, outro
--
-- que é a do SCHEMA INICIAL (2026-08-06). A migration
-- `20260807123331_formas_pagamento.sql` já a tinha substituído DOZE DIAS
-- ANTES do congelamento:
--
--     dinheiro, credito, debito, pix, convenio, convcard, crediario, outro
--
-- `vale` saiu ("não é usado, confundia com número do vale da entrega") e
-- entraram `convcard` e `crediario`.
--
-- Os três lugares — os golden vectors, `src/lib/canonicoRetorno.ts` e o
-- gêmeo SQL de `20260819140000` — carregavam o MESMO engano, porque os
-- três foram escritos a partir da mesma leitura errada. É exatamente a
-- falha que os golden vectors existiam pra impedir, e eles não
-- impediram porque o erro estava neles também. Os vetores travam bem o
-- que uma implementação faz com a especificação; não travam a
-- especificação estar certa sobre o banco.
--
-- E o vetor I010 já dizia, com todas as letras, qual era a intenção:
--
--     "O domínio é o CHECK de pagamentos.forma. Valor fora dele passaria
--      pelo canônico e morreria no INSERT, dentro da transação do selo —
--      depois de colhidas as duas assinaturas."
--
-- ---------------------------------------------------------------------
-- O QUE ISSO CUSTARIA NA 2B, NAS DUAS DIREÇÕES
-- ---------------------------------------------------------------------
--   convcard/crediario  o canônico responderia `forma_invalida` e o
--                       retorno NÃO selaria — com as duas assinaturas já
--                       colhidas e o motoboy no balcão
--   vale                passaria pelo canônico e morreria no INSERT em
--                       `pagamentos`, dentro da mesma transação
--
-- ---------------------------------------------------------------------
-- POR QUE MEXER NUM CONTRATO CONGELADO, E POR QUE AGORA
-- ---------------------------------------------------------------------
-- Congelar o DCRR1 importa porque, DEPOIS QUE O PRIMEIRO ROMANEIO DE
-- RETORNO REAL FOR SELADO, o significado byte a byte dele vira parte
-- permanente do histórico. Nenhum foi selado ainda: a 2B não existe.
--
-- Então a janela é esta, e ela fecha sozinha. Nenhum vetor válido muda
-- de bytes — conferido, os oito hashes originais estão intactos —, o que
-- muda é só o conjunto de entradas RECUSADAS.
--
-- Continua sendo DCRR1, e não DCRR2: a versão do formato existe pra
-- distinguir documentos que foram assinados sob regras diferentes, e não
-- há nenhum assinado.
--
-- ---------------------------------------------------------------------
-- O QUE ESTA MIGRATION NÃO FAZ
-- ---------------------------------------------------------------------
-- Não representa a CUSTÓDIA DO PAPEL do crediário. A linha `pr` diz o
-- que aconteceu com o pagamento; o carnê que sai junto pra o cliente
-- assinar é outro fato, e misturá-lo aqui faria o documento confundir "o
-- dinheiro foi combinado" com "o papel voltou assinado".
--
-- Decidido em 2026-08-20 que isso vira um bloco próprio (`d`), e que ele
-- só entra depois de levantado o fluxo real — quando o papel é impresso,
-- quem leva, quem assina, se volta obrigatoriamente na mesma corrida, e
-- o que acontece quando não volta. Congelar situações antes de observar
-- o balcão seria repetir, no bloco `d`, o erro que esta migration está
-- corrigindo no bloco `pr`.
--
-- ---------------------------------------------------------------------
-- SÓ `romaneio_retorno_validar` MUDA
-- ---------------------------------------------------------------------
-- `romaneio_retorno_canonico` não é tocada: ela chama a validação e
-- serializa o que passar. Reescrevê-la à toa reabriria a função que
-- produz bytes assinados, sem necessidade nenhuma.
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
  -- ESTA LISTA É O CHECK DE `pagamentos.forma`. Se um dia ela divergir de
  -- novo, o sintoma é uma saída que não fecha com o motoboy no balcão.
  -- Mexeu aqui, mexa junto em `src/lib/canonicoRetorno.ts`, em
  -- `scripts/dcrr1-vetores.mts` e no `FORMAS` de
  -- `scripts/dcrr1-vetores.spec.mts` — são quatro cópias, e as quatro
  -- são deliberadas (a do spec existe pra não concordar consigo mesma).
  v_formas_ok   text[] := array['dinheiro','credito','debito','pix',
                                'convenio','convcard','crediario','outro'];
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
-- CONFERIR DEPOIS DE APLICAR
--
-- 1. As duas formas novas passam, e `vale` não. Esperado: t, t, f.
--
--   with p as (select $j${"entrega_id":"019fe83f-1d58-70e9-8dd8-0000000000e1",
--                          "desfecho":"entregue","motivo":null,"detalhe":null,
--                          "pagamentos_realizados":[{"pagamento_id":"019fe83f-1d58-70e9-8dd8-0000000000f1",
--                            "forma":"%s","valor_cents":100,"troco_cents":0}]}$j$ as m)
--   select f.forma,
--          public.romaneio_retorno_validar(
--            'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
--            ('[' || format(p.m, f.forma) || ']')::jsonb) is null as aceita
--     from p, (values ('convcard'), ('crediario'), ('vale')) as f(forma);
--
-- 2. O V001 continua dando o MESMO hash — o que prova que esta migration
--    não mexeu em byte nenhum de documento válido. Esperado:
--    c6d4a10382ca1b388e0549fc90b09f78594f216c58265fd427168b22ff323089
--
--   select encode(digest(public.romaneio_retorno_canonico(
--     '019fe83f-1d58-70e9-8dd8-0000000000a1'::uuid,
--     'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
--     '019fe83f-1d58-70e9-8dd8-0000000000b1'::uuid,
--     '019fe83f-1d58-70e9-8dd8-0000000000c1'::uuid,
--     '[{"entrega_id":"019fe83f-1d58-70e9-8dd8-0000000000e1",
--        "desfecho":"entregue","motivo":null,"detalhe":null,
--        "pagamentos_realizados":[{"pagamento_id":"019fe83f-1d58-70e9-8dd8-0000000000f1",
--          "forma":"pix","valor_cents":12345,"troco_cents":0}]}]'::jsonb
--   ), 'sha256'), 'hex');
--
-- 3. E a conferência completa contra os golden vectors, agora com 10
--    válidos e 13 inválidos:
--
--       npx tsx scripts/dcrr1-sql.spec.mts
--
--    gera a consulta única pra colar no SQL Editor. Esperado: **43 de
--    43** (10 válidos × texto/bytes/hash + 13 motivos de recusa), e
--    nenhuma linha com `ok = false` — elas vêm primeiro justamente pra
--    não se esconderem no fim de uma lista longa.
-- =====================================================================
