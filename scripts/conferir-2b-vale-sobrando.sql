-- =====================================================================
-- ETAPA 2B — o ramo que faltou: `vales_nao_conferem`
--
-- Na primeira rodada o caso (a) veio "nao aplicavel": a corrida do
-- R-000014 tem UM vale, e com um vale só não há como faltar vale.
--
-- Mas a checagem tem DOIS sentidos, e o outro é exercitável com qualquer
-- corrida: mandar um vale A MAIS. Faltando, o documento fecharia a
-- corrida deixando vale sem desfecho; sobrando, ele afirma o desfecho de
-- um vale que nunca saiu nessa corrida. As duas metades importam, e é a
-- mesma linha de código que recusa as duas.
--
-- O vale extra é um uuid inventado, e isso é de propósito: a comparação
-- é de conjunto contra `romaneio_entregas`, e acontece ANTES de qualquer
-- FK ou join. `registrar_conflito_retorno` guarda o payload DECLARADO
-- sem montar o snapshot bonito — justamente pra o conflito "vale que não
-- é deste romaneio" não falhar ao tentar descrever o vale estranho.
--
-- Mesma disciplina do outro arquivo: termina em `raise exception`, que
-- desfaz o romaneio de conflito e o evento que este bloco escreveu. O
-- ERRO VERMELHO É O RESULTADO.
-- =====================================================================

do $$
declare
  a         record;
  v_resp    uuid;
  v_ret     jsonb;
  v_out     jsonb;
  v_extra   uuid := gen_random_uuid();
  v_strokes jsonb := '{"strokes":[],"canvas":{"w":600,"h":200}}'::jsonb;
begin
  select r.id as saida_id, r.document_hash, r.numero, c.mototaxista_id,
         (select array_agg(re.entrega_id order by re.entrega_id)
            from public.romaneio_entregas re where re.romaneio_id = r.id) as vales
    into a
    from public.romaneios r
    join public.corridas c on c.id = r.corrida_id
   where r.tipo = 'saida' and r.status = 'selado' and c.status = 'aberta'
   order by r.recebido_em_servidor desc
   limit 1;

  if a.saida_id is null then
    raise exception E'Nenhuma corrida aberta — sele uma saída e não feche a corrida.';
  end if;

  select p.id into v_resp
    from public.profiles p where p.ativo and p.papel in ('caixa','gerente','admin') limit 1;

  -- os vales de verdade MAIS um que não é desta saída
  select jsonb_agg(jsonb_build_object(
           'entrega_id', v, 'desfecho', 'entregue',
           'motivo', null, 'detalhe', null,
           'pagamentos_realizados', '[]'::jsonb))
    into v_ret
    from unnest(a.vales || v_extra) as v;

  v_out := public.selar_romaneio_retorno_interno(
    v_resp, gen_random_uuid(), a.saida_id, a.document_hash, a.mototaxista_id,
    v_ret, repeat('0', 64), gen_random_uuid(), v_strokes, v_strokes,
    now(), 'online', null, null);

  -- `%` PURO, e não `%s`. O placeholder do `raise` do PL/pgSQL é `%`;
  -- `%s` é do `format()`. Escrever `%s` aqui não dá erro — o `s` sobra
  -- como literal grudado no valor, e a primeira rodada deste script
  -- imprimiu `R-000014s` e um uuid terminando em `s`. Os valores estavam
  -- certos; a leitura é que ficava mentindo.
  raise exception E'\n\n=== VALE SOBRANDO — NADA FOI GRAVADO ===\n\nsaída % · % vale(s) reais + 1 inventado\n\nmotivo    -> %\nfaltando  -> %\nsobrando  -> %\n\nESPERADO:\n  motivo    vales_nao_conferem\n  faltando  []\n  sobrando  [%]\n',
    a.numero, coalesce(array_length(a.vales, 1), 0),
    coalesce(v_out #>> '{conflitos,0,motivo}', v_out::text),
    coalesce(v_out #>> '{conflitos,0,faltando}', '(ausente)'),
    coalesce(v_out #>> '{conflitos,0,sobrando}', '(ausente)'),
    v_extra;
end $$;
