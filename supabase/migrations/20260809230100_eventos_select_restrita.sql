-- =====================================================================
-- RLS de eventos: SELECT tenant-wide era brecha real
--
-- O gate "só admin/gerente vê Notificações/Ocorrências/Registro de
-- Auditoria" sempre foi só de UI — a policy de SELECT permitia qualquer
-- autenticado do tenant ler TODO evento (inclusive payload de
-- pagamento_alterado, falta_receita, insucesso_detalhado de outras lojas
-- e outros usuários), bastando uma query direta ao Supabase.
--
-- Fix: gerente/admin continuam vendo tudo do tenant (mesmo padrão de
-- corridas_select/entregas_select). Caixa passa a ver só os próprios
-- eventos (user_id = auth.uid()) — suficiente pro select-antes-de-inserir
-- de inserirEventoIdempotente (src/data/eventos.ts) continuar funcionando,
-- já que quem insere um evento sempre passa o próprio id como
-- registrado_por/user_id.
-- =====================================================================

drop policy eventos_select on public.eventos;

create policy eventos_select on public.eventos for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_gerente() or user_id = auth.uid())
  );
