-- =====================================================================
-- Dois relógios na custódia de papel (convênio e receita)
--
-- Último lugar do app que gravava só um relógio: `documento_recebido_em`
-- e `receita_recebida_em` recebiam `new Date()` do navegador, sem
-- nenhum par de servidor. Diferente dos casos de
-- 20260810120000/20260810120100, esses dois não passam pela fila
-- offline (mutation direta em src/data/documentos.ts) — então o risco
-- não é sincronizar atrasado, é o relógio do PC do caixa estar errado
-- em termos absolutos, que a regra 8 do CLAUDE.md cita explicitamente
-- ("pode estar 40 minutos errado"). Sem par de servidor não há como
-- nem perceber a diferença depois.
--
-- Mesmo formato do resto do projeto: o cliente manda o relógio do
-- dispositivo na coluna `_local`, o servidor carimba `now()` na coluna
-- sem sufixo. As duas colunas sem sufixo já existiam (schema inicial e
-- 20260809210000) — o que muda é quem as preenche.
--
-- O gatilho é o `_local` virar não-nulo, e não o status_documental,
-- porque a receita não tem coluna de status: nas duas o "aconteceu" é
-- justamente o carimbo do dispositivo chegando.
-- =====================================================================

alter table public.entregas
  add column if not exists documento_recebido_em_local timestamptz,
  add column if not exists receita_recebida_em_local timestamptz;

create or replace function public.fn_entrega_registrar_custodia()
returns trigger language plpgsql as $$
begin
  if new.documento_recebido_em_local is not null
     and new.documento_recebido_em_local is distinct from old.documento_recebido_em_local then
    new.documento_recebido_em := now();
  end if;

  if new.receita_recebida_em_local is not null
     and new.receita_recebida_em_local is distinct from old.receita_recebida_em_local then
    new.receita_recebida_em := now();
  end if;

  return new;
end;
$$;

-- Roda antes de trg_entregas_imutavel/trg_entregas_touch (ordem
-- alfabética entre triggers do mesmo momento). Não conflita: a trigger
-- de imutabilidade só barra mudança em valor, cliente e número do vale.
create trigger trg_entregas_custodia
  before update on public.entregas
  for each row execute function public.fn_entrega_registrar_custodia();
