-- =====================================================================
-- Dedupe de eventos reenviados pela fila offline.
--
-- eventos.id é bigint identity (gerado pelo banco) — não dá pra usar o
-- padrão de id determinístico + upsert que o resto do app usa pra
-- idempotência de reenvio (regra 5 do CLAUDE.md). Em vez de abrir uma
-- policy de UPDATE em eventos (o que quebraria a garantia de append-only
-- da regra 6), a aplicação gera uma chave no cliente uma única vez por
-- operação e faz um select por essa chave antes de inserir — só grava se
-- ainda não existir. Nula pra todo evento que não vem de um fluxo
-- reenviável pela fila (ex.: os eventos automáticos do trigger
-- fn_log_entrega continuam sem essa chave).
-- =====================================================================

alter table public.eventos
  add column if not exists idempotency_key uuid;

create unique index if not exists eventos_idempotency_key_unico
  on public.eventos (idempotency_key)
  where idempotency_key is not null;
