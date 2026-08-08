-- =====================================================================
-- Justificativa da divergência de pagamento.
--
-- O registro 'realizado' já existe por design (ver CLAUDE.md, seção
-- "pagamentos é tabela separada"). Falta só um lugar pra guardar o motivo
-- da alteração sem obrigar quem consulta a ir vasculhar o JSON de eventos.
-- =====================================================================

alter table public.pagamentos
  add column if not exists observacao text;
