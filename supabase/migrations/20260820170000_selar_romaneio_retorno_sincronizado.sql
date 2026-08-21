-- =====================================================================
-- 2C.1 — A PORTA OFFLINE DO ROMANEIO DE RETORNO
--
-- A 2B construiu só a porta ONLINE (`selar_romaneio_retorno`), e deixou
-- esta anotada num comentário. O motivo de ela não poder ser a mesma:
--
--   `selar_romaneio_retorno_interno` recebe `p_autorizacao_id` — uma
--   autorização JÁ EMITIDA, de uso único, amarrada ao `document_hash`.
--   Offline não existe autorização: o PIN só pode ser conferido na
--   sincronização, a partir do envelope RSA. Não há a quem pedir uma
--   autorização às 20h17 num balcão sem rede.
--
-- Esta função é o espelho literal de `selar_romaneio_sincronizado`
-- (20260816150000), a porta offline da SAÍDA: recebe token e PIN em
-- claro (a Edge Function acabou de abri-los do envelope, e é a única que
-- consegue), autentica, e então CUNHA a autorização efêmera só pra o
-- caminho do selo ser um só.
--
-- O QUE ESSA FORMA COMPRA, e é o motivo de não improvisar outra:
--
--        ONLINE ──── autorização da tela ────┐
--                                            ├──> selar_romaneio_retorno_interno
--        OFFLINE ─── valida PIN aqui ────────┘         (selo ÚNICO)
--                    cunha autorização
--
-- Não existe segunda implementação de selagem, logo não existe segunda
-- fórmula de hash pra divergir. Toda a lição das duas implementações
-- gêmeas do canônico aplicada de véspera, num lugar onde ainda dava pra
-- escolher não ter o problema.
--
-- ---------------------------------------------------------------------
-- SEM CLIENTE AINDA. Esta migration não é chamada por nada: a 2C.6 é que
-- vai fazer a `sync-romaneio` despachar pra cá. Ela nasce e é provada
-- isoladamente, de propósito.
-- ---------------------------------------------------------------------
--
-- POR QUE O GUARD DE REENVIO SUBIU PRA CÁ (e na saída ele está lá dentro)
--
-- `selar_romaneio_retorno_interno` abre com o guard de reenvio — romaneio
-- já `selado` devolve `ja_existia`, já em `conflito` devolve o conflito.
-- Isso basta pro caminho online. Aqui não basta, e o caso é estreito mas
-- o estrago é o pior conhecido do projeto:
--
--   1. a fila reenvia uma operação que JÁ selou (a resposta se perdeu);
--   2. no meio tempo a credencial do motoboy foi bloqueada por outra
--      pessoa errando o PIN;
--   3. autenticando ANTES do guard, este reenvio falha a autenticação e
--      cai em `registrar_conflito_retorno`.
--
-- O que acontece então NÃO é violação de chave primária — o insert de lá
-- é `on conflict (id) do nothing`, e isso está certo. É pior de ler e
-- mais silencioso: a linha selada fica intacta, mas a função devolve
-- `ok:false, motivo:'conflito'` com o NÚMERO DO ROMANEIO SELADO, e grava
-- um evento `conflito_retorno` contra um documento que está perfeitamente
-- selado. O cliente marca o item como terminal "em conflito", e o
-- Registro de Auditoria passa a mostrar um conflito que nunca houve.
--
-- Com o guard aqui em cima, reenvio nunca chega a encostar na credencial:
-- devolve o que já aconteceu e sai. De quebra, deixa de gastar um bcrypt
-- por reenvio. O interno continua sendo a autoridade — se os dois
-- divergirem, o pior caso é o atalho não disparar e o interno decidir.
--
-- ---------------------------------------------------------------------
-- RECUSA É CONFLITO, EXCEÇÃO É O QUE NÃO TEM PROVA A PRESERVAR
--
-- Mesma regra da 2B, e ela vale ainda mais aqui: quando um retorno chega
-- nesta função, o motoboy já devolveu os vales e as DUAS PARTES JÁ
-- ASSINARAM, possivelmente horas antes. Um `raise` daria rollback e
-- levaria os dois traços junto.
--
--   conflito (grava e preserva)   PIN errado, credencial bloqueada,
--                                 cartão de outro motoboy, responsável
--                                 sem competência na loja
--
--   exceção (não há o que salvar) responsável inexistente ou inativo,
--                                 romaneio de saída inexistente,
--                                 saída de outra farmácia
--
-- ---------------------------------------------------------------------
-- A COMPETÊNCIA SOBRE A LOJA, QUE É NOVA E DELIBERADA
--
-- A porta da SAÍDA tem um buraco conhecido: `p_loja_id` vem do payload e
-- só é conferida contra os vales, o que prova consistência interna e não
-- competência. `SECURITY DEFINER` ignora RLS, então lá a proteção real é
-- "o caixa não consegue LER os ids de outra filial", não "a função
-- recusa". Não é alcançável pelo caminho normal, e não se conserta aqui.
--
-- O retorno já nasce melhor — ele não tem `p_loja_id`, a loja sai do
-- romaneio de saída selado, e payload nenhum opina. Falta só não repetir
-- o padrão: esta porta confere que o responsável tem competência sobre a
-- loja DA SAÍDA. Só `admin` atravessa filial (gerente não — ver "Quem vê
-- o quê" no CLAUDE.md).
--
-- E ela é CONFLITO, não exceção, porque o caso alcançável é legítimo: um
-- caixa registra o retorno offline e tem o perfil movido de filial antes
-- de a fila drenar. O retorno ACONTECEU; o que mudou foi o cadastro de
-- quem o fez. Levantar exceção deixaria a prova só no IndexedDB dele.
--
-- ---------------------------------------------------------------------
-- ORDEM DAS CHECAGENS, E ELA NÃO É ARBITRÁRIA
--
--   1. reenvio          → não encosta na credencial
--   2. responsável      → precisa do tenant pra tudo abaixo
--   3. saída existe     → precisa da loja pro caminho do conflito
--   4. competência      → recusa ANTES de gastar tentativa de PIN
--   5. autenticação     → bcrypt, ~300ms
--   6. cartão é dele?   → a cadeia não pode fechar com quem não a abriu
--   7. cunha autorização
--   8. selo
--
-- A 4 antes da 5 importa: quem não tem competência sobre aquela filial
-- não deve conseguir queimar o contador de tentativas de um motoboy.
--
-- E a leitura da saída no passo 3 é DELIBERADAMENTE sem `for update`.
-- Ela existe só pra ter `loja_id` no caminho do conflito; quem trava a
-- linha é o interno, depois. Travar aqui seguraria o lock durante o
-- bcrypt do passo 5.
-- =====================================================================

create or replace function public.selar_romaneio_retorno_sincronizado(
  p_responsavel_id       uuid,
  p_romaneio_id          uuid,
  p_saida_romaneio_id    uuid,
  p_saida_document_hash  text,
  p_motoboy_id           uuid,
  p_retorno              jsonb,
  p_document_hash        text,
  p_token                text,
  p_pin                  text,
  p_responsavel_strokes  jsonb,
  p_motoboy_strokes      jsonb,
  p_ocorrido_em_local    timestamptz,
  p_ip                   inet,
  p_geolocalizacao       jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_existente         record;
  v_tenant            uuid;
  v_papel             text;
  v_loja_do_perfil    uuid;
  v_saida             record;
  v_auth              record;
  v_motoboy_do_cartao uuid;
  v_autorizacao_id    uuid;
begin
  -- ---- 1. reenvio, ANTES de qualquer credencial -------------------------
  -- Olha o STATUS, não só a existência: um romaneio em conflito também
  -- tem número, e devolvê-lo como "ok, já existia" esconderia o conflito
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

  -- ---- 2. quem é o responsável ------------------------------------------
  -- Vem do `p_responsavel_id`, que a Edge Function tira do JWT validado —
  -- NUNCA do corpo do request. É essa cadeia que torna `papel_no_momento`
  -- um registro de auditoria e não uma afirmação do cliente.
  select p.tenant_id, p.papel, p.loja_id
    into v_tenant, v_papel, v_loja_do_perfil
    from public.profiles p
   where p.id = p_responsavel_id and p.ativo;

  if v_tenant is null then
    raise exception 'Responsável inexistente ou inativo.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- 3. a saída, pela loja --------------------------------------------
  -- Sem `for update` de propósito — ver o cabeçalho. O interno relê com
  -- lock e é ele quem decide; isto aqui é só pra o conflito ter loja.
  --
  -- NÃO confere `status = 'selado'`, e isso é escolha: se a saída não
  -- estiver selada e a autenticação passar, o interno levanta exceção
  -- (correto, não há corrida pra fechar); se a autenticação falhar, o
  -- conflito grava a prova, que é melhor que perdê-la.
  select r.id, r.tenant_id, r.loja_id, r.tipo into v_saida
    from public.romaneios r where r.id = p_saida_romaneio_id;

  if v_saida.id is null or v_saida.tipo <> 'saida' then
    raise exception 'Romaneio de saída % não existe.', p_saida_romaneio_id
      using errcode = 'no_data_found';
  end if;
  if v_saida.tenant_id <> v_tenant then
    raise exception 'Romaneio de saída não é desta farmácia.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- 4. competência sobre a loja da saída -----------------------------
  -- `v_papel <> 'admin'` espelha `is_admin()`, que é ESTRITAMENTE
  -- `papel = 'admin'`. `superadmin` existe no CHECK de `profiles.papel`
  -- desde o schema inicial e **não entra em `is_admin()`** — logo não
  -- atravessa filial em policy nenhuma, e não pode atravessar aqui.
  -- Acrescentá-lo neste literal abriria um escopo que a RLS fecha.
  if v_papel <> 'admin' and v_loja_do_perfil is distinct from v_saida.loja_id then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local,
      'offline_sincronizada', p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'responsavel_sem_competencia_na_loja',
        'loja_da_saida', v_saida.loja_id,
        'loja_do_responsavel', v_loja_do_perfil,
        'papel', v_papel)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- ---- 5. cartão + PIN ---------------------------------------------------
  -- Cartão e PIN DE NOVO, e não é redundância: são duas transferências de
  -- custódia em sentidos opostos. O bloqueio progressivo (30s → 2min →
  -- 5min, teto de 15min, zerado por um acerto) é o mesmo, e é por isso
  -- que a recusa aqui tem que virar item TERMINAL na fila — retentar
  -- queimaria tentativa e derrubaria o motoboy sozinho.
  select * into v_auth
    from public.autenticar_credencial_interno(v_tenant, p_token, p_pin);

  if not v_auth.ok then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local,
      'offline_sincronizada', p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'autenticacao_falhou', 'detalhe', v_auth.motivo,
        'bloqueado_ate', v_auth.bloqueado_ate)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- ---- 6. o cartão é do motoboy que o documento nomeia? -----------------
  -- Sem isto, um retorno offline poderia nomear um motoboy e apresentar o
  -- cartão de outro — e a cadeia de custódia fecharia com quem não a
  -- abriu. (Que o motoboy seja o da CORRIDA, o interno confere depois.)
  select c.motoboy_id into v_motoboy_do_cartao
    from public.motoboy_credenciais c where c.id = v_auth.credencial_id;

  if v_motoboy_do_cartao is distinct from p_motoboy_id then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local,
      'offline_sincronizada', p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'cartao_de_outro_motoboy',
        'motoboy_no_retorno', p_motoboy_id,
        'motoboy_do_cartao', v_motoboy_do_cartao)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- ---- 7. a autorização efêmera -----------------------------------------
  -- Nasce e é consumida na MESMA transação. Existe só pra o caminho do
  -- selo ser um só: o interno não precisa saber se a autenticação foi
  -- agora ou dois minutos atrás, na tela.
  --
  -- Amarrada ao `p_document_hash` DO RETORNO — é o que o interno confere
  -- ao consumir (`a.document_hash = p_document_hash`), junto de tenant,
  -- motoboy, não-consumida e não-expirada, tudo na mesma cláusula.
  insert into public.motoboy_autorizacoes
    (tenant_id, credencial_id, motoboy_id, document_hash, expira_em)
  values
    (v_tenant, v_auth.credencial_id, p_motoboy_id, p_document_hash,
     now() + interval '1 minute')
  returning id into v_autorizacao_id;

  -- ---- 8. o selo, o mesmo dos dois caminhos ------------------------------
  return public.selar_romaneio_retorno_interno(
    p_responsavel_id, p_romaneio_id, p_saida_romaneio_id, p_saida_document_hash,
    p_motoboy_id, p_retorno, p_document_hash, v_autorizacao_id,
    p_responsavel_strokes, p_motoboy_strokes, p_ocorrido_em_local,
    'offline_sincronizada', p_ip, p_geolocalizacao);
end;
$$;

-- Só a Edge Function alcança isto. Um `authenticated` que a alcançasse
-- escolheria de quem é o retorno — o `p_responsavel_id` é confiável
-- justamente porque quem chama já provou a identidade contra o JWT.
--
-- O `revoke` explícito não é decorativo: o Supabase configura
-- `alter default privileges ... grant all ... to anon, authenticated`,
-- então função nova nasce COM TUDO LIBERADO.
revoke all on function public.selar_romaneio_retorno_sincronizado(
  uuid, uuid, uuid, text, uuid, jsonb, text, text, text,
  jsonb, jsonb, timestamptz, inet, jsonb
) from public, anon, authenticated;

grant execute on function public.selar_romaneio_retorno_sincronizado(
  uuid, uuid, uuid, text, uuid, jsonb, text, text, text,
  jsonb, jsonb, timestamptz, inet, jsonb
) to service_role;

-- =====================================================================
-- CONFERÊNCIA 1 — SEM NENHUMA ESCRITA
--
-- Cole no SQL Editor DEPOIS de aplicar. O ERRO VERMELHO É O RESULTADO —
-- o `raise exception` do fim é como o relatório aparece, e ele garante
-- que nada fica pendurado.
--
-- O caminho feliz NÃO está aqui e não tem como estar: exige cartão físico
-- e PIN, e é E2E de tela (2D). O que estas quatro linhas provam é o
-- perímetro — quem pode chamar, e as três recusas que não escrevem.
--
-- A linha (b) é a mais interessante: ela passa um TOKEN LIXO junto de um
-- romaneio que já existe. Se o guard de reenvio estivesse depois da
-- autenticação, ela falharia na credencial; vindo `ja_existia`, está
-- provado que ele vem antes — que é a razão de ele ter subido pra cá.
-- =====================================================================
--
-- do $$
-- declare
--   v_rel  text := E'\n';
--   v_um   uuid;
--   v_res  jsonb;
--   v_zero uuid := '00000000-0000-0000-0000-000000000000';
-- begin
--   -- (a) quem alcança a função
--   v_rel := v_rel || format(
--     '(a) grants          anon=%s authenticated=%s service_role=%s   (esperado f/f/t)%s',
--     has_function_privilege('anon',          'public.selar_romaneio_retorno_sincronizado(uuid,uuid,uuid,text,uuid,jsonb,text,text,text,jsonb,jsonb,timestamptz,inet,jsonb)', 'execute'),
--     has_function_privilege('authenticated', 'public.selar_romaneio_retorno_sincronizado(uuid,uuid,uuid,text,uuid,jsonb,text,text,text,jsonb,jsonb,timestamptz,inet,jsonb)', 'execute'),
--     has_function_privilege('service_role',  'public.selar_romaneio_retorno_sincronizado(uuid,uuid,uuid,text,uuid,jsonb,text,text,text,jsonb,jsonb,timestamptz,inet,jsonb)', 'execute'),
--     E'\n');
--
--   -- (b) reenvio vem ANTES da credencial: token lixo, e mesmo assim responde
--   select r.id into v_um from public.romaneios r
--    where r.status = 'selado' order by r.numero limit 1;
--
--   v_res := public.selar_romaneio_retorno_sincronizado(
--     v_zero, v_um, v_zero, repeat('0', 64), v_zero, '[]'::jsonb,
--     repeat('0', 64), 'TOKEN-QUE-NAO-EXISTE', '000000',
--     '[]'::jsonb, '[]'::jsonb, now(), null, null);
--   v_rel := v_rel || format('(b) reenvio          %s   (esperado ja_existia=true)%s',
--                            coalesce(v_res ->> 'ja_existia', '(nulo)'), E'\n');
--
--   -- (c) responsável inexistente → exceção
--   begin
--     perform public.selar_romaneio_retorno_sincronizado(
--       v_zero, gen_random_uuid(), v_zero, repeat('0', 64), v_zero, '[]'::jsonb,
--       repeat('0', 64), 'x', '000000', '[]'::jsonb, '[]'::jsonb, now(), null, null);
--     v_rel := v_rel || '(c) responsavel      NAO RECUSOU  <-- ERRADO' || E'\n';
--   exception when others then
--     v_rel := v_rel || format('(c) responsavel      %s | %s%s', SQLSTATE, SQLERRM, E'\n');
--   end;
--
--   -- (d) saída inexistente, com responsável real → exceção
--   begin
--     perform public.selar_romaneio_retorno_sincronizado(
--       (select id from public.profiles where ativo order by criado_em limit 1),
--       gen_random_uuid(), gen_random_uuid(), repeat('0', 64), v_zero, '[]'::jsonb,
--       repeat('0', 64), 'x', '000000', '[]'::jsonb, '[]'::jsonb, now(), null, null);
--     v_rel := v_rel || '(d) saida            NAO RECUSOU  <-- ERRADO' || E'\n';
--   exception when others then
--     v_rel := v_rel || format('(d) saida            %s | %s%s', SQLSTATE, SQLERRM, E'\n');
--   end;
--
--   raise exception '%', v_rel;
-- end $$;
--
-- =====================================================================
-- CONFERÊNCIA 2 — OPCIONAL, E ELA QUEIMA NÚMERO DE ROMANEIO
--
-- Exercita os dois caminhos de CONFLITO (competência e autenticação).
-- Eles inserem em `romaneios`, e por isso esta conferência é separada e
-- opcional.
--
-- **`romaneios_numero_seq` NÃO VOLTA ATRÁS COM ROLLBACK.** O `raise` do
-- fim desfaz as LINHAS, mas os números gastos ficam gastos — e a próxima
-- saída real vai pular pra depois deles.
--
-- Isso tem uma consequência direta no GATE A, e é melhor saber antes:
-- a checagem `selados + conflitos = maior R- emitido` só fecha enquanto
-- nada tiver sido selado DEPOIS de números queimados. Ela fechou em
-- 20/08 (14 = 14) porque as conferências da 2B queimaram números e
-- nenhum romaneio real nasceu depois. No primeiro selo real seguinte ela
-- vai acusar `selados + conflitos < maior`, e isso NÃO é documento
-- perdido — é rollback de conferência.
--
-- A forma robusta da mesma pergunta, que não depende disso:
--
--     select count(*) = count(*) filter (where status in ('selado','conflito'))
--       from public.romaneios;
--
-- ou seja: toda linha existente é ou selada ou conflito, nenhuma some.
-- Os buracos na sequência passam a ser explicáveis por rollback em vez
-- de terem que ser zero.
-- =====================================================================
