-- =====================================================================
-- Token v3: mesmo formato numérico do v2, mais curto
--
--   3      versão (1 dígito)
--   012345 public_id (6 dígitos)
--   1234…  segredo (15 dígitos ≈ 50 bits)
--          ────────────────────────────
--          22 dígitos, sem separador
--
--
-- POR QUE ENCURTAR, SE O V2 JÁ CABIA
--
-- O v2 cabe e foi lido no teste real. O que ele NÃO tem é margem pra
-- impressão fora do ideal — e o primeiro uso de verdade é justamente um
-- teste em papel comum, antes de mandar pra gráfica. Medido com o
-- codificador, dividindo os 75mm pelo total COM as zonas de silêncio:
--
--   dígitos  módulos  +silêncio  mm/módulo  folga  pontos/módulo @300dpi
--   42 (v2)      266        286     0,2622   +38%                    3,1
--   30           200        220     0,3409   +79%                    4,0
--   26           178        198     0,3788   +99%                    4,5
--   22 (v3)      156        176     0,4261  +124%                    5,0
--
-- Os pontos por módulo são o número que decide o teste em papel: a 3,1,
-- o arredondamento da impressora já vale ±16% na largura da barra, e
-- papel comum espalha mais tinta que PVC. A 5,0 isso deixa de importar.
--
-- ATENÇÃO — o cabeçalho da migration do v2 diz "0,282mm" pro v2. Aquele
-- número está ERRADO: divide 75mm por 266 e esquece os 20 módulos das
-- duas zonas de silêncio, que ocupam largura dentro dos mesmos 75mm. O
-- valor certo é 75/286 = 0,2622mm, que é o que a tela sempre mostrou (ela
-- divide por `unidadesLargura`, que já inclui o padding) e o que está na
-- tabela do CLAUDE.md. Nada foi decidido com o número errado — ele só
-- aparece naquele comentário.
--
--
-- 50 BITS BASTAM, E ISSO NÃO É CONCESSÃO
--
-- Mesma razão do v1 e do v2, agora com a conta explícita. A 50 tentativas
-- por segundo contra o servidor, com 15 dígitos de segredo:
--
--   quebrar um cartão específico  → ~317 mil anos
--   achar qualquer cartão válido  → ~11 mil anos (com 30 cartões ativos)
--
-- E acertar o token não dá acesso a nada: ainda falta o PIN, com bcrypt
-- de custo 12 e bloqueio progressivo até 15 minutos. Quem protege a
-- credencial continua sendo o PIN, o bloqueio e a revogação — o elo fraco
-- é o cartão perdido, e a resposta pra esse é revogar, nunca torcer pra
-- ninguém adivinhar. A margem de impressão, essa sim, protege contra
-- riscos que acontecem: impressora ruim, cartão sujo, leitor velho.
--
--
-- PUBLIC_ID DE 6 DÍGITOS
--
-- São 1 milhão de identificadores pra uma farmácia que terá dezenas de
-- motoboys. Ele não é segredo (fica em claro na tabela e é a chave de
-- busca), então encurtá-lo não tira segurança nenhuma: o que autentica é
-- o `token_hash` conferido logo depois. E não colide com os public_id de
-- 10 dígitos já emitidos — comprimentos diferentes, strings diferentes.
--
--
-- OS TRÊS FORMATOS CONVIVEM
--
-- Nenhum cartão é reemitido. `public_id_do_token` reconhece v1, v2 e v3,
-- e continua sendo o ÚNICO ponto do banco que sabe que existe mais de um
-- formato. O par dele no cliente é `publicIdDoToken`, em
-- src/data/credenciais.ts — os dois mudam juntos, sempre.
-- =====================================================================


-- =====================================================================
-- 1. O PARSER, AGORA COM TRÊS FORMATOS
-- =====================================================================

create or replace function public.public_id_do_token(p_token text)
returns text language sql immutable set search_path = public as $$
  select case
    -- v3: 1 + 6 + 15 = 22 dígitos, sem separador
    when p_token ~ '^3[0-9]{21}$'
      then substr(p_token, 2, 6)
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
-- 2. EMISSÃO — passa a gerar v3
--
-- Idêntica à versão do v2 em tudo o mais. Só mudam os dois tamanhos e o
-- dígito de versão.
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

  -- O loop de unicidade importa mais com 6 dígitos do que com 10, mas a
  -- forma é a mesma: com dezenas de cartões num espaço de 1 milhão, a
  -- chance de repetir é desprezível — e se repetir, sorteia de novo.
  loop
    v_public_id := public.gerar_digitos(6);
    exit when not exists (
      select 1 from public.motoboy_credenciais c where c.public_id = v_public_id
    );
  end loop;

  -- Sem separador nenhum: ponto no meio quebraria o Set C e o código
  -- ficaria quase 40% mais largo. Ver o cabeçalho da migration do v2.
  v_token := '3' || v_public_id || public.gerar_digitos(15);

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
-- 3. CONFERÊNCIA
--
-- Nada mais muda: identificar/autenticar/definir PIN já chamam o parser
-- em vez de fatiar o token na mão (foi o que a migration do v2 arrumou).
-- As três continuam funcionando pros três formatos sem uma linha nova.
--
-- Pra conferir depois de aplicar:
--
--   select public.public_id_do_token('3' || repeat('7',21));  -- '777777'
--   select public.public_id_do_token('2' || repeat('7',41));  -- v2, 10 díg.
--   select public.public_id_do_token('3' || repeat('7',20));  -- null
-- =====================================================================
