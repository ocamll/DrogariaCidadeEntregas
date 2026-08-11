-- =====================================================================
-- Gestão de usuários pelo app — parte do banco
--
-- Criar usuário continua exigindo a `service_role` (Edge Function
-- `criar-usuario`), porque só ela fala com o Auth. Mas EDITAR quem já
-- existe (nome, papel, loja, ativo/inativo) não precisa dela: é UPDATE
-- em `profiles`, e isso a RLS resolve — desde que resolva direito.
--
-- ARMADILHA QUE ESTA MIGRATION FECHA
--
-- `marcarNotificacoesPagamentoLidas` faz o próprio usuário dar UPDATE no
-- seu profile (coluna notificacoes_pagamento_lidas_em). Ou seja: existe
-- um caminho legítimo de "usuário atualiza a própria linha".
--
-- Se eu abrisse esse caminho com uma policy simples de
-- `id = auth.uid()`, qualquer caixa poderia mandar
-- `update profiles set papel = 'admin' where id = <o próprio id>` direto
-- na API e virar admin. Escalação de privilégio criada por mim, não
-- pré-existente. RLS não sabe restringir por COLUNA, então a policy
-- sozinha não resolve.
--
-- Solução: a policy libera a linha, e um trigger barra as colunas
-- sensíveis pra quem não é admin. Quem manda no papel/loja/nome/acesso
-- é só admin, verificado no banco e não na tela.
-- =====================================================================

-- 'admin' é mais restrito que is_gerente() (que aceita gerente também):
-- criar e editar acesso é a ação mais sensível do sistema, e é o único
-- lugar do app que contorna a RLS.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select public.current_papel() = 'admin';
$$;

-- E-mail é snapshot do que foi usado no Auth, gravado na criação. Serve
-- só pra tela poder mostrar quem é quem (auth.users não é legível pelo
-- cliente). Não há edição de e-mail no app, então não desincroniza.
-- Perfis criados antes desta migration ficam com null e aparecem como
-- "—" — dá pra preencher à mão depois, se incomodar.
alter table public.profiles add column if not exists email text;

-- --- policies de UPDATE -----------------------------------------------
drop policy if exists profiles_update_admin on public.profiles;

-- admin mexe em qualquer perfil do tenant
create policy profiles_update_admin on public.profiles for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id());

-- qualquer um mexe na PRÓPRIA linha — mas o trigger abaixo decide o que
-- de fato pode mudar aí (na prática, só a marcação de notificação lida)
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- --- trigger que protege as colunas sensíveis -------------------------
create or replace function public.fn_profiles_protege_campos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.papel     is distinct from old.papel
  or new.loja_id   is distinct from old.loja_id
  or new.tenant_id is distinct from old.tenant_id
  or new.ativo     is distinct from old.ativo
  or new.nome      is distinct from old.nome
  or new.email     is distinct from old.email
  then
    raise exception
      'Só administrador altera nome, papel, loja, e-mail ou acesso de um usuário.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger trg_profiles_protege_campos
  before update on public.profiles
  for each row execute function public.fn_profiles_protege_campos();
