-- =====================================================================
-- Ajuste nas formas de pagamento: 'vale' sai (não é usado, confundia com
-- número do vale da entrega), entram 'convcard' (cartão convênio próprio
-- da farmácia, diferente de 'convenio' que é acordo com terceiro) e
-- 'crediario'.
-- =====================================================================

alter table public.pagamentos drop constraint if exists pagamentos_forma_check;

alter table public.pagamentos add constraint pagamentos_forma_check
  check (forma in ('dinheiro','credito','debito','pix','convenio','convcard','crediario','outro'));
