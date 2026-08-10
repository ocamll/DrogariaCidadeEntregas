-- =====================================================================
-- Dois relógios em pagamentos
--
-- registrado_em só tinha o relógio do servidor (now() no INSERT).
-- Previsto/realizado passam pela fila offline (cadastro de entrega,
-- transferência, divergência de pagamento) — se o item sincronizar
-- atrasado, registrado_em acaba refletindo o momento do sync, não o
-- momento real em que o caixa registrou o pagamento. Mesma lacuna que
-- corridas.retorno_em tinha antes da migration
-- 20260809230000_corrida_retorno_dois_relogios.sql.
--
-- registrado_em_local passa a guardar o relógio do dispositivo, capturado
-- pelo componente antes de enfileirar — mesmo padrão de
-- entregas.ocorrido_em_local.
-- =====================================================================

alter table public.pagamentos add column registrado_em_local timestamptz;
