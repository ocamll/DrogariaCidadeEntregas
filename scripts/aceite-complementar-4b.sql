-- =====================================================================
-- ACEITE COMPLEMENTAR DO 4B — 2026-09-13
--
-- O que o aceite de 2026-09-12 (itens 107 e 108 do NOTAS) NÃO mediu, e que
-- o desenho do 4B (§11) pedia. SOMENTE LEITURA: nada aqui escreve.
--
-- Rodar no SQL Editor, UMA CONSULTA POR VEZ, na ordem. Cada bloco diz o que
-- é esperado e qual cenário de tela precisa ter sido feito antes. O roteiro
-- dos cenários está no NOTAS (item 110).
-- =====================================================================


-- ---------------------------------------------------------------------
-- (1) Os vales dos retornos R-000039..42 ficaram no motoboy certo?
--
-- Até aqui isto era DEDUÇÃO (item 108): "as duas coisas saem da mesma
-- transação do selo". Agora é medição, por três colunas independentes.
-- Não depende de cenário novo.
--
-- esperado: toda linha com
--   motoboy_confere = true   (evidência do retorno = motoboy da corrida)
--   vale_na_corrida = true   (o vale pertence àquela corrida)
--   corrida = 'fechada'
-- e, nos dois do gerente, gerente_validador preenchido e DIFERENTE do nome
-- do motoboy.
-- ---------------------------------------------------------------------
select r.numero                              as retorno,
       s.numero                              as saida,
       e.numero_vale,
       m.nome                                as motoboy_da_corrida,
       (a.motoboy_id = c.mototaxista_id)     as motoboy_confere,
       (e.corrida_id = c.id)                 as vale_na_corrida,
       c.status                              as corrida,
       e.status_entrega,
       a.auth_method,
       a.motivo_excecao,
       g.nome                                as gerente_validador
  from public.romaneios r
  join public.romaneios s            on s.id = r.romaneio_saida_id
  join public.corridas c             on c.id = r.corrida_id
  join public.romaneio_entregas re   on re.romaneio_id = r.id
  join public.entregas e             on e.id = re.entrega_id
  join public.assinaturas a          on a.romaneio_id = r.id and a.tipo_signatario = 'motoboy'
  left join public.mototaxistas m    on m.id = c.mototaxista_id
  left join public.profiles g        on g.id = a.validador_profile_id
 where r.tipo = 'retorno'
   and r.numero in ('R-000039', 'R-000040', 'R-000041', 'R-000042')
 order by r.numero, e.numero_vale;


-- ---------------------------------------------------------------------
-- (2) "Cartão perdido" em documento real — cenário A do roteiro.
--
-- Antes: uma SAÍDA e um RETORNO autorizados pelo gerente com o motivo
-- "Cartão perdido", um online e um offline, sem apresentar cartão do
-- motoboy.
--
-- esperado: as linhas novas com motivo_excecao = 'cartao_perdido',
-- auth_method `gerente_card_pin_*` coerente com o modo, gerente_validador
-- preenchido, e motoboy_responsavel = o motoboy ESCOLHIDO (saída) ou o da
-- saída (retorno) — nunca o gerente.
-- ---------------------------------------------------------------------
select r.numero,
       r.tipo,
       r.modo,
       a.auth_method,
       a.motivo_excecao,
       mo.nome as motoboy_responsavel,
       g.nome  as gerente_validador,
       r.selado_em
  from public.romaneios r
  join public.assinaturas a       on a.romaneio_id = r.id and a.tipo_signatario = 'motoboy'
  left join public.mototaxistas mo on mo.id = a.motoboy_id
  left join public.profiles g      on g.id = a.validador_profile_id
 where a.motivo_excecao = 'cartao_perdido'
 order by r.numero;


-- ---------------------------------------------------------------------
-- (3) O mesmo gerente confirmando pela farmácia E autorizando a exceção.
--
-- Antes: cenário A feito LOGADO COMO O GERENTE, com o cartão dele.
--
-- esperado: ao menos uma linha com mesmo_gerente = true, e as duas
-- responsabilidades separadas — papel_na_confirmacao = 'gerente' no slot da
-- farmácia, e o cartão dele registrado no slot do motoboy.
-- ---------------------------------------------------------------------
select r.numero,
       r.tipo,
       f.tipo_signatario                         as slot_da_farmacia,
       f.papel_no_momento                        as papel_na_confirmacao,
       (f.user_id = a.validador_profile_id)      as mesmo_gerente,
       a.motivo_excecao
  from public.romaneios r
  join public.assinaturas f on f.romaneio_id = r.id and f.tipo_signatario <> 'motoboy'
  join public.assinaturas a on a.romaneio_id = r.id and a.tipo_signatario = 'motoboy'
 where a.validador_profile_id is not null
 order by r.numero;


-- ---------------------------------------------------------------------
-- (4) As recusas que ficam REGISTRADAS — cenários E e F do roteiro.
--
-- E  mudar a filial (ou bloquear) o gerente entre a captura offline e a
--    sincronização
--    → esperado: romaneio em conflito com motivo `gerente_sem_competencia`
--      (retorno) ou o equivalente da saída, e `validacao.resultado`
--      dizendo o que foi APRESENTADO — não uma autorização.
-- F  trocar o motivo só no corpo da fila, com o envelope original
--    → esperado: NENHUM romaneio novo (a Edge Function recusa antes de
--      qualquer RPC, com `validacao_divergente`) e o item terminal na fila.
--      Esta consulta deve continuar SEM linha nova para o F.
-- ---------------------------------------------------------------------
select numero,
       tipo,
       modo,
       conflito -> 'motivos'    as motivos,
       conflito -> 'validacao'  as validacao_apresentada,
       recebido_em_servidor
  from public.romaneios
 where status = 'conflito'
   and recebido_em_servidor >= '2026-09-13'
 order by numero;


-- ---------------------------------------------------------------------
-- (5) PIN errado do gerente conta no bloqueio DELE — cenário G.
--
-- Antes: errar o PIN do gerente uma ou duas vezes, sem acertar depois
-- (acertar zera o contador).
--
-- esperado: `tentativas_pin` > 0 na credencial do GERENTE, e a credencial do
-- motoboy daquela operação intacta. Os eventos `credencial_pin_incorreto`
-- carregam `titular_tipo = 'gerente'`.
-- ---------------------------------------------------------------------
select c.public_id,
       case when c.motoboy_id is not null then 'motoboy' else 'gerente' end as titular,
       coalesce(m.nome, p.nome) as titular_nome,
       c.tentativas_pin,
       c.bloqueado_ate
  from public.motoboy_credenciais c
  left join public.mototaxistas m on m.id = c.motoboy_id
  left join public.profiles p     on p.id = c.profile_id
 where c.ativo
 order by titular, titular_nome;

-- `eventos` não tem `registrado_em`: o relógio do servidor ali é `ocorrido_em`
-- (default now()), e o do dispositivo é `ocorrido_em_local`.
select ocorrido_em, payload ->> 'titular_tipo' as titular, payload ->> 'titular_nome' as nome
  from public.eventos
 where tipo = 'credencial_pin_incorreto'
   and ocorrido_em >= '2026-09-13'
 order by ocorrido_em;


-- ---------------------------------------------------------------------
-- (6) O placar, DEPOIS de tudo acima.
--
-- esperado: divergências = 0. O número de verificados sobe com os
-- documentos novos dos cenários — o gate nunca foi o número, é "os que
-- verificavam continuam verificando, e nenhum sumiu" (CLAUDE.md, 2B.4).
-- ---------------------------------------------------------------------
select * from public.verificar_romaneios_selados();
