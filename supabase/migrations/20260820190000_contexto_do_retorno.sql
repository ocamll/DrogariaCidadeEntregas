-- =====================================================================
-- 2D.2 — O CONTEXTO DO RETORNO, numa chamada só
--
-- A tela do retorno precisa mostrar, por vale: número, cliente,
-- endereço, valor da compra, o pagamento PREVISTO e quais papéis a saída
-- espera de volta. E precisa do vínculo criptográfico da saída
-- (`id` + `document_hash`) pra montar o DCRR1.
--
-- ---------------------------------------------------------------------
-- TUDO SAI DO DOCUMENTO SELADO. NADA SAI DE ESTADO OPERACIONAL MUTÁVEL.
--
-- Este é o ponto da função, e ele foi um achado: `romaneios.payload` da
-- saída **já carrega tudo** — inclusive `pagamentos_previstos` por vale,
-- com `pagamento_id`, `forma`, `valor_cents` e `troco_cents`. Não é
-- preciso encostar em `entregas` nem em `pagamentos`.
--
-- Isso não é economia de join, é a regra 7:
--
--     se a saída dizia "Rua X, 123" e alguém corrigiu o cadastro pra
--     "Rua Y" depois, a tela de conferência do retorno tem que mostrar
--     "Rua X, 123" — porque é isso que o motoboy recebeu sob custódia.
--
-- É a mesma decisão que governa o PDF do romaneio desde 18/08. Correção
-- posterior é assunto de outra superfície; a referência de CONFERÊNCIA é
-- o snapshot.
--
-- ---------------------------------------------------------------------
-- POR QUE UMA CHAMADA, E NÃO TRÊS
--
-- Três consultas React (corrida, romaneio, pagamentos) abririam janela
-- pra misturar estados. Aqui a janela nem existe — todo o conteúdo vem
-- de UMA linha imutável —, mas a forma de uma chamada é o que garante
-- que continue assim quando alguém for acrescentar um campo.
--
-- ---------------------------------------------------------------------
-- `security invoker`, DE PROPÓSITO
--
-- A RLS de `romaneios` se aplica: o caixa só enxerga a própria filial, o
-- admin enxerga o tenant. Nada aqui precisa de `SECURITY DEFINER`, e
-- usá-lo obrigaria a reescrever à mão cada checagem que a policy já faz
-- de graça — a classe de buraco que este projeto já abriu antes.
--
-- ---------------------------------------------------------------------
-- `versao: 'CTXR1'`, E ELA EXISTE PELO CACHE
--
-- O contexto vai ser guardado em IndexedDB pra o retorno funcionar sem
-- rede. Um contexto cacheado por uma versão antiga do app tem que ser
-- RECONHECÍVEL como antigo, senão a tela monta o DCRR1 com um formato
-- que ela não entende mais. Mesma disciplina do `versaoDocumento` do
-- item da fila — e, como lá, o servidor não confia nela: ele reconstrói
-- e valida de qualquer jeito.
-- =====================================================================

create or replace function public.obter_contexto_retorno(p_corrida_id uuid)
returns jsonb
language sql stable security invoker
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'versao', 'CTXR1',
    'corrida_id', c.id,
    'saida_romaneio_id', r.id,
    'saida_numero', r.numero,
    'saida_document_hash', r.document_hash,
    'motoboy_id', c.mototaxista_id,
    'motoboy_nome', m.nome,
    'agencia_nome', a.nome,
    'saida_em', c.saida_em,
    -- Os vales, DO SNAPSHOT. `payload -> 'vales'` já vem ordenado por
    -- entrega_id (collate "C") de quando o romaneio foi selado, e a ordem
    -- é preservada aqui: a tela lista na mesma ordem em que o documento
    -- foi assinado.
    'vales', coalesce((
      select jsonb_agg(
               vale || jsonb_build_object(
                 -- Os papéis que ESTA saída espera de volta, derivados do
                 -- canônico assinado dela. A tela gera exatamente estas
                 -- linhas `d` e nenhuma outra — é a igualdade de conjunto
                 -- que `selar_romaneio_retorno` exige, reproduzida na UI.
                 'documentos_esperados', coalesce((
                   select jsonb_agg(d.tipo_documento order by d.tipo_documento collate "C")
                     from public.romaneio_documentos_esperados(r.id) d
                    where d.entrega_id = (vale ->> 'entrega_id')::uuid
                 ), '[]'::jsonb)
               )
               order by vale ->> 'entrega_id' collate "C"
             )
        from jsonb_array_elements(r.payload -> 'vales') as vale
    ), '[]'::jsonb)
  )
    from public.corridas c
    join public.romaneios r
      on r.corrida_id = c.id and r.tipo = 'saida' and r.status = 'selado'
    left join public.mototaxistas m on m.id = c.mototaxista_id
    left join public.agencias a on a.id = c.agencia_id
   where c.id = p_corrida_id;
$$;

revoke all on function public.obter_contexto_retorno(uuid) from public, anon;
grant execute on function public.obter_contexto_retorno(uuid) to authenticated;

-- =====================================================================
-- CONFERÊNCIA — não escreve nada, e o erro vermelho é o resultado.
--
-- ESPERADO, com pelo menos uma corrida cuja saída está selada:
--   (a) instalada=t  anon=f  authenticated=t
--   (b) contexto veio, versao=CTXR1, com saida_document_hash de 64 hex
--   (c) a contagem de vales do contexto = a de romaneio_entregas
--   (d) todo vale traz `pagamentos_previstos` e `documentos_esperados`
--   (e) o cliente do contexto vem do SNAPSHOT: se `entregas` divergir,
--       o contexto continua mostrando o que foi assinado
-- =====================================================================
--
-- do $$
-- declare
--   v_rel text := E'\n\n';
--   v_corrida uuid;
--   v_ctx jsonb;
--   v_saida uuid;
--   v_vales_ctx int;
--   v_vales_re  int;
--   v_sem_campo int;
-- begin
--   v_rel := v_rel || format('(a) instalada=%s anon=%s authenticated=%s  (esperado t/f/t)%s',
--     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--              where n.nspname='public' and p.proname='obter_contexto_retorno'),
--     has_function_privilege('anon','public.obter_contexto_retorno(uuid)','execute'),
--     has_function_privilege('authenticated','public.obter_contexto_retorno(uuid)','execute'),
--     E'\n');
--
--   select r.corrida_id, r.id into v_corrida, v_saida
--     from public.romaneios r
--    where r.tipo='saida' and r.status='selado' and r.corrida_id is not null
--    order by r.numero limit 1;
--
--   if v_corrida is null then
--     raise exception '%', v_rel || '(b-e) PULADO — nenhuma saida selada no alcance da RLS';
--   end if;
--
--   v_ctx := public.obter_contexto_retorno(v_corrida);
--   v_rel := v_rel || format('(b) versao=%s  hash=%s chars  numero=%s%s',
--     v_ctx ->> 'versao', length(v_ctx ->> 'saida_document_hash'),
--     v_ctx ->> 'saida_numero', E'\n');
--
--   v_vales_ctx := jsonb_array_length(v_ctx -> 'vales');
--   select count(*) into v_vales_re from public.romaneio_entregas where romaneio_id = v_saida;
--   v_rel := v_rel || format('(c) vales no contexto=%s  em romaneio_entregas=%s  %s%s',
--     v_vales_ctx, v_vales_re,
--     case when v_vales_ctx = v_vales_re then 'ok' else '<-- ERRADO' end, E'\n');
--
--   select count(*) into v_sem_campo
--     from jsonb_array_elements(v_ctx -> 'vales') v
--    where v -> 'pagamentos_previstos' is null or v -> 'documentos_esperados' is null;
--   v_rel := v_rel || format('(d) vales sem previstos/esperados=%s  (esperado 0)%s',
--     v_sem_campo, E'\n');
--
--   v_rel := v_rel || format('(e) cliente no contexto=%s  |  hoje em entregas=%s%s',
--     v_ctx #>> '{vales,0,cliente_nome}',
--     (select e.cliente_nome from public.entregas e
--       where e.id = (v_ctx #>> '{vales,0,entrega_id}')::uuid), E'\n');
--   v_rel := v_rel || '    (se os dois diferirem, o contexto está CERTO: ele mostra o assinado)' || E'\n';
--
--   raise exception '%', v_rel;
-- end $$;
