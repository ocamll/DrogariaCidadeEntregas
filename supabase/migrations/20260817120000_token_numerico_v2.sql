-- =====================================================================
-- Token v2: numérico, pra caber num cartão CR80 de verdade
--
-- O formato v1 (`DCM1.<10 base32>.<20 base32>`) não cabe. Medido com o
-- codificador de verdade, não estimado:
--
--   área útil num CR80 (85,6mm menos 5mm de margem de cada lado) = 75mm
--   piso comum de leitor laser 1D                                = 0,19mm/módulo
--
--   v1   DCM1.<10>.<20>   36 car → 431 módulos → 0,174mm  NÃO CABE
--   b32  DC2.<6>.<24>     35 car → 420 módulos → 0,179mm  NÃO CABE
--   b64  DC2.<6>.<22>     34 car → 409 módulos → 0,183mm  NÃO CABE
--   v2   2<10><31>        42 car → 266 módulos → 0,282mm  CABE
--
--
-- POR QUE O MAIS LONGO É O MAIS ESTREITO
--
-- Code 128 tem um modo numérico (Set C) que empacota DOIS DÍGITOS por
-- símbolo de 11 módulos. Texto alfanumérico gasta 11 módulos por
-- caractere, seja base32 ou base64 — trocar de alfabeto reduz caracteres,
-- não módulos o bastante. Um token só de dígitos, mesmo com mais
-- caracteres, ocupa quase metade da largura. O bwip-js troca de set
-- sozinho.
--
-- Corolário que decide o formato: **sem separadores.** Um ponto no meio
-- quebra a corrida numérica e força troca de set — `DC2.0102…` com pontos
-- volta pra 398 módulos e deixa de caber. Os campos são de largura fixa.
--
--   2          versão (1 dígito)
--   0102030405 public_id (10 dígitos)
--   1234…      segredo (31 dígitos ≈ 103 bits)
--
-- E some de graça o problema que o alfabeto Crockford existia pra
-- mitigar: com só dígitos não há `O`/`0` nem `I`/`1`/`L` pra confundir.
--
--
-- 103 BITS BASTAM
--
-- Mesma razão da nota do v1: quem protege a credencial é o PIN, o
-- bloqueio progressivo e a revogação. O elo fraco é o cartão perdido, e a
-- resposta pra esse é revogar. Adivinhar 2^103 pela rede não é o risco de
-- ninguém — e a folga de 0,282mm/módulo perdoa impressora ruim, cartão
-- sujo e leitor velho, que são riscos de verdade.
--
--
-- CARTÃO ANTIGO CONTINUA VALENDO
--
-- Nada é reemitido. `public_id_do_token` reconhece os dois formatos, e é
-- só ele que sabe da diferença — o resto do sistema (HMAC, PIN, bcrypt,
-- emissão, revogação, romaneio, auditoria) não encosta nisso.
-- =====================================================================


-- =====================================================================
-- 1. DÍGITOS ALEATÓRIOS, SEM VIÉS
-- =====================================================================

create or replace function public.gerar_digitos(p_tamanho int)
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  v_saida text := '';
  v_bytes bytea;
  v_byte int;
  i int;
begin
  while length(v_saida) < p_tamanho loop
    v_bytes := gen_random_bytes(p_tamanho);
    for i in 0 .. p_tamanho - 1 loop
      exit when length(v_saida) >= p_tamanho;
      v_byte := get_byte(v_bytes, i);
      -- Rejeita 250..255. 256 NÃO é múltiplo de 10, então aceitar todo
      -- byte faria os dígitos 0-5 saírem levemente mais que 6-9 — viés
      -- pequeno, mas de graça de evitar. (No base32 do v1 isso não
      -- existia: 256 é múltiplo exato de 32.)
      if v_byte < 250 then
        v_saida := v_saida || (v_byte % 10)::text;
      end if;
    end loop;
  end loop;
  return v_saida;
end;
$$;

revoke all on function public.gerar_digitos(int) from public, anon, authenticated;


-- =====================================================================
-- 2. O PARSER QUE CONHECE OS DOIS FORMATOS
--
-- É o único ponto do sistema que sabe que existe mais de um formato.
-- Devolve null pro que não reconhece, e quem chama trata isso como
-- "cartão desconhecido" — a mesma resposta de token inválido, de
-- propósito: distinguir os casos só ajudaria quem está tentando
-- descobrir.
-- =====================================================================

create or replace function public.public_id_do_token(p_token text)
returns text language sql immutable set search_path = public as $$
  select case
    -- v2: 1 + 10 + 31 = 42 dígitos, sem separador
    when p_token ~ '^2[0-9]{41}$'
      then substr(p_token, 2, 10)
    -- v1: DCM1.<10>.<20>, alfabeto Crockford
    when split_part(p_token, '.', 1) = 'DCM1'
     and length(split_part(p_token, '.', 2)) = 10
      then split_part(p_token, '.', 2)
    else null
  end;
$$;


-- =====================================================================
-- 3. EMISSÃO — agora gera v2
-- =====================================================================

create or replace function public.emitir_credencial(p_motoboy_id uuid)
returns table (credencial_id uuid, public_id text, token text)
language plpgsql volatile security definer set search_path = public, extensions as $$
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

  select m.id, m.nome, m.ativo into v_motoboy
    from public.mototaxistas m
   where m.id = p_motoboy_id and m.tenant_id = v_tenant;

  if v_motoboy.id is null then
    raise exception 'Motoboy não encontrado neste tenant.' using errcode = 'no_data_found';
  end if;
  if not v_motoboy.ativo then
    raise exception 'Motoboy inativo não recebe credencial.' using errcode = 'check_violation';
  end if;

  -- Emitir cartão novo revoga o anterior: é o fluxo do cartão perdido, e
  -- o índice parcial garante a invariante de um ativo por motoboy.
  update public.motoboy_credenciais
     set ativo = false, revogado_em = now(), revogado_por = auth.uid()
   where motoboy_id = p_motoboy_id and ativo;

  loop
    v_public_id := public.gerar_digitos(10);
    exit when not exists (
      select 1 from public.motoboy_credenciais c where c.public_id = v_public_id
    );
  end loop;

  -- Sem separador nenhum: ponto no meio quebraria o Set C e o código
  -- deixaria de caber no cartão. Ver o cabeçalho.
  v_token := '2' || v_public_id || public.gerar_digitos(31);

  insert into public.motoboy_credenciais
    (tenant_id, motoboy_id, public_id, token_hash, emitido_por)
  values
    (v_tenant, p_motoboy_id, v_public_id, public.hash_do_token(v_token), auth.uid())
  returning id into v_id;

  perform public.log_credencial(v_tenant, v_id, 'credencial_emitida',
    jsonb_build_object('motoboy_nome', v_motoboy.nome, 'public_id', v_public_id));

  return query select v_id, v_public_id, v_token;
end;
$$;

revoke all on function public.emitir_credencial(uuid) from public, anon;
grant execute on function public.emitir_credencial(uuid) to authenticated;


-- =====================================================================
-- 4. AS TRÊS FUNÇÕES QUE LIAM O TOKEN NA MÃO
--
-- Todas trocam `split_part(p_token, '.', 2)` pelo parser. O resto do
-- corpo é idêntico ao que já estava rodando.
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


create or replace function public.definir_pin(p_token text, p_pin text)
returns void language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_cred record;
  v_erro text;
begin
  -- Depende de auth.uid(), então criar PIN é ONLINE por construção — não
  -- por uma checagem de tela que alguém possa contornar.
  if v_tenant is null then
    raise exception 'Sessão inválida — criar PIN exige estar online.'
      using errcode = 'insufficient_privilege';
  end if;

  select c.id, c.pin_hash into v_cred
    from public.motoboy_credenciais c
   where c.public_id = public.public_id_do_token(p_token)
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
     set pin_hash = crypt(p_pin, gen_salt('bf', 12)),
         tentativas_pin = 0,
         bloqueado_ate = null
   where id = v_cred.id;

  perform public.log_credencial(v_tenant, v_cred.id, 'credencial_pin_definido', '{}'::jsonb);
end;
$$;

revoke all on function public.definir_pin(text, text) from public, anon;
grant execute on function public.definir_pin(text, text) to authenticated;


create or replace function public.autenticar_credencial_interno(
  p_tenant_id uuid, p_token text, p_pin text
)
returns table (ok boolean, motivo text, bloqueado_ate timestamptz, credencial_id uuid)
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_cred record;
  v_tentativas smallint;
  v_bloqueio interval;
  v_ate timestamptz;
begin
  select c.id, c.pin_hash, c.tentativas_pin, c.bloqueado_ate into v_cred
    from public.motoboy_credenciais c
   where c.public_id = public.public_id_do_token(p_token)
     and c.tenant_id = p_tenant_id
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

  -- Caminho do PIN errado: PRECISA commitar, por isso resultado e não
  -- exceção — senão o bloqueio progressivo fica desligado.
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

  perform public.log_credencial(p_tenant_id, v_cred.id,
    case when v_ate is null then 'credencial_pin_incorreto' else 'credencial_bloqueada' end,
    jsonb_build_object('tentativas', v_tentativas, 'bloqueado_ate', v_ate));

  return query select false,
    case when v_ate is null then 'pin_incorreto' else 'bloqueado' end,
    v_ate, v_cred.id;
end;
$$;

revoke all on function public.autenticar_credencial_interno(uuid, text, text)
  from public, anon, authenticated;
