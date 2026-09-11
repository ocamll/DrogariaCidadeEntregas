-- =====================================================================
-- O nome da filial CONGELADO no snapshot dos romaneios — passo 3, 2026-09-11
--
-- O DEFEITO, medido: o nome da filial nos documentos vinha de join vivo
-- (`lojas(nome)` em src/data/romaneios.ts). Renomear uma filial mudava o
-- cabeçalho de todo PDF histórico e mandava um reenvio ao Drive para outra
-- pasta. É a regra 7 noutra coluna: o documento diz o que era verdade
-- quando foi selado.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA
-- ---------------------------------------------------------------------
--   romaneio_payload          + 'loja_nome', lido de `lojas` no selo
--   romaneio_retorno_payload  + 'loja_nome', da filial da SAÍDA — é o
--                               loja_id que o selo do retorno grava
--
-- Assinaturas idênticas: quem chama (selar_romaneio_interno,
-- registrar_conflito_romaneio, preparar_romaneio e
-- selar_romaneio_retorno_interno) NÃO é reaberto.
--
-- ---------------------------------------------------------------------
-- O QUE NÃO MUDA, e por que é seguro
-- ---------------------------------------------------------------------
--   * NENHUM BYTE DE HASH. O nome não entra no canônico — `romaneio_canonico`
--     e `romaneio_retorno_canonico` não são tocados, e o `document_hash`
--     continua cobrindo só o loja_id. O verificador confere
--     `digest(canonico)` sobre os bytes gravados e não lê o payload.
--   * NENHUM DOCUMENTO EXISTENTE. `create or replace` troca a função, não
--     reescreve `romaneios.payload`. Os já selados ficam sem a chave, e o
--     cliente cai no nome atual só para eles — são dados de teste, que o
--     corte pré-V1 apaga. Preencher agora seria INVENTAR: gravar o nome de
--     hoje como se fosse o do instante do selo.
--   * nenhum leitor quebra: no banco e no cliente o payload só é lido por
--     `-> 'vales'`; ninguém compara o payload inteiro.
--
-- UM LIMITE, declarado: na saída OFFLINE o selo acontece na sincronização,
-- então o nome congelado é o do instante em que o servidor sela, e não o
-- da retirada no balcão. Só diverge se a filial for renomeada nesse meio
-- tempo — e renomear filial é SQL manual e raro.
--
-- Gerada por scripts/patch-payload-loja-nome.mts, que extrai as definições
-- vigentes e PROVA que só a chave nova mudou. Não edite à mão.
-- =====================================================================


-- (1) SAÍDA ------------------------------------------------------------
create or replace function public.romaneio_payload(
  p_loja_id uuid, p_agencia_id uuid, p_motoboy_id uuid, p_caixa_id uuid,
  p_entrega_ids uuid[]
)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'versao', 'DCR1',
    'loja_id', p_loja_id,
    'loja_nome', (select l.nome from public.lojas l where l.id = p_loja_id),
    'agencia_id', p_agencia_id,
    'motoboy_id', p_motoboy_id,
    'caixa_id', p_caixa_id,
    'vales', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entrega_id', e.id,
               'numero_vale', e.numero_vale,
               'tipo', e.tipo,
               'cliente_nome', e.cliente_nome,
               'cliente_endereco', e.cliente_endereco,
               'quantidade_vales', e.quantidade_vales,
               'valor_compra_cents', e.valor_compra_cents,
               'valor_entrega_cents', e.valor_entrega_cents,
               'entrega_paga_cliente_cents', e.entrega_paga_cliente_cents,
               'loja_origem_id', e.loja_origem_id,
               'convenio_id', e.convenio_id,
               'pagamentos_previstos', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'pagamento_id', pg.id, 'forma', pg.forma,
                          'valor_cents', pg.valor_cents, 'troco_cents', pg.troco_cents
                        ) order by pg.id::text collate "C"), '[]'::jsonb)
                   from public.pagamentos pg
                  where pg.entrega_id = e.id and pg.momento = 'previsto'
               )
             ) order by e.id::text collate "C")
        from public.entregas e
       where e.id = any(p_entrega_ids)
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.romaneio_payload(uuid, uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;


-- (2) RETORNO ----------------------------------------------------------
create or replace function public.romaneio_retorno_payload(
  p_saida_id uuid, p_retorno jsonb
)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'versao', 'DCRR1',
    'saida_romaneio_id', p_saida_id,
    'loja_nome', (select l.nome
                    from public.romaneios s
                    join public.lojas l on l.id = s.loja_id
                   where s.id = p_saida_id),
    'vales', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entrega_id', e.id,
               'numero_vale', e.numero_vale,
               'tipo', e.tipo,
               'cliente_nome', e.cliente_nome,
               'desfecho', v.value ->> 'desfecho',
               -- NORMALIZADO igual ao canônico: `entregue` não tem motivo
               -- nem detalhe por definição. Sem isto o snapshot poderia
               -- mostrar um motivo que o documento assinado não afirma —
               -- e o PDF do retorno sai do snapshot, como o da saída.
               'motivo', case when (v.value ->> 'desfecho') = 'entregue'
                              then null else v.value ->> 'motivo' end,
               'detalhe', case when (v.value ->> 'desfecho') = 'entregue'
                               then null else v.value ->> 'detalhe' end,
               'pagamentos_previstos', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'pagamento_id', pg.id, 'forma', pg.forma,
                          'valor_cents', pg.valor_cents, 'troco_cents', pg.troco_cents
                        ) order by pg.id::text collate "C"), '[]'::jsonb)
                   from public.pagamentos pg
                  where pg.entrega_id = e.id and pg.momento = 'previsto'
               ),
               'pagamentos_realizados',
                 coalesce(v.value -> 'pagamentos_realizados', '[]'::jsonb)
             ) order by e.id::text collate "C")
        from jsonb_array_elements(p_retorno) as v(value)
        join public.entregas e on e.id = (v.value ->> 'entrega_id')::uuid
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.romaneio_retorno_payload(uuid, jsonb)
  from public, anon, authenticated;

-- =====================================================================
-- CONFERÊNCIAS — rodar depois de aplicar, UMA POR VEZ no SQL Editor
-- =====================================================================
--
-- (a) as duas funções carregam a chave:
--
-- select p.proname, position('loja_nome' in p.prosrc) > 0 as tem_loja_nome
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('romaneio_payload', 'romaneio_retorno_payload')
--  order by 1;
--
-- esperado: 2 linhas, tem_loja_nome = true
--
--
-- (b) a saída congela o nome certo — sem gravar nada:
--
-- select l.nome as filial,
--        public.romaneio_payload(l.id, null, null, null, array[]::uuid[]) ->> 'loja_nome' as no_snapshot
--   from public.lojas l
--  order by l.nome;
--
-- esperado: as duas colunas iguais em todas as linhas
--
--
-- (c) o retorno pega a filial da saída — sem gravar nada:
--
-- select r.numero, l.nome as filial,
--        public.romaneio_retorno_payload(r.id, '[]'::jsonb) ->> 'loja_nome' as no_snapshot
--   from public.romaneios r
--   join public.lojas l on l.id = r.loja_id
--  where r.tipo = 'saida' and r.status = 'selado'
--  order by r.numero desc
--  limit 5;
--
-- esperado: as duas colunas iguais
--
--
-- (d) nenhum documento existente foi reescrito:
--
-- select tipo, status, count(*) as documentos,
--        count(*) filter (where payload ? 'loja_nome') as com_nome
--   from public.romaneios
--  group by 1, 2
--  order by 1, 2;
--
-- esperado: com_nome = 0 em todas as linhas, até a próxima saída
--
--
-- (e) o verificador não se moveu:
--
-- select * from public.verificar_integridade_resumo();
--
-- esperado: o mesmo placar da última medição (20 · 20 · 0 em 2026-09-10),
--           ou maior só pelos documentos criados desde então, sem divergência
--
--
-- (f) DEPOIS da próxima saída (e do próximo retorno), o nome está gravado:
--
-- select numero, tipo, payload ->> 'loja_nome' as filial_no_documento
--   from public.romaneios
--  where payload ? 'loja_nome'
--  order by recebido_em_servidor desc
--  limit 5;
