-- =====================================================================
-- Gerente passa a enxergar só a própria filial
--
-- Até aqui quem liberava ver dado de outra loja era `is_gerente()`, que
-- apesar do nome significa "gerente OU admin". Na prática gerente e admin
-- enxergavam exatamente a mesma coisa: um gerente da Filial 02 lia os
-- vales, os pagamentos, as assinaturas e os eventos da Matriz, e a aba
-- "Hoje" (que não tem filtro de filial e sai direto da RLS) mostrava pra
-- ele o movimento das outras lojas.
--
-- A regra da farmácia é outra: gerente e caixa veem a própria filial,
-- admin vê todas. Quem passa a liberar o cross-filial é `is_admin()`.
--
-- `is_gerente()` NÃO muda e NÃO some. Ela continua significando
-- "capacidade de gestão" — hoje só a trigger fn_entrega_protege_conferencia
-- a usa, pra deixar gerente/admin marcarem vale como conferido. Isso é
-- outra pergunta: "pode conferir" não é "enxerga outra filial". O gerente
-- segue conferindo, agora só o que é da filial dele, porque o UPDATE
-- passa pela policy abaixo.
--
-- Escrita também fecha junto (insert/update), não só leitura: sem isso o
-- gerente continuaria podendo criar ou alterar vale de outra loja às
-- cegas — enxergar nada e ainda assim escrever é pior que o bug original.
-- =====================================================================

-- --- helpers de escopo -------------------------------------------------
-- pagamentos e assinaturas não têm loja_id próprio: o escopo delas vem da
-- entrega/corrida dona, por estas duas funções. Trocando aqui, as quatro
-- policies daquelas tabelas acompanham sem precisar ser reescritas.
create or replace function public.pode_ver_entrega(p_entrega_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entregas e
    where e.id = p_entrega_id
      and e.tenant_id = public.current_tenant_id()
      and (public.is_admin() or e.loja_id = public.current_loja_id())
  );
$$;

create or replace function public.pode_ver_corrida(p_corrida_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.corridas c
    where c.id = p_corrida_id
      and c.tenant_id = public.current_tenant_id()
      and (public.is_admin() or c.loja_id = public.current_loja_id())
  );
$$;

-- --- entregas ----------------------------------------------------------
drop policy entregas_select on public.entregas;
create policy entregas_select on public.entregas for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  );

drop policy entregas_insert on public.entregas;
create policy entregas_insert on public.entregas for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
    and criado_por = auth.uid()
  );

-- O `with check` repete a regra do `using` de propósito. Antes ele exigia
-- só o tenant, e num UPDATE o `using` escolhe a linha ANTIGA enquanto o
-- `with check` valida a NOVA — dava pra pegar um vale da própria loja e
-- gravar `loja_id` de outra filial, mandando o vale pra um lugar onde
-- quem o criou não o enxerga mais. O app nunca faz isso; a policy é que
-- não deveria permitir.
drop policy entregas_update on public.entregas;
create policy entregas_update on public.entregas for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  )
  with check (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  );

-- --- corridas ----------------------------------------------------------
drop policy corridas_select on public.corridas;
create policy corridas_select on public.corridas for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  );

drop policy corridas_insert on public.corridas;
create policy corridas_insert on public.corridas for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  );

-- mesmo motivo do entregas_update acima
drop policy corridas_update on public.corridas;
create policy corridas_update on public.corridas for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  )
  with check (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  );

-- --- eventos -----------------------------------------------------------
-- eventos é o único caso que não sai de uma troca de função: a tabela não
-- tem loja_id, só entrega_id/corrida_id (os dois nullable). O escopo do
-- gerente precisa passar pela entrega/corrida dona.
--
-- Os três papéis, explicitamente:
--   admin   → tudo do tenant
--   gerente → o que for da própria filial, via a entrega/corrida do evento
--   caixa   → só os próprios eventos, como já era
--
-- O `user_id = auth.uid()` fica ANTES da parte de gerente de propósito: é
-- ele que sustenta o select-antes-de-inserir de inserirEventoIdempotente
-- (src/data/eventos.ts), que roda pra qualquer papel.
--
-- Evento sem entrega_id e sem corrida_id (só o de teste manual
-- 'teste_dedupe_fila_offline' hoje) fica visível só pro admin. É o
-- comportamento certo: não há filial a que pertença.
drop policy eventos_select on public.eventos;
create policy eventos_select on public.eventos for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_admin()
      or user_id = auth.uid()
      or (
        public.current_papel() = 'gerente'
        and (
          (entrega_id is not null and public.pode_ver_entrega(entrega_id))
          or (corrida_id is not null and public.pode_ver_corrida(corrida_id))
        )
      )
    )
  );
