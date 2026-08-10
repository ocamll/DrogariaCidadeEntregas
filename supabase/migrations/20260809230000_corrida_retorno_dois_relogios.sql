-- =====================================================================
-- Dois relógios também no retorno de corrida
--
-- saida_em/saida_em_local já tinham o par (relógio do dispositivo +
-- registrado_em do servidor, este último fixado na criação da corrida).
-- retorno_em só existia como valor mandado pelo cliente (new Date() do
-- navegador), sem nenhum companheiro de servidor — regra 8 do CLAUDE.md
-- (nunca usar só um relógio) ficava violada especificamente no fechamento.
--
-- Fix: retorno_em_local guarda o relógio do dispositivo (capturado antes
-- de enfileirar, sobrevive a reenvio da fila offline); retorno_em passa a
-- ser preenchido pelo trigger com now() do servidor no instante em que o
-- UPDATE de fechamento é de fato aplicado — que pode ser bem depois do
-- retorno real, se a fila offline sincronizar atrasada.
-- =====================================================================

alter table public.corridas add column retorno_em_local timestamptz;

create or replace function public.fn_corrida_registrar_retorno()
returns trigger language plpgsql as $$
begin
  if new.status = 'fechada' and old.status is distinct from 'fechada' then
    new.retorno_em := now();
  end if;
  return new;
end;
$$;

create trigger trg_corridas_retorno
  before update on public.corridas
  for each row execute function public.fn_corrida_registrar_retorno();
