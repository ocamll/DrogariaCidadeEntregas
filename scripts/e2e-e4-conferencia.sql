-- =====================================================================
-- CONFERÊNCIA DO E2E DO E4 — duas formas de pagamento previstas
--
-- Rode no SQL Editor do Supabase, COMO ADMIN. A RLS de `entregas` é por
-- filial, e `verificar_integridade_resumo` é `security invoker`: rodando
-- como caixa, o placar volta PARCIAL sem avisar que é parcial.
--
-- Este arquivo NÃO altera nada. Só `select`.
--
-- ---------------------------------------------------------------------
-- NÃO É PRECISO TROCAR NÚMERO DE VALE EM LUGAR NENHUM.
-- ---------------------------------------------------------------------
-- Cada bloco resolve o alvo sozinho, pela CTE `alvo`: **o vale mais
-- recente que tem DOIS OU MAIS pagamentos previstos.**
--
-- Isso é exato hoje por um motivo que vale registrar: até este PR, NADA
-- no sistema conseguia criar um segundo previsto — o id era derivado do
-- uuid da entrega, e a segunda forma colidia na PK. Então o primeiro (e
-- único) vale com dois previstos é justamente o que o E2E acabou de
-- criar. Não há como pegar o vale errado.
--
-- A ordenação é `order by e.id desc`, e ela é temporal de verdade: a
-- regra 5 do projeto manda usar **uuid v7**, que carrega o timestamp nos
-- bits altos, e a ordem de bytes do Postgres coincide com a ordem
-- cronológica. Não é `created_at` porque não há coluna dessas aqui.
--
-- Se quiser fixar um vale específico, troque o corpo da CTE pela linha
-- comentada dentro dela.
-- =====================================================================


-- =====================================================================
-- BLOCO 1 · O PLACAR — rode ANTES, depois da SAÍDA, e depois do RETORNO
--
-- Não precisa de alvo nenhum. O critério não é "continuar em 16":
--
--     documentos antigos válidos continuam válidos
--   + cada romaneio selado novo aumenta o universo esperado
--   + nenhuma divergência de integridade nova
--
-- Um número MAIOR é o esperado depois de selar. O que não pode é
-- `divergencias > 0`, nem `documentos` DIMINUIR.
-- =====================================================================

select escopo, documentos, integros, divergencias
  from public.verificar_integridade_resumo()
 order by escopo;

-- O total agregado, no formato que o NOTAS registra:
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
-- Espere DUAS linhas, com `pagamento_id` distintos entre si — e a coluna
-- `id_derivado_da_entrega` FALSE nas duas. Era essa derivação (id do
-- previsto = uuid da entrega) que o E3 removeu, e que fazia a segunda
-- forma bater no 23505, ser tratada como sucesso, e sumir em silêncio.
-- =====================================================================

with alvo as (
  -- select id, numero_vale from public.entregas where numero_vale = 'V-000123'
  select e.id, e.numero_vale
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.numero_vale
  having count(*) >= 2
   order by e.id desc
   limit 1
)
select a.numero_vale,
       e.valor_compra_cents,
       p.id            as pagamento_id,
       p.forma,
       p.valor_cents,
       p.id = e.id     as id_derivado_da_entrega   -- FALSE nas duas
  from alvo a
  join public.entregas e   on e.id = a.id
  join public.pagamentos p on p.entrega_id = a.id and p.momento = 'previsto'
 order by p.id::text collate "C";

-- A soma bate com o valor da compra?
with alvo as (
  select e.id, e.numero_vale
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.numero_vale
  having count(*) >= 2
   order by e.id desc
   limit 1
)
select a.numero_vale,
       e.valor_compra_cents,
       sum(p.valor_cents)                          as soma_prevista,
       sum(p.valor_cents) = e.valor_compra_cents   as bate,
       count(*)                                    as formas
  from alvo a
  join public.entregas e   on e.id = a.id
  join public.pagamentos p on p.entrega_id = a.id and p.momento = 'previsto'
 group by a.numero_vale, e.valor_compra_cents;


-- =====================================================================
-- BLOCO 3 · O DCR1 TEM DUAS LINHAS `p`?
--
-- Acha sozinho o romaneio de SAÍDA que contém aquele vale, via
-- `romaneio_entregas`. Rode depois da saída selada.
--
-- Lê o canônico ASSINADO, não `pagamentos`. É o documento que as duas
-- partes assinaram: se ele tiver uma linha `p` só, a segunda forma ficou
-- FORA do que foi assinado — e esse é o defeito grave, não o cosmético.
-- =====================================================================

with alvo as (
  select e.id, e.numero_vale
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.numero_vale
  having count(*) >= 2
   order by e.id desc
   limit 1
),
saida as (
  select r.*
    from public.romaneios r
    join public.romaneio_entregas re on re.romaneio_id = r.id
    join alvo a on a.id = re.entrega_id
   where r.tipo = 'saida'
   limit 1
)
select s.numero,
       s.tipo,
       s.status,
       s.modo,
       count(*) filter (where split_part(linha, e'\t', 1) = 'p') as linhas_p,
       count(*) filter (where split_part(linha, e'\t', 1) = 'v') as linhas_v
  from saida s
  cross join lateral unnest(string_to_array(s.canonico, e'\n')) as linha
 group by s.numero, s.tipo, s.status, s.modo;

-- As linhas `p` em si — forma e valor DENTRO do documento assinado.
-- Formato: p <entrega_id> <pagamento_id> <forma> <valor> <troco>
with alvo as (
  select e.id
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id
  having count(*) >= 2
   order by e.id desc
   limit 1
)
select split_part(linha, e'\t', 4) as forma,
       split_part(linha, e'\t', 5) as valor_cents,
       linha
  from public.romaneios r
  join public.romaneio_entregas re on re.romaneio_id = r.id
  join alvo a on a.id = re.entrega_id
  cross join lateral unnest(string_to_array(r.canonico, e'\n')) as linha
 where r.tipo = 'saida'
   and split_part(linha, e'\t', 1) = 'p'
   and split_part(linha, e'\t', 2) = a.id::text;


-- =====================================================================
-- BLOCO 4 · O RETORNO FIEL **NÃO** VIROU DIVERGÊNCIA
--
-- A asserção que este PR existe pra provar. Pagar exatamente
-- `pix + dinheiro` num vale previsto `pix + dinheiro` é FIEL: o servidor
-- compara conjuntos de `forma|valor`, e a tela passou a usar a MESMA
-- regra (`divergiuDoPrevisto`) em vez de contar linhas.
--
-- Espere:  status_financeiro = 'na_ordem'  e  eventos = 0
-- =====================================================================

with alvo as (
  select e.id, e.numero_vale
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.numero_vale
  having count(*) >= 2
   order by e.id desc
   limit 1
)
select a.numero_vale,
       e.status_entrega,
       e.status_financeiro,                        -- tem que ser 'na_ordem'
       (select count(*) from public.eventos ev
         where ev.entrega_id = a.id
           and ev.tipo = 'pagamento_alterado')     as eventos_pagamento_alterado
  from alvo a
  join public.entregas e on e.id = a.id;

-- Previsto × realizado lado a lado. Os dois têm que ser iguais como
-- MULTICONJUNTO: mesma forma, mesmo valor, mesma contagem.
with alvo as (
  select e.id, e.numero_vale
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.numero_vale
  having count(*) >= 2
   order by e.id desc
   limit 1
)
select p.momento, p.forma, p.valor_cents, p.troco_cents
  from alvo a
  join public.pagamentos p on p.entrega_id = a.id
 order by p.momento, p.forma;


-- =====================================================================
-- BLOCO 5 · A DIVERGÊNCIA DELIBERADA — o `de` com as DUAS formas
--
-- Só depois do cenário fiel passar. Registre uma divergência pelo menu
-- "⋮" do vale → Notificar ocorrência, num vale com dois previstos.
--
-- Era escalar até o E4: `pagamento_alterado` tem DOIS escritores, e o
-- E3.B corrigiu só o do servidor. Este bloco prova o outro.
--
-- Espere `tipo_do_de = array` e `formas_no_de = 2`.
-- =====================================================================

with alvo as (
  select e.id, e.numero_vale
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.numero_vale
  having count(*) >= 2
   order by e.id desc
   limit 1
)
select a.numero_vale,
       ev.payload -> 'de'                       as de,
       jsonb_typeof(ev.payload -> 'de')         as tipo_do_de,    -- 'array'
       jsonb_array_length(ev.payload -> 'de')   as formas_no_de,  -- 2
       ev.payload -> 'para'                     as para,
       ev.payload ->> 'justificativa'           as justificativa,
       pr.nome                                  as autor,
       ev.registrado_em
  from alvo a
  join public.eventos ev on ev.entrega_id = a.id and ev.tipo = 'pagamento_alterado'
  left join public.profiles pr on pr.id = ev.user_id
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

with alvo as (
  select e.id, e.numero_vale
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.numero_vale
  having count(*) >= 2
   order by e.id desc
   limit 1
)
select a.numero_vale,
       e.status_documental,
       e.convenio_id is not null                  as tem_convenio_id,
       array_agg(p.forma order by p.forma)        as formas_previstas
  from alvo a
  join public.entregas e   on e.id = a.id
  join public.pagamentos p on p.entrega_id = a.id and p.momento = 'previsto'
 group by a.numero_vale, e.status_documental, e.convenio_id;


-- =====================================================================
-- BLOCO 0 · SANIDADE — rode ANTES de tudo, uma vez
--
-- Quantos vales com dois previstos existem HOJE? A resposta esperada
-- ANTES do E2E é **zero**, e é isso que torna a CTE `alvo` inequívoca.
--
-- Se vier mais que zero antes de você cadastrar nada, pare: ou alguém
-- criou pelo app, ou a premissa acima não vale e os blocos podem estar
-- olhando o vale errado.
-- =====================================================================

select count(*) as vales_com_dois_previstos
  from (
    select e.id
      from public.entregas e
      join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
     group by e.id
    having count(*) >= 2
  ) t;
