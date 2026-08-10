-- =====================================================================
-- RLS de pagamentos e assinaturas: escopo por loja, igual entregas
--
-- `entregas` e `corridas` sempre restringiram o caixa à própria loja
-- (gerente/admin veem o tenant inteiro). `pagamentos` e `assinaturas`
-- ficaram só com `tenant_id = current_tenant_id()` desde o schema
-- inicial — ou seja, um caixa da Filial 02 conseguia ler, por query
-- direta, o valor e a forma de pagamento de toda entrega da Matriz,
-- a justificativa de cada divergência (pagamentos.observacao) e os
-- traços de assinatura de qualquer motoboy do tenant.
--
-- Mesma classe do buraco de `eventos` fechado em
-- 20260809230100_eventos_select_restrita.sql: o filtro existia só na
-- UI (as telas nunca pedem dado de outra loja), nunca no banco.
--
-- Nenhuma das duas tabelas tem loja_id próprio, então o escopo vem da
-- entrega/corrida dona. As funções abaixo são SECURITY DEFINER pelo
-- mesmo motivo de current_tenant_id() e amigas: ler entregas/corridas
-- de dentro de uma policy sem disparar recursão de RLS. Elas repetem
-- explicitamente a regra tenant + (gerente ou loja própria), então não
-- ampliam acesso nenhum ao contornar a RLS da tabela lida.
-- =====================================================================

create or replace function public.pode_ver_entrega(p_entrega_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entregas e
    where e.id = p_entrega_id
      and e.tenant_id = public.current_tenant_id()
      and (public.is_gerente() or e.loja_id = public.current_loja_id())
  );
$$;

create or replace function public.pode_ver_corrida(p_corrida_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.corridas c
    where c.id = p_corrida_id
      and c.tenant_id = public.current_tenant_id()
      and (public.is_gerente() or c.loja_id = public.current_loja_id())
  );
$$;

-- --- pagamentos -------------------------------------------------------
-- Continua sem policy de UPDATE (registro gravado não se altera —
-- correção é linha nova 'realizado' + evento). Só o escopo muda.
drop policy pagamentos_select on public.pagamentos;
create policy pagamentos_select on public.pagamentos for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.pode_ver_entrega(entrega_id)
  );

drop policy pagamentos_insert on public.pagamentos;
create policy pagamentos_insert on public.pagamentos for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.pode_ver_entrega(entrega_id)
  );

-- --- assinaturas ------------------------------------------------------
drop policy assinaturas_select on public.assinaturas;
create policy assinaturas_select on public.assinaturas for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.pode_ver_corrida(corrida_id)
  );

drop policy assinaturas_insert on public.assinaturas;
create policy assinaturas_insert on public.assinaturas for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.pode_ver_corrida(corrida_id)
  );
