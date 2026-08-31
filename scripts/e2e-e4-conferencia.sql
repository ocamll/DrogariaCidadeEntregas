-- =====================================================================
-- CONFERÊNCIA DO E2E DO E4 — duas formas de pagamento previstas
--
-- Rode no SQL Editor do Supabase, COMO ADMIN. A RLS de `entregas` é por
-- filial, e `verificar_integridade_resumo` é `security invoker`: rodando
-- como caixa, o placar volta PARCIAL sem avisar que é parcial.
--
-- Este arquivo NÃO altera nada. Só `select`.
--
-- A ordem importa: o bloco 1 roda TRÊS vezes, nos três momentos, e é a
-- comparação entre eles que é o gate — não o valor absoluto de nenhum.
-- =====================================================================


-- =====================================================================
-- BLOCO 1 · O PLACAR — rode ANTES, depois da SAÍDA, e depois do RETORNO
--
-- O critério não é "continuar em 16":
--
--     documentos antigos válidos continuam válidos
--   + cada romaneio selado novo aumenta o universo esperado
--   + nenhuma divergência de integridade nova
--
-- Um número MAIOR é o esperado depois de selar; o que não pode é
-- `divergencias > 0`, nem `documentos` DIMINUIR.
-- =====================================================================

select escopo, documentos, integros, divergencias
  from public.verificar_integridade_resumo()
 order by escopo;

-- E o total agregado, que é o formato que o NOTAS registra:
select count(*)                                   as verificados,
       count(*) filter (where divergencias = 0)   as validos,
       coalesce(sum(divergencias), 0)             as divergencias
  from public.verificar_romaneios_selados();

-- A CONTAGEM FECHA CONTRA A SEQUÊNCIA? (o método do §64)
-- selados + conflitos tem que dar o maior número emitido. Sem isto, um
-- documento sumido pareceria tão saudável quanto nenhum.
select
  (select count(*) from public.romaneios where status = 'selado')   as selados,
  (select count(*) from public.romaneios where status = 'conflito') as conflitos,
  (select max(numero) from public.romaneios)                        as maior_numero;


-- =====================================================================
-- BLOCO 2 · OS DOIS PREVISTOS PERSISTIRAM?
--
-- Troque o número do vale. Espere DUAS linhas, com `pagamento_id`
-- DISTINTOS entre si e distintos do `entrega_id` — era essa derivação
-- (id do previsto = uuid da entrega) que o E3 removeu, e que fazia a
-- segunda forma colidir na PK e sumir em silêncio.
-- =====================================================================

select e.numero_vale,
       e.valor_compra_cents,
       p.id            as pagamento_id,
       p.forma,
       p.valor_cents,
       p.id = e.id     as id_derivado_da_entrega   -- tem que ser FALSE nas duas
  from public.entregas e
  join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
 where e.numero_vale = 'V-000XXX'                  -- <<< TROQUE
 order by p.id::text collate "C";

-- A soma bate com o valor da compra?
select e.numero_vale,
       e.valor_compra_cents,
       sum(p.valor_cents)                              as soma_prevista,
       sum(p.valor_cents) = e.valor_compra_cents       as bate,
       count(*)                                        as formas
  from public.entregas e
  join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
 where e.numero_vale = 'V-000XXX'                  -- <<< TROQUE
 group by e.numero_vale, e.valor_compra_cents;


-- =====================================================================
-- BLOCO 3 · O DCR1 TEM DUAS LINHAS `p`?
--
-- Lê o canônico ASSINADO, não `pagamentos`. É o documento que as duas
-- partes assinaram — se ele tiver uma linha `p` só, a segunda forma
-- ficou fora do que foi assinado, e isso é o defeito grave.
--
-- Rode DEPOIS da saída selada.
-- =====================================================================

select r.numero,
       r.tipo,
       r.status,
       count(*) filter (where split_part(linha, e'\t', 1) = 'p') as linhas_p,
       count(*) filter (where split_part(linha, e'\t', 1) = 'v') as linhas_v
  from public.romaneios r
  cross join lateral unnest(string_to_array(r.canonico, e'\n')) as linha
 where r.numero = 'R-000XXX'                       -- <<< TROQUE
 group by r.numero, r.tipo, r.status;

-- E as linhas `p` em si, pra ver forma e valor dentro do documento:
select linha
  from public.romaneios r
  cross join lateral unnest(string_to_array(r.canonico, e'\n')) as linha
 where r.numero = 'R-000XXX'                       -- <<< TROQUE
   and split_part(linha, e'\t', 1) = 'p';


-- =====================================================================
-- BLOCO 4 · O RETORNO FIEL **NÃO** VIROU DIVERGÊNCIA
--
-- Esta é a asserção que este PR existe pra provar. Pagar exatamente
-- `pix + dinheiro` num vale previsto `pix + dinheiro` é FIEL: o servidor
-- compara conjuntos de `forma|valor`, e a tela passou a usar a mesma
-- regra (`divergiuDoPrevisto`) em vez de contar linhas.
--
-- Espere:  status_financeiro = 'na_ordem'   e   eventos = 0
-- =====================================================================

select e.numero_vale,
       e.status_financeiro,                        -- tem que continuar 'na_ordem'
       (select count(*) from public.eventos ev
         where ev.entrega_id = e.id
           and ev.tipo = 'pagamento_alterado') as eventos_pagamento_alterado
  from public.entregas e
 where e.numero_vale = 'V-000XXX';                 -- <<< TROQUE

-- Previsto × realizado lado a lado — os dois conjuntos têm que ser
-- iguais como MULTICONJUNTO (mesma forma, mesmo valor, mesma contagem).
select p.momento, p.forma, p.valor_cents, p.troco_cents
  from public.entregas e
  join public.pagamentos p on p.entrega_id = e.id
 where e.numero_vale = 'V-000XXX'                  -- <<< TROQUE
 order by p.momento, p.forma;


-- =====================================================================
-- BLOCO 5 · A DIVERGÊNCIA DELIBERADA — o `de` com as DUAS formas
--
-- Só depois do cenário fiel passar. Registre uma divergência (menu "⋮"
-- do vale → Notificar ocorrência) num vale com DOIS previstos, e confira
-- que o `de` do evento traz AS DUAS.
--
-- Era escalar até o E4: `pagamento_alterado` tem DOIS escritores, e o
-- E3.B corrigiu só o do servidor. Este bloco prova o outro.
--
-- Espere `de` com jsonb_array_length = 2.
-- =====================================================================

select ev.tipo,
       ev.payload -> 'de'                       as de,
       jsonb_typeof(ev.payload -> 'de')         as tipo_do_de,   -- 'array'
       jsonb_array_length(ev.payload -> 'de')   as formas_no_de, -- 2
       ev.payload -> 'para'                     as para,
       ev.payload ->> 'justificativa'           as justificativa,
       pr.nome                                  as autor,
       ev.registrado_em
  from public.eventos ev
  join public.entregas e on e.id = ev.entrega_id
  left join public.profiles pr on pr.id = ev.user_id
 where e.numero_vale = 'V-000XXX'                  -- <<< TROQUE
   and ev.tipo = 'pagamento_alterado'
 order by ev.registrado_em desc;


-- =====================================================================
-- BLOCO 6 · A REGRA DO PAPEL, se alguma das formas for convênio
--
-- `status_documental` tem que olhar TODAS as formas: basta uma prever
-- convênio ou crediário pra o vale nascer 'pendente'. É a mesma regra
-- que `romaneio_documentos_esperados` aplica no servidor varrendo todas
-- as linhas `p` — divergirem faria o retorno recusar
-- `documentos_nao_conferem` DEPOIS de colhidas as duas assinaturas.
-- =====================================================================

select e.numero_vale,
       e.status_documental,
       e.convenio_id is not null                     as tem_convenio_id,
       array_agg(p.forma order by p.forma)           as formas_previstas
  from public.entregas e
  join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
 where e.numero_vale = 'V-000XXX'                  -- <<< TROQUE
 group by e.numero_vale, e.status_documental, e.convenio_id;
