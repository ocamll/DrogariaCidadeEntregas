-- =====================================================================
-- RETORNO_RELATOS — "o que aconteceu?", fora dos bytes assinados
--
-- Decidido com o usuário em 2026-09-14/15 (NOTAS 111, versão 2): quando
-- um item do retorno DIVERGE — pagamento diferente do previsto, ou
-- documento declarado faltante —, quem confirma escreve o que aconteceu
-- ou marca "precisa apurar". Confirmado em 2026-09-15.
--
-- ---------------------------------------------------------------------
-- POR QUE TABELA PRÓPRIA, E NÃO UMA COLUNA NO DCRR1
-- ---------------------------------------------------------------------
-- O relato é declaração do BALCÃO sobre uma diferença — não é fato que o
-- motoboy confirma com cartão e PIN. Pô-lo dentro de `p_retorno` faria
-- ele parecer conteúdo assinado por quem devolveu a corrida, que nunca
-- viu esse texto. Por isso ele viaja num parâmetro PRÓPRIO no selo
-- (`p_relatos`, na migration seguinte) e mora numa tabela própria,
-- fora do `canonico` e fora do `document_hash`.
--
-- ---------------------------------------------------------------------
-- AS DUAS REGRAS QUE DECIDEM O QUE ENTRA AQUI
-- ---------------------------------------------------------------------
--   relato sem diferença   o selo recusa a operação INTEIRA — é bug de
--                          tela, nunca decisão de negócio (migration
--                          seguinte)
--   diferença sem relato   o selo ACEITA. A obrigatoriedade é cobrada na
--                          TELA, antes de congelar — recusar depois de
--                          cartão, PIN e duas assinaturas por causa de uma
--                          nota FORA do documento seria pior. Ausência de
--                          linha aqui, para um item que diverge, já
--                          significa "sem relato" — nenhuma coluna extra
--                          precisa disso.
--
-- ---------------------------------------------------------------------
-- QUEM ESCREVE, QUEM LÊ
-- ---------------------------------------------------------------------
-- Só o selo (SECURITY DEFINER) escreve — nenhum grant de insert/update/
-- delete para authenticated, RLS habilitada sem policy de escrita.
-- Leitura: gerente (própria filial) e admin (todas). O caixa não lê —
-- quem recebe o papel de volta lê pela aba Documentos existente; o
-- relato é acompanhamento de gestão.
-- =====================================================================

create table public.retorno_relatos (
  -- uuidv7 do CLIENTE (regra 5) — é o que dá idempotência ao reenvio da
  -- fila offline via `on conflict (id) do nothing`, mesmo padrão de
  -- `pagamentoId`.
  id                  uuid primary key,
  tenant_id           uuid not null references public.tenants(id),
  loja_id             uuid not null references public.lojas(id),
  romaneio_retorno_id uuid not null references public.romaneios(id),
  entrega_id          uuid not null references public.entregas(id),
  natureza            text not null check (natureza in ('pagamento', 'documento')),
  -- null quando natureza = 'pagamento' — ver o CHECK abaixo. Domínio
  -- igual ao do bloco `d` do DCRR1 (`TIPOS_DOCUMENTO_FISICO`).
  tipo_documento      text check (tipo_documento in ('convenio', 'crediario', 'receita')),
  situacao            text not null check (situacao in ('relatado', 'precisa_apurar')),
  relato              text check (char_length(relato) <= 1000),
  autor_id            uuid not null references public.profiles(id),
  ocorrido_em_local   timestamptz not null,
  registrado_em       timestamptz not null default now(),
  constraint documento_tem_tipo check ((natureza = 'documento') = (tipo_documento is not null)),
  constraint relatado_tem_texto check (situacao <> 'relatado' or btrim(coalesce(relato, '')) <> '')
);

-- Um relato por item — o par (romaneio_retorno_id, entrega_id, natureza,
-- tipo_documento). `coalesce(tipo_documento, '')` porque `unique` não
-- trata dois NULLs como iguais, e dois relatos de pagamento pro mesmo
-- vale têm tipo_documento nulo nos dois.
create unique index retorno_relatos_um_por_item
  on public.retorno_relatos (romaneio_retorno_id, entrega_id, natureza, coalesce(tipo_documento, ''));

-- Escopo por filial: o mesmo índice que toda tabela filha de romaneios
-- já usa pra resolver "quem pode ver".
create index on public.retorno_relatos (tenant_id, loja_id);

alter table public.retorno_relatos enable row level security;

-- Nasce com tudo liberado por causa do `alter default privileges` do
-- Supabase — revoke explícito é obrigatório, não decorativo.
revoke all on public.retorno_relatos from anon, authenticated;
grant select on public.retorno_relatos to authenticated;

create policy retorno_relatos_select on public.retorno_relatos
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (public.is_admin()
         or (public.current_papel() = 'gerente' and loja_id = public.current_loja_id()))
  );

-- Nenhuma policy de insert/update/delete: SECURITY DEFINER ignora RLS, e
-- é o único escritor. `revoke all` acima já fecha a porta pro cliente
-- mesmo que uma policy frouxa aparecesse aqui por engano no futuro.


-- =====================================================================
-- CONFERIR DEPOIS DE APLICAR
--
-- (a) a tabela nasceu vazia, com RLS e sem grant de escrita:
--
--   select count(*) from public.retorno_relatos;
--   -- esperado: 0
--
--   select has_table_privilege('authenticated', 'public.retorno_relatos', 'insert') as pode_inserir,
--          has_table_privilege('authenticated', 'public.retorno_relatos', 'select') as pode_ler;
--   -- esperado: false, true
--
-- (b) a policy de leitura existe:
--
--   select policyname from pg_policies where tablename = 'retorno_relatos';
--   -- esperado: retorno_relatos_select
-- =====================================================================
