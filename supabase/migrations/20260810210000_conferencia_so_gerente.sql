-- =====================================================================
-- Conferência do dinheiro é ato de supervisão — só gerente/admin
--
-- Fluxo real da farmácia (confirmado com o usuário): o operador marca as
-- divergências que percebeu, o GESTOR confere os vales, e os divergentes
-- sobem pra administração. Isso é o que dá sentido aos três valores de
-- `status_financeiro`:
--
--   na_ordem   → ainda não conferido
--   divergente → tem problema, vai pra administração
--   conferido  → gestor bateu e está ok
--
-- Um caixa marcando o próprio dia como conferido derrota o propósito da
-- conferência. Mas não dá pra resolver isso com policy: `entregas` tem
-- UPDATE liberado pro caixa por necessidade (cadastro, corrida, retorno,
-- cancelamento), e RLS não restringe COLUNA — mesma limitação que já
-- apareceu em `profiles` (ver fn_profiles_protege_campos).
--
-- Então a regra fica num trigger, como lá. Note que ele barra só a
-- transição PARA 'conferido': o caixa continua podendo marcar
-- 'divergente', que é justamente o papel dele nesse fluxo.
-- =====================================================================

create or replace function public.fn_entrega_protege_conferencia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status_financeiro = 'conferido'
     and old.status_financeiro is distinct from 'conferido'
     and not public.is_gerente()
  then
    raise exception 'Só gerente ou admin marca vale como conferido.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger trg_entregas_protege_conferencia
  before update on public.entregas
  for each row execute function public.fn_entrega_protege_conferencia();
