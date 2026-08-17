-- =====================================================================
-- Custo do bcrypt do PIN: 10 → 12
--
-- Pedido do usuário em 2026-08-16. Eu tinha escolhido 10 pesando o tempo
-- no balcão; ele especificou 12, e revendo a conta ele está certo:
--
--   custo 10 ≈  60-100ms
--   custo 12 ≈ 250-400ms
--
-- Esses ~300ms a mais acontecem UMA vez por saída, no passo do motoboy —
-- não no cadastro de entrega, que é o fluxo cronometrado contra os 25
-- segundos. Ninguém percebe. E num espaço de 6 dígitos (1 milhão de
-- combinações), cada dobra de custo vale muito: é o que separa "uma GPU
-- quebra o dump em minutos" de "leva ordens de grandeza mais".
--
--
-- NÃO EXISTE MIGRAÇÃO DE DADO AQUI, E ISSO NÃO É ESQUECIMENTO
--
-- O hash do bcrypt carrega o custo dentro dele ($2a$10$... contra
-- $2a$12$...), e `crypt(pin, pin_hash)` lê o custo do próprio hash
-- guardado. Então PIN criado antes desta migration continua validando
-- normalmente, com o custo antigo — e passa a usar 12 na próxima vez que
-- for redefinido.
--
-- Reidratar os hashes existentes seria impossível de qualquer forma: pra
-- recalcular com custo novo seria preciso conhecer o PIN, e ninguém
-- conhece. É o comportamento correto do desenho, não uma limitação.
-- =====================================================================

create or replace function public.definir_pin(p_token text, p_pin text)
returns void language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_cred record;
  v_erro text;
begin
  -- `current_tenant_id()` depende de `auth.uid()`, então esta função só
  -- roda com sessão — ou seja, criar PIN é ONLINE por construção, nunca
  -- por uma checagem de tela que alguém possa contornar. É o passo em que
  -- o servidor grava o pin_hash oficial; não há como fazê-lo offline.
  if v_tenant is null then
    raise exception 'Sessão inválida — criar PIN exige estar online.'
      using errcode = 'insufficient_privilege';
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

  -- Só ativa quem ainda não tem PIN. Quem já tem passa pelo admin
  -- (redefinir_pin apaga o hash), e é isso que impede alguém que ache um
  -- cartão ativo de simplesmente escolher outro PIN.
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

  -- Quem supervisionou a ativação fica registrado (auth.uid() do caixa ou
  -- gestor logado). O PIN, não — nem o digitado, nem o hash.
  perform public.log_credencial(v_tenant, v_cred.id, 'credencial_pin_definido', '{}'::jsonb);
end;
$$;

revoke all on function public.definir_pin(text, text) from public, anon;
grant execute on function public.definir_pin(text, text) to authenticated;
