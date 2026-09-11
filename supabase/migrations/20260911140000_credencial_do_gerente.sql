-- =====================================================================
-- 4B.1 — a credencial do gerente
--
-- Etapa 1 do desenho em `docs/desenho-4b-2026-09-11.md` (versão 2). Aqui
-- a credencial física deixa de ser só do motoboy: o GERENTE da filial
-- passa a poder ter um cartão próprio, com o PIN dele, para autorizar a
-- saída e o retorno quando o motoboy perdeu o cartão ou esqueceu o PIN.
--
-- ESTA MIGRATION NÃO AUTORIZA NADA AINDA, E ISSO É DE PROPÓSITO. Ela
-- emite, identifica, autentica, revoga, redefine e audita o cartão do
-- gerente — e só. A amarração com o Romaneio (autorização de uso único
-- com motivo e validador) é a 4B.2, e até lá um cartão de gerente
-- apresentado numa saída é RECUSADO pelo selo, porque
-- `selar_romaneio_sincronizado` compara o `motoboy_id` da credencial com
-- o do documento e o do gerente é nulo. Recusar é o comportamento certo
-- enquanto o outro lado não existe: o que não pode é selar documento
-- afirmando uma validação que ninguém desenhou ainda.
--
--
-- POR QUE UMA TABELA SÓ, E NÃO UMA SEGUNDA
--
-- O cartão do gerente usa o mesmo formato de token v3, o mesmo HMAC, o
-- mesmo bcrypt, o mesmo bloqueio progressivo, a mesma revogação e a mesma
-- redefinição. Uma segunda tabela duplicaria justamente a parte que este
-- projeto já sabe que é cara quando tem gêmeo — e criaria dois lugares
-- para consertar quando o bloqueio ou o formato mudarem.
--
-- O nome `motoboy_credenciais` FICA. Renomear mexeria em FK, grant,
-- policy e nas funções de selo por um ganho só de vocabulário, e o 4B já
-- reabre essas funções na 4B.2 por motivo de verdade.
--
--
-- AS TRÊS LEITURAS QUE DEGRADAVAM EM SILÊNCIO
--
-- Medido no código antes de escrever esta migration, e é a razão de ela
-- mexer em três funções e não só no schema:
--
--   identificar_credencial  `join mototaxistas` + `m.ativo` → o cartão do
--                           gerente devolveria ZERO LINHAS, resposta
--                           idêntica a "este cartão não existe"
--   log_credencial          mesmo join → o contexto sairia nulo e a
--                           auditoria cairia no fallback com só o
--                           `credencial_id`: sem nome, sem public_id
--   cache offline           `mototaxistas(nome, agencia_id, …)` → bloco
--                           nulo (isso é cliente, e sai na 4B.1b)
--
-- Nenhuma das três daria erro. Todas mentiriam baixinho, que é o modo de
-- falha mais caro deste projeto.
--
--
-- O QUE NÃO MUDA
--
-- `token_hash` e `pin_hash` continuam fora do `grant select` — é o GRANT
-- que protege coluna, não a policy. Não há grant de INSERT/UPDATE/DELETE:
-- toda escrita continua passando por função SECURITY DEFINER. O bloqueio
-- progressivo, o `pin_aceitavel`, o parser do token e o `definir_pin`
-- (que exige sessão, e por isso criar PIN é ONLINE por construção) valem
-- igual para os dois titulares, sem uma linha nova.
-- =====================================================================


-- =====================================================================
-- 0. PRÉ-VOO — para nada aqui rodar sobre um banco diferente do que eu li
--
-- Duas asserções, e a segunda é a que evita o pior acidente: mudar o tipo
-- de retorno de `identificar_credencial` exige DROP. Se alguém já tiver
-- criado uma sobrecarga dela, um `create or replace` deixaria DUAS
-- funções com o mesmo nome e o PostgREST passaria a recusar a chamada por
-- ambiguidade — erro que aparece longe daqui.
-- =====================================================================

do $$
declare
  v_nulavel text;
  v_ja_tem  boolean;
  v_funcoes int;
  v_orfas   int;
begin
  select is_nullable into v_nulavel
    from information_schema.columns
   where table_schema = 'public' and table_name = 'motoboy_credenciais'
     and column_name = 'motoboy_id';

  if v_nulavel is null then
    raise exception 'Tabela motoboy_credenciais não encontrada. Banco errado?';
  end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'motoboy_credenciais'
       and column_name = 'profile_id'
  ) into v_ja_tem;

  if v_ja_tem then
    raise exception 'profile_id já existe — esta migration já foi aplicada.';
  end if;

  select count(*) into v_funcoes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'identificar_credencial';

  if v_funcoes <> 1 then
    raise exception 'Esperava exatamente 1 identificar_credencial, achei %.', v_funcoes;
  end if;

  -- Toda credencial de hoje é de motoboy. Se isso não valer, o CHECK lá
  -- embaixo falharia no meio da migration, e é melhor saber agora.
  select count(*) into v_orfas
    from public.motoboy_credenciais where motoboy_id is null;

  if v_orfas > 0 then
    raise exception '% credenciais sem motoboy_id — investigar antes.', v_orfas;
  end if;

  raise notice 'Pré-voo OK. Credenciais hoje: % ativas, % no total.',
    (select count(*) from public.motoboy_credenciais where ativo),
    (select count(*) from public.motoboy_credenciais);
end $$;


-- =====================================================================
-- 1. SCHEMA — dois tipos de titular, exatamente um por linha
--
-- `num_nonnulls` é o jeito curto de dizer "um e só um": ele recusa tanto
-- a linha sem titular nenhum quanto a que apontasse para um motoboy E um
-- gerente ao mesmo tempo, que seria um cartão de identidade ambígua.
--
-- O CHECK garante a FORMA. Ele não garante que o profile é gerente, que
-- está ativo e que tem filial — isso é da emissão, logo abaixo, porque
-- depende de estado que muda depois (alguém deixa de ser gerente sem que
-- o cartão dele deixe de existir; quem trata disso é o selo, na 4B.2).
-- =====================================================================

alter table public.motoboy_credenciais
  alter column motoboy_id drop not null;

alter table public.motoboy_credenciais
  add column profile_id uuid references public.profiles(id);

alter table public.motoboy_credenciais
  add constraint motoboy_credenciais_um_titular
  check (num_nonnulls(motoboy_id, profile_id) = 1);

-- Espelha `motoboy_credenciais_um_ativo`: um cartão ativo por gerente,
-- para "revogar o perdido" continuar sendo operação sem ambiguidade.
create unique index motoboy_credenciais_um_ativo_gerente
  on public.motoboy_credenciais (profile_id)
  where ativo;

create index on public.motoboy_credenciais (tenant_id, profile_id);

-- O grant é por coluna e por isso a nova precisa ser citada: sem esta
-- linha o cliente não enxerga de quem é o cartão, e o `select` dele
-- voltaria permission denied — alto, não em silêncio, como sempre.
grant select (profile_id) on public.motoboy_credenciais to authenticated;


-- =====================================================================
-- 2. AUDITORIA — a linha precisa dizer de quem é o cartão
--
-- `join` virou `left join` nos dois lados. A chave `motoboy_nome` fica
-- para o cartão de motoboy: ela está em eventos já gravados e a tela lê
-- por ela hoje. As chaves novas (`titular_tipo`, `titular_nome`) são o
-- que o cliente passa a ler, com `motoboy_nome` como resposta antiga.
--
-- Continua valendo a regra de sempre: PIN nenhum entra em payload —
-- nem o digitado, nem o hash.
-- =====================================================================

create or replace function public.log_credencial(
  p_tenant_id uuid, p_credencial_id uuid, p_tipo text, p_payload jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_contexto jsonb;
begin
  select jsonb_build_object(
           'credencial_id', c.id,
           'public_id',     c.public_id,
           'titular_tipo',  (case when c.motoboy_id is not null then 'motoboy' else 'gerente' end)::text,
           'titular_nome',  coalesce(m.nome, p.nome)
         )
         -- Só para o cartão de motoboy, e por compatibilidade: é a chave
         -- que os eventos antigos têm e que a tela lê hoje.
         || case when c.motoboy_id is not null
                 then jsonb_build_object('motoboy_nome', m.nome)
                 else '{}'::jsonb
            end
    into v_contexto
    from public.motoboy_credenciais c
    left join public.mototaxistas m on m.id = c.motoboy_id
    left join public.profiles     p on p.id = c.profile_id
   where c.id = p_credencial_id;

  insert into public.eventos (tenant_id, tipo, payload, user_id)
  values (
    p_tenant_id, p_tipo,
    coalesce(p_payload, '{}'::jsonb)
      || coalesce(v_contexto, jsonb_build_object('credencial_id', p_credencial_id)),
    auth.uid()
  );
end;
$$;

revoke all on function public.log_credencial(uuid, uuid, text, jsonb)
  from public, anon, authenticated;


-- =====================================================================
-- 3. EMISSÃO — um gerador só, dois validadores
--
-- A parte que sorteia o token, revoga o cartão anterior do mesmo titular,
-- insere e audita é UMA função. Se ela fosse copiada para o gerente, o
-- projeto ganharia um gêmeo onde não precisa: no dia em que o formato do
-- token mudar de novo (já mudou duas vezes), um dos dois lados ficaria
-- para trás, e o sintoma seria um cartão que a gráfica imprime e o leitor
-- não reconhece.
--
-- O que difere entre os dois é só QUEM PODE RECEBER, e isso fica em cada
-- porta pública.
-- =====================================================================

create or replace function public.emitir_credencial_interno(
  p_tenant_id uuid, p_motoboy_id uuid, p_profile_id uuid
)
returns table (credencial_id uuid, public_id text, token text)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_public_id text;
  v_token text;
  v_id uuid;
begin
  if num_nonnulls(p_motoboy_id, p_profile_id) <> 1 then
    raise exception 'Credencial precisa de exatamente um titular.'
      using errcode = 'check_violation';
  end if;

  -- Emitir cartão novo revoga o anterior daquele titular: é o fluxo do
  -- cartão perdido, e o índice parcial garante a invariante.
  update public.motoboy_credenciais
     set ativo = false, revogado_em = now(), revogado_por = auth.uid()
   where ativo
     and tenant_id = p_tenant_id
     and (motoboy_id = p_motoboy_id or profile_id = p_profile_id);

  loop
    v_public_id := public.gerar_digitos(6);
    exit when not exists (
      select 1 from public.motoboy_credenciais c where c.public_id = v_public_id
    );
  end loop;

  v_token := '3' || v_public_id || public.gerar_digitos(15);

  insert into public.motoboy_credenciais
    (tenant_id, motoboy_id, profile_id, public_id, token_hash, emitido_por)
  values
    (p_tenant_id, p_motoboy_id, p_profile_id, v_public_id,
     public.hash_do_token(v_token), auth.uid())
  returning id into v_id;

  -- O nome do titular não vem por parâmetro: quem o resolve é
  -- `log_credencial`, lendo a linha que acabou de ser inserida. Passá-lo
  -- daqui criaria duas fontes para o mesmo fato.
  perform public.log_credencial(p_tenant_id, v_id, 'credencial_emitida',
    jsonb_build_object('public_id', v_public_id));

  return query select v_id, v_public_id, v_token;
end;
$$;

revoke all on function public.emitir_credencial_interno(uuid, uuid, uuid)
  from public, anon, authenticated;


create or replace function public.emitir_credencial(p_motoboy_id uuid)
returns table (credencial_id uuid, public_id text, token text)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_motoboy record;
begin
  if v_tenant is null or not public.is_admin() then
    raise exception 'Só administrador emite credencial.'
      using errcode = 'insufficient_privilege';
  end if;

  select m.id, m.ativo into v_motoboy
    from public.mototaxistas m
   where m.id = p_motoboy_id and m.tenant_id = v_tenant;

  if v_motoboy.id is null then
    raise exception 'Motoboy não encontrado neste tenant.' using errcode = 'no_data_found';
  end if;
  if not v_motoboy.ativo then
    raise exception 'Motoboy inativo não recebe credencial.' using errcode = 'check_violation';
  end if;

  return query select * from public.emitir_credencial_interno(v_tenant, p_motoboy_id, null);
end;
$$;

revoke all on function public.emitir_credencial(uuid) from public, anon;
grant execute on function public.emitir_credencial(uuid) to authenticated;


-- =====================================================================
-- 3.1 EMISSÃO PARA O GERENTE
--
-- Três recusas, e cada uma existe por um motivo diferente:
--
--   papel <> 'gerente'   caixa não autoriza exceção, e admin não opera
--                        balcão (ver "E10" no CLAUDE.md). Um cartão
--                        emitido para eles seria uma autorização que o
--                        desenho não prevê, esperando alguém usar
--   inativo              cartão para conta bloqueada é cartão que
--                        continua valendo depois do desligamento
--   sem filial           a exceção é conferida contra a FILIAL DO
--                        DOCUMENTO, na 4B.2. Gerente sem filial nunca
--                        casaria com documento nenhum: o cartão seria
--                        emitido e inútil, e a descoberta viria no balcão
--                        com o motoboy esperando
--
-- A última não deveria acontecer — o CHECK `profiles_filial_obrigatoria`
-- (passo 2) já exige filial de caixa e gerente. Ela cobre o admin legado
-- que for promovido a gerente por UPDATE direto, e custa uma linha.
-- =====================================================================

create or replace function public.emitir_credencial_de_gerente(p_profile_id uuid)
returns table (credencial_id uuid, public_id text, token text)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_perfil record;
begin
  if v_tenant is null or not public.is_admin() then
    raise exception 'Só administrador emite credencial.'
      using errcode = 'insufficient_privilege';
  end if;

  select p.id, p.papel, p.ativo, p.loja_id into v_perfil
    from public.profiles p
   where p.id = p_profile_id and p.tenant_id = v_tenant;

  if v_perfil.id is null then
    raise exception 'Usuário não encontrado neste tenant.' using errcode = 'no_data_found';
  end if;
  if v_perfil.papel <> 'gerente' then
    raise exception 'Cartão de autorização é só para gerente. Este usuário é %.', v_perfil.papel
      using errcode = 'check_violation';
  end if;
  if not v_perfil.ativo then
    raise exception 'Usuário bloqueado não recebe credencial.' using errcode = 'check_violation';
  end if;
  if v_perfil.loja_id is null then
    raise exception 'Gerente sem filial não recebe credencial: a autorização é conferida contra a filial do documento.'
      using errcode = 'check_violation';
  end if;

  return query select * from public.emitir_credencial_interno(v_tenant, null, p_profile_id);
end;
$$;

revoke all on function public.emitir_credencial_de_gerente(uuid) from public, anon;
grant execute on function public.emitir_credencial_de_gerente(uuid) to authenticated;


-- =====================================================================
-- 4. IDENTIFICAR — o "bipar", agora com dois tipos de titular
--
-- DROP antes do CREATE porque o tipo de retorno muda, e `create or
-- replace` não altera tipo de retorno: ou falha, ou (com assinatura
-- diferente) cria uma segunda função e o PostgREST passa a recusar por
-- ambiguidade.
--
-- As colunas antigas FICAM, com os mesmos nomes. É o que permite aplicar
-- esta migration antes de publicar o cliente novo: o de hoje continua
-- lendo `motoboy_id`/`motoboy_nome` e funcionando para cartão de motoboy,
-- que é o único que existe até alguém emitir o primeiro de gerente.
--
-- Continua respondendo só "quem é", nunca "é ele" — e continua sem mexer
-- em `tentativas_pin`, senão daria para bloquear o cartão de alguém só
-- passando cartão errado.
-- =====================================================================

drop function public.identificar_credencial(text);

create function public.identificar_credencial(p_token text)
returns table (
  credencial_id  uuid,
  public_id      text,
  titular_tipo   text,
  motoboy_id     uuid,
  motoboy_nome   text,
  agencia_id     uuid,
  agencia_nome   text,
  profile_id     uuid,
  titular_nome   text,
  loja_id        uuid,
  loja_nome      text,
  tem_pin        boolean,
  bloqueado_ate  timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_public_id text := public.public_id_do_token(p_token);
begin
  if v_tenant is null then
    raise exception 'Sessão sem tenant.' using errcode = 'insufficient_privilege';
  end if;

  -- Formato irreconhecível: zero linhas, mesma resposta de "não existe".
  if v_public_id is null then
    return;
  end if;

  return query
    select c.id,
           c.public_id,
           (case when c.motoboy_id is not null then 'motoboy' else 'gerente' end)::text,
           m.id, m.nome,
           a.id, a.nome,
           p.id,
           coalesce(m.nome, p.nome),
           l.id, l.nome,
           c.tem_pin, c.bloqueado_ate
      from public.motoboy_credenciais c
      left join public.mototaxistas m on m.id = c.motoboy_id
      left join public.agencias     a on a.id = m.agencia_id
      left join public.profiles     p on p.id = c.profile_id
      left join public.lojas        l on l.id = p.loja_id
     where c.public_id = v_public_id
       and c.tenant_id = v_tenant
       and c.ativo
       and c.token_hash = public.hash_do_token(p_token)
       -- Titular desligado não é identificado, e a regra é a mesma dos
       -- dois lados: era `m.ativo` antes, e continua sendo — agora
       -- somando `p.ativo` e o cargo, porque um ex-gerente com o cartão
       -- na mão não autoriza exceção nenhuma.
       and (
         (c.motoboy_id is not null and m.ativo)
         or (c.profile_id is not null and p.ativo and p.papel = 'gerente')
       );
end;
$$;

revoke all on function public.identificar_credencial(text) from public, anon;
grant execute on function public.identificar_credencial(text) to authenticated;


-- =====================================================================
-- CONFERÊNCIAS — rodar no SQL Editor depois de aplicar
--
-- Nenhuma delas emite cartão de verdade: a emissão real é pela tela, na
-- 4B.1b, porque o token aparece UMA vez e o lugar dele é a credencial
-- impressa, não o resultado de uma consulta.
--
--
-- (a) schema: coluna nulável, titular único, índices e grant
--
--   select column_name, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'motoboy_credenciais'
--      and column_name in ('motoboy_id','profile_id')
--    order by column_name;
--   -- esperado: motoboy_id YES, profile_id YES
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.motoboy_credenciais'::regclass
--      and conname = 'motoboy_credenciais_um_titular';
--   -- esperado: check (num_nonnulls(motoboy_id, profile_id) = 1)
--
--   select indexname from pg_indexes
--    where tablename = 'motoboy_credenciais'
--      and indexname like '%um_ativo%'
--    order by indexname;
--   -- esperado: motoboy_credenciais_um_ativo e _um_ativo_gerente
--
--   select count(*) from information_schema.column_privileges
--    where table_name = 'motoboy_credenciais' and grantee = 'authenticated'
--      and column_name in ('profile_id','token_hash','pin_hash');
--   -- esperado: 1 — só profile_id. Os dois hashes continuam FORA.
--
--
-- (b) o CHECK recusa linha sem titular e linha com os dois
--
--   do $conf$
--   declare v_erro text;
--   begin
--     begin
--       insert into public.motoboy_credenciais (tenant_id, public_id, token_hash)
--       select t.id, 'X00001', 'x' from public.tenants t limit 1;
--       raise exception 'FALHOU: aceitou credencial sem titular.';
--     exception when check_violation then
--       raise notice 'OK: sem titular recusado.';
--     end;
--     begin
--       insert into public.motoboy_credenciais
--         (tenant_id, motoboy_id, profile_id, public_id, token_hash)
--       select c.tenant_id, c.motoboy_id, p.id, 'X00002', 'x'
--         from public.motoboy_credenciais c, public.profiles p
--        where c.motoboy_id is not null limit 1;
--       raise exception 'FALHOU: aceitou dois titulares na mesma linha.';
--     exception when check_violation then
--       raise notice 'OK: dois titulares recusado.';
--     end;
--   end $conf$;
--   -- esperado: os dois "OK". Nada é inserido: a exceção desfaz tudo.
--
--
-- (c) a emissão recusa quem não é gerente — com a sessão de um admin real
--
--   select set_config('request.jwt.claims',
--     json_build_object('sub', (select id from public.profiles
--                                where papel = 'admin' and ativo limit 1))::text,
--     true);
--
--   do $conf$
--   declare v_alvo uuid; v_msg text;
--   begin
--     for v_alvo in
--       select id from public.profiles where papel in ('caixa','admin') and ativo limit 2
--     loop
--       begin
--         perform public.emitir_credencial_de_gerente(v_alvo);
--         raise exception 'FALHOU: emitiu cartão para quem não é gerente.';
--       exception when check_violation then
--         get stacked diagnostics v_msg = message_text;
--         raise notice 'OK: recusado — %', v_msg;
--       end;
--     end loop;
--   end $conf$;
--   -- esperado: um "OK: recusado — Cartão de autorização é só para
--   -- gerente…" por usuário testado.
--
--
-- (d) identificar continua respondendo, e sem exceção, a lixo
--
--   select count(*) from public.identificar_credencial('3' || repeat('7', 21));
--   -- esperado: 0 (zero linhas, nenhum erro)
--
--   select count(*) from public.identificar_credencial('nao-e-um-token');
--   -- esperado: 0
--
--
-- (e) auditoria: os eventos antigos continuam legíveis, e os novos dizem
--     o titular
--
--   select tipo, payload->>'titular_tipo' as titular_tipo,
--          payload->>'titular_nome' as titular_nome,
--          payload->>'motoboy_nome' as motoboy_nome
--     from public.eventos
--    where tipo like 'credencial%'
--    order by ocorrido_em desc limit 5;
--   -- esperado: os ANTIGOS com titular_tipo nulo e motoboy_nome
--   -- preenchido (payload é congelado, e reescrevê-lo seria inventar
--   -- passado); os novos, com as três colunas.
--
--
-- (f) nada de documento se moveu — o placar tem que repetir a última
--     medição (22 · 22 · 0 no TOTAL, medida em 2026-09-11)
--
--   select * from public.verificar_integridade_resumo();
--
--   Esta migration não encosta em romaneio, assinatura nem hash, então o
--   número tem que ser o MESMO. Diferente dele, pare aqui: alguma outra
--   coisa mudou junto, e descobrir agora custa muito menos.
-- =====================================================================
