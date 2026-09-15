-- =====================================================================
-- RECEBER DOCUMENTO — a chegada posterior do papel, pelo vale
--
-- Decidido com o usuário (NOTAS 111, versão 2 do documento de mudança de
-- escopo, §4). SQL mostrado e confirmado em 2026-09-15, com a Opção A de
-- leitura: caixa e gerente leem a própria filial, admin lê todas.
--
-- O retorno de segunda declara a receita FALTANTE, e isso fica no DCRR1
-- assinado. Na terça o papel chega: o caixa acha o vale e registra o
-- recebimento. O romaneio de segunda continua dizendo — corretamente —
-- que a receita não voltou naquele retorno. Nada aqui toca documento
-- selado.
--
-- ---------------------------------------------------------------------
-- AS REGRAS
-- ---------------------------------------------------------------------
--   um recebimento por documento   unique (entrega_id, tipo_documento)
--   reenvio / clique repetido      mesmo id → "recebido", nada duplica
--   outra pessoa já recebeu        "ja_recebido", com quem e quando; o
--                                  primeiro NUNCA é sobrescrito
--   receita ≠ convênio             cada tipo tem a própria linha; receber
--                                  um não quita o outro
--   quem recebe                    caixa ou gerente, na PRÓPRIA filial. O
--                                  admin consulta e decide; não declara
--                                  recebimento físico que não fez
--   o que está pendente            a linha `d <entrega> <tipo> faltante`
--                                  do DCRR1 SELADO da corrida — nunca uma
--                                  coluna mutável. Vale sem retorno selado
--                                  responde "sem_pendencia": o papel ainda
--                                  pode estar com o motoboy
--   recusa prevista                volta como jsonb, não como exceção — a
--                                  fila offline a marca terminal em vez de
--                                  retentar pra sempre. Autorização (sessão,
--                                  cargo, filial) é exceção 42501
--
-- `auth.uid()` É CERTO AQUI, e não contradiz o E10.1: esta função é
-- chamada pelo cliente, com a sessão do dono da operação (a fila só roda
-- item do usuário logado). Se um dia passar por Edge Function como
-- service_role, `auth.uid()` vira NULL e a função recusa tudo — aí o ator
-- tem que virar parâmetro, como nas funções de selo.
-- =====================================================================

begin;

-- ---- 1. a tabela ---------------------------------------------------------

create table public.recebimentos_documento (
  id                  uuid primary key,          -- uuidv7 do cliente (regra 5)
  tenant_id           uuid not null references public.tenants(id),
  loja_id             uuid not null references public.lojas(id),
  entrega_id          uuid not null references public.entregas(id),
  tipo_documento      text not null
                      check (tipo_documento in ('convenio', 'crediario', 'receita')),
  romaneio_retorno_id uuid not null references public.romaneios(id),
  recebido_por        uuid not null references public.profiles(id),
  papel_no_momento    text not null check (papel_no_momento in ('caixa', 'gerente')),
  ocorrido_em_local   timestamptz not null,       -- relógio do dispositivo
  registrado_em       timestamptz not null default now(),  -- relógio do servidor
  constraint recebimento_um_por_documento unique (entrega_id, tipo_documento)
);

create index on public.recebimentos_documento (tenant_id, loja_id);

alter table public.recebimentos_documento enable row level security;

-- Nasce com tudo liberado por causa do `alter default privileges` do
-- Supabase — revoke explícito é obrigatório. Só a função escreve.
revoke all on public.recebimentos_documento from anon, authenticated;
grant select on public.recebimentos_documento to authenticated;

-- Opção A: o caixa precisa ver "já recebido por Ana" no vale, senão tenta
-- receber de novo. Ele já lê os vales da própria filial.
create policy recebimentos_documento_select on public.recebimentos_documento
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  );


-- ---- 2. a função ---------------------------------------------------------

create function public.receber_documento(
  p_id                uuid,
  p_entrega_id        uuid,
  p_tipo_documento    text,
  p_ocorrido_em_local timestamptz
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_perfil     record;
  v_entrega    record;
  v_retorno    record;
  v_existente  record;
  v_pendentes  int;
begin
  select id, tenant_id, loja_id, papel, nome into v_perfil
    from public.profiles where id = auth.uid() and ativo;
  if v_perfil.id is null then
    raise exception 'Sessão inválida.' using errcode = 'insufficient_privilege';
  end if;
  if v_perfil.papel not in ('caixa', 'gerente') then
    raise exception 'Só caixa ou gerente recebe documento.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_tipo_documento is null or p_tipo_documento not in ('convenio', 'crediario', 'receita') then
    return jsonb_build_object('resultado', 'tipo_invalido');
  end if;

  -- Trava o vale: dois recebimentos simultâneos do mesmo vale viram fila,
  -- e o segundo enxerga a linha do primeiro.
  select id, tenant_id, loja_id, corrida_id into v_entrega
    from public.entregas where id = p_entrega_id for update;
  if v_entrega.id is null
     or v_entrega.tenant_id <> v_perfil.tenant_id
     or v_entrega.loja_id is distinct from v_perfil.loja_id then
    raise exception 'Vale fora da sua filial.' using errcode = 'insufficient_privilege';
  end if;

  -- Reenvio ou já recebido: nunca duplica, nunca substitui o primeiro.
  select id, recebido_por, registrado_em into v_existente
    from public.recebimentos_documento
   where entrega_id = p_entrega_id and tipo_documento = p_tipo_documento;
  if found then
    return jsonb_build_object(
      'resultado',     case when v_existente.id = p_id then 'recebido' else 'ja_recebido' end,
      'reenvio',       v_existente.id = p_id,
      'recebido_por',  v_existente.recebido_por,
      'registrado_em', v_existente.registrado_em);
  end if;

  -- A pendência vem do documento ASSINADO: a linha
  -- `d <entrega> <tipo> faltante` do DCRR1 selado desta corrida. Ids do
  -- canônico são minúsculos, como `uuid::text`; `faltante` é o último
  -- campo da linha e nenhum outro valor começa assim.
  select id, canonico into v_retorno
    from public.romaneios
   where corrida_id = v_entrega.corrida_id and tipo = 'retorno' and status = 'selado';
  if v_retorno.id is null
     or position(E'\nd\t' || p_entrega_id::text || E'\t' || p_tipo_documento || E'\tfaltante'
                 in E'\n' || v_retorno.canonico) = 0 then
    return jsonb_build_object('resultado', 'sem_pendencia');
  end if;

  insert into public.recebimentos_documento
    (id, tenant_id, loja_id, entrega_id, tipo_documento, romaneio_retorno_id,
     recebido_por, papel_no_momento, ocorrido_em_local)
  values
    (p_id, v_entrega.tenant_id, v_entrega.loja_id, p_entrega_id, p_tipo_documento,
     v_retorno.id, v_perfil.id, v_perfil.papel, p_ocorrido_em_local);

  -- Mantém as colunas que as telas de hoje já leem.
  if p_tipo_documento = 'receita' then
    update public.entregas
       set receita_recebida_em_local = p_ocorrido_em_local,  -- trg_entregas_custodia carimba o _em
           receita_recebida_por      = v_perfil.id
     where id = p_entrega_id
       and receita_recebida_em is null and receita_recebida_em_local is null;
  else
    -- Convênio/crediário: `status_documental` só vira `recebido` quando
    -- NENHUM dos dois ficou faltante sem recebimento. A receita fica fora
    -- desta conta, como no selo do retorno (2026-09-14).
    select count(*) into v_pendentes
      from regexp_matches(v_retorno.canonico,
             E'(?:^|\n)d\t' || p_entrega_id::text || E'\t(convenio|crediario)\tfaltante', 'g') as m
     where not exists (select 1 from public.recebimentos_documento r
                        where r.entrega_id = p_entrega_id and r.tipo_documento = m[1]);
    if v_pendentes = 0 then
      update public.entregas
         set status_documental           = 'recebido',
             documento_recebido_em_local = coalesce(documento_recebido_em_local, p_ocorrido_em_local),
             documento_recebido_por      = coalesce(documento_recebido_por, v_perfil.id)
       where id = p_entrega_id;
    end if;
  end if;

  -- Auditoria, com a mesma chave do recebimento: reenvio não duplica.
  insert into public.eventos
    (tenant_id, entrega_id, corrida_id, tipo, payload, user_id, ocorrido_em_local, idempotency_key)
  values
    (v_entrega.tenant_id, p_entrega_id, v_entrega.corrida_id, 'documento_recebido_depois',
     jsonb_build_object('tipo_documento', p_tipo_documento,
                        'autor_nome', v_perfil.nome,
                        'romaneio_retorno_id', v_retorno.id),
     v_perfil.id, p_ocorrido_em_local, p_id);

  return jsonb_build_object('resultado', 'recebido', 'reenvio', false);
end;
$$;

revoke all on function public.receber_documento(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.receber_documento(uuid, uuid, text, timestamptz) to authenticated;

commit;


-- =====================================================================
-- CONFERIR DEPOIS DE APLICAR
--
-- (a) só a função escreve; o app só lê:
--
--   select has_table_privilege('authenticated', 'public.recebimentos_documento', 'insert') as pode_inserir,
--          has_table_privilege('authenticated', 'public.recebimentos_documento', 'select') as pode_ler;
--   -- esperado: false, true
--
-- (b) a policy de leitura:
--
--   select policyname from pg_policies where tablename = 'recebimentos_documento';
--   -- esperado: recebimentos_documento_select
--
-- (c) a função existe, uma só:
--
--   select pg_get_function_identity_arguments(p.oid) as args
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'receber_documento';
--   -- esperado: 1 linha — p_id uuid, p_entrega_id uuid, p_tipo_documento text,
--   --           p_ocorrido_em_local timestamp with time zone
--
-- (d) sem sessão, recusa. O SQL Editor não tem usuário logado, então esta
--     chamada TEM que falhar:
--
--   select public.receber_documento(gen_random_uuid(), gen_random_uuid(), 'receita', now());
--   -- esperado: ERRO 42501 "Sessão inválida."
--
-- (e) o placar não muda — esta migration não toca documento nenhum:
--
--   select * from public.verificar_integridade_resumo();
--   -- esperado: o mesmo de antes (44 · 44 · 0 no dia em que foi escrita)
-- =====================================================================
