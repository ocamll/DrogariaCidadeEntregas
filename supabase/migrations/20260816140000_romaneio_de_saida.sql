-- =====================================================================
-- Romaneio de Saída — o documento selado da retirada
--
-- Etapa 3. Cria o documento, o hash canônico, a autorização de uso único
-- e a transação atômica que sela tudo. NÃO muda tela nenhuma: a Nova
-- Corrida continua com o fluxo antigo até a etapa 5.
--
-- A porta de sincronização offline (chamada pela Edge Function com
-- service_role) é a etapa 4. Por isso nenhuma função do caminho interno
-- lê `auth.uid()`: o id do caixa entra por parâmetro, sempre. É o que vai
-- permitir a segunda porta existir sem reescrever nada aqui — e é fácil
-- de errar, porque a porta online tem auth.uid() disponível o tempo todo.
--
--
-- POR QUE UM FORMATO DE TEXTO, E NÃO JSON CANÔNICO
--
-- O hash precisa sair IDÊNTICO em dois lugares: aqui, e no TypeScript do
-- navegador (que precisa hashear offline, sem servidor). Duas
-- implementações do mesmo algoritmo é a parte mais frágil de tudo isto.
--
-- JSON canônico é onde essa fragilidade mora: ordem de chave, escape de
-- Unicode, notação de número, espaço em branco — cada um é uma chance de
-- os dois lados divergirem em silêncio, e o sintoma seria "o vale offline
-- nunca sincroniza", meses depois, sem pista.
--
-- Então o canônico é texto por linha, com TAB separando campo e ordem de
-- campo fixa. Não tem escape, não tem chave, não tem ordenação de objeto.
-- Só inteiros, uuids em minúscula e texto com TAB/CR/LF trocados por
-- espaço. É chato de propósito: chato é o que dá pra reproduzir.
-- =====================================================================


-- =====================================================================
-- 1. NUMERAÇÃO
--
-- Mesmo padrão do numero_vale. Sequência não volta atrás em rollback,
-- então a numeração TEM buracos quando um selo falha — isso é normal em
-- documento numerado e é melhor que o contrário (dois romaneios com o
-- mesmo número seria falha de verdade).
-- =====================================================================

create sequence if not exists public.romaneios_numero_seq;


-- =====================================================================
-- 2. TABELAS
-- =====================================================================

create table public.romaneios (
  id            uuid primary key,   -- v7 do cliente (regra 5), sem default
  tenant_id     uuid not null references public.tenants(id),
  loja_id       uuid not null references public.lojas(id),

  -- Nullable porque romaneio em CONFLITO não tem corrida: ela nunca
  -- chegou a ser criada. O CHECK abaixo garante que o selado sempre tem.
  corrida_id    uuid references public.corridas(id),

  numero        text not null default (
    'R-' || lpad(nextval('public.romaneios_numero_seq')::text, 6, '0')
  ),

  -- 'rascunho' NÃO existe aqui de propósito. O rascunho vive no cliente
  -- (e na fila offline), e `preparar_romaneio` é função pura que não
  -- grava nada — então um valor 'rascunho' seria estado sem ninguém que
  -- escreva, igual ao `status_documental = 'extraviado'` que o projeto já
  -- carrega. Só existe o que alguém grava.
  status        text not null check (status in ('selado', 'conflito')),

  modo          text not null check (modo in ('online', 'offline_sincronizada')),

  -- payload é pra ler e consultar; canonico são os bytes que de fato
  -- foram hasheados. Guardar os dois é redundante e é de propósito:
  -- reconstruir o canônico a partir do payload anos depois arriscaria
  -- reconstruir DIFERENTE, e aí o documento não se verifica mais.
  payload       jsonb not null,
  canonico      text,
  document_hash text not null,
  final_hash    text,

  -- Três tempos, não dois: quando a retirada aconteceu no balcão, quando
  -- o servidor recebeu, e quando selou. Numa saída online os três quase
  -- coincidem; numa offline eles contam a história inteira.
  ocorrido_em_local     timestamptz,
  recebido_em_servidor  timestamptz not null default now(),
  selado_em             timestamptz,

  criado_por    uuid not null references public.profiles(id),
  ip            inet,
  geolocalizacao jsonb,

  -- Só em status='conflito': quais vales bateram, por quê, e os traços
  -- das duas assinaturas. Eles não podem ir pra `assinaturas` (aquela
  -- tabela exige corrida, e aqui não há nenhuma), mas também não podem
  -- sumir: uma retirada física aconteceu de verdade e alguém vai precisar
  -- resolver isso olhando o que foi assinado.
  conflito      jsonb,

  constraint romaneio_selado_tem_corrida check (
    status <> 'selado' or (corrida_id is not null and canonico is not null)
  )
);

create index on public.romaneios (tenant_id, loja_id, recebido_em_servidor desc);
create index on public.romaneios (corrida_id);
create unique index romaneios_numero_unico on public.romaneios (tenant_id, numero);


create table public.romaneio_entregas (
  romaneio_id uuid not null references public.romaneios(id),
  entrega_id  uuid not null references public.entregas(id),
  tenant_id   uuid not null references public.tenants(id),  -- regra 2
  ordem       smallint not null,
  primary key (romaneio_id, entrega_id)
);

create index on public.romaneio_entregas (entrega_id);


-- Autorização de uso único: prova que o motoboy autenticou para ESTE
-- documento. Amarrada ao document_hash, então mexer nos vales depois de
-- autenticar invalida a autorização sozinho — sem precisar de nenhuma
-- lógica que "perceba" a mudança.
create table public.motoboy_autorizacoes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id),
  credencial_id uuid not null references public.motoboy_credenciais(id),
  motoboy_id    uuid not null references public.mototaxistas(id),
  document_hash text not null,
  criada_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  consumida_em  timestamptz,
  consumida_por_romaneio uuid references public.romaneios(id)
);

create index on public.motoboy_autorizacoes (credencial_id, expira_em desc);


-- =====================================================================
-- 3. ASSINATURAS — duas por corrida agora
-- =====================================================================

alter table public.assinaturas
  add column if not exists romaneio_id      uuid references public.romaneios(id),
  add column if not exists tipo_signatario  text not null default 'motoboy'
    check (tipo_signatario in ('caixa', 'motoboy')),
  add column if not exists user_id          uuid references public.profiles(id),
  add column if not exists motoboy_id       uuid references public.mototaxistas(id),
  add column if not exists credencial_id    uuid references public.motoboy_credenciais(id),
  add column if not exists autorizacao_id   uuid references public.motoboy_autorizacoes(id),
  add column if not exists auth_method      text,
  add column if not exists document_hash    text,
  add column if not exists signature_hash   text,
  add column if not exists assinado_em_local timestamptz,
  add column if not exists ip               inet,
  add column if not exists geolocalizacao   jsonb;

-- O índice antigo permitia exatamente UMA assinatura por corrida, o que
-- impedia a assinatura do caixa de existir. A invariante certa é uma de
-- cada tipo.
--
-- O default 'motoboy' acima resolve as linhas que já existem: elas são
-- assinaturas de motoboy de antes do romaneio, e ficam com romaneio_id
-- nulo. Não há backfill inventando documento pra elas.
drop index if exists assinaturas_corrida_id_idx;
drop index if exists assinaturas_corrida_id_key;
create unique index if not exists assinaturas_corrida_signatario
  on public.assinaturas (corrida_id, tipo_signatario);


-- =====================================================================
-- 4. RLS E GRANTS
--
-- Mesmo escopo de `corridas`: caixa e gerente veem a própria filial,
-- admin vê todas. Nenhum grant de escrita em lugar nenhum — romaneio só
-- nasce pela transação da seção 8.
-- =====================================================================

alter table public.romaneios            enable row level security;
alter table public.romaneio_entregas    enable row level security;
alter table public.motoboy_autorizacoes enable row level security;

create policy romaneios_select on public.romaneios for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_admin() or loja_id = public.current_loja_id())
  );

-- Espelha pode_ver_entrega/pode_ver_corrida: romaneio_entregas não tem
-- loja_id próprio, e o escopo vem do romaneio dono.
create or replace function public.pode_ver_romaneio(p_romaneio_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.romaneios r
    where r.id = p_romaneio_id
      and r.tenant_id = public.current_tenant_id()
      and (public.is_admin() or r.loja_id = public.current_loja_id())
  );
$$;

create policy romaneio_entregas_select on public.romaneio_entregas for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.pode_ver_romaneio(romaneio_id)
  );

-- motoboy_autorizacoes fica SEM POLICY NENHUMA de propósito: RLS ligada e
-- zero policies = ninguém lê pelo PostgREST. O frontend só precisa do id
-- que `autorizar_saida` devolve; ler a tabela não serve pra nada legítimo
-- e serviria pra procurar autorização de outro.
revoke all on public.motoboy_autorizacoes from anon, authenticated;

revoke all on public.romaneios         from anon, authenticated;
revoke all on public.romaneio_entregas from anon, authenticated;

grant select on public.romaneios         to authenticated;
grant select on public.romaneio_entregas to authenticated;


-- =====================================================================
-- 5. O CANÔNICO
--
-- Formato (linhas unidas por \n, SEM \n final; TAB entre campos):
--
--   DCR1
--   tenant<TAB>{uuid}
--   loja<TAB>{uuid}
--   agencia<TAB>{uuid|-}
--   motoboy<TAB>{uuid}
--   caixa<TAB>{uuid}
--   vales<TAB>{n}
--   v<TAB>{entrega_id}<TAB>{numero_vale}<TAB>{tipo}<TAB>{cliente_nome}
--     <TAB>{cliente_endereco}<TAB>{qtd_vales}<TAB>{valor_compra_cents}
--     <TAB>{valor_entrega_cents}<TAB>{entrega_paga_cliente_cents}
--     <TAB>{loja_origem_id|-}<TAB>{convenio_id|-}
--   p<TAB>{entrega_id}<TAB>{pagamento_id}<TAB>{forma}<TAB>{valor_cents}<TAB>{troco_cents}
--
-- Regras que os DOIS lados têm que respeitar igual:
--   - vales ordenados por entrega_id::text (não por uuid binário — texto
--     é o que o JavaScript consegue reproduzir sem esforço)
--   - pagamentos ordenados por (entrega_id::text, pagamento_id::text)
--   - nulo vira '-'
--   - TAB, CR e LF dentro de texto viram espaço
--   - inteiro em decimal simples, sem separador
--   - uuid em minúscula
--
-- O tenant sai de `p_tenant_id`, não de current_tenant_id(): a porta de
-- sincronização não tem sessão, e um canônico que depende de quem chama
-- produziria hash diferente conforme a porta.
--
-- Nada de medicamento, princípio ativo ou item de compra entra aqui
-- (regra 9). O snapshot prova O QUE saiu em termos de vale, valor e
-- destino — nunca o conteúdo do saco.
-- =====================================================================

create or replace function public.texto_para_canonico(p_texto text)
returns text language sql immutable set search_path = public as $$
  select coalesce(translate(p_texto, e'\t\n\r', '   '), '-');
$$;

create or replace function public.romaneio_canonico(
  p_tenant_id uuid,
  p_loja_id uuid,
  p_agencia_id uuid,
  p_motoboy_id uuid,
  p_caixa_id uuid,
  p_entrega_ids uuid[]
)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_linhas text[];
  v_registro record;
begin
  v_linhas := array[
    'DCR1',
    'tenant'  || e'\t' || p_tenant_id::text,
    'loja'    || e'\t' || p_loja_id::text,
    'agencia' || e'\t' || coalesce(p_agencia_id::text, '-'),
    'motoboy' || e'\t' || p_motoboy_id::text,
    'caixa'   || e'\t' || p_caixa_id::text,
    'vales'   || e'\t' || coalesce(array_length(p_entrega_ids, 1), 0)::text
  ];

  for v_registro in
    select e.id, e.numero_vale, e.tipo, e.cliente_nome, e.cliente_endereco,
           e.quantidade_vales, e.valor_compra_cents, e.valor_entrega_cents,
           e.entrega_paga_cliente_cents, e.loja_origem_id, e.convenio_id
      from public.entregas e
     where e.id = any(p_entrega_ids)
     order by e.id::text collate "C"
  loop
    v_linhas := v_linhas || (
      'v' || e'\t' || v_registro.id::text
          || e'\t' || public.texto_para_canonico(v_registro.numero_vale)
          || e'\t' || v_registro.tipo
          || e'\t' || public.texto_para_canonico(v_registro.cliente_nome)
          || e'\t' || public.texto_para_canonico(v_registro.cliente_endereco)
          || e'\t' || v_registro.quantidade_vales::text
          || e'\t' || v_registro.valor_compra_cents::text
          || e'\t' || v_registro.valor_entrega_cents::text
          || e'\t' || v_registro.entrega_paga_cliente_cents::text
          || e'\t' || coalesce(v_registro.loja_origem_id::text, '-')
          || e'\t' || coalesce(v_registro.convenio_id::text, '-')
    );
  end loop;

  -- Uma linha por pagamento previsto, e não "o previsto" no singular:
  -- pagamentos é 1:N de verdade (ver CLAUDE.md), e escolher um de vários
  -- deixaria dado fora do hash sem ninguém notar.
  for v_registro in
    select pg.entrega_id, pg.id, pg.forma, pg.valor_cents, pg.troco_cents
      from public.pagamentos pg
     where pg.entrega_id = any(p_entrega_ids)
       and pg.momento = 'previsto'
     order by pg.entrega_id::text collate "C", pg.id::text collate "C"
  loop
    v_linhas := v_linhas || (
      'p' || e'\t' || v_registro.entrega_id::text
          || e'\t' || v_registro.id::text
          || e'\t' || v_registro.forma
          || e'\t' || v_registro.valor_cents::text
          || e'\t' || v_registro.troco_cents::text
    );
  end loop;

  return array_to_string(v_linhas, e'\n');
end;
$$;

revoke all on function public.romaneio_canonico(uuid, uuid, uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;


-- O snapshot legível. Separado do canônico porque servem a coisas
-- diferentes: este é pra ler e consultar, aquele é pra hashear.
create or replace function public.romaneio_payload(
  p_loja_id uuid, p_agencia_id uuid, p_motoboy_id uuid, p_caixa_id uuid,
  p_entrega_ids uuid[]
)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'versao', 'DCR1',
    'loja_id', p_loja_id,
    'agencia_id', p_agencia_id,
    'motoboy_id', p_motoboy_id,
    'caixa_id', p_caixa_id,
    'vales', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entrega_id', e.id,
               'numero_vale', e.numero_vale,
               'tipo', e.tipo,
               'cliente_nome', e.cliente_nome,
               'cliente_endereco', e.cliente_endereco,
               'quantidade_vales', e.quantidade_vales,
               'valor_compra_cents', e.valor_compra_cents,
               'valor_entrega_cents', e.valor_entrega_cents,
               'entrega_paga_cliente_cents', e.entrega_paga_cliente_cents,
               'loja_origem_id', e.loja_origem_id,
               'convenio_id', e.convenio_id,
               'pagamentos_previstos', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'pagamento_id', pg.id, 'forma', pg.forma,
                          'valor_cents', pg.valor_cents, 'troco_cents', pg.troco_cents
                        ) order by pg.id::text collate "C"), '[]'::jsonb)
                   from public.pagamentos pg
                  where pg.entrega_id = e.id and pg.momento = 'previsto'
               )
             ) order by e.id::text collate "C")
        from public.entregas e
       where e.id = any(p_entrega_ids)
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.romaneio_payload(uuid, uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;


-- =====================================================================
-- 6. PREPARAR — função PURA, não grava nada
--
-- Devolve o canônico INTEIRO de propósito, não só o hash: é o que
-- permite comparar byte a byte com a implementação TypeScript e provar
-- que as duas concordam. Sem isso, a divergência só apareceria como
-- "vale offline não sincroniza", meses depois e sem pista.
-- =====================================================================

create or replace function public.preparar_romaneio(
  p_loja_id uuid, p_agencia_id uuid, p_motoboy_id uuid, p_entrega_ids uuid[]
)
returns table (payload jsonb, canonico text, document_hash text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_caixa uuid := auth.uid();
  v_canonico text;
begin
  if v_tenant is null or v_caixa is null then
    raise exception 'Sessão inválida.' using errcode = 'insufficient_privilege';
  end if;

  v_canonico := public.romaneio_canonico(v_tenant, p_loja_id, p_agencia_id,
                                         p_motoboy_id, v_caixa, p_entrega_ids);

  return query select
    public.romaneio_payload(p_loja_id, p_agencia_id, p_motoboy_id, v_caixa, p_entrega_ids),
    v_canonico,
    encode(digest(v_canonico, 'sha256'), 'hex');
end;
$$;

revoke all on function public.preparar_romaneio(uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.preparar_romaneio(uuid, uuid, uuid, uuid[]) to authenticated;


-- =====================================================================
-- 7. AUTORIZAR — cartão + PIN amarrados a ESTE documento
--
-- Reusa autenticar_credencial (etapa 2), que já é quem grava tentativa e
-- aplica bloqueio progressivo. Aqui só acrescenta a amarração e a
-- validade curta.
-- =====================================================================

create or replace function public.autorizar_saida(
  p_token text, p_pin text, p_document_hash text
)
returns table (ok boolean, motivo text, autorizacao_id uuid, expira_em timestamptz)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_auth record;
  v_motoboy_id uuid;
  v_id uuid;
  v_expira timestamptz;
begin
  if v_tenant is null then
    raise exception 'Sessão sem tenant.' using errcode = 'insufficient_privilege';
  end if;

  -- Não levanta exceção com PIN errado — a razão está na etapa 2: o
  -- contador de tentativas precisa commitar.
  select * into v_auth from public.autenticar_credencial(p_token, p_pin);

  if not v_auth.ok then
    return query select false, v_auth.motivo, null::uuid, null::timestamptz;
    return;
  end if;

  select c.motoboy_id into v_motoboy_id
    from public.motoboy_credenciais c where c.id = v_auth.credencial_id;

  -- 2 minutos: tempo de assinar duas vezes com folga, curto o bastante
  -- pra uma autorização esquecida na tela não valer depois.
  v_expira := now() + interval '2 minutes';

  insert into public.motoboy_autorizacoes
    (tenant_id, credencial_id, motoboy_id, document_hash, expira_em)
  values
    (v_tenant, v_auth.credencial_id, v_motoboy_id, p_document_hash, v_expira)
  returning id into v_id;

  return query select true, null::text, v_id, v_expira;
end;
$$;

revoke all on function public.autorizar_saida(text, text, text) from public, anon;
grant execute on function public.autorizar_saida(text, text, text) to authenticated;


-- =====================================================================
-- 8. SELAR — tudo ou nada
--
-- Devolve jsonb discriminado em vez de levantar exceção nos casos
-- previstos, e isso é decisão de desenho, não preguiça: o registro do
-- CONFLITO precisa commitar. Se o conflito fosse `raise`, o rollback
-- levaria junto a prova de que uma retirada física aconteceu — que é
-- exatamente o que não pode sumir.
--
-- Erro de verdade (parâmetro inconsistente, autorização inválida)
-- continua sendo exceção, porque aí não há nada a preservar.
-- =====================================================================

-- Precisa vir antes de selar_romaneio_interno, que a chama.
create or replace function public.registrar_conflito_romaneio(
  p_romaneio_id uuid, p_tenant uuid, p_loja_id uuid, p_caixa_id uuid,
  p_document_hash text, p_ocorrido_em_local timestamptz, p_modo text,
  p_ip inet, p_geolocalizacao jsonb, p_conflitos jsonb,
  p_entrega_ids uuid[], p_caixa_strokes jsonb, p_motoboy_strokes jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_numero text;
begin
  -- corrida_id fica nulo: a corrida não chegou a existir. Os traços das
  -- duas assinaturas vão pro campo `conflito` porque `assinaturas` exige
  -- corrida — e sumir com eles seria apagar a prova de que alguém de
  -- fato assinou e levou os vales.
  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, status, modo, payload, canonico,
     document_hash, ocorrido_em_local, criado_por, ip, geolocalizacao, conflito)
  values
    (p_romaneio_id, p_tenant, p_loja_id, null, 'conflito', p_modo,
     jsonb_build_object('entrega_ids', to_jsonb(p_entrega_ids)), null,
     p_document_hash, p_ocorrido_em_local, p_caixa_id, p_ip, p_geolocalizacao,
     jsonb_build_object('motivos', p_conflitos,
                        'caixa_strokes', p_caixa_strokes,
                        'motoboy_strokes', p_motoboy_strokes))
  on conflict (id) do nothing;

  select r.numero into v_numero from public.romaneios r where r.id = p_romaneio_id;

  insert into public.eventos (tenant_id, tipo, payload, user_id, ocorrido_em_local)
  values (p_tenant, 'conflito_sincronizacao',
          jsonb_build_object('romaneio_id', p_romaneio_id, 'numero', v_numero,
                             'modo', p_modo, 'conflitos', p_conflitos),
          p_caixa_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', false, 'motivo', 'conflito',
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'conflitos', p_conflitos);
end;
$$;

revoke all on function public.registrar_conflito_romaneio(
  uuid, uuid, uuid, uuid, text, timestamptz, text, inet, jsonb, jsonb, uuid[], jsonb, jsonb
) from public, anon, authenticated;


create or replace function public.selar_romaneio_interno(
  p_caixa_id uuid,
  p_romaneio_id uuid,
  p_corrida_id uuid,
  p_loja_id uuid,
  p_agencia_id uuid,
  p_motoboy_id uuid,
  p_entrega_ids uuid[],
  p_document_hash text,
  p_autorizacao_id uuid,
  p_caixa_strokes jsonb,
  p_motoboy_strokes jsonb,
  p_ocorrido_em_local timestamptz,
  p_modo text,
  p_ip inet,
  p_geolocalizacao jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_tenant uuid;
  v_existente record;
  v_canonico text;
  v_hash text;
  v_conflitos jsonb;
  v_numero text;
  v_agora timestamptz := now();
  v_hash_caixa text;
  v_hash_motoboy text;
  v_final text;
  v_credencial_id uuid;
  v_ordem smallint := 0;
  v_entrega_id uuid;
begin
  -- ---- reenvio da fila offline ---------------------------------------
  -- Vem ANTES de qualquer lock pra não segurar linha à toa. Olha o
  -- STATUS, não só a existência: um romaneio em conflito também tem
  -- número, e devolvê-lo como "ok, já existia" esconderia o conflito
  -- justamente de quem precisa resolvê-lo.
  select r.status, r.numero, r.final_hash, r.conflito into v_existente
    from public.romaneios r where r.id = p_romaneio_id;

  if v_existente.status = 'selado' then
    return jsonb_build_object('ok', true, 'ja_existia', true,
                              'romaneio_id', p_romaneio_id,
                              'numero', v_existente.numero,
                              'final_hash', v_existente.final_hash);
  elsif v_existente.status = 'conflito' then
    return jsonb_build_object('ok', false, 'motivo', 'conflito', 'ja_existia', true,
                              'romaneio_id', p_romaneio_id,
                              'numero', v_existente.numero,
                              'conflitos', v_existente.conflito -> 'motivos');
  end if;

  select p.tenant_id into v_tenant from public.profiles p
   where p.id = p_caixa_id and p.ativo;
  if v_tenant is null then
    raise exception 'Caixa inexistente ou inativo.' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(array_length(p_entrega_ids, 1), 0) = 0 then
    raise exception 'Romaneio sem vale nenhum.' using errcode = 'check_violation';
  end if;
  if p_caixa_strokes is null or p_motoboy_strokes is null then
    raise exception 'Romaneio exige as duas assinaturas.' using errcode = 'check_violation';
  end if;

  -- ---- trava os vales ANTES de validar --------------------------------
  -- Sem o FOR UPDATE, dois caixas leem "pendente" ao mesmo tempo e os
  -- dois selam. Com ele, o segundo espera o primeiro commitar e então
  -- enxerga corrida_id preenchido — vira conflito, que é o certo.
  --
  -- O `order by` é pra reduzir deadlock quando duas saídas têm vales em
  -- comum em ordens diferentes. Se ainda assim der deadlock, o Postgres
  -- aborta uma das duas, que é falha segura: nenhuma sela pela metade.
  perform 1 from public.entregas e
   where e.id = any(p_entrega_ids)
   order by e.id
   for update;

  -- ---- conflito: vale que não está mais disponível ---------------------
  select jsonb_agg(jsonb_build_object(
           'entrega_id', e.id, 'numero_vale', e.numero_vale,
           'status_entrega', e.status_entrega, 'corrida_id', e.corrida_id,
           'motivo', case
             when e.tenant_id <> v_tenant then 'outro_tenant'
             when e.loja_id <> p_loja_id then 'outra_filial'
             when e.corrida_id is not null then 'ja_em_corrida'
             else 'status_nao_permite'
           end))
    into v_conflitos
    from public.entregas e
   where e.id = any(p_entrega_ids)
     and (e.tenant_id <> v_tenant
       or e.loja_id <> p_loja_id
       or e.corrida_id is not null
       or e.status_entrega <> 'pendente');

  -- Vale que sumiu do banco também é conflito, não "some da lista".
  if (select count(*) from public.entregas e where e.id = any(p_entrega_ids))
     <> array_length(p_entrega_ids, 1) then
    v_conflitos := coalesce(v_conflitos, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('motivo', 'vale_inexistente'));
  end if;

  if v_conflitos is not null then
    return public.registrar_conflito_romaneio(
      p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
      p_ocorrido_em_local, p_modo, p_ip, p_geolocalizacao, v_conflitos,
      p_entrega_ids, p_caixa_strokes, p_motoboy_strokes);
  end if;

  -- ---- o hash tem que bater com o que foi assinado --------------------
  -- Recalculado a partir do BANCO, não do que o cliente mandou. É isso
  -- que faz o hash significar alguma coisa: se o conteúdo do vale mudou
  -- entre assinar e selar, os bytes mudam e a assinatura não vale mais.
  v_canonico := public.romaneio_canonico(v_tenant, p_loja_id, p_agencia_id,
                                         p_motoboy_id, p_caixa_id, p_entrega_ids);
  v_hash := encode(digest(v_canonico, 'sha256'), 'hex');

  if v_hash <> p_document_hash then
    return public.registrar_conflito_romaneio(
      p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
      p_ocorrido_em_local, p_modo, p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'documento_alterado',
        'hash_assinado', p_document_hash, 'hash_atual', v_hash)),
      p_entrega_ids, p_caixa_strokes, p_motoboy_strokes);
  end if;

  -- ---- consome a autorização ------------------------------------------
  -- Uso único, prazo curto e amarrada ao document_hash, tudo na mesma
  -- cláusula: se qualquer uma falhar, zero linhas e a saída é recusada.
  update public.motoboy_autorizacoes a
     set consumida_em = v_agora, consumida_por_romaneio = p_romaneio_id
   where a.id = p_autorizacao_id
     and a.tenant_id = v_tenant
     and a.motoboy_id = p_motoboy_id
     and a.document_hash = p_document_hash
     and a.consumida_em is null
     and a.expira_em > v_agora
  returning a.credencial_id into v_credencial_id;

  if v_credencial_id is null then
    raise exception 'Autorização inválida, expirada, já usada ou de outro documento.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- ORDEM DAQUI PRA BAIXO IMPORTA ----------------------------------
  -- corrida → vales em rota → romaneio → vínculo → assinaturas.
  --
  -- O UPDATE dos vales tem que acontecer ANTES de existir romaneio_entregas
  -- ou assinatura, senão o trigger de imutabilidade (seção 9) vê o
  -- documento já selado e barra o próprio selo — a saída falharia sempre,
  -- e o erro apontaria pro lugar errado. Mesma armadilha que o código
  -- antigo de criarCorridaComAssinatura já contornava.
  insert into public.corridas
    (id, tenant_id, loja_id, mototaxista_id, agencia_id, status,
     saida_por, saida_em_local)
  values
    (p_corrida_id, v_tenant, p_loja_id, p_motoboy_id, p_agencia_id, 'aberta',
     p_caixa_id, p_ocorrido_em_local);

  update public.entregas
     set corrida_id = p_corrida_id, status_entrega = 'em_rota'
   where id = any(p_entrega_ids);

  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, status, modo, payload, canonico,
     document_hash, ocorrido_em_local, selado_em, criado_por, ip, geolocalizacao)
  values
    (p_romaneio_id, v_tenant, p_loja_id, p_corrida_id, 'selado', p_modo,
     public.romaneio_payload(p_loja_id, p_agencia_id, p_motoboy_id, p_caixa_id, p_entrega_ids),
     v_canonico, v_hash, p_ocorrido_em_local, v_agora, p_caixa_id,
     p_ip, p_geolocalizacao)
  returning numero into v_numero;

  foreach v_entrega_id in array p_entrega_ids loop
    insert into public.romaneio_entregas (romaneio_id, entrega_id, tenant_id, ordem)
    values (p_romaneio_id, v_entrega_id, v_tenant, v_ordem);
    v_ordem := v_ordem + 1;
  end loop;

  -- ---- assinaturas -----------------------------------------------------
  -- signature_hash amarra documento + quem assinou + os traços + o
  -- relógio do servidor + como autenticou. Trocar qualquer um muda o
  -- hash. `strokes::text` serve de forma canônica de graça: jsonb já
  -- ordena chave e normaliza número.
  --
  -- `hash_sha256` (coluna do schema inicial, not null) recebe o mesmo
  -- signature_hash. Ela existia pra guardar "o hash desta assinatura" e
  -- continua sendo isso — só que agora o hash cobre bem mais coisa.
  v_hash_caixa := encode(digest(
    v_hash || '|caixa|' || p_caixa_id::text || '|' || p_caixa_strokes::text
           || '|' || v_agora::text || '|sessao_autenticada', 'sha256'), 'hex');

  v_hash_motoboy := encode(digest(
    v_hash || '|motoboy|' || p_motoboy_id::text || '|' || p_motoboy_strokes::text
           || '|' || v_agora::text || '|' || p_modo, 'sha256'), 'hex');

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, strokes, hash_sha256,
     user_id, auth_method, document_hash, signature_hash, assinado_em_local,
     ip, geolocalizacao)
  values
    (v_tenant, p_corrida_id, p_romaneio_id, 'caixa', p_caixa_strokes, v_hash_caixa,
     p_caixa_id, 'sessao_autenticada', v_hash, v_hash_caixa, p_ocorrido_em_local,
     p_ip, p_geolocalizacao);

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, strokes, hash_sha256,
     motoboy_id, credencial_id, autorizacao_id, auth_method, document_hash,
     signature_hash, assinado_em_local, ip, geolocalizacao)
  values
    (v_tenant, p_corrida_id, p_romaneio_id, 'motoboy', p_motoboy_strokes, v_hash_motoboy,
     p_motoboy_id, v_credencial_id, p_autorizacao_id,
     case p_modo when 'online' then 'physical_card_pin_server_verified'
                 else 'physical_card_pin_offline_then_verified' end,
     v_hash, v_hash_motoboy, p_ocorrido_em_local, p_ip, p_geolocalizacao);

  v_final := encode(digest(v_hash || '|' || v_hash_caixa || '|' || v_hash_motoboy,
                           'sha256'), 'hex');
  update public.romaneios set final_hash = v_final where id = p_romaneio_id;

  insert into public.eventos (tenant_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
  values (v_tenant, p_corrida_id, 'romaneio_selado',
          jsonb_build_object('romaneio_id', p_romaneio_id, 'numero', v_numero,
                             'modo', p_modo, 'vales', array_length(p_entrega_ids, 1),
                             'final_hash', v_final),
          p_caixa_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', true, 'ja_existia', false,
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'document_hash', v_hash, 'final_hash', v_final);
end;
$$;

-- Não é exposta: quem a alcançasse escolheria de quem é a saída.
revoke all on function public.selar_romaneio_interno(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid, jsonb, jsonb,
  timestamptz, text, inet, jsonb
) from public, anon, authenticated;


-- A porta ONLINE. A identidade do caixa sai do JWT, nunca do parâmetro.
create or replace function public.selar_romaneio(
  p_romaneio_id uuid, p_corrida_id uuid, p_loja_id uuid, p_agencia_id uuid,
  p_motoboy_id uuid, p_entrega_ids uuid[], p_document_hash text,
  p_autorizacao_id uuid, p_caixa_strokes jsonb, p_motoboy_strokes jsonb,
  p_ocorrido_em_local timestamptz, p_geolocalizacao jsonb default null
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_ip inet;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = 'insufficient_privilege';
  end if;

  -- O IP não pode vir do cliente (ele diria o que quisesse). O PostgREST
  -- expõe os cabeçalhos da requisição como GUC; se não vier, ou se vier
  -- em formato que não é IP, fica nulo — registrar nulo é honesto,
  -- inventar não é.
  begin
    v_ip := trim(split_part(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1
    ))::inet;
  exception when others then
    v_ip := null;
  end;

  return public.selar_romaneio_interno(
    auth.uid(), p_romaneio_id, p_corrida_id, p_loja_id, p_agencia_id,
    p_motoboy_id, p_entrega_ids, p_document_hash, p_autorizacao_id,
    p_caixa_strokes, p_motoboy_strokes, p_ocorrido_em_local, 'online',
    v_ip, p_geolocalizacao);
end;
$$;

revoke all on function public.selar_romaneio(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid, jsonb, jsonb, timestamptz, jsonb
) from public, anon;
grant execute on function public.selar_romaneio(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid, jsonb, jsonb, timestamptz, jsonb
) to authenticated;


-- =====================================================================
-- 9. IMUTABILIDADE ALARGADA
--
-- A regra 7 do CLAUDE.md dizia "valor, cliente e vale congelam". Com o
-- romaneio, o que congela é TUDO que entrou no canônico — senão o
-- documento afirma uma coisa e a linha diz outra, e o hash denuncia sem
-- explicar o que houve.
--
-- O que continua mudando: os três eixos de status, observações, motivo
-- de insucesso e a custódia de papel. Nada disso entra no hash, porque
-- nada disso descreve o que saiu — descreve o que aconteceu depois.
-- =====================================================================

create or replace function public.fn_entrega_imutavel()
returns trigger language plpgsql set search_path = public as $$
declare
  v_congelada boolean;
begin
  select exists (
    select 1 from public.romaneio_entregas re
      join public.romaneios r on r.id = re.romaneio_id
     where re.entrega_id = old.id and r.status = 'selado'
  ) or (old.corrida_id is not null and exists (
    -- Caminho legado: as assinaturas anteriores ao romaneio. Elas não têm
    -- documento, mas congelam a entrega do mesmo jeito.
    select 1 from public.assinaturas a where a.corrida_id = old.corrida_id
  )) into v_congelada;

  if not v_congelada then
    return new;
  end if;

  if new.numero_vale                 is distinct from old.numero_vale
  or new.cliente_nome                is distinct from old.cliente_nome
  or new.cliente_endereco            is distinct from old.cliente_endereco
  or new.valor_compra_cents          is distinct from old.valor_compra_cents
  or new.valor_entrega_cents         is distinct from old.valor_entrega_cents
  or new.quantidade_vales            is distinct from old.quantidade_vales
  or new.entrega_paga_cliente_cents  is distinct from old.entrega_paga_cliente_cents
  or new.tipo                        is distinct from old.tipo
  or new.loja_id                     is distinct from old.loja_id
  or new.loja_origem_id              is distinct from old.loja_origem_id
  or new.convenio_id                 is distinct from old.convenio_id
  or new.corrida_id                  is distinct from old.corrida_id
  then
    raise exception
      'Vale % está num romaneio selado: o que foi assinado não muda. Registre um evento de correção.',
      old.numero_vale using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
