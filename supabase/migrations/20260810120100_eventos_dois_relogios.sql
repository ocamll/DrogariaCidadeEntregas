-- =====================================================================
-- Dois relógios em eventos
--
-- ocorrido_em só tinha o relógio do servidor (now() no INSERT). Os 3 tipos
-- inseridos via inserirEventoIdempotente (pagamento_alterado,
-- falta_receita, insucesso_detalhado) passam pela fila offline — mesma
-- lacuna de pagamentos.registrado_em (ver migration
-- 20260810120000_pagamentos_dois_relogios.sql).
--
-- ocorrido_em_local guarda o relógio do dispositivo, capturado por quem
-- chama antes de enfileirar. Pra entrega_criada (gerado sozinho pelo
-- trigger fn_log_entrega, nunca passa por inserirEventoIdempotente) o
-- valor vem de graça do próprio entregas.ocorrido_em_local da linha que
-- disparou o insert — mesma ação, mesmo instante, sem precisar de nada
-- novo vindo do cliente.
--
-- status_alterado FICA SEM ocorrido_em_local, de propósito: a transição
-- pode vir de um UPDATE em lote (fechamento de corrida com vários vales
-- de uma vez) e não existe hoje um relógio de dispositivo por linha
-- disponível nesse ponto pra usar sem inventar valor. Gap conhecido, não
-- é regressão desta migration — registrar em NOTAS.md se ficar pendente.
-- =====================================================================

alter table public.eventos add column ocorrido_em_local timestamptz;

create or replace function public.fn_log_entrega()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.eventos (tenant_id, entrega_id, tipo, payload, user_id, ocorrido_em_local)
    values (new.tenant_id, new.id, 'entrega_criada',
            jsonb_build_object('numero_vale', new.numero_vale,
                               'valor_compra_cents', new.valor_compra_cents),
            auth.uid(), new.ocorrido_em_local);

  elsif new.status_entrega is distinct from old.status_entrega
     or new.status_financeiro is distinct from old.status_financeiro
     or new.status_documental is distinct from old.status_documental then
    insert into public.eventos (tenant_id, entrega_id, tipo, payload, user_id)
    values (new.tenant_id, new.id, 'status_alterado',
            jsonb_build_object(
              'de', jsonb_build_object('entrega', old.status_entrega,
                                       'financeiro', old.status_financeiro,
                                       'documental', old.status_documental),
              'para', jsonb_build_object('entrega', new.status_entrega,
                                         'financeiro', new.status_financeiro,
                                         'documental', new.status_documental)),
            auth.uid());
  end if;

  return new;
end;
$$;
