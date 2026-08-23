-- =====================================================================
-- ETAPA 2C.2 — CONFERÊNCIA DEPOIS DE APLICAR
--
-- Migration: 20260820180000_fechamento_legado_obsoleto.sql
--
-- DOIS BLOCOS, RODE UM DE CADA VEZ. O editor mostra só o último
-- statement.
--
--   BLOCO 1  instalação. Não escreve nada.
--   BLOCO 2  COMPORTAMENTO, e é ele que vale. Escreve e desfaz sozinho,
--            mas QUEIMA UM NÚMERO DE ROMANEIO — leia o aviso.
--
-- **O ERRO VERMELHO É O RESULTADO** nos dois: eles terminam em
-- `raise exception` com o relatório na mensagem, que é o que garante que
-- nada fica pendurado.
-- =====================================================================


-- =====================================================================
-- BLOCO 1 — INSTALAÇÃO, SEM ESCRITA
--
-- ESPERADO: função=t  trigger=t  timing=BEFORE  evento=UPDATE  linha=t
-- =====================================================================

do $$
declare
  v_rel text := E'\n\n';
  v_t   record;
begin
  v_rel := v_rel || format('(a) funcao instalada     %s   (esperado t)%s',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname = 'fn_entrega_protege_desfecho_selado'), E'\n');

  select t.tgname,
         (t.tgtype & 2) <> 0 as antes,
         (t.tgtype & 16) <> 0 as em_update,
         (t.tgtype & 1) <> 0 as por_linha
    into v_t
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where c.relname = 'entregas' and t.tgname = 'trg_entregas_desfecho_selado';

  if v_t.tgname is null then
    v_rel := v_rel || '(b) trigger              NAO EXISTE  <-- ERRADO' || E'\n';
  else
    v_rel := v_rel || format(
      '(b) trigger              antes=%s update=%s por_linha=%s   (esperado t/t/t)%s',
      v_t.antes, v_t.em_update, v_t.por_linha, E'\n');
  end if;

  raise exception '%', v_rel;
end $$;


-- =====================================================================
-- BLOCO 2 — O COMPORTAMENTO, E É ELE QUE FECHA A 2C.2
--
-- Guarda que não se prova contra o defeito que a motivou é decoração.
-- Este bloco monta um retorno selado SINTÉTICO sobre uma corrida aberta
-- de verdade e mede as três coisas que importam:
--
--   (c) ANTES do retorno existir, o fechamento legado PASSA
--       — sem isto, um trigger que bloqueasse tudo passaria no (d)
--         e ninguém notaria até nenhuma corrida mais fechar;
--   (d) DEPOIS do retorno selado + corrida fechada, o mesmo UPDATE
--       é RECUSADO, e com SQLSTATE distinguível;
--   (e) `status_financeiro` continua LIVRE no mesmo vale
--       — prova que o congelamento é estreito e não quebrou
--         `marcarDivergencia` nem a custódia de papel.
--
-- **ANOTE O SQLSTATE QUE (d) DEVOLVER.** É ele que o handler legado da
-- 2C.8 tem que reconhecer pra marcar o item TERMINAL. Não confie no que
-- está escrito na migration: na 2C.1 a previsão era `02000` e o banco
-- devolveu `P0002`.
--
-- **QUEIMA UM NÚMERO DE ROMANEIO.** `romaneios_numero_seq` não volta
-- atrás com rollback: o `raise` do fim desfaz a LINHA, o número fica
-- gasto, e a próxima saída real pula pra depois dele. Isso antecipa a
-- diferença na aritmética `selados + conflitos = maior R- emitido` que o
-- primeiro selo real seguinte ia mostrar de qualquer jeito. A forma
-- robusta da mesma pergunta:
--
--     select count(*) = count(*) filter (where status in ('selado','conflito'))
--       from public.romaneios;
--
-- Se (c) vier PULADO, é porque não há corrida ABERTA com vale e romaneio
-- de saída selado — nesse caso feche a 2C.2 pelo bloco 1 e rode este
-- depois da próxima saída.
-- =====================================================================

do $$
declare
  v_rel     text := E'\n\n';
  v_alvo    record;
  v_fake    uuid := gen_random_uuid();
  v_novo_desfecho   text;
  v_novo_financeiro text;
  v_perfil  uuid;
begin
  -- Uma corrida ABERTA, com vale, cuja saída está selada.
  select c.id as corrida_id, c.tenant_id, c.loja_id,
         e.id as entrega_id, e.status_entrega, e.status_financeiro,
         r.id as saida_id
    into v_alvo
    from public.corridas c
    join public.entregas e on e.corrida_id = c.id
    join public.romaneios r on r.corrida_id = c.id
                           and r.tipo = 'saida' and r.status = 'selado'
   where c.status = 'aberta'
   limit 1;

  if v_alvo.corrida_id is null then
    v_rel := v_rel || '(c-e) PULADO — nenhuma corrida aberta com vale e saida selada' || E'\n';
    raise exception '%', v_rel;
  end if;

  select p.id into v_perfil from public.profiles p where p.ativo limit 1;

  -- VALORES DIFERENTES DOS ATUAIS, e isto não é detalhe: o trigger sai na
  -- PRIMEIRA LINHA quando nenhuma das três colunas do DCRR1 muda. Mandar
  -- o mesmo valor faria (c) e (d) passarem os dois por curto-circuito, e
  -- eu leria "o guard não mordeu" sem ele ter sido exercitado uma vez.
  -- Um instrumento que concorda com o defeito já custou onze rodadas
  -- neste projeto.
  v_novo_desfecho := case when v_alvo.status_entrega = 'entregue'
                          then 'em_rota' else 'entregue' end;
  v_novo_financeiro := case when v_alvo.status_financeiro = 'divergente'
                            then 'na_ordem' else 'divergente' end;

  v_rel := v_rel || format('    alvo: corrida %s, vale %s%s    desfecho %s -> %s, financeiro %s -> %s%s',
                           v_alvo.corrida_id, v_alvo.entrega_id, E'\n',
                           v_alvo.status_entrega, v_novo_desfecho,
                           v_alvo.status_financeiro, v_novo_financeiro, E'\n');

  -- (c) SEM retorno selado, o caminho legado tem que passar
  begin
    update public.entregas
       set status_entrega = v_novo_desfecho
     where id = v_alvo.entrega_id;
    v_rel := v_rel || '(c) antes do retorno     PASSOU   (esperado: passar)' || E'\n';
  exception when others then
    v_rel := v_rel || format('(c) antes do retorno     BLOQUEOU %s | %s  <-- ERRADO%s',
                             SQLSTATE, SQLERRM, E'\n');
  end;

  -- o retorno selado sintético, e a corrida fechando como o selo faria
  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, tipo, romaneio_saida_id, status, modo,
     payload, canonico, document_hash, criado_por, selado_em)
  values
    (v_fake, v_alvo.tenant_id, v_alvo.loja_id, v_alvo.corrida_id, 'retorno',
     v_alvo.saida_id, 'selado', 'online',
     '{"sintetico": true}'::jsonb, 'DCRR1-SINTETICO', repeat('0', 64),
     v_perfil, now());

  update public.corridas set status = 'fechada' where id = v_alvo.corrida_id;

  -- (d) agora o UPDATE tem que ser recusado.
  --
  -- Repare que ele REVERTE pro valor original em vez de repetir o de (c):
  -- (c) já deixou a coluna em `v_novo_desfecho`, então mandá-lo de novo
  -- seria um no-op e o trigger sairia na primeira linha — (d) passaria
  -- por curto-circuito e eu leria "o guard não mordeu". A mudança tem que
  -- ser real nas DUAS tentativas, não só na primeira.
  begin
    update public.entregas
       set status_entrega = v_alvo.status_entrega
     where id = v_alvo.entrega_id;
    v_rel := v_rel || '(d) depois do retorno    PASSOU  <-- ERRADO, o guard nao mordeu' || E'\n';
  exception when others then
    v_rel := v_rel || format('(d) depois do retorno    RECUSOU  SQLSTATE=%s%s      %s%s',
                             SQLSTATE, E'\n', SQLERRM, E'\n');
  end;

  -- (e) e o congelamento tem que ser ESTREITO
  begin
    update public.entregas
       set status_financeiro = v_novo_financeiro
     where id = v_alvo.entrega_id;
    v_rel := v_rel || '(e) status_financeiro    LIVRE    (esperado: passar)' || E'\n';
  exception when others then
    v_rel := v_rel || format('(e) status_financeiro    BLOQUEOU %s  <-- ERRADO, congelou demais%s',
                             SQLSTATE, E'\n');
  end;

  v_rel := v_rel || E'\n    (tudo acima foi desfeito por este raise; o numero de romaneio, nao)\n';
  raise exception '%', v_rel;
end $$;
