-- =====================================================================
-- Custódia da receita física — não é dado de saúde, só rastro de papel.
--
-- Regra 9 do CLAUDE.md proíbe guardar medicamento/princípio ativo. Essas
-- colunas guardam só: precisa de receita nesse vale? e ela já voltou?
-- Mesmo espírito de status_documental/documento_recebido_em (convênio),
-- que já existiam desde o schema inicial pra esse tipo de rastreio.
-- =====================================================================

alter table public.entregas
  add column if not exists tem_receita boolean not null default false,
  add column if not exists receita_recebida_em timestamptz,
  add column if not exists receita_recebida_por uuid references public.profiles(id);
