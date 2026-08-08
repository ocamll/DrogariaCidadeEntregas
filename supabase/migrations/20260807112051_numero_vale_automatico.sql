-- =====================================================================
-- numero_vale deixa de ser digitado pelo caixa e passa a ser gerado
-- pelo banco. O vale É o preenchimento dos dados (cliente, endereço,
-- valor) — não existe um número físico prévio pra transcrever, e pedir
-- pro caixa inventar/lembrar o próximo número só causa erro e colisão.
--
-- Resolve o "CONFIRMAR COM O CAIXA" deixado em aberto na migration
-- anterior: não reinicia por dia/mês, é sequencial pra sempre. Mais
-- simples, sem problema de fuso/horário de corte — pode virar
-- reinício diário depois se fizer falta de verdade.
-- =====================================================================

create sequence if not exists public.entregas_numero_vale_seq;

alter table public.entregas
  alter column numero_vale set default (
    'V-' || lpad(nextval('public.entregas_numero_vale_seq')::text, 6, '0')
  );
