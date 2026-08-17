-- =====================================================================
-- Autoria derivada da sessão, não do que o frontend manda
--
-- Etapa 1 da cadeia de custódia (Romaneio de Saída). Independente do
-- resto: não cria tabela, não muda tela, e vale por si só.
--
-- O QUE ESTAVA ABERTO
--
-- `entregas_insert` sempre exigiu `criado_por = auth.uid()` na policy —
-- esse caso estava certo desde o schema inicial. Todos os outros não:
--
--   corridas.saida_por              INSERT/UPDATE, livre
--   corridas.retorno_por            UPDATE, livre
--   entregas.cancelado_por          UPDATE, livre
--   entregas.documento_recebido_por UPDATE, livre
--   entregas.receita_recebida_por   UPDATE, livre
--   pagamentos.registrado_por       INSERT, livre
--   eventos.user_id                 INSERT, livre
--
-- Qualquer autenticado podia gravar qualquer uma dessas apontando pra
-- outro usuário. Numa farmácia onde cada caixa tem login próprio e o
-- Registro de Auditoria responde "quem realizou", isso esvazia a
-- resposta: a coluna dizia quem o cliente afirmou ser, não quem era.
--
-- E tinha um nono caso, que só apareceu ao conferir os outros oito:
-- `entregas_update` não re-checa `criado_por`, então dava pra pegar um
-- vale da própria loja e **reescrever quem o criou**. A policy fecha o
-- INSERT e deixa o UPDATE aberto — mesma forma do buraco de
-- `with check` corrigido em 20260812120000, em outra coluna.
--
-- POR QUE VALIDAR EM VEZ DE SOBRESCREVER
--
-- O caminho óbvio seria ignorar o valor do cliente e carimbar
-- `auth.uid()` sempre. Não serve por causa da fila offline: se o caixa A
-- enfileira uma corrida, sai, e o caixa B entra no mesmo PC, carimbar
-- gravaria a saída de A em nome de B **em silêncio** — trocaria um
-- problema de confiança por outro pior, porque ninguém notaria.
--
-- Validando, esse caso vira erro: o item fica na fila com status 'erro' e
-- alguém percebe. É a resposta certa hoje, e é provisória — a etapa 4 dá
-- dono ao item da fila e passa a recusar isso antes de chegar no banco.
--
-- POR QUE SÓ QUANDO O VALOR MUDA
--
-- Nos UPDATEs a checagem é sobre `is distinct from old`, nunca sobre o
-- valor final. Sem isso, um UPDATE que nem toca em `retorno_por` (fechar
-- a corrida mexe em vários campos) carregaria o autor original pra dentro
-- da comparação e falharia sempre que quem edita não fosse quem fechou.
-- =====================================================================


-- Devolve o autor que de fato vale para a linha, ou levanta erro.
--
-- `auth.uid()` nulo significa contexto de servidor confiável — hoje
-- ninguém chega aqui assim (as policies são todas `to authenticated`),
-- mas a Edge Function de sincronização da etapa 4 vai, com `service_role`
-- e a identidade já verificada por ela antes de chamar o banco. Deixar
-- passar aqui é o que permite aquela porta existir sem reescrever isto.
create or replace function public.autor_conferido(p_valor uuid, p_coluna text)
returns uuid language plpgsql stable set search_path = public as $$
begin
  if auth.uid() is null then
    return p_valor;
  end if;

  if p_valor is null then
    return auth.uid();
  end if;

  if p_valor <> auth.uid() then
    raise exception
      '% aponta para outro usuário: a autoria vem da sessão, não do cliente.',
      p_coluna using errcode = 'insufficient_privilege';
  end if;

  return p_valor;
end;
$$;


-- --- corridas ---------------------------------------------------------
create or replace function public.fn_corrida_autoria()
returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.saida_por   := public.autor_conferido(new.saida_por,   'saida_por');
    new.retorno_por := public.autor_conferido(new.retorno_por, 'retorno_por');
    return new;
  end if;

  if new.saida_por is distinct from old.saida_por then
    new.saida_por := public.autor_conferido(new.saida_por, 'saida_por');
  end if;

  if new.retorno_por is distinct from old.retorno_por then
    new.retorno_por := public.autor_conferido(new.retorno_por, 'retorno_por');
  end if;

  return new;
end;
$$;

-- 'a' de autoria vem antes de 'r' (fn_corrida_registrar_saida/retorno) na
-- ordem alfabética, que é como o Postgres desempata trigger BEFORE do
-- mesmo evento. Não é coincidência: o autor tem que estar conferido antes
-- de qualquer outro gatilho olhar a linha.
drop trigger if exists trg_corridas_autoria on public.corridas;
create trigger trg_corridas_autoria
  before insert or update on public.corridas
  for each row execute function public.fn_corrida_autoria();


-- --- entregas ---------------------------------------------------------
create or replace function public.fn_entrega_autoria()
returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    -- criado_por já é garantido pela policy entregas_insert; aqui só
    -- preenche quando vem nulo, pra manter o mesmo contrato das outras.
    new.criado_por := public.autor_conferido(new.criado_por, 'criado_por');
    return new;
  end if;

  -- Quem criou o vale não muda nunca. Não é "conferir contra a sessão":
  -- o criador legítimo quase sempre é outra pessoa que não a que está
  -- editando agora, então comparar com auth.uid() bloquearia o uso normal.
  if new.criado_por is distinct from old.criado_por then
    raise exception
      'criado_por é imutável: quem registrou o vale % não muda.',
      old.numero_vale using errcode = 'insufficient_privilege';
  end if;

  if new.cancelado_por is distinct from old.cancelado_por then
    new.cancelado_por := public.autor_conferido(new.cancelado_por, 'cancelado_por');
  end if;

  if new.documento_recebido_por is distinct from old.documento_recebido_por then
    new.documento_recebido_por :=
      public.autor_conferido(new.documento_recebido_por, 'documento_recebido_por');
  end if;

  if new.receita_recebida_por is distinct from old.receita_recebida_por then
    new.receita_recebida_por :=
      public.autor_conferido(new.receita_recebida_por, 'receita_recebida_por');
  end if;

  return new;
end;
$$;

-- Antes de trg_entregas_imutavel, _protege_conferencia e _touch, todos
-- BEFORE nesta mesma tabela (ver nota de ordem alfabética acima).
drop trigger if exists trg_entregas_autoria on public.entregas;
create trigger trg_entregas_autoria
  before insert or update on public.entregas
  for each row execute function public.fn_entrega_autoria();


-- --- pagamentos -------------------------------------------------------
-- Não há policy de UPDATE em pagamentos (de propósito: pagamento gravado
-- não se altera), mas o trigger cobre os dois eventos mesmo assim — se um
-- dia a policy aparecer, a autoria já está protegida.
create or replace function public.fn_pagamento_autoria()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Os dois ramos fazem a mesma coisa, e ainda assim precisam ficar
  -- separados: `TG_OP = 'INSERT' or new.x is distinct from old.x` numa
  -- condição só quebraria, porque no INSERT o registro OLD não existe e o
  -- Postgres não garante curto-circuito do `or`.
  if TG_OP = 'INSERT' then
    new.registrado_por := public.autor_conferido(new.registrado_por, 'registrado_por');
  elsif new.registrado_por is distinct from old.registrado_por then
    new.registrado_por := public.autor_conferido(new.registrado_por, 'registrado_por');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pagamentos_autoria on public.pagamentos;
create trigger trg_pagamentos_autoria
  before insert or update on public.pagamentos
  for each row execute function public.fn_pagamento_autoria();


-- --- eventos ----------------------------------------------------------
-- Só INSERT: eventos é append-only (regra 6) e não tem policy de UPDATE
-- nem de DELETE. Um trigger de UPDATE aqui seria código morto sugerindo
-- que a tabela aceita edição.
--
-- Isso reforça de quebra a policy eventos_select, cujo ramo do caixa é
-- `user_id = auth.uid()`: o caixa passa a enxergar exatamente os eventos
-- que ele de fato gerou, não os que alguém marcou com o id dele.
create or replace function public.fn_evento_autoria()
returns trigger language plpgsql set search_path = public as $$
begin
  new.user_id := public.autor_conferido(new.user_id, 'user_id');
  return new;
end;
$$;

drop trigger if exists trg_eventos_autoria on public.eventos;
create trigger trg_eventos_autoria
  before insert on public.eventos
  for each row execute function public.fn_evento_autoria();
