-- =====================================================================
-- Dois relógios também na SAÍDA da corrida
--
-- A migration 20260809230000 arrumou o retorno e deixou a saída pra
-- trás. Olhando o cliente (`criarCorridaComAssinatura`), as duas colunas
-- recebiam o MESMO valor:
--
--   saida_em:       input.ocorridoEmLocal   <- relógio do dispositivo
--   saida_em_local: input.ocorridoEmLocal   <- relógio do dispositivo
--
-- Ou seja: o par existia só no nome. Não havia relógio de servidor
-- nenhum na saída, e ninguém tinha como perceber depois que o PC do
-- caixa estava errado — que é justamente o que a regra 8 quer evitar.
--
-- Agora `saida_em` é carimbado pelo banco, e o cliente manda só
-- `saida_em_local`.
--
-- O reenvio da fila offline é o caso delicado aqui: `corridas` é
-- gravada com upsert, então um reenvio depois de falha parcial vira
-- UPDATE. Se o trigger remarcasse `now()` nesse UPDATE, a saída passaria
-- a ser o horário do sync em vez do horário real — pior que o bug
-- original. Por isso só carimba quando ainda não há valor.
--
-- Corridas antigas ficam com o relógio do dispositivo em `saida_em`
-- (não dá pra recuperar o horário de servidor que nunca foi gravado).
-- Não há backfill: inventar valor seria pior que o dado torto conhecido.
-- =====================================================================

create or replace function public.fn_corrida_registrar_saida()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    new.saida_em := now();
  elsif old.saida_em is not null then
    -- reenvio da fila offline: preserva a saída original
    new.saida_em := old.saida_em;
  else
    new.saida_em := now();
  end if;
  return new;
end;
$$;

create trigger trg_corridas_saida
  before insert or update on public.corridas
  for each row execute function public.fn_corrida_registrar_saida();
