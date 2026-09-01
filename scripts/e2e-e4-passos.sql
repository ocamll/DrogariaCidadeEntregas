-- =====================================================================
-- E2E DO E4 — só as conferências, na ORDEM de execução
--
-- Companheiro do roteiro. O outro arquivo (`e2e-e4-conferencia.sql`) tem
-- os blocos forenses que já foram rodados; este tem o que falta, na
-- sequência em que se usa.
--
-- Rode COMO ADMIN no SQL Editor. Só `select`, nada altera.
--
-- Nenhum número de vale pra trocar: a CTE `alvo` resolve sozinha o vale
-- mais recente com dois ou mais previstos. Depois do cadastro, esse é o
-- vale novo. (Existe UM anterior, o `V-000006` de 08/08, e ele é mais
-- antigo — a ordenação por uuid v7 é temporal.)
--
-- 🛑 Cada CHECK tem uma condição de PARADA. Batendo nela, pare e me
--    mande o resultado antes de seguir: os passos seguintes custam
--    cartão, PIN e duas assinaturas.
-- =====================================================================


-- #####################################################################
-- CHECK 1 · DEPOIS DO CADASTRO, antes de qualquer outra coisa
-- #####################################################################

-- 1a. Quais vales têm dois previstos, e qual deles os outros blocos vão
--     olhar. Espere DUAS linhas: o V-000006 antigo e o seu, com o seu
--     marcado `alvo = true`.
with candidatos as (
  select e.id, e.numero_vale, e.valor_compra_cents,
         count(*)                                    as previstos,
         sum(p.valor_cents)                          as soma_prevista,
         sum(p.valor_cents) = e.valor_compra_cents   as soma_bate,
         array_agg(p.forma order by p.forma)         as formas
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.numero_vale, e.valor_compra_cents
  having count(*) >= 2
)
select numero_vale, previstos, formas, valor_compra_cents,
       soma_prevista, soma_bate,
       row_number() over (order by id desc) = 1 as alvo
  from candidatos
 order by id desc;

-- 1b. As duas linhas do vale novo, com os ids.
--     `id_derivado_da_entrega` tem que ser FALSE nas duas — era essa
--     derivação que o E3 removeu, e que fazia a segunda forma colidir
--     na PK e sumir em silêncio.
with alvo as (
  select e.id, e.numero_vale
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.numero_vale
  having count(*) >= 2
   order by e.id desc
   limit 1
)
select a.numero_vale, e.valor_compra_cents,
       p.id as pagamento_id, p.forma, p.valor_cents,
       p.id = e.id as id_derivado_da_entrega
  from alvo a
  join public.entregas e   on e.id = a.id
  join public.pagamentos p on p.entrega_id = a.id and p.momento = 'previsto'
 order by p.id::text collate "C";

-- 🛑 PARE SE:  soma_bate = false
--              vierem 3+ linhas
--              id_derivado_da_entrega = true em alguma
--              as duas formas forem iguais


-- #####################################################################
-- CHECK 2 · ENSAIO A SECO — o DCR1 antes de existir
--
-- Monta o canônico SEM selar: não grava, não consome número da
-- sequência, não pede cartão, PIN nem assinatura.
--
-- É o gate mais barato do roteiro. Dando errado aqui, ninguém gastou uma
-- transferência de custódia pra descobrir.
--
-- Os três uuids zerados são agência, motoboy e caixa: eles só entram no
-- CABEÇALHO do documento, nunca nas linhas `p`, que é o que se mede.
-- #####################################################################

with alvo as (
  select e.id, e.tenant_id, e.loja_id, e.numero_vale
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id, e.tenant_id, e.loja_id, e.numero_vale
  having count(*) >= 2
   order by e.id desc
   limit 1
),
doc as (
  select a.numero_vale,
         public.romaneio_canonico(
           a.tenant_id, a.loja_id,
           '00000000-0000-0000-0000-000000000000'::uuid,
           '00000000-0000-0000-0000-000000000000'::uuid,
           '00000000-0000-0000-0000-000000000000'::uuid,
           array[a.id]
         ) as canonico
    from alvo a
)
select numero_vale,
       split_part(linha, e'\t', 4) as forma,
       split_part(linha, e'\t', 5) as valor_cents,
       linha
  from doc
  cross join lateral unnest(string_to_array(canonico, e'\n')) as linha
 where split_part(linha, e'\t', 1) = 'p';

-- 🛑 PARE SE vier UMA linha só. As duas formas não entrariam no
--    documento assinado, e a saída real não deve acontecer.


-- #####################################################################
-- CHECK 3 · DEPOIS DA SAÍDA SELADA
-- #####################################################################

-- 3a. O placar. SUBIR é o esperado: saida 14 · TOTAL 17.
--     O critério não é "continuar em 16" — é nenhuma divergência nova e
--     nenhum documento a menos.
select escopo, documentos, integros, divergencias
  from public.verificar_integridade_resumo()
 order by escopo;

select count(*)                                   as verificados,
       count(*) filter (where divergencias = 0)   as validos,
       coalesce(sum(divergencias), 0)             as divergencias
  from public.verificar_romaneios_selados();

-- 3b. O documento SELADO tem duas linhas `p`?
--     Agora não é ensaio: é o canônico congelado que as duas partes
--     assinaram.
with alvo as (
  select e.id
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id
  having count(*) >= 2
   order by e.id desc
   limit 1
),
saida as (
  select r.numero, r.status, r.modo, r.canonico, a.id as entrega_id
    from public.romaneios r
    join public.romaneio_entregas re on re.romaneio_id = r.id
    join alvo a on a.id = re.entrega_id
   where r.tipo = 'saida'
   limit 1
)
select s.numero, s.status, s.modo,
       count(*) filter (where split_part(linha, e'\t', 1) = 'p'
                          and split_part(linha, e'\t', 2) = s.entrega_id::text) as linhas_p_do_vale,
       count(*) filter (where split_part(linha, e'\t', 1) = 'v') as linhas_v
  from saida s
  cross join lateral unnest(string_to_array(s.canonico, e'\n')) as linha
 group by s.numero, s.status, s.modo, s.entrega_id;

-- 🛑 PARE SE:  divergencias > 0
--              linhas_p_do_vale <> 2


-- #####################################################################
-- CHECK 4 · DEPOIS DO RETORNO FIEL — o veredito do PR
-- #####################################################################

-- 4a. O placar: retorno 4 · TOTAL 18.
select escopo, documentos, integros, divergencias
  from public.verificar_integridade_resumo()
 order by escopo;

select count(*)                                   as verificados,
       count(*) filter (where divergencias = 0)   as validos,
       coalesce(sum(divergencias), 0)             as divergencias
  from public.verificar_romaneios_selados();

-- 4b. O VEREDITO. Pagar exatamente o previsto, em duas formas, NÃO é
--     divergência — o servidor compara conjuntos de `forma|valor`, e
--     desde o E4 a tela usa a mesma regra em vez de contar linhas.
--
--     Antes deste PR, a tela teria dito que divergiu e o servidor não.
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
       e.status_financeiro,                                    -- 'na_ordem'
       (select count(*) from public.eventos ev
         where ev.entrega_id = a.id
           and ev.tipo = 'pagamento_alterado')  as eventos_pagamento_alterado  -- 0
  from alvo a
  join public.entregas e on e.id = a.id;

-- 4c. Previsto × realizado lado a lado. Iguais como MULTICONJUNTO.
with alvo as (
  select e.id
    from public.entregas e
    join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
   group by e.id
  having count(*) >= 2
   order by e.id desc
   limit 1
)
select p.momento, p.forma, p.valor_cents, p.troco_cents
  from alvo a
  join public.pagamentos p on p.entrega_id = a.id
 order by p.momento, p.forma;

-- 🛑 PARE SE:  status_financeiro = 'divergente'
--              eventos_pagamento_alterado > 0
--              (é o defeito que este PR conserta — me avise)


-- #####################################################################
-- CHECK 5 · SÓ DEPOIS DO FIEL PASSAR — divergência deliberada
--
-- Marque uma divergência pelo menu "⋮" do vale (ex.: tudo em Dinheiro).
-- Prova o `de` com AS DUAS formas: `pagamento_alterado` tem dois
-- escritores, e o E3.B corrigiu só o do servidor.
-- #####################################################################

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
       ev.payload -> 'de'                     as de,
       jsonb_typeof(ev.payload -> 'de')       as tipo_do_de,      -- 'array'
       -- CASE obrigatório: `jsonb_array_length` estoura sobre escalar, e
       -- o `de` foi string até o E3.B/E4. `eventos` é append-only, então
       -- essa forma é permanente.
       case jsonb_typeof(ev.payload -> 'de')
         when 'array'  then jsonb_array_length(ev.payload -> 'de')
         when 'string' then 1
         else 0
       end                                    as formas_no_de,    -- 2
       ev.payload -> 'para'                   as para,
       ev.payload -> 'referencia_informada'   as referencia_informada,  -- null aqui
       ev.payload ->> 'justificativa'         as justificativa,
       pr.nome                                as autor,
       ev.ocorrido_em
  from alvo a
  join public.eventos ev on ev.entrega_id = a.id and ev.tipo = 'pagamento_alterado'
  left join public.profiles pr on pr.id = ev.user_id
 order by ev.ocorrido_em desc;

-- ESPERADO:  tipo_do_de = 'array'  ·  formas_no_de = 2
--            referencia_informada = null   ← o vale TEM previsto, então
--                                            não há nada a declarar
--                                            (E4.1)
