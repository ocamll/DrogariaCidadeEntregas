-- =====================================================================
-- ETAPA 2C.1 — CONFERÊNCIA DEPOIS DE APLICAR
--
-- Migration: 20260820170000_selar_romaneio_retorno_sincronizado.sql
--
-- DOIS BLOCOS, E RODE UM DE CADA VEZ. O editor mostra só o resultado do
-- ÚLTIMO statement, então colar os dois juntos faria o primeiro sumir.
--
--   BLOCO 1  não escreve nada. É o que fecha a 2C.1.
--   BLOCO 2  OPCIONAL, escreve e desfaz — mas QUEIMA número de romaneio.
--            Leia o aviso antes de rodar.
--
-- **O ERRO VERMELHO É O RESULTADO.** Os dois blocos terminam em
-- `raise exception` com o relatório na mensagem: é assim que ele aparece
-- sem depender de ninguém lembrar de desfazer nada.
--
-- O CAMINHO FELIZ NÃO ESTÁ AQUI, e não tem como estar: selar de verdade
-- exige cartão físico e PIN, e isso é E2E de tela (2D). O que o bloco 1
-- prova é o perímetro — quem alcança a função, e as três recusas que
-- acontecem antes de qualquer escrita.
-- =====================================================================


-- =====================================================================
-- BLOCO 1 — SEM NENHUMA ESCRITA
--
-- ESPERADO (medido em 2026-08-20, e passou):
--   (a) instalada=t  anon=f  authenticated=f  service_role=t
--   (b) ja_existia=true  ok=true
--   (c) 42501 | Responsável inexistente ou inativo.
--   (d) P0002 | Romaneio de saída ... não existe.
--
-- **`P0002`, NÃO `02000`.** Eu tinha escrito `02000` aqui e o banco
-- devolveu `P0002` — a expectativa é que estava errada, não o código.
-- `no_data_found` é nome de condição do PL/pgSQL, que o mapeia para
-- `P0002`; `02000` é o `no_data` do padrão SQL, outra coisa. A 2B levanta
-- a mesma exceção com o mesmo `errcode`, então os dois lados concordam.
--
-- Isso não é cosmético: a 2C.6 vai classificar erro por SQLSTATE pra
-- decidir o que é TERMINAL na fila. Handler escrito esperando `02000`
-- não casaria nunca, e o item ficaria retentando uma recusa definitiva.
-- Os três que importam até aqui:
--
--     P0001  raise_exception          o relatório desta conferência
--     P0002  no_data_found            saída inexistente
--     42501  insufficient_privilege   responsável inválido, autorização inválida
--
-- A LINHA (b) É A MAIS INTERESSANTE. Ela passa um TOKEN LIXO junto de um
-- romaneio que já existe. Se o guard de reenvio estivesse DEPOIS da
-- autenticação — como está na porta da saída —, ela morreria na
-- credencial. Vindo `ja_existia`, está provado que ele vem antes, que é
-- a razão de ele ter subido pra porta: sem isso, reenviar um retorno já
-- selado com a credencial bloqueada no meio tempo violaria a chave
-- primária e travaria o item da fila em backoff pra sempre.
-- =====================================================================

do $$
declare
  v_assinatura constant text :=
    'public.selar_romaneio_retorno_sincronizado(uuid,uuid,uuid,text,uuid,jsonb,text,text,text,jsonb,jsonb,timestamptz,inet,jsonb)';
  v_rel   text := E'\n\n';
  v_um    uuid;
  v_perfil uuid;
  v_res   jsonb;
  v_zero  constant uuid := '00000000-0000-0000-0000-000000000000';
  v_hash  constant text := repeat('0', 64);
begin
  -- (a) existe, e quem alcança
  v_rel := v_rel || format(
    '(a) instalada=%s  anon=%s  authenticated=%s  service_role=%s   (esperado t/f/f/t)%s',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname = 'selar_romaneio_retorno_sincronizado'),
    has_function_privilege('anon',          v_assinatura, 'execute'),
    has_function_privilege('authenticated', v_assinatura, 'execute'),
    has_function_privilege('service_role',  v_assinatura, 'execute'),
    E'\n');

  -- (b) o guard de reenvio vem ANTES da credencial
  select r.id into v_um
    from public.romaneios r where r.status = 'selado' order by r.numero limit 1;

  if v_um is null then
    v_rel := v_rel || '(b) reenvio          PULADO — nenhum romaneio selado no alcance' || E'\n';
  else
    v_res := public.selar_romaneio_retorno_sincronizado(
      v_zero, v_um, v_zero, v_hash, v_zero, '[]'::jsonb, v_hash,
      'TOKEN-QUE-NAO-EXISTE', '000000',
      '[]'::jsonb, '[]'::jsonb, now(), null, null);
    v_rel := v_rel || format(
      '(b) reenvio          ja_existia=%s  ok=%s   (esperado true/true)%s',
      coalesce(v_res ->> 'ja_existia', '(nulo)'),
      coalesce(v_res ->> 'ok', '(nulo)'), E'\n');
  end if;

  -- (c) responsável inexistente → EXCEÇÃO (não há prova a preservar)
  begin
    perform public.selar_romaneio_retorno_sincronizado(
      v_zero, gen_random_uuid(), v_zero, v_hash, v_zero, '[]'::jsonb, v_hash,
      'x', '000000', '[]'::jsonb, '[]'::jsonb, now(), null, null);
    v_rel := v_rel || '(c) responsavel      NAO RECUSOU  <-- ERRADO' || E'\n';
  exception when others then
    v_rel := v_rel || format('(c) responsavel      %s | %s%s', SQLSTATE, SQLERRM, E'\n');
  end;

  -- (d) saída inexistente, agora com responsável REAL → EXCEÇÃO
  select p.id into v_perfil
    from public.profiles p where p.ativo order by p.criado_em limit 1;

  begin
    perform public.selar_romaneio_retorno_sincronizado(
      v_perfil, gen_random_uuid(), gen_random_uuid(), v_hash, v_zero, '[]'::jsonb,
      v_hash, 'x', '000000', '[]'::jsonb, '[]'::jsonb, now(), null, null);
    v_rel := v_rel || '(d) saida            NAO RECUSOU  <-- ERRADO' || E'\n';
  exception when others then
    v_rel := v_rel || format('(d) saida            %s | %s%s', SQLSTATE, SQLERRM, E'\n');
  end;

  raise exception '%', v_rel;
end $$;


-- =====================================================================
-- BLOCO 2 — OPCIONAL, E ELE QUEIMA NÚMERO DE ROMANEIO
--
-- Exercita os dois caminhos de CONFLITO: competência sobre a loja e
-- autenticação. Os dois INSEREM em `romaneios` — é isso que preserva as
-- duas assinaturas quando o servidor recusa, e é o que este bloco existe
-- pra provar.
--
-- **`romaneios_numero_seq` NÃO VOLTA ATRÁS COM ROLLBACK.** O `raise` do
-- fim desfaz as LINHAS; os números gastos ficam gastos, e o próximo
-- romaneio real pula pra depois deles.
--
-- Consequência no GATE A, e é melhor decidir sabendo: a checagem
-- `selados + conflitos = maior R- emitido` só fecha enquanto nada tiver
-- sido selado DEPOIS de números queimados. Rodar este bloco antecipa a
-- diferença que o primeiro selo real seguinte ia mostrar de qualquer
-- jeito. A forma robusta da mesma pergunta, que não depende de sequência
-- contígua:
--
--     select count(*) = count(*) filter (where status in ('selado','conflito'))
--       from public.romaneios;
--
-- ESPERADO, havendo uma saída selada de uma filial que não seja a do
-- primeiro perfil ativo:
--   (e) motivo = responsavel_sem_competencia_na_loja
--   (f) motivo = autenticacao_falhou, detalhe = credencial_invalida
--
-- Se (e) vier PULADO, é porque todo perfil ativo é admin ou é da mesma
-- filial de todas as saídas — aí aquele ramo não é exercitável com o
-- dado que existe, e isso é informação, não falha.
-- =====================================================================

-- do $$
-- declare
--   v_rel    text := E'\n\n';
--   v_res    jsonb;
--   v_saida  record;
--   v_caixa  uuid;
--   v_admin  uuid;
--   v_hash   constant text := repeat('0', 64);
-- begin
--   select r.id, r.loja_id into v_saida
--     from public.romaneios r
--    where r.status = 'selado' and r.tipo = 'saida'
--    order by r.numero limit 1;
--
--   -- (e) alguém NÃO-admin de OUTRA filial que a da saída
--   select p.id into v_caixa
--     from public.profiles p
--    where p.ativo and p.papel <> 'admin'
--      and p.loja_id is distinct from v_saida.loja_id
--    limit 1;
--
--   if v_caixa is null then
--     v_rel := v_rel || '(e) competencia      PULADO — nao ha perfil nao-admin de outra filial' || E'\n';
--   else
--     v_res := public.selar_romaneio_retorno_sincronizado(
--       v_caixa, gen_random_uuid(), v_saida.id, v_hash, gen_random_uuid(),
--       '[]'::jsonb, v_hash, 'x', '000000',
--       '[{"t":"caixa"}]'::jsonb, '[{"t":"motoboy"}]'::jsonb, now(), null, null);
--     v_rel := v_rel || format('(e) competencia      %s%s',
--       coalesce(v_res #>> '{conflitos,0,motivo}', v_res::text), E'\n');
--   end if;
--
--   -- (f) autenticação falha, com alguém que TEM competência
--   select p.id into v_admin
--     from public.profiles p
--    where p.ativo and (p.papel = 'admin' or p.loja_id = v_saida.loja_id)
--    limit 1;
--
--   v_res := public.selar_romaneio_retorno_sincronizado(
--     v_admin, gen_random_uuid(), v_saida.id, v_hash, gen_random_uuid(),
--     '[]'::jsonb, v_hash, 'TOKEN-QUE-NAO-EXISTE', '000000',
--     '[{"t":"caixa"}]'::jsonb, '[{"t":"motoboy"}]'::jsonb, now(), null, null);
--   v_rel := v_rel || format('(f) autenticacao     %s / %s%s',
--     coalesce(v_res #>> '{conflitos,0,motivo}', v_res::text),
--     coalesce(v_res #>> '{conflitos,0,detalhe}', '-'), E'\n');
--
--   -- E a prova de que os TRAÇOS ficaram guardados nos dois casos —
--   -- que é o ponto inteiro de recusa ser conflito e não exceção.
--   -- As chaves são `motivos`, `responsavel_strokes` e `motoboy_strokes`
--   -- (ver `registrar_conflito_retorno`), e o relógio é
--   -- `recebido_em_servidor` — `romaneios` não tem `criado_em`.
--   v_rel := v_rel || format('    tracos preservados em %s conflito(s) criados agora%s',
--     (select count(*) from public.romaneios
--       where tipo = 'retorno' and status = 'conflito'
--         and conflito -> 'responsavel_strokes' is not null
--         and conflito -> 'motoboy_strokes' is not null
--         and recebido_em_servidor > now() - interval '1 minute'), E'\n');
--
--   raise exception '%', v_rel;
-- end $$;
