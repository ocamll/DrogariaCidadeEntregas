-- =====================================================================
-- Cancelamento de vale — a metade que faltava
--
-- O schema inicial já previa tudo: `status_entrega` aceita 'cancelada',
-- existem `cancelado_em`, `cancelado_por` e `motivo_cancelamento`, e há
-- até um CHECK exigindo o motivo (`entrega_cancelada_tem_motivo`). A
-- regra 4 do CLAUDE.md descreve o fluxo em detalhe.
--
-- Só que nada no app nunca escreveu esse status: a palavra 'cancelada'
-- aparecia no código só como rótulo de exibição. A regra descrevia um
-- caminho que não tinha como acontecer, e vale digitado errado ficava
-- pendente pra sempre, poluindo a lista do dia e os relatórios.
--
-- Aqui entra só o que faltava no banco: o par de relógios do
-- cancelamento (regra 8). `cancelado_em` passa a ser carimbado pelo
-- servidor, e o cliente manda o relógio do dispositivo em
-- `cancelado_em_local` — mesmo formato de saída/retorno de corrida e da
-- custódia de papel.
-- =====================================================================

alter table public.entregas
  add column if not exists cancelado_em_local timestamptz;

create or replace function public.fn_entrega_registrar_cancelamento()
returns trigger language plpgsql as $$
begin
  if new.status_entrega = 'cancelada'
     and old.status_entrega is distinct from 'cancelada' then
    new.cancelado_em := now();
  end if;
  return new;
end;
$$;

-- Roda antes de trg_entregas_imutavel e trg_entregas_touch (ordem
-- alfabética no mesmo momento). Não conflita: a de imutabilidade só barra
-- valor, cliente e número do vale, e cancelamento não mexe em nenhum
-- deles.
create trigger trg_entregas_cancelamento
  before update on public.entregas
  for each row execute function public.fn_entrega_registrar_cancelamento();
