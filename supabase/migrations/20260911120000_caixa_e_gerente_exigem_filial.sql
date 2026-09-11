-- =====================================================================
-- Caixa e gerente EXIGEM filial — passo 2, 2026-09-11
--
-- docs/escopo-pre-v1-revisado.md, seção 6: "Uma filial vazia impede
-- salvar; a regra também precisa valer na criação/edição no servidor."
--
-- ---------------------------------------------------------------------
-- POR QUE CHECK, E NÃO SÓ A TELA
-- ---------------------------------------------------------------------
-- Sem filial, caixa e gerente não enxergam nada e falham EM SILÊNCIO: a
-- policy compara `loja_id = current_loja_id()`, e com nulo isso nunca
-- casa. A tela já validava; o que faltava era o servidor.
--
-- Um CHECK cobre os DOIS caminhos de escrita de uma vez:
--
--   criação   Edge Function `criar-usuario` → insert em `profiles`.
--             Recusado aqui, a função apaga o login que acabou de criar
--             (ela já fazia isso para qualquer erro de perfil).
--   edição    UPDATE direto do painel, via RLS.
--
-- Não entra em `fn_profiles_protege_campos`: aquele trigger decide QUEM
-- pode mudar a coluna; esta regra é sobre QUE valor é válido, para
-- qualquer um — inclusive `service_role` e o SQL Editor.
--
-- ---------------------------------------------------------------------
-- O QUE NÃO MUDA
-- ---------------------------------------------------------------------
--   * admin: nada é exigido nem apagado. Admins antigos que têm filial
--     (a Matriz, por exemplo) CONTINUAM com ela até alguém salvar o
--     cadastro pelo painel — o formulário novo grava admin com filial
--     nula, inclusive na edição. Nenhuma atualização em massa aqui.
--   * `agencia` e `superadmin`: fora da regra. O escopo da agência é a
--     agência, não uma filial (passo 6), e nenhum dos dois opera balcão.
--   * nenhuma policy, nenhuma permissão, nenhuma função de selo. A guarda
--     do E10.1 em `selar_romaneio_interno` segue intacta.
--
-- CENSO: o de 2026-09-10 (NOTAS, item 98), lido pela aplicação, tinha
-- sete perfis e nenhum caixa ou gerente sem filial — inclusive o inativo.
-- Não foi refeito em 2026-09-11. Quem garante é o pré-voo: se o censo
-- mudou, a migration PARA, e a filial de cada um é escolhida por gente,
-- no painel. Nunca por suposição.
--
-- CHECK VALIDADO, e não `NOT VALID` — mesmo critério da 20260910120000:
-- com o pré-voo passando os dois têm o mesmo efeito hoje, e o validado
-- deixa uma invariante conferível (`convalidated = true`).
-- =====================================================================


-- (1) PRÉ-VOO — parar, nunca preencher --------------------------------
do $$
declare
  v_n integer;
begin
  select count(*) into v_n
    from public.profiles
   where papel in ('caixa', 'gerente')
     and loja_id is null;
  if v_n > 0 then
    raise exception 'Existem % perfil(is) de caixa ou gerente sem filial. Esta migration não escolhe filial por suposição: defina a filial de cada um pelo painel antes de aplicar.', v_n;
  end if;
end $$;


-- (2) O CHECK ---------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_filial_obrigatoria;
alter table public.profiles add constraint profiles_filial_obrigatoria
  check (papel not in ('caixa', 'gerente') or loja_id is not null);


-- =====================================================================
-- CONFERÊNCIAS — rodar depois de aplicar, no SQL Editor
-- =====================================================================
--
-- (a) a constraint existe, com a regra certa, e está validada:
--
-- select conname, pg_get_constraintdef(oid) as regra, convalidated
--   from pg_constraint
--  where conrelid = 'public.profiles'::regclass
--    and conname = 'profiles_filial_obrigatoria';
--
-- esperado: 1 linha, CHECK (... papel <> ALL (ARRAY['caixa', 'gerente']) ...
--           OR loja_id IS NOT NULL), convalidated = true
--
--
-- (b) o banco RECUSA tirar a filial de um caixa/gerente — pelo caminho
--     real, como um admin editando no painel, e SEM GRAVAR NADA.
--
--     O SQL Editor roda sem `auth.uid()`, e aí `fn_profiles_protege_campos`
--     barraria o UPDATE ANTES do CHECK, com outro erro. Por isso o bloco
--     assume a identidade de um admin ativo só dentro desta transação
--     (`set_config(..., true)`), como o PostgREST faz com o JWT.
--
--     Se o CHECK faltar, o UPDATE passa, e o bloco levanta um erro que
--     NÃO é check_violation: ele escapa do handler e desfaz tudo. Nos dois
--     desfechos nenhuma linha muda.
--
-- do $$
-- declare
--   v_admin uuid;
--   v_alvo  uuid;
-- begin
--   select id into v_admin from public.profiles where papel = 'admin' and ativo limit 1;
--   select id into v_alvo  from public.profiles where papel in ('caixa', 'gerente') limit 1;
--   if v_admin is null or v_alvo is null then
--     raise notice 'sem admin ativo ou sem caixa/gerente para exercitar';
--     return;
--   end if;
--
--   perform set_config('request.jwt.claims',
--     json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--
--   begin
--     update public.profiles set loja_id = null where id = v_alvo;
--     raise exception 'FALHOU: caixa/gerente ficou sem filial — o CHECK não está ativo'
--       using errcode = 'P0001';
--   exception when check_violation then
--     raise notice 'ok: recusado pelo CHECK — %', sqlerrm;
--   end;
-- end $$;
--
-- esperado: NOTICE "ok: recusado pelo CHECK — ... profiles_filial_obrigatoria"
--
--
-- (c) o que ficou de fora da regra, para o número não surpreender depois:
--
-- select papel, (loja_id is null) as sem_filial, ativo, count(*)
--   from public.profiles
--  group by 1, 2, 3
--  order by 1, 2, 3;
--
-- esperado: nenhuma linha caixa/gerente com sem_filial = true. Admin pode
--           aparecer dos dois jeitos — o antigo com filial fica como está.
