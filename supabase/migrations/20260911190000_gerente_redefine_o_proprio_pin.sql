-- =====================================================================
-- O TITULAR REDEFINE O PRÓPRIO PIN — decidido em 2026-09-11
--
-- Achado pelo usuário testando o cartão do gerente, e é uma falha de
-- desenho, não de código:
--
--   *"O motoboy esquece o PIN dele, o Gestor também, e fica tudo
--   travado, tendo que esperar contato do admin."*
--
-- A exceção do gerente existe pra DESTRAVAR o balcão quando o motoboy
-- não tem o que apresentar. Se o destravamento depender de o admin
-- atender o telefone, ele deixa de existir na hora em que é necessário —
-- 20h de uma sexta, com o motoboy esperando.
--
--
-- POR QUE ISSO NÃO AFROUXA NADA
--
-- Redefinir apaga o hash; quem cria o novo PIN é quem está com o CARTÃO
-- na mão (`definir_pin` exige o token completo e só funciona com
-- `pin_hash` nulo). Então continuam sendo necessárias as duas coisas:
--
--   a SESSÃO      prova quem é — o gerente tem conta, username e senha
--   o CARTÃO      prova posse — sem ele, o PIN novo não se cria
--
-- Quem tivesse só a sessão zeraria um PIN e não conseguiria usar o
-- cartão; quem tivesse só o cartão não conseguiria zerar. E quem tivesse
-- os dois já teria tudo de qualquer forma. O elo fraco continua sendo o
-- cartão perdido, e a resposta pra ele continua sendo revogar.
--
-- O MOTOBOY NÃO ENTRA NISSO, e não é esquecimento: ele não tem conta no
-- sistema, então não há sessão que prove quem ele é. O PIN dele continua
-- sendo redefinido pelo admin — e é justamente por isso que a exceção do
-- gerente existe, pra o esquecimento dele não parar a saída.
--
-- `redefinir_pin(p_credencial_id)`, do admin, FICA como está: ela alcança
-- qualquer credencial do tenant e continua exigindo `is_admin()`. Esta
-- aqui alcança UMA credencial: a de quem chamou.
-- =====================================================================

create or replace function public.redefinir_meu_pin()
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_credencial_id uuid;
begin
  -- Sem sessão não há titular. E isto é ONLINE por construção, como o
  -- `definir_pin`: quem esquece o PIN precisa de internet pra resolver,
  -- e a tela diz isso antes de alguém contar com o contrário.
  if v_uid is null or v_tenant is null then
    raise exception 'Sessão inválida — redefinir o próprio PIN exige estar online.'
      using errcode = 'insufficient_privilege';
  end if;

  -- `profile_id = v_uid` é a cláusula inteira da autorização: não há
  -- parâmetro nenhum nesta função, então não existe como pedir a
  -- credencial de outra pessoa. É de propósito que ela não receba id.
  update public.motoboy_credenciais c
     set pin_hash = null, tentativas_pin = 0, bloqueado_ate = null
   where c.profile_id = v_uid
     and c.tenant_id = v_tenant
     and c.ativo
  returning c.id into v_credencial_id;

  if v_credencial_id is null then
    raise exception 'Você não tem cartão ativo. Peça ao administrador para emitir um.'
      using errcode = 'no_data_found';
  end if;

  -- Mesma auditoria do reset do admin, com quem fez dentro do payload: o
  -- evento não pode parecer ato administrativo quando foi o titular.
  perform public.log_credencial(v_tenant, v_credencial_id, 'credencial_pin_redefinido',
    jsonb_build_object('por', 'titular'));
end;
$$;

revoke all on function public.redefinir_meu_pin() from public, anon;
grant execute on function public.redefinir_meu_pin() to authenticated;


-- =====================================================================
-- CONFERÊNCIAS
--
-- (a) a função existe, é SECURITY DEFINER e não recebe parâmetro
--
--   select p.proname, p.prosecdef, pg_get_function_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('redefinir_pin', 'redefinir_meu_pin')
--    order by p.proname;
--   -- esperado: redefinir_meu_pin com args vazio e prosecdef = true;
--   -- redefinir_pin continua com p_credencial_id
--
--
-- (b) sem sessão, ela recusa — e recusa por sessão, não por cartão
--
--   select public.redefinir_meu_pin();
--   -- esperado: ERRO "Sessão inválida — redefinir o próprio PIN exige
--   -- estar online." (no SQL Editor não há auth.uid())
--
--
-- (c) com a sessão de um GERENTE que tem cartão, ela zera só o dele
--
--   select set_config('request.jwt.claims',
--     json_build_object('sub', (select c.profile_id from public.motoboy_credenciais c
--                                where c.profile_id is not null and c.ativo limit 1))::text,
--     true);
--
--   select public.redefinir_meu_pin();
--
--   select c.public_id, c.tem_pin, p.nome
--     from public.motoboy_credenciais c
--     join public.profiles p on p.id = c.profile_id
--    where c.ativo;
--   -- esperado: tem_pin = false SÓ na linha daquele gerente. O cartão
--   -- volta a aceitar um PIN novo, e quem o cria é quem tem o cartão.
--
--   ATENÇÃO: isto ZERA o PIN de verdade. Rode só se estiver disposto a
--   criar o PIN de novo pela tela — que é, aliás, o teste completo.
--
--
-- (d) a auditoria diz que foi o titular, e não o admin
--
--   select tipo, payload->>'por' as por, payload->>'titular_nome' as titular
--     from public.eventos
--    where tipo = 'credencial_pin_redefinido'
--    order by ocorrido_em desc limit 3;
--   -- esperado: o mais recente com por = titular; os antigos com por
--   -- nulo, porque o reset do admin não carimba nada (e não vai passar a
--   -- carimbar retroativamente)
-- =====================================================================
