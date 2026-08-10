-- =====================================================================
-- eventos.user_id não tinha FK pra profiles — por isso o padrão até
-- agora era guardar autor_nome como snapshot no payload (marcarDivergencia,
-- notificarFaltaReceita, insucesso_detalhado) em vez de fazer join.
--
-- Os eventos gerados automaticamente pelo trigger fn_log_entrega
-- (entrega_criada, status_alterado) não têm esse snapshot — só o user_id
-- cru. Pro Registro de Auditoria mostrar "quem realizou" neles, a FK
-- precisa existir de verdade, habilitando join via profiles(nome).
--
-- Aditivo: todo user_id já gravado veio de auth.uid() ou profile.id de
-- sessão autenticada, nunca um id solto — não deve haver violação.
-- =====================================================================

alter table public.eventos
  add constraint eventos_user_id_fkey
  foreign key (user_id) references public.profiles(id);
