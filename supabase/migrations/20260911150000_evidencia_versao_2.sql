-- =====================================================================
-- 4B.2a — a EVIDÊNCIA VERSÃO 2: a fórmula, congelada com vetores
--
-- A versão 1 é a de hoje: a manifestação de cada parte é um TRAÇO
-- manuscrito, e ele entra no `signature_hash`. A versão 2 é a do 4B: não
-- há traço nenhum, e o que o documento passa a afirmar é QUEM validou e
-- COMO — inclusive quando quem autenticou foi o gerente da filial, no
-- lugar do motoboy que perdeu o cartão ou esqueceu o PIN.
--
-- ESTA MIGRATION NÃO FAZ NINGUÉM ESCREVER VERSÃO 2. Ela acrescenta as
-- colunas, congela a fórmula e prova, na própria aplicação, que a fórmula
-- produz os bytes esperados. Quem passa a gravar v2 é a 4B.2b (selos e
-- autorização), e quem passa a ler as duas versões é o verificador, junto
-- com ela. Separar assim é o mesmo método do DCRR1: vetor primeiro,
-- implementação depois — senão o SQL e a especificação concordam por
-- terem sido escritos juntos, que é concordar consigo mesmo.
--
--
-- A FÓRMULA
--
--   interna (saída e retorno)
--     EV2|<document_hash>|<tipo_signatario>|<user_id>|<papel_no_momento>
--        |<instante>|<auth_method>
--
--   motoboy (normal ou por autorização do gerente)
--     EV2|<document_hash>|motoboy|<motoboy_id>|<credencial_id>
--        |<validador_profile_id>|<motivo_excecao>|<instante>|<auth_method>
--
--   nulo         '-'
--   instante     to_char(selado_em at time zone 'UTC',
--                        'YYYY-MM-DD HH24:MI:SS.US')
--   digest       sha256, hex
--
-- Três decisões que não são estilo:
--
-- 1. **`EV2` na frente.** Sem o prefixo, um hash de uma era poderia ser
--    lido como de outra; com ele, os domínios não se encostam.
-- 2. **`credencial_id`, `validador_profile_id` e `motivo_excecao` DENTRO
--    do digest.** É isso que torna "quem autorizou" verificável. Fossem
--    só colunas ao lado, trocar o gerente ou trocar `cartao_perdido` por
--    `pin_esquecido` num UPDATE não quebraria conferência nenhuma — e o
--    documento assinado passaria a dizer outra coisa sem que nada
--    acusasse.
-- 3. **O instante entra por `to_char` com máscara explícita**, como o
--    DCRR1 já faz, e nunca pelo `::text` da fórmula histórica da saída,
--    cujo texto depende do fuso da sessão. A fórmula velha continua como
--    está — ela é reproduzida, não melhorada.
--
-- `papel_no_momento` entra também na evidência interna da SAÍDA. Na
-- versão 1 ele era metadado ao lado; aqui a camada muda de qualquer
-- forma, e deixar de fora um dado que o documento apresenta seria
-- apresentar o que ninguém assinou.
-- =====================================================================


-- =====================================================================
-- 0. PRÉ-VOO
-- =====================================================================

do $$
declare
  v_ja boolean;
  v_sem_traco int;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'assinaturas'
       and column_name = 'versao_evidencia'
  ) into v_ja;

  if v_ja then
    raise exception 'versao_evidencia já existe — esta migration já foi aplicada.';
  end if;

  -- Toda assinatura de hoje tem traço. Se não tivesse, o CHECK da versão
  -- 1 falharia no meio da migration, e é melhor descobrir antes.
  select count(*) into v_sem_traco from public.assinaturas where strokes is null;
  if v_sem_traco > 0 then
    raise exception '% assinatura(s) sem strokes — investigar antes.', v_sem_traco;
  end if;

  raise notice 'Pré-voo OK. Assinaturas hoje: % (todas versão 1).',
    (select count(*) from public.assinaturas);
end $$;


-- =====================================================================
-- 1. AS COLUNAS
--
-- O CHECK é o que torna estado incoerente IMPOSSÍVEL DE REPRESENTAR, em
-- vez de improvável — a mesma escolha do §59 do NOTAS:
--
--   versão 1  tem traço, e não tem validador nem motivo (a exceção do
--             gerente não existia nessa era)
--   versão 2  NÃO tem traço; validador e motivo andam juntos (um sem o
--             outro seria "autorizado por ninguém" ou "autorizado sem
--             motivo"), e só existem na linha do MOTOBOY, que é a única
--             que alguém pode autorizar no lugar de outro
--   outra     recusada. Versão desconhecida não entra nem por UPDATE
-- =====================================================================

alter table public.assinaturas
  add column versao_evidencia smallint not null default 1,
  add column validador_profile_id uuid references public.profiles(id),
  add column motivo_excecao text
    check (motivo_excecao in ('cartao_perdido', 'pin_esquecido', 'ambos'));

alter table public.assinaturas
  alter column strokes drop not null;

alter table public.assinaturas
  add constraint assinaturas_evidencia_coerente check (
    case versao_evidencia
      when 1 then strokes is not null
              and validador_profile_id is null
              and motivo_excecao is null
      when 2 then strokes is null
              and (validador_profile_id is null) = (motivo_excecao is null)
              and (validador_profile_id is null or tipo_signatario = 'motoboy')
      else false
    end
  );

create index on public.assinaturas (validador_profile_id)
  where validador_profile_id is not null;

-- A autorização de uso único carrega a mesma dupla, e pelo mesmo motivo:
-- é ela que o selo lê pra saber que aquela operação foi autorizada por
-- alguém que não é o motoboy, e por quê.
alter table public.motoboy_autorizacoes
  add column validador_profile_id uuid references public.profiles(id),
  add column motivo_excecao text
    check (motivo_excecao in ('cartao_perdido', 'pin_esquecido', 'ambos'));

alter table public.motoboy_autorizacoes
  add constraint motoboy_autorizacoes_excecao_coerente
  check ((validador_profile_id is null) = (motivo_excecao is null));


-- =====================================================================
-- 2. A FÓRMULA, EM DUAS FUNÇÕES
--
-- `evidencia_texto_v2` existe separada do hash de propósito, e não é
-- luxo: é ela que permite olhar os bytes quando alguém precisar entender
-- uma divergência, sem ter que reconstruir a concatenação de cabeça. Foi
-- o que `conferir_canonico_retorno` comprou no DCRR1.
--
-- Pura e IMMUTABLE: mesma entrada, mesma saída, sempre — inclusive quando
-- o `TimeZone` da sessão for outro, porque o `at time zone 'UTC'` é
-- explícito.
-- =====================================================================

create or replace function public.evidencia_texto_v2(
  p_document_hash        text,
  p_tipo_signatario      text,
  p_identidade           uuid,   -- user_id na interna, motoboy_id na do motoboy
  p_papel_no_momento     text,   -- só interna
  p_credencial_id        uuid,   -- só motoboy
  p_validador_profile_id uuid,   -- só motoboy, e só na exceção
  p_motivo_excecao       text,   -- idem
  p_selado_em            timestamptz,
  p_auth_method          text
)
returns text language sql immutable set search_path = public as $$
  select case
    when p_tipo_signatario = 'motoboy' then
      'EV2|' || p_document_hash
        || '|' || p_tipo_signatario
        || '|' || coalesce(p_identidade::text, '-')
        || '|' || coalesce(p_credencial_id::text, '-')
        || '|' || coalesce(p_validador_profile_id::text, '-')
        || '|' || coalesce(p_motivo_excecao, '-')
        || '|' || to_char(p_selado_em at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')
        || '|' || coalesce(p_auth_method, '-')
    else
      'EV2|' || p_document_hash
        || '|' || p_tipo_signatario
        || '|' || coalesce(p_identidade::text, '-')
        || '|' || coalesce(p_papel_no_momento, '-')
        || '|' || to_char(p_selado_em at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')
        || '|' || coalesce(p_auth_method, '-')
  end;
$$;

create or replace function public.evidencia_hash_v2(
  p_document_hash        text,
  p_tipo_signatario      text,
  p_identidade           uuid,
  p_papel_no_momento     text,
  p_credencial_id        uuid,
  p_validador_profile_id uuid,
  p_motivo_excecao       text,
  p_selado_em            timestamptz,
  p_auth_method          text
)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(digest(public.evidencia_texto_v2(
    p_document_hash, p_tipo_signatario, p_identidade, p_papel_no_momento,
    p_credencial_id, p_validador_profile_id, p_motivo_excecao,
    p_selado_em, p_auth_method
  ), 'sha256'), 'hex');
$$;

-- O verificador roda como `security invoker` e vai chamar as duas, então
-- elas precisam ser executáveis por quem verifica. São matemática pura:
-- não leem tabela nenhuma e não decidem permissão nenhuma.
revoke all on function public.evidencia_texto_v2(text, text, uuid, text, uuid, uuid, text, timestamptz, text)
  from public, anon;
revoke all on function public.evidencia_hash_v2(text, text, uuid, text, uuid, uuid, text, timestamptz, text)
  from public, anon;
grant execute on function public.evidencia_texto_v2(text, text, uuid, text, uuid, uuid, text, timestamptz, text)
  to authenticated;
grant execute on function public.evidencia_hash_v2(text, text, uuid, text, uuid, uuid, text, timestamptz, text)
  to authenticated;


-- =====================================================================
-- 3. OS VETORES — e eles rodam AGORA, não no rodapé
--
-- Os digests abaixo foram calculados FORA do banco, com sha256 sobre a
-- string do comentário de cada caso. Não são "o que o SQL devolveu":
-- são uma terceira referência, escrita antes de existir chamador — que é
-- o que impede a implementação e a especificação concordarem por terem
-- sido escritas juntas.
--
-- Estar dentro de um DO block (e não num comentário de conferência) faz a
-- migration SE RECUSAR A APLICAR se a fórmula não produzir exatamente
-- estes bytes. Depois que o primeiro documento versão 2 for selado, esses
-- digests viram parte permanente do histórico, e é melhor que o erro
-- apareça agora.
-- =====================================================================

do $$
declare
  c_doc  constant text := 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  c_user constant uuid := '00000000-0000-4000-8000-000000000001';
  c_moto constant uuid := '00000000-0000-4000-8000-000000000002';
  c_cred constant uuid := '00000000-0000-4000-8000-000000000003';
  c_ger  constant uuid := '00000000-0000-4000-8000-000000000004';
  c_em   constant timestamptz := '2026-09-11 18:42:07.123456+00';
  v_dif  text := '';
begin
  -- V1 — interna da saída, confirmada pela sessão
  if public.evidencia_hash_v2(c_doc, 'caixa', c_user, 'caixa', null, null, null,
                              c_em, 'sessao_confirmacao_explicita')
     <> '05412bdd48fcdc43411718a62c33ec9c8c3f1d37e0caa0e0d60f46300c10f5de' then
    v_dif := v_dif || E'  V1 interna da saída\n';
  end if;

  -- V2 — interna do retorno, com o papel de quem recebeu
  if public.evidencia_hash_v2(c_doc, 'responsavel_loja', c_user, 'gerente', null, null, null,
                              c_em, 'sessao_confirmacao_explicita')
     <> '6831fbeb3e19e82d418563026786b8b5fb0584b82a8c902671943b4894c7704a' then
    v_dif := v_dif || E'  V2 interna do retorno\n';
  end if;

  -- V3 — interna sem papel gravado: o nulo vira '-', e não some
  if public.evidencia_hash_v2(c_doc, 'caixa', c_user, null, null, null, null,
                              c_em, 'sessao_confirmacao_explicita')
     <> '27f61737561037adc2f64ba30ea248a0e80b606f3b8ca9b6d79973201d38b721' then
    v_dif := v_dif || E'  V3 interna sem papel\n';
  end if;

  -- V4 — motoboy no fluxo normal: sem validador, sem motivo
  if public.evidencia_hash_v2(c_doc, 'motoboy', c_moto, null, c_cred, null, null,
                              c_em, 'physical_card_pin_server_verified')
     <> '2bbfd8104b169c82d03a4deb1fc378f11943924b2038cf3a919c1e5ca3d4daa1' then
    v_dif := v_dif || E'  V4 motoboy no fluxo normal\n';
  end if;

  -- V5 — autorizado pelo gerente, cartão perdido
  if public.evidencia_hash_v2(c_doc, 'motoboy', c_moto, null, c_cred, c_ger, 'cartao_perdido',
                              c_em, 'gerente_card_pin_server_verified')
     <> 'ab142fce3d477ef649a28a3497f524bf55d9bb33f0f1515bf618c7d73c91d660' then
    v_dif := v_dif || E'  V5 gerente, cartão perdido\n';
  end if;

  -- V6 — autorizado pelo gerente offline, os dois motivos
  if public.evidencia_hash_v2(c_doc, 'motoboy', c_moto, null, c_cred, c_ger, 'ambos',
                              c_em, 'gerente_card_pin_offline_then_verified')
     <> '3f19a2a2dd65397283391c33962caff99e030b146abe21a9416ad27f121d027f' then
    v_dif := v_dif || E'  V6 gerente, ambos, offline\n';
  end if;

  -- O instante NÃO pode depender do fuso da sessão. Se depender, um
  -- verificador rodando noutra máquina acusaria divergência onde não há.
  perform set_config('TimeZone', 'America/Sao_Paulo', true);
  if public.evidencia_hash_v2(c_doc, 'motoboy', c_moto, null, c_cred, c_ger, 'ambos',
                              c_em, 'gerente_card_pin_offline_then_verified')
     <> '3f19a2a2dd65397283391c33962caff99e030b146abe21a9416ad27f121d027f' then
    v_dif := v_dif || E'  V7 o fuso da sessão mudou o hash\n';
  end if;
  perform set_config('TimeZone', 'UTC', true);

  -- Trocar o validador ou o motivo TEM que mudar o digest — é isso que
  -- torna "quem autorizou" verificável, e não só uma coluna ao lado.
  if public.evidencia_hash_v2(c_doc, 'motoboy', c_moto, null, c_cred, c_user, 'cartao_perdido',
                              c_em, 'gerente_card_pin_server_verified')
     = 'ab142fce3d477ef649a28a3497f524bf55d9bb33f0f1515bf618c7d73c91d660' then
    v_dif := v_dif || E'  V8 trocar o gerente NÃO mudou o hash\n';
  end if;

  if public.evidencia_hash_v2(c_doc, 'motoboy', c_moto, null, c_cred, c_ger, 'pin_esquecido',
                              c_em, 'gerente_card_pin_server_verified')
     = 'ab142fce3d477ef649a28a3497f524bf55d9bb33f0f1515bf618c7d73c91d660' then
    v_dif := v_dif || E'  V9 trocar o motivo NÃO mudou o hash\n';
  end if;

  if v_dif <> '' then
    raise exception E'A fórmula da evidência v2 não bate com os vetores congelados:\n%', v_dif;
  end if;

  raise notice 'Vetores da evidência v2: 9 de 9.';
end $$;


-- =====================================================================
-- CONFERÊNCIAS — no SQL Editor, depois de aplicar
--
-- (a) as colunas e o CHECK
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'assinaturas'
--      and column_name in ('strokes','versao_evidencia','validador_profile_id','motivo_excecao')
--    order by column_name;
--   -- esperado: strokes YES (nulável agora), versao_evidencia NO,
--   -- validador_profile_id YES, motivo_excecao YES
--
--   select count(*) as todas, count(*) filter (where versao_evidencia = 1) as v1
--     from public.assinaturas;
--   -- esperado: os dois números iguais — nada nasceu v2 ainda
--
--
-- (b) o CHECK recusa cada forma incoerente
--
--   do $conf$
--   declare v_id uuid; v_t uuid; v_c uuid;
--   begin
--     select id, tenant_id, corrida_id into v_id, v_t, v_c
--       from public.assinaturas where versao_evidencia = 1 limit 1;
--
--     begin
--       update public.assinaturas set versao_evidencia = 2 where id = v_id;
--       raise exception 'FALHOU: aceitou v2 com traço.';
--     exception when check_violation then raise notice 'OK: v2 com traço recusada.';
--     end;
--
--     begin
--       update public.assinaturas set versao_evidencia = 3 where id = v_id;
--       raise exception 'FALHOU: aceitou versão desconhecida.';
--     exception when check_violation then raise notice 'OK: versão 3 recusada.';
--     end;
--
--     begin
--       update public.assinaturas set motivo_excecao = 'ambos' where id = v_id;
--       raise exception 'FALHOU: aceitou motivo na versão 1.';
--     exception when check_violation then raise notice 'OK: motivo em v1 recusado.';
--     end;
--   end $conf$;
--   -- esperado: três "OK". Nada é alterado: a exceção desfaz tudo.
--
--
-- (c) a fórmula, à mão, pra olhar os bytes
--
--   select public.evidencia_texto_v2(
--     'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
--     'motoboy', '00000000-0000-4000-8000-000000000002',
--     null, '00000000-0000-4000-8000-000000000003',
--     '00000000-0000-4000-8000-000000000004', 'cartao_perdido',
--     '2026-09-11 18:42:07.123456+00', 'gerente_card_pin_server_verified');
--   -- esperado, exatamente:
--   -- EV2|a1b2…8f90|motoboy|…0002|…0003|…0004|cartao_perdido|
--   --    2026-09-11 18:42:07.123456|gerente_card_pin_server_verified
--
--
-- (d) nenhum documento se moveu — de novo 22 · 22 · 0
--
--   select * from public.verificar_integridade_resumo();
--
--   As colunas novas não entram em fórmula nenhuma da versão 1, e o
--   verificador ainda nem sabe que a versão 2 existe (isso é a 4B.2b).
--   Qualquer número diferente aqui e alguma outra coisa mudou junto.
-- =====================================================================
