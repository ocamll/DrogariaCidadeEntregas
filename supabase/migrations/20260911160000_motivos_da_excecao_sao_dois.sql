-- =====================================================================
-- Os motivos da exceção são DOIS — decidido em 2026-09-11
--
-- A 4B.2a nasceu com três (`cartao_perdido`, `pin_esquecido`, `ambos`).
-- O usuário desfez o terceiro no mesmo dia, e a razão é do processo, não
-- do código:
--
--   cartão perdido   →  credencial NOVA, do zero (emitir revoga a
--                       anterior, e o PIN é criado de novo no primeiro
--                       uso do cartão novo)
--   PIN esquecido    →  só redefinir o PIN; o cartão continua o mesmo
--
-- "Os dois ao mesmo tempo" não é um terceiro caso: é o primeiro. Quem
-- perdeu o cartão vai receber outro, e o PIN daquele cartão ainda nem
-- existe — pedir "redefinir o PIN" ali não significaria nada. Um valor
-- que sempre desemboca no mesmo procedimento não é uma classificação, é
-- um sinônimo caro: mais um caminho pra testar, mais uma coluna de
-- relatório pra somar errado.
--
-- Nada precisa ser convertido: nenhuma linha usa `ambos`, porque ninguém
-- escreve evidência versão 2 nem autorização excepcional ainda (isso é a
-- 4B.2b em diante). O pré-voo confere isso em vez de supor.
--
-- A FÓRMULA NÃO MUDA. `evidencia_texto_v2` serializa o motivo que
-- recebe — ela não conhece o domínio, e é o CHECK que o restringe. Por
-- isso os vetores congelados da 4B.2a continuam válidos byte a byte, e
-- esta migration não toca em hash nenhum.
-- =====================================================================


do $$
declare
  v_ambos int;
begin
  select count(*) into v_ambos
    from public.assinaturas where motivo_excecao = 'ambos';
  if v_ambos > 0 then
    raise exception '% assinatura(s) com motivo ambos — decidir a conversão antes.', v_ambos;
  end if;

  select count(*) into v_ambos
    from public.motoboy_autorizacoes where motivo_excecao = 'ambos';
  if v_ambos > 0 then
    raise exception '% autorização(ões) com motivo ambos — decidir a conversão antes.', v_ambos;
  end if;

  raise notice 'Pré-voo OK: nenhuma linha usa o motivo ambos.';
end $$;


-- O CHECK nasceu inline (`add column … check (…)`), então o nome é
-- gerado pelo Postgres. Descobrir e derrubar pelo nome real é o mesmo
-- método que a 20260819120000 usou pra ampliar `tipo_signatario` — supor
-- o nome é o tipo de coisa que falha só no banco de outra pessoa.
do $$
declare
  r record;
begin
  for r in
    select c.relname as tabela, con.conname as nome
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
     where c.relname in ('assinaturas', 'motoboy_autorizacoes')
       and c.relnamespace = 'public'::regnamespace
       and con.contype = 'c'
       -- Só os que NOMEIAM `ambos`. O CHECK de coerência da versão não
       -- cita motivo nenhum, então ele não é tocado aqui.
       and pg_get_constraintdef(con.oid) like '%ambos%'
  loop
    execute format('alter table public.%I drop constraint %I', r.tabela, r.nome);
    raise notice 'CHECK antigo removido: %.%', r.tabela, r.nome;
  end loop;
end $$;

alter table public.assinaturas
  add constraint assinaturas_motivo_excecao_check
  check (motivo_excecao in ('cartao_perdido', 'pin_esquecido'));

alter table public.motoboy_autorizacoes
  add constraint motoboy_autorizacoes_motivo_excecao_check
  check (motivo_excecao in ('cartao_perdido', 'pin_esquecido'));


-- =====================================================================
-- CONFERÊNCIAS
--
-- (a) os dois CHECKs, com dois valores cada
--
--   select conrelid::regclass as tabela, conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conname in ('assinaturas_motivo_excecao_check',
--                      'motoboy_autorizacoes_motivo_excecao_check')
--    order by 1;
--   -- esperado: os dois com (cartao_perdido, pin_esquecido), sem `ambos`
--
--   select count(*) from pg_constraint con
--     join pg_class c on c.oid = con.conrelid
--    where c.relname in ('assinaturas','motoboy_autorizacoes')
--      and pg_get_constraintdef(con.oid) like '%ambos%';
--   -- esperado: 0 — nenhum CHECK antigo sobrou
--
--
-- (b) `ambos` é recusado
--
--   do $conf$
--   declare v_id uuid;
--   begin
--     select id into v_id from public.assinaturas limit 1;
--     begin
--       update public.assinaturas set motivo_excecao = 'ambos' where id = v_id;
--       raise exception 'FALHOU: aceitou o motivo ambos.';
--     exception when check_violation then raise notice 'OK: ambos recusado.';
--     end;
--   end $conf$;
--   -- esperado: "OK". (O outro CHECK, o de coerência da versão, também
--   -- recusaria motivo numa linha v1 — qualquer um dos dois que pegue,
--   -- pega antes de gravar.)
--
--
-- (c) a fórmula continua a mesma — os vetores da 4B.2a valem byte a byte
--
--   select public.evidencia_hash_v2(
--     'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
--     'motoboy', '00000000-0000-4000-8000-000000000002', null,
--     '00000000-0000-4000-8000-000000000003',
--     '00000000-0000-4000-8000-000000000004', 'cartao_perdido',
--     '2026-09-11 18:42:07.123456+00', 'gerente_card_pin_server_verified');
--   -- esperado: ab142fce3d477ef649a28a3497f524bf55d9bb33f0f1515bf618c7d73c91d660
--
--
-- (d) e nada de documento se moveu
--
--   select * from public.verificar_integridade_resumo();
--   -- esperado: 22 · 22 · 0, como na 4B.2a
-- =====================================================================
