-- =====================================================================
-- Credencial física do motoboy: cartão + PIN
--
-- Etapa 2 da cadeia de custódia. Ainda NÃO toca em corrida nenhuma —
-- emite, identifica, autentica, revoga e redefine, e só. A amarração com
-- o Romaneio (autorização de uso único ligada ao document_hash) é a
-- etapa 3, quando o documento existir pra amarrar.
--
--   CARTÃO → quem é?      identifica a credencial física
--   PIN    → é ele mesmo? autentica a pessoa
--
-- As duas coisas são separadas de propósito, e o cartão NUNCA carrega o
-- PIN — nem em claro, nem cifrado.
--
--
-- POR QUE COLUMN GRANT, E NÃO SÓ RLS
--
-- Este projeto já aprendeu duas vezes que **RLS não restringe coluna**
-- (foi a lição de `profiles` e a da conferência do fechamento). A
-- conclusão de lá era "então põe num trigger". Aqui a ferramenta certa é
-- outra e existe desde sempre: **GRANT restringe coluna**.
--
-- Então `token_hash` e `pin_hash` simplesmente não entram no `grant
-- select` — nenhuma policy, por mais frouxa, consegue devolvê-los, porque
-- o privilégio não existe. E não há grant de INSERT/UPDATE/DELETE nenhum:
-- toda escrita passa pelas funções SECURITY DEFINER do fim deste arquivo.
--
-- O `revoke` explícito é obrigatório, não decorativo: o Supabase configura
-- `alter default privileges ... grant all on tables to anon, authenticated`
-- no schema public, então uma tabela nova nasce **com tudo liberado**.
--
--
-- SOBRE O SEGREDO DO HMAC
--
-- O segredo do token tem 100 bits de entropia (ver seção 3). Força bruta
-- sobre o hash é inviável com ou sem pepper.
-- O HMAC existe como defesa em profundidade: um dump do banco não entrega
-- cartões que funcionam. Vale saber disso ao pensar em rotação: perder o
-- segredo invalida os cartões (todos precisam ser reemitidos), mas não
-- expõe ninguém.
-- =====================================================================


-- =====================================================================
-- 1. SEGREDO DO HMAC — Vault
-- =====================================================================

-- Criar o segredo é passo manual e roda UMA vez, fora desta migration:
--
--   select vault.create_secret(
--     encode(gen_random_bytes(32), 'hex'),
--     'credencial_hmac',
--     'HMAC das credenciais físicas de motoboy'
--   );
--
-- Gerado dentro do banco de propósito: assim o segredo nunca passa por
-- arquivo, chat ou área de transferência de ninguém.
create or replace function public.segredo_credencial()
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_segredo text;
begin
  select decrypted_secret into v_segredo
    from vault.decrypted_secrets
   where name = 'credencial_hmac'
   limit 1;

  if v_segredo is null then
    raise exception
      'Segredo credencial_hmac ausente no Vault. Rode vault.create_secret antes de emitir credencial.'
      using errcode = 'config_file_error';
  end if;

  return v_segredo;
end;
$$;

-- Ninguém chama isto de fora. É helper interno das funções abaixo, e
-- deixá-lo executável seria entregar o pepper a qualquer autenticado.
revoke all on function public.segredo_credencial() from public, anon, authenticated;


-- =====================================================================
-- 2. TABELA
-- =====================================================================

create table public.motoboy_credenciais (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id),
  motoboy_id     uuid not null references public.mototaxistas(id),

  -- Em claro de propósito: é o que localiza a linha a partir do cartão
  -- bipado, e o que o cache local usa pra mostrar o nome offline. Não é
  -- segredo — sozinho ele não autentica nada.
  public_id      text not null,

  token_hash     text not null,
  pin_hash       text,

  -- Deriva de pin_hash pra a tela saber se o motoboy já criou o PIN sem
  -- precisar de acesso ao hash. É por isso que ela pode existir: responde
  -- a pergunta sem revelar o dado.
  tem_pin        boolean generated always as (pin_hash is not null) stored,

  ativo          boolean not null default true,
  emitido_em     timestamptz not null default now(),
  emitido_por    uuid references public.profiles(id),
  revogado_em    timestamptz,
  revogado_por   uuid references public.profiles(id),
  ultimo_uso_em  timestamptz,

  tentativas_pin smallint not null default 0 check (tentativas_pin >= 0),
  bloqueado_ate  timestamptz
);

create unique index motoboy_credenciais_public_id
  on public.motoboy_credenciais (public_id);

-- Um cartão ativo por motoboy. Emitir outro revoga o anterior (ver
-- emitir_credencial): dois cartões vivos pra mesma pessoa tornaria
-- "revogar o perdido" uma operação ambígua.
create unique index motoboy_credenciais_um_ativo
  on public.motoboy_credenciais (motoboy_id)
  where ativo;

create index on public.motoboy_credenciais (tenant_id, motoboy_id);

alter table public.motoboy_credenciais enable row level security;

-- Gestão de credencial acompanha Cadastros: admin. O caixa nunca precisa
-- LER esta tabela — ele bipa o cartão, e quem resolve identidade é a
-- função identificar_credencial, que roda com privilégio próprio.
create policy motoboy_credenciais_select on public.motoboy_credenciais
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_admin());

revoke all on public.motoboy_credenciais from anon, authenticated;

-- token_hash e pin_hash ficam de fora. Repare que isso obriga o frontend
-- a listar colunas: um `select *` do PostgREST passa a dar permission
-- denied, que é o comportamento desejado — falha alto, não em silêncio.
grant select (
  id, tenant_id, motoboy_id, public_id, ativo, tem_pin,
  emitido_em, emitido_por, revogado_em, revogado_por,
  ultimo_uso_em, tentativas_pin, bloqueado_ate
) on public.motoboy_credenciais to authenticated;


-- =====================================================================
-- 3. GERAÇÃO DO TOKEN
--
--   DCM1.01K4D7M2Q8.7N5X9K3R2T8W6H4M9C7
--   ^^^^ ^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^
--   ver.  public_id  segredo (100 bits)
--
-- Alfabeto Crockford base32, sem I, L, O e U — some a confusão entre
-- 1/I/L e 0/O na hora de alguém ler ou digitar o cartão à mão, e o U sai
-- pra evitar palavra acidental. 256 é múltiplo exato de 32, então o
-- `% 32` sobre um byte não introduz viés.
--
-- POR QUE 20 CARACTERES E NÃO 32
--
-- Restrição física, medida antes de fechar o formato — e conferida
-- rodando o codificador de verdade, não só pela fórmula:
--
--   segredo de 32 → token de 47 caracteres → 552 módulos → 105mm a 0,19
--   segredo de 20 → token de 36 caracteres → 431 módulos →  82mm a 0,19
--
-- Um cartão de crédito tem 85,6mm de largura. Com 32 o cartão não existe
-- em formato nenhum que caiba na carteira de alguém; com 20 ele cabe.
-- (0,19mm por módulo é o piso comum de leitor laser 1D; a tela de emissão
-- deixa escolher a largura e avisa quando fica abaixo disso.)
--
-- E 100 bits não é concessão de segurança aqui: o que protege a
-- credencial não é o tamanho do segredo, é o PIN (que autentica a
-- pessoa), o bloqueio progressivo e a revogação imediata. Adivinhar 2^100
-- pela rede não é o elo fraco de nada — o cartão perdido é, e pra esse a
-- resposta é revogar.
-- =====================================================================

-- `extensions` entra no search_path porque gen_random_bytes, hmac, crypt e
-- gen_salt são todos do pgcrypto, e no Supabase ele mora lá (em outras
-- instalações, em public). Citar os dois schemas faz as funções deste
-- arquivo valerem nos dois casos, sem eu ter que adivinhar qual é aqui —
-- schema inexistente no search_path é ignorado, não dá erro.
create or replace function public.gerar_base32(p_tamanho int)
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  c_alfabeto constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := gen_random_bytes(p_tamanho);
  v_saida text := '';
  i int;
begin
  for i in 0 .. p_tamanho - 1 loop
    v_saida := v_saida || substr(c_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_saida;
end;
$$;

revoke all on function public.gerar_base32(int) from public, anon, authenticated;


-- HMAC sobre o token INTEIRO (versão, public_id e segredo), como
-- especificado. Trocar a versão ou o public_id muda o hash, então um
-- token remontado a partir de partes de dois cartões não valida.
create or replace function public.hash_do_token(p_token text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select encode(hmac(p_token, public.segredo_credencial(), 'sha256'), 'hex');
$$;

revoke all on function public.hash_do_token(text) from public, anon, authenticated;


-- =====================================================================
-- 4. REGRAS DO PIN
--
-- 6 dígitos. bcrypt via pgcrypto — não SHA-256, porque o espaço é de
-- 1 milhão e uma hash rápida cai em minutos numa GPU. Custo 10 fica em
-- ~60-100ms: caro pra quem ataca, imperceptível no balcão.
--
-- Sequência e dígito repetido são recusados. Num espaço pequeno, os
-- poucos palpites que um atacante consegue antes do bloqueio vão
-- exatamente pra esses.
-- =====================================================================

create or replace function public.pin_aceitavel(p_pin text)
returns text language plpgsql immutable set search_path = public as $$
declare
  c_sequencias constant text[] := array['0123456789', '9876543210'];
  s text;
begin
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    return 'O PIN precisa ter exatamente 6 dígitos.';
  end if;

  if p_pin ~ '^(.)\1{5}$' then
    return 'Esse PIN repete o mesmo dígito seis vezes. Escolha outro.';
  end if;

  foreach s in array c_sequencias loop
    if position(p_pin in s) > 0 then
      return 'Esse PIN é uma sequência. Escolha outro.';
    end if;
  end loop;

  return null;  -- aceito
end;
$$;


-- =====================================================================
-- 5. EVENTOS
--
-- Credencial não tem entrega nem corrida, então estes eventos ficam com
-- entrega_id e corrida_id nulos — e a policy eventos_select já resolve
-- isso do jeito certo: evento sem as duas só aparece pro admin.
--
-- O PIN nunca entra em payload nenhum. Nem o digitado, nem o hash.
-- =====================================================================

create or replace function public.log_credencial(
  p_tenant_id uuid, p_credencial_id uuid, p_tipo text, p_payload jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_contexto jsonb;
begin
  -- Resolve nome e public_id aqui, e não em cada chamador: uma linha de
  -- auditoria dizendo "Cartão revogado" sem dizer de quem não responde
  -- nada. O public_id não é segredo (fica em claro na tabela, e estes
  -- eventos só o admin enxerga); a tela ainda mostra só os 4 últimos.
  select jsonb_build_object(
           'credencial_id', c.id,
           'public_id',     c.public_id,
           'motoboy_nome',  m.nome
         )
    into v_contexto
    from public.motoboy_credenciais c
    join public.mototaxistas m on m.id = c.motoboy_id
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
-- 6. EMITIR — devolve o token UMA vez e nunca mais
-- =====================================================================

create or replace function public.emitir_credencial(p_motoboy_id uuid)
returns table (credencial_id uuid, public_id text, token text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_motoboy record;
  v_public_id text;
  v_token text;
  v_id uuid;
begin
  if v_tenant is null or not public.is_admin() then
    raise exception 'Só administrador emite credencial.'
      using errcode = 'insufficient_privilege';
  end if;

  -- SECURITY DEFINER ignora a RLS de quem chamou, então o escopo de
  -- tenant precisa ser conferido na mão. Vale pra todas as funções deste
  -- arquivo.
  select m.id, m.nome, m.ativo into v_motoboy
    from public.mototaxistas m
   where m.id = p_motoboy_id and m.tenant_id = v_tenant;

  if v_motoboy.id is null then
    raise exception 'Motoboy não encontrado neste tenant.' using errcode = 'no_data_found';
  end if;
  if not v_motoboy.ativo then
    raise exception 'Motoboy inativo não recebe credencial.' using errcode = 'check_violation';
  end if;

  -- Emitir cartão novo revoga o anterior. É o fluxo real do cartão
  -- perdido: uma ação só, e o índice parcial garante a invariante mesmo
  -- que alguém chame isto de outro jeito um dia.
  update public.motoboy_credenciais
     set ativo = false, revogado_em = now(), revogado_por = auth.uid()
   where motoboy_id = p_motoboy_id and ativo;

  -- Colisão de public_id é astronomicamente improvável (32^10), mas o
  -- índice único é quem decide — o laço existe pra não transformar azar
  -- em erro na cara do usuário.
  loop
    v_public_id := public.gerar_base32(10);
    exit when not exists (
      select 1 from public.motoboy_credenciais c where c.public_id = v_public_id
    );
  end loop;

  v_token := 'DCM1.' || v_public_id || '.' || public.gerar_base32(20);

  insert into public.motoboy_credenciais
    (tenant_id, motoboy_id, public_id, token_hash, emitido_por)
  values
    (v_tenant, p_motoboy_id, v_public_id, public.hash_do_token(v_token), auth.uid())
  returning id into v_id;

  perform public.log_credencial(v_tenant, v_id, 'credencial_emitida',
    jsonb_build_object('motoboy_nome', v_motoboy.nome, 'public_id', v_public_id));

  -- Única vez em que o token existe fora do cartão. Não há como recuperá-lo
  -- depois: só o HMAC fica gravado.
  return query select v_id, v_public_id, v_token;
end;
$$;

revoke all on function public.emitir_credencial(uuid) from public, anon;
grant execute on function public.emitir_credencial(uuid) to authenticated;


-- =====================================================================
-- 7. IDENTIFICAR — o "bipar"
--
-- Responde só "quem é", nunca "é ele". Não mexe em tentativas_pin: o
-- token tem 160 bits, força bruta aqui não é o risco, e contar tentativa
-- de leitura daria um jeito de bloquear a credencial de alguém só
-- passando cartão errado.
-- =====================================================================

create or replace function public.identificar_credencial(p_token text)
returns table (
  credencial_id  uuid,
  public_id      text,
  motoboy_id     uuid,
  motoboy_nome   text,
  agencia_id     uuid,
  agencia_nome   text,
  tem_pin        boolean,
  bloqueado_ate  timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_public_id text := split_part(p_token, '.', 2);
begin
  if v_tenant is null then
    raise exception 'Sessão sem tenant.' using errcode = 'insufficient_privilege';
  end if;

  if split_part(p_token, '.', 1) <> 'DCM1' or length(v_public_id) <> 10 then
    return;  -- formato errado: zero linhas, mesma resposta de "não existe"
  end if;

  return query
    select c.id, c.public_id, m.id, m.nome, a.id, a.nome, c.tem_pin, c.bloqueado_ate
      from public.motoboy_credenciais c
      join public.mototaxistas m on m.id = c.motoboy_id
      left join public.agencias a on a.id = m.agencia_id
     where c.public_id = v_public_id
       and c.tenant_id = v_tenant
       and c.ativo
       and m.ativo
       and c.token_hash = public.hash_do_token(p_token);
end;
$$;

revoke all on function public.identificar_credencial(text) from public, anon;
grant execute on function public.identificar_credencial(text) to authenticated;


-- =====================================================================
-- 8. DEFINIR PIN — quem cria é o motoboy, no primeiro uso
--
-- Exige o token completo: quem define o PIN tem que estar com o cartão
-- na mão. E só funciona com pin_hash nulo, que é o estado de recém-emitida
-- ou de recém-redefinida pelo admin. É isso que torna "Mostrar PIN"
-- impossível de existir: o admin nunca escolhe, então nunca sabe.
-- =====================================================================

create or replace function public.definir_pin(p_token text, p_pin text)
returns void language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_cred record;
  v_erro text;
begin
  if v_tenant is null then
    raise exception 'Sessão sem tenant.' using errcode = 'insufficient_privilege';
  end if;

  select c.id, c.pin_hash into v_cred
    from public.motoboy_credenciais c
   where c.public_id = split_part(p_token, '.', 2)
     and c.tenant_id = v_tenant
     and c.ativo
     and c.token_hash = public.hash_do_token(p_token);

  if v_cred.id is null then
    raise exception 'Credencial não reconhecida.' using errcode = 'no_data_found';
  end if;

  if v_cred.pin_hash is not null then
    raise exception 'Esta credencial já tem PIN. Peça ao administrador para redefinir.'
      using errcode = 'check_violation';
  end if;

  v_erro := public.pin_aceitavel(p_pin);
  if v_erro is not null then
    raise exception '%', v_erro using errcode = 'check_violation';
  end if;

  update public.motoboy_credenciais
     set pin_hash = crypt(p_pin, gen_salt('bf', 10)),
         tentativas_pin = 0,
         bloqueado_ate = null
   where id = v_cred.id;

  perform public.log_credencial(v_tenant, v_cred.id, 'credencial_pin_definido', '{}'::jsonb);
end;
$$;

revoke all on function public.definir_pin(text, text) from public, anon;
grant execute on function public.definir_pin(text, text) to authenticated;


-- =====================================================================
-- 9. AUTENTICAR — cartão + PIN
--
-- ESTA FUNÇÃO NÃO LEVANTA EXCEÇÃO QUANDO O PIN ESTÁ ERRADO, e isso é o
-- ponto inteiro dela: `raise` faria rollback, o contador de tentativas
-- nunca subiria, e o bloqueio progressivo estaria desligado sem ninguém
-- perceber. Ela devolve um resultado, e o resultado é que diz "não".
--
-- O bloqueio tem TETO de 15 minutos de propósito: bloqueio permanente
-- automático deixaria qualquer pessoa com o cartão na mão derrubar o
-- motoboy de vez, só errando o PIN — negação de serviço contra a vítima.
-- =====================================================================

create or replace function public.autenticar_credencial(p_token text, p_pin text)
returns table (ok boolean, motivo text, bloqueado_ate timestamptz, credencial_id uuid)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_cred record;
  v_tentativas smallint;
  v_bloqueio interval;
  v_ate timestamptz;
begin
  if v_tenant is null then
    raise exception 'Sessão sem tenant.' using errcode = 'insufficient_privilege';
  end if;

  select c.id, c.pin_hash, c.tentativas_pin, c.bloqueado_ate into v_cred
    from public.motoboy_credenciais c
   where c.public_id = split_part(p_token, '.', 2)
     and c.tenant_id = v_tenant
     and c.ativo
     and c.token_hash = public.hash_do_token(p_token);

  if v_cred.id is null then
    return query select false, 'credencial_invalida'::text, null::timestamptz, null::uuid;
    return;
  end if;

  if v_cred.pin_hash is null then
    return query select false, 'pin_nao_definido'::text, null::timestamptz, v_cred.id;
    return;
  end if;

  if v_cred.bloqueado_ate is not null and v_cred.bloqueado_ate > now() then
    return query select false, 'bloqueado'::text, v_cred.bloqueado_ate, v_cred.id;
    return;
  end if;

  if v_cred.pin_hash = crypt(p_pin, v_cred.pin_hash) then
    update public.motoboy_credenciais
       set tentativas_pin = 0, bloqueado_ate = null, ultimo_uso_em = now()
     where id = v_cred.id;

    return query select true, null::text, null::timestamptz, v_cred.id;
    return;
  end if;

  -- Daqui pra baixo é o caminho do PIN errado, e ele PRECISA commitar.
  v_tentativas := v_cred.tentativas_pin + 1;
  v_bloqueio := case
    when v_tentativas < 3  then null
    when v_tentativas = 3  then interval '30 seconds'
    when v_tentativas = 4  then interval '2 minutes'
    when v_tentativas = 5  then interval '5 minutes'
    else interval '15 minutes'
  end;
  v_ate := case when v_bloqueio is null then null else now() + v_bloqueio end;

  update public.motoboy_credenciais
     set tentativas_pin = v_tentativas, bloqueado_ate = v_ate
   where id = v_cred.id;

  perform public.log_credencial(v_tenant, v_cred.id,
    case when v_ate is null then 'credencial_pin_incorreto' else 'credencial_bloqueada' end,
    jsonb_build_object('tentativas', v_tentativas, 'bloqueado_ate', v_ate));

  return query select false,
    case when v_ate is null then 'pin_incorreto' else 'bloqueado' end,
    v_ate, v_cred.id;
end;
$$;

revoke all on function public.autenticar_credencial(text, text) from public, anon;
grant execute on function public.autenticar_credencial(text, text) to authenticated;


-- =====================================================================
-- 10. REVOGAR e REDEFINIR — administração
--
-- Não existe "mostrar PIN" e não pode passar a existir. Redefinir só
-- apaga o hash; quem escolhe o novo é o motoboy, no cartão dele.
--
-- Nenhuma das duas mexe em assinatura já gravada: o histórico continua
-- apontando qual credencial foi usada, mesmo depois de revogada. É o que
-- mantém um romaneio antigo verificável.
-- =====================================================================

create or replace function public.revogar_credencial(p_credencial_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_existe boolean;
begin
  if v_tenant is null or not public.is_admin() then
    raise exception 'Só administrador revoga credencial.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.motoboy_credenciais
     set ativo = false, revogado_em = now(), revogado_por = auth.uid()
   where id = p_credencial_id and tenant_id = v_tenant and ativo
  returning true into v_existe;

  if v_existe is null then
    raise exception 'Credencial não encontrada ou já revogada.' using errcode = 'no_data_found';
  end if;

  perform public.log_credencial(v_tenant, p_credencial_id, 'credencial_revogada', '{}'::jsonb);
end;
$$;

revoke all on function public.revogar_credencial(uuid) from public, anon;
grant execute on function public.revogar_credencial(uuid) to authenticated;


create or replace function public.redefinir_pin(p_credencial_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_existe boolean;
begin
  if v_tenant is null or not public.is_admin() then
    raise exception 'Só administrador redefine PIN.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.motoboy_credenciais
     set pin_hash = null, tentativas_pin = 0, bloqueado_ate = null
   where id = p_credencial_id and tenant_id = v_tenant and ativo
  returning true into v_existe;

  if v_existe is null then
    raise exception 'Credencial não encontrada ou revogada.' using errcode = 'no_data_found';
  end if;

  perform public.log_credencial(v_tenant, p_credencial_id, 'credencial_pin_redefinido', '{}'::jsonb);
end;
$$;

revoke all on function public.redefinir_pin(uuid) from public, anon;
grant execute on function public.redefinir_pin(uuid) to authenticated;
