-- =====================================================================
-- "Lida" de verdade pro contador de alterações de pagamento: guarda até
-- quando cada usuário já viu. Fica no profile (não numa tabela separada
-- de leitura por evento) porque a semântica é "vi tudo até aqui", não
-- leitura individual por notificação.
-- =====================================================================

alter table public.profiles
  add column if not exists notificacoes_pagamento_lidas_em timestamptz;
