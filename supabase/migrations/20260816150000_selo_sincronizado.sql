-- =====================================================================
-- A porta de sincronização — selar uma saída que aconteceu offline
--
-- Etapa 4. Aqui entra o segundo caminho pro mesmo selo: em vez de vir do
-- navegador com sessão, vem da Edge Function `sync-romaneio`, com
-- `service_role`, depois de ela ter (1) conferido o JWT de quem
-- sincroniza, (2) confirmado que é o MESMO usuário que registrou a saída
-- e (3) aberto o envelope com a chave privada.
--
-- Nada aqui confia no corpo do request — a Edge Function é quem verificou
-- a identidade, e é por isso que ela pode passar o id do caixa. A regra
-- do CLAUDE.md continua valendo: identidade nunca vem do frontend.
--
--
-- POR QUE PARTIR autenticar_credencial EM DUAS
--
-- A versão da etapa 2 lê `current_tenant_id()`, que depende de
-- `auth.uid()`. Sob service_role isso é NULO, e a função levantaria
-- "Sessão sem tenant" — a saída offline nunca sincronizaria. Então a
-- lógica desce pra uma função que recebe o tenant por parâmetro, e a
-- antiga vira uma casca fina por cima. O comportamento online não muda.
-- =====================================================================


-- =====================================================================
-- 1. AUTENTICAÇÃO SEM SESSÃO
-- =====================================================================

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
   where c.public_id = split_part(p_token, '.', 2)
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

  -- Caminho do PIN errado: PRECISA commitar, por isso a função devolve
  -- resultado em vez de levantar exceção (ver etapa 2).
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


-- A versão com sessão vira casca. Comportamento idêntico ao da etapa 2 —
-- só o tenant passou a ser resolvido antes em vez de dentro.
create or replace function public.autenticar_credencial(p_token text, p_pin text)
returns table (ok boolean, motivo text, bloqueado_ate timestamptz, credencial_id uuid)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'Sessão sem tenant.' using errcode = 'insufficient_privilege';
  end if;
  return query select * from public.autenticar_credencial_interno(v_tenant, p_token, p_pin);
end;
$$;

revoke all on function public.autenticar_credencial(text, text) from public, anon;
grant execute on function public.autenticar_credencial(text, text) to authenticated;


-- =====================================================================
-- 2. O SELO SINCRONIZADO
--
-- Diferença de fundo em relação à porta online: lá o motoboy autenticou
-- ANTES de assinar e a autorização já existia. Aqui ele autenticou no
-- balcão, offline, e a prova disso é o PIN selado no envelope — então a
-- autenticação e a autorização acontecem agora, na mesma transação do
-- selo, e o `document_hash` é o que amarra as duas coisas à saída certa.
--
-- Falha de PIN aqui é TERMINAL, não é pra retentar: o PIN foi digitado
-- uma vez, no balcão, e tentar de novo com o mesmo valor dá o mesmo
-- resultado — só queimaria tentativa e bloquearia o motoboy. Vira
-- conflito registrado, que preserva as assinaturas e chama gente.
-- =====================================================================

create or replace function public.selar_romaneio_sincronizado(
  p_caixa_id uuid,
  p_romaneio_id uuid,
  p_corrida_id uuid,
  p_loja_id uuid,
  p_agencia_id uuid,
  p_motoboy_id uuid,
  p_entrega_ids uuid[],
  p_document_hash text,
  p_token text,
  p_pin text,
  p_caixa_strokes jsonb,
  p_motoboy_strokes jsonb,
  p_ocorrido_em_local timestamptz,
  p_ip inet,
  p_geolocalizacao jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_tenant uuid;
  v_auth record;
  v_motoboy_do_cartao uuid;
  v_autorizacao_id uuid;
begin
  select p.tenant_id into v_tenant from public.profiles p
   where p.id = p_caixa_id and p.ativo;
  if v_tenant is null then
    raise exception 'Caixa inexistente ou inativo.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_auth
    from public.autenticar_credencial_interno(v_tenant, p_token, p_pin);

  if not v_auth.ok then
    return public.registrar_conflito_romaneio(
      p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
      p_ocorrido_em_local, 'offline_sincronizada', p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'autenticacao_falhou', 'detalhe', v_auth.motivo)),
      p_entrega_ids, p_caixa_strokes, p_motoboy_strokes);
  end if;

  -- O cartão apresentado tem que ser do motoboy que a saída diz ser. Sem
  -- isto, uma saída offline poderia nomear um motoboy e apresentar o
  -- cartão de outro — e a cadeia de custódia apontaria pra pessoa errada.
  select c.motoboy_id into v_motoboy_do_cartao
    from public.motoboy_credenciais c where c.id = v_auth.credencial_id;

  if v_motoboy_do_cartao is distinct from p_motoboy_id then
    return public.registrar_conflito_romaneio(
      p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
      p_ocorrido_em_local, 'offline_sincronizada', p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'cartao_de_outro_motoboy',
        'motoboy_na_saida', p_motoboy_id, 'motoboy_do_cartao', v_motoboy_do_cartao)),
      p_entrega_ids, p_caixa_strokes, p_motoboy_strokes);
  end if;

  -- Autorização nasce e é consumida na mesma transação. Ela existe aqui
  -- só pra o caminho do selo ser um só: `selar_romaneio_interno` não
  -- precisa saber se a autenticação foi agora ou dois minutos atrás.
  insert into public.motoboy_autorizacoes
    (tenant_id, credencial_id, motoboy_id, document_hash, expira_em)
  values
    (v_tenant, v_auth.credencial_id, p_motoboy_id, p_document_hash,
     now() + interval '1 minute')
  returning id into v_autorizacao_id;

  return public.selar_romaneio_interno(
    p_caixa_id, p_romaneio_id, p_corrida_id, p_loja_id, p_agencia_id,
    p_motoboy_id, p_entrega_ids, p_document_hash, v_autorizacao_id,
    p_caixa_strokes, p_motoboy_strokes, p_ocorrido_em_local,
    'offline_sincronizada', p_ip, p_geolocalizacao);
end;
$$;

-- Só a Edge Function alcança isto. Um `authenticated` que a alcançasse
-- escolheria de quem é a saída — o parâmetro p_caixa_id é confiável
-- justamente porque quem chama já provou a identidade.
revoke all on function public.selar_romaneio_sincronizado(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid[], text, text, text,
  jsonb, jsonb, timestamptz, inet, jsonb
) from public, anon, authenticated;

grant execute on function public.selar_romaneio_sincronizado(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid[], text, text, text,
  jsonb, jsonb, timestamptz, inet, jsonb
) to service_role;
