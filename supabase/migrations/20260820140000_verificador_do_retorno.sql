-- =====================================================================
-- ETAPA 2B.4 — O VERIFICADOR PASSA A COBRIR O ROMANEIO DE RETORNO
--
-- ---------------------------------------------------------------------
-- POR QUE ISTO NÃO PODE ESPERAR A 2C
-- ---------------------------------------------------------------------
-- `verificar_romaneios_selados()` filtra por `status = 'selado'`, NÃO por
-- tipo. Um romaneio de retorno selado já entraria no placar hoje — e
-- entraria reportando as duas camadas de assinatura como DIVERGENTES,
-- porque o verificador aplicaria a fórmula da saída a um documento cuja
-- fórmula tem `papel_no_momento` dentro do digest e usa `to_char` no
-- lugar do cast.
--
-- O baseline sairia de `10 · 10 · 0` para `11 · 10 · 2`, e a divergência
-- não seria de integridade nenhuma: seria o instrumento medindo a coisa
-- errada. Instrumento que acusa defeito onde não há é pior que
-- instrumento que não mede — o primeiro custa uma investigação e a
-- confiança no resto do placar.
--
-- (O rodapé de `20260820130000` diz que o baseline "continua 10 · 10 · 0
-- mesmo depois do primeiro retorno selado". Está errado, e esta migration
-- é a correção.)
--
-- ---------------------------------------------------------------------
-- UM ORQUESTRADOR, FÓRMULAS SEPARADAS — a trava que decide o desenho
-- ---------------------------------------------------------------------
--     verificar_romaneio(id)
--       ├── lê `assinaturas.tipo_signatario` DA LINHA        (sempre)
--       ├── romaneios.tipo = 'saida'   → fórmula DCR1  (histórica)
--       ├── romaneios.tipo = 'retorno' → fórmula DCRR1
--       └── diagnóstico uniforme, camada por camada
--
-- **A FÓRMULA DA SAÍDA É MOVIDA, NUNCA MELHORADA.** Ela concatena
-- `selado_em::text`, que depende do `TimeZone` da sessão — daí o
-- `set timezone = 'UTC'` no nível da função, que continua aqui e continua
-- sendo o que a torna reproduzível. Isso é um defeito histórico da
-- fórmula, e o verificador existe pra reproduzir o documento COMO ELE FOI
-- CRIADO, defeitos incluídos. O `to_char` do retorno conserta a fórmula
-- NOVA; ele não muda retroativamente o significado de nenhum hash já
-- assinado, e "consertar" a da saída aqui transformaria a ferramenta de
-- medir em fonte de divergência.
--
-- O teste da extração é o mais simples que existe:
--
--     antes:  10 · 10 · 0
--     depois: 10 · 10 · 0
--
-- Um único resultado diferente e a extração mexeu em algo. Para ali.
--
-- ---------------------------------------------------------------------
-- LITERAL ESPERADO ≠ VALOR DA LINHA
-- ---------------------------------------------------------------------
-- O despacho SABE o que esperar estruturalmente:
--
--     DCR1   caixa            + motoboy
--     DCRR1  responsavel_loja + motoboy
--
-- e usa isso pra VALIDAR a estrutura. Mas a recomputação criptográfica
-- usa o valor gravado em `assinaturas.tipo_signatario`, sempre. Substituir
-- o valor da linha pelo literal esperado na hora do digest é fixar o
-- literal com passos extras — e um documento com o campo divergente
-- passaria a "verificar" contra uma fórmula que não é a dele.
--
-- ---------------------------------------------------------------------
-- PROBLEMA ESTRUTURAL TEM DIAGNÓSTICO PRÓPRIO
-- ---------------------------------------------------------------------
-- Coluna nova `resultado`, com três valores em vez de um booleano:
--
--     OK                    recalculou e bateu
--     DIVERGENTE            recalculou e NÃO bateu
--     INVARIANTE_VIOLADA    não dá pra recalcular, e o motivo é o achado
--
-- `papel_no_momento` nulo numa assinatura de retorno é o caso que motivou
-- isso. Um `coalesce(papel_no_momento, '')` produziria um hash que não
-- bate e reportaria DIVERGENTE — escondendo uma violação de estrutura
-- atrás de uma aparência de adulteração criptográfica, que manda o
-- investigador procurar a coisa errada por horas.
--
-- Mesma filosofia pros outros impossíveis: assinatura faltando,
-- `tipo_signatario` inesperado pro protocolo, e retorno cujo
-- `romaneio_saida_id` aponta pra lugar nenhum. Nenhum deles vira hash
-- mismatch genérico.
--
-- `ok` continua existindo (é `resultado = 'OK'`) pra quem já contava com
-- ele. As duas formas de não-OK contam como divergência no placar, o que
-- é certo: as duas exigem gente olhando.
--
-- ---------------------------------------------------------------------
-- CONFLITO NÃO ENTRA NO DENOMINADOR
-- ---------------------------------------------------------------------
-- Os romaneios em conflito que a 2B preserva com os dois traços são
-- evidência de uma tentativa RECUSADA. Eles não são documento selado, não
-- têm `final_hash`, e as assinaturas deles vivem em `romaneios.conflito`.
-- Contá-los no placar de integridade transformaria "recusamos
-- corretamente" em "temos documento corrompido".
--
-- O resumo os CONTA à parte, numa linha própria, porque zero conflito e
-- doze conflitos são fatos diferentes e nenhum dos dois é divergência.
-- Verificar a evidência guardada dentro deles é outro relatório, e não se
-- mistura com este.
-- =====================================================================


-- =====================================================================
-- O DROP + CREATE, E AS DUAS PROTEÇÕES QUE ELE EXIGE
--
-- `create or replace` não muda as colunas de `returns table`, e
-- `resultado` é coluna nova. Então é drop e recria — numa função que já
-- existe em produção.
--
-- O risco aqui NÃO é criptográfico: é recriar a função certa com
-- permissão diferente da anterior e ninguém perceber. Um `grant` que
-- some deixa o verificador inalcançável pela tela; um que sobra expõe
-- leitura que a RLS deveria escopar.
--
--   1. TUDO NUMA TRANSAÇÃO, e SEM CASCADE. Sem transação, um erro no meio
--      deixa o banco sem verificador nenhum — e é justamente durante uma
--      migration do verificador que ninguém tem como medir se está tudo
--      bem. Sem `cascade` porque `cascade` derruba em silêncio o que
--      depender da função, e a graça é ser recusado se houver algo que
--      eu não previ.
--   2. OS ATRIBUTOS SÃO CAPTURADOS ANTES E CONFERIDOS DEPOIS. Owner,
--      volatilidade, security, `proconfig` e ACL são lidos de `pg_proc`
--      antes do drop e comparados depois; divergiu, a transação é
--      desfeita. "Recriei igual" vira medição em vez de leitura de
--      código.
--
--      A captura vai num GUC de transação (`set_config(..., true)`) e
--      NÃO numa tabela temporária. Temp table resolveria igual — vive em
--      `pg_temp`, some no commit e nenhuma outra sessão a enxerga —, mas
--      o linter do SQL Editor não distingue `create temp table` de
--      `create table` e para pra perguntar sobre RLS. Fazer alguém
--      decidir sobre um falso positivo no meio de uma migration é como
--      se aprende a clicar em "sim" sem ler. O GUC não cria objeto
--      nenhum, e `is_local = true` o desfaz junto com a transação.
--
-- As funções antigas não têm `comment on function` (conferido), então não
-- há comentário a restaurar.
-- =====================================================================

begin;

do $$
declare
  v_antes jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'proname',     p.proname,
           'owner',       pg_get_userbyid(p.proowner),
           'provolatile', p.provolatile,                     -- 's' = stable
           'prosecdef',   p.prosecdef,                       -- false = invoker
           'proconfig',   to_jsonb(coalesce(p.proconfig, '{}'::text[])),
           -- ACL como conjunto ORDENADO: a ordem dos `aclitem` segue a
           -- ordem dos grants, e comparar texto cru reprovaria um
           -- resultado certo por causa dela.
           'acl', to_jsonb((select coalesce(array_agg(x::text order by x::text), '{}'::text[])
                              from unnest(coalesce(p.proacl, '{}'::aclitem[])) x))
         ) order by p.proname), '[]'::jsonb)
    into v_antes
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('verificar_romaneio', 'verificar_romaneios_selados');

  perform set_config('app.verificador_antes', v_antes::text, true);
end $$;

-- A dependente cai primeiro: `verificar_romaneios_selados` chama a base,
-- e sem isso o drop da base é recusado (que é o comportamento certo).
drop function if exists public.verificar_romaneios_selados();
drop function if exists public.verificar_romaneio(uuid);


-- =====================================================================
-- 1. VERIFICAR UM ROMANEIO, CAMADA POR CAMADA
--
-- `security invoker` de propósito, como antes: o verificador enxerga
-- exatamente o que quem chama enxerga, então a RLS continua valendo e um
-- caixa não verifica romaneio de outra filial.
--
-- `set timezone = 'UTC'` NÃO É DECORAÇÃO e não pode sair: a fórmula da
-- saída concatena `selado_em::text`, cujo texto depende do fuso da
-- sessão. Todas as selagens vieram por PostgREST em UTC, então UTC é a
-- reconstrução certa — e continua sendo uma RECONSTRUÇÃO, porque o fuso
-- da selagem não está gravado em lugar nenhum. A fórmula do retorno não
-- depende disto (ela tem `at time zone 'UTC'` explícito), e é justamente
-- essa a diferença que o `to_char` comprou.
-- =====================================================================

create function public.verificar_romaneio(p_romaneio_id uuid)
returns table (
  camada           text,
  -- OK                  recalculou e bateu
  -- DIVERGENTE          recalculou e NÃO bateu
  -- INVARIANTE_VIOLADA  não dá pra recalcular, e o motivo é o achado
  -- NAO_VERIFICAVEL     depende de uma camada que já falhou; não houve
  --                     recomputação, então chamar de DIVERGENTE seria
  --                     afirmar uma discordância que ninguém mediu
  -- NAO_APLICAVEL       não é documento selado (conflito)
  resultado        text,
  -- `resultado = 'OK'`, e NULO quando a métrica não se aplica. Falso ali
  -- diria "verificado e reprovado", que é outra coisa.
  ok               boolean,
  hash_gravado     text,
  hash_recalculado text,
  detalhe          text
)
language plpgsql stable security invoker
set search_path = public, extensions
set timezone = 'UTC'
set datestyle = 'ISO, MDY'
as $$
declare
  r                record;
  a                record;
  v_protocolo      text;
  v_interna_esp    text;   -- o tipo_signatario que ESTE protocolo espera
  v_recalc         text;
  v_ultimo         text;
  v_id             text;
  v_instante       text;
  v_hash_interna   text;
  v_hash_motoboy   text;
  v_final          text;
  v_vistos         text[] := '{}';
  v_violou         text;
  v_saida          record;
  v_linha_saida    text;
  v_linha_hash     text;
  v_saida_doc      text;
  v_hash_doc       text;
  v_falta          text;
begin
  select ro.id, ro.numero, ro.status, ro.modo, ro.tipo, ro.canonico,
         ro.document_hash, ro.final_hash, ro.selado_em, ro.romaneio_saida_id
    into r
    from public.romaneios ro
   where ro.id = p_romaneio_id;

  if not found then
    return query select 'romaneio'::text, 'INVARIANTE_VIOLADA'::text, false,
                        null::text, null::text,
                        'não encontrado (ou fora do alcance da RLS)'::text;
    return;
  end if;

  -- Conflito não é falha de verificação: é documento de outra natureza.
  -- `ok` NULO e não `true`: verdadeiro diria "verificado e íntegro", e
  -- aqui não houve verificação nenhuma. É a mesma distinção que faz a
  -- linha de conflito do resumo vir com `divergencias` nula.
  if r.status <> 'selado' then
    return query select 'nao_aplicavel'::text, 'NAO_APLICAVEL'::text, null::boolean,
                        null::text, null::text,
                        format('romaneio %s tem status %s — evidência de tentativa recusada, não documento selado',
                               r.numero, r.status);
    return;
  end if;

  -- ---- o protocolo, e o que ele espera estruturalmente ----------------
  if r.tipo = 'retorno' then
    v_protocolo   := 'DCRR1';
    v_interna_esp := 'responsavel_loja';
  else
    v_protocolo   := 'DCR1';
    v_interna_esp := 'caixa';
  end if;

  -- ---- camada 0 (só retorno): O CHÃO CITADO É O CHÃO REAL -------------
  --
  -- Esta camada responde pela RELAÇÃO ENTRE OS DOIS DOCUMENTOS, e não
  -- pelo hash interno do retorno. A distinção decide o desenho: um DCRR1
  -- pode ser criptograficamente autoconsistente — canônico, as duas
  -- assinaturas e o envelope todos fechando — e ainda assim apontar pra
  -- saída errada. As outras quatro camadas passariam. É esta que pega.
  --
  -- E O `saida_hash` VEM DO CANÔNICO, não de coluna de conveniência.
  -- `romaneio_saida_id` é operacional; a linha `saida_hash` do DCRR1 é o
  -- que as duas partes ASSINARAM. Comparar coluna com coluna provaria
  -- consistência do banco consigo mesmo; comparar o documento com o
  -- banco é o que interessa.
  --
  -- A semântica, congelada:
  --   saída não existe / não é saída / não está selada  → INVARIANTE_VIOLADA
  --   o documento cita outra saída                      → DIVERGENTE
  --   saida_hash assinado ≠ document_hash da saída      → DIVERGENTE
  --   existe, é a certa, e o hash corresponde           → OK
  if r.tipo = 'retorno' then
    -- Linhas 2 e 3 do DCRR1: `saida\t<uuid>` e `saida_hash\t<hex64>`.
    v_linha_saida := split_part(coalesce(r.canonico, ''), e'\n', 2);
    v_linha_hash  := split_part(coalesce(r.canonico, ''), e'\n', 3);
    v_saida_doc   := nullif(split_part(v_linha_saida, e'\t', 2), '');
    v_hash_doc    := nullif(split_part(v_linha_hash,  e'\t', 2), '');

    select s.id, s.tipo, s.status, s.document_hash, s.numero into v_saida
      from public.romaneios s where s.id = r.romaneio_saida_id;

    if r.romaneio_saida_id is null then
      v_violou := 'retorno sem romaneio_saida_id';
    elsif r.canonico is null then
      v_violou := 'canônico ausente — não dá pra ler o saida_hash que foi assinado';
    elsif split_part(v_linha_saida, e'\t', 1) <> 'saida'
       or split_part(v_linha_hash, e'\t', 1) <> 'saida_hash' then
      v_violou := format('canônico não tem a forma do DCRR1 nas linhas 2 e 3 (achei "%s" e "%s")',
                         split_part(v_linha_saida, e'\t', 1),
                         split_part(v_linha_hash, e'\t', 1));
    elsif v_saida.id is null then
      v_violou := format('romaneio_saida_id %s não existe', r.romaneio_saida_id);
    elsif v_saida.tipo <> 'saida' then
      v_violou := format('romaneio_saida_id %s é do tipo "%s", não "saida"',
                         r.romaneio_saida_id, v_saida.tipo);
    elsif v_saida.status <> 'selado' then
      v_violou := format('saída %s está com status "%s" — um retorno não fecha o que não foi selado',
                         v_saida.numero, v_saida.status);
    end if;

    if v_violou is not null then
      return query select 'saida_referenciada'::text, 'INVARIANTE_VIOLADA'::text, false,
                          v_hash_doc, null::text, v_violou;
    elsif lower(v_saida_doc) is distinct from lower(r.romaneio_saida_id::text) then
      -- O documento assinado cita uma saída, a coluna aponta pra outra.
      return query select 'saida_referenciada'::text, 'DIVERGENTE'::text, false,
                          v_saida_doc, r.romaneio_saida_id::text,
                          'o DCRR1 assinado cita uma saída diferente da que a coluna aponta'::text;
    elsif v_hash_doc is distinct from v_saida.document_hash then
      return query select 'saida_referenciada'::text, 'DIVERGENTE'::text, false,
                          v_hash_doc, v_saida.document_hash,
                          format('o saida_hash assinado não é o document_hash da saída %s',
                                 v_saida.numero)::text;
    else
      return query select 'saida_referenciada'::text, 'OK'::text, true,
                          v_hash_doc, v_saida.document_hash,
                          format('fecha a saída %s', v_saida.numero)::text;
    end if;
    v_violou := null;
  end if;

  -- ---- camada 1: o canônico produz o document_hash --------------------
  -- IGUAL NOS DOIS PROTOCOLOS, e é ela que fecha a ponta que as outras
  -- três não fecham: sem esta camada, as assinaturas provariam estar
  -- amarradas ao hash ARMAZENADO, e não que esse hash ainda é o do
  -- documento. Alterar o canônico sozinho passaria despercebido.
  --
  -- Note que NÃO se recalcula o canônico a partir de `entregas` (na
  -- saída) nem do payload (no retorno). O documento é imutável, mas o
  -- vale pode ter sido corrigido depois (regra 7), e aí a divergência
  -- seria legítima e o verificador estaria medindo a coisa errada. O que
  -- se prova é que os BYTES ASSINADOS produzem o HASH ASSINADO.
  v_recalc := case when r.canonico is null then null
                   else encode(digest(r.canonico, 'sha256'), 'hex') end;
  return query select 'documento'::text,
                      case when r.canonico is null then 'INVARIANTE_VIOLADA'
                           when v_recalc = r.document_hash then 'OK'
                           else 'DIVERGENTE' end,
                      v_recalc is not null and v_recalc = r.document_hash,
                      r.document_hash, v_recalc,
                      case when r.canonico is null
                           then format('canônico ausente (%s)', v_protocolo)::text
                           else null::text end;

  -- ---- camada 2: cada assinatura --------------------------------------
  for a in
    select s.tipo_signatario, s.user_id, s.motoboy_id, s.strokes,
           s.signature_hash, s.hash_sha256, s.papel_no_momento
      from public.assinaturas s
     where s.romaneio_id = p_romaneio_id
     order by case s.tipo_signatario when 'motoboy' then 2 else 1 end
  loop
    v_violou := null;

    -- VALIDAÇÃO ESTRUTURAL pelo literal esperado…
    if a.tipo_signatario not in (v_interna_esp, 'motoboy') then
      v_violou := format('tipo_signatario "%s" não pertence ao protocolo %s (esperado "%s" ou "motoboy")',
                         a.tipo_signatario, v_protocolo, v_interna_esp);
    elsif a.tipo_signatario = any(v_vistos) then
      v_violou := format('duas assinaturas "%s" no mesmo documento', a.tipo_signatario);
    end if;
    v_vistos := v_vistos || a.tipo_signatario;

    -- …e RECOMPUTAÇÃO pelo valor da linha, sempre.
    if a.tipo_signatario = 'motoboy' then
      v_id     := a.motoboy_id::text;
      -- O motoboy fecha com `modo`, NÃO com `auth_method`. Vale nos dois
      -- protocolos: as duas fórmulas concatenam o modo do romaneio ali.
      v_ultimo := r.modo;
    else
      v_id     := a.user_id::text;
      v_ultimo := 'sessao_autenticada';
    end if;

    if v_violou is null and v_id is null then
      v_violou := format('assinatura "%s" sem id de quem assinou', a.tipo_signatario);
    elsif v_violou is null and a.strokes is null then
      v_violou := format('assinatura "%s" sem traços', a.tipo_signatario);
    elsif v_violou is null and r.selado_em is null then
      v_violou := 'romaneio selado sem selado_em — a fórmula não tem instante';
    end if;

    -- O CASO QUE MOTIVOU A COLUNA `resultado`. No DCRR1 o papel entra
    -- DENTRO do digest, então nulo não é "hash que não bate": é documento
    -- que não pode ser verificado. Calcular com string vazia reportaria
    -- DIVERGENTE e mandaria quem investiga procurar adulteração onde há
    -- um campo faltando.
    if v_violou is null
       and r.tipo = 'retorno'
       and a.tipo_signatario <> 'motoboy'
       and a.papel_no_momento is null then
      v_violou := 'papel_no_momento ausente em assinatura de Romaneio de Retorno — '
                  || 'ele entra no digest do DCRR1, então o hash não é recalculável';
    end if;

    if v_violou is not null then
      -- Não tenta calcular. `hash_recalculado` fica nulo de propósito:
      -- um valor ali sugeriria que houve recomputação.
      return query select ('assinatura:' || a.tipo_signatario)::text,
                          'INVARIANTE_VIOLADA'::text, false,
                          a.signature_hash, null::text, v_violou;
      continue;
    end if;

    if r.tipo = 'retorno' then
      -- FÓRMULA DCRR1. Duas diferenças da histórica, as duas deliberadas:
      -- o instante entra por `to_char` com máscara explícita (não depende
      -- do fuso da sessão), e o lado da farmácia carrega o papel.
      v_instante := to_char(r.selado_em at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US');
      if a.tipo_signatario = 'motoboy' then
        v_recalc := encode(digest(
          r.document_hash || '|' || a.tipo_signatario || '|' || v_id
            || '|' || a.strokes::text
            || '|' || v_instante
            || '|' || v_ultimo, 'sha256'), 'hex');
      else
        v_recalc := encode(digest(
          r.document_hash || '|' || a.tipo_signatario || '|' || v_id
            || '|' || a.papel_no_momento
            || '|' || a.strokes::text
            || '|' || v_instante
            || '|' || v_ultimo, 'sha256'), 'hex');
      end if;
    else
      -- FÓRMULA DCR1 — HISTÓRICA, MOVIDA E NÃO MELHORADA.
      -- `selado_em::text` fica como está: o texto depende do `TimeZone` da
      -- sessão, e é o `set timezone = 'UTC'` da função que o reproduz. O
      -- papel NÃO entra, mesmo quando `papel_no_momento` está preenchido
      -- (desde o `R-000013`) — ele é metadado ao lado nesta era.
      v_recalc := encode(digest(
        r.document_hash || '|' || a.tipo_signatario || '|' || v_id
          || '|' || a.strokes::text
          || '|' || r.selado_em::text
          || '|' || v_ultimo, 'sha256'), 'hex');
    end if;

    if a.tipo_signatario = 'motoboy' then
      v_hash_motoboy := a.signature_hash;
    else
      v_hash_interna := a.signature_hash;
    end if;

    return query select ('assinatura:' || a.tipo_signatario)::text,
                        case when v_recalc = a.signature_hash then 'OK' else 'DIVERGENTE' end,
                        v_recalc = a.signature_hash,
                        a.signature_hash, v_recalc,
                        case when a.signature_hash is distinct from a.hash_sha256
                             then 'signature_hash e hash_sha256 divergem entre si'::text
                             else null::text end;
  end loop;

  -- Assinatura FALTANDO é estrutura, não hash. Sem isto, a ausência
  -- apareceria só como um `final` que não fecha, e o motivo ficaria
  -- escondido numa camada que não é a dele.
  if not (v_interna_esp = any(v_vistos)) then
    return query select ('assinatura:' || v_interna_esp)::text,
                        'INVARIANTE_VIOLADA'::text, false, null::text, null::text,
                        format('documento %s sem a assinatura interna', v_protocolo);
  end if;
  if not ('motoboy' = any(v_vistos)) then
    return query select 'assinatura:motoboy'::text,
                        'INVARIANTE_VIOLADA'::text, false, null::text, null::text,
                        format('documento %s sem a assinatura do motoboy', v_protocolo);
  end if;

  -- ---- camada 3: o envelope -------------------------------------------
  -- Fórmula IDÊNTICA nos dois protocolos: documento, interna, motoboy —
  -- e é a ordem da fórmula, não a de inserção das linhas. Por isso o laço
  -- guarda cada hash pelo tipo em vez de acumular numa lista.
  --
  -- FALTANDO UMA ASSINATURA, ISTO NÃO É DIVERGÊNCIA. Não houve
  -- recomputação, então não há discordância medida — chamar de
  -- DIVERGENTE inventaria uma segunda corrupção a partir da primeira, e
  -- mandaria quem investiga procurar dois problemas onde há um. O
  -- `resultado` diz `NAO_VERIFICAVEL` e o motivo aponta a dependência.
  --
  -- `v_hash_interna`/`v_hash_motoboy` só ficam preenchidos quando a
  -- assinatura correspondente foi RECALCULADA com sucesso de estrutura,
  -- então uma invariante violada lá em cima chega aqui como dependência,
  -- não como hash faltando.
  v_falta := case
    when v_hash_interna is null and v_hash_motoboy is null
      then format('as duas assinaturas (%s e motoboy)', v_interna_esp)
    when v_hash_interna is null then format('a assinatura %s', v_interna_esp)
    when v_hash_motoboy is null then 'a assinatura do motoboy'
  end;

  v_final := case
    when v_falta is not null then null
    else encode(digest(r.document_hash || '|' || v_hash_interna
                       || '|' || v_hash_motoboy, 'sha256'), 'hex')
  end;

  return query select 'final'::text,
                      case when v_falta is not null then 'NAO_VERIFICAVEL'
                           when v_final = r.final_hash then 'OK'
                           else 'DIVERGENTE' end,
                      case when v_falta is not null then false
                           else v_final = r.final_hash end,
                      r.final_hash, v_final,
                      case when v_falta is not null
                           then format('não recalculado: depende de %s, que não passou', v_falta)::text
                           else null::text end;
end;
$$;

revoke all on function public.verificar_romaneio(uuid) from public, anon;
grant execute on function public.verificar_romaneio(uuid) to authenticated;


-- =====================================================================
-- 2. UMA LINHA POR DOCUMENTO SELADO — agora com `tipo`
--
-- `where status = 'selado'` já excluía conflito, e continua. A coluna
-- `tipo` entra pra o resumo poder decompor sem adivinhar.
-- =====================================================================

create function public.verificar_romaneios_selados()
returns table (
  romaneio_id  uuid,
  numero       text,
  tipo         text,
  modo         text,
  camadas      integer,
  divergencias integer,
  onde         text
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select ro.id, ro.numero, ro.tipo, ro.modo,
         count(*)::integer,
         count(*) filter (where not v.ok)::integer,
         -- só as camadas que NÃO passaram, com o resultado junto: uma
         -- INVARIANTE_VIOLADA e uma DIVERGENTE mandam procurar coisas
         -- diferentes, e a linha do resumo tem que dizer qual é qual.
         nullif(string_agg(v.camada || ' (' || v.resultado || ')', ', ' order by v.camada)
                filter (where not v.ok), '')
    from public.romaneios ro
    cross join lateral public.verificar_romaneio(ro.id) v
   where ro.status = 'selado'
   group by ro.id, ro.numero, ro.tipo, ro.modo
   order by ro.tipo, ro.numero;
$$;

revoke all on function public.verificar_romaneios_selados() from public, anon;
grant execute on function public.verificar_romaneios_selados() to authenticated;


-- =====================================================================
-- 3. O RESUMO — DECOMPOSTO POR TIPO, e é isso que o torna útil
--
-- Um agregado `13 · 13 · 0` esconde o que mais interessa daqui a seis
-- meses: `9 saídas + 4 retornos = 13` parece saudável e significa que uma
-- saída sumiu de um conjunto que tinha 10.
--
-- Por isso o baseline histórico continua sendo invariante PRÓPRIA: as 10
-- saídas que verificavam antes desta migration continuam sendo as mesmas
-- 10 e continuam verificando. O total é conveniência; a decomposição é o
-- controle.
--
-- A linha `conflito` existe pelo motivo oposto: ela NÃO entra em
-- verificado/íntegro/divergente, porque tentativa recusada não é
-- documento corrompido. Mas some do relatório seria pior — zero conflitos
-- e doze conflitos são fatos diferentes, e quem lê o placar merece ver os
-- dois. `divergencias` vem nulo ali de propósito: não é zero, é "não se
-- aplica".
-- =====================================================================

create or replace function public.verificar_integridade_resumo()
returns table (
  escopo       text,
  documentos   integer,
  integros     integer,
  divergencias integer
)
language sql stable security invoker
set search_path = public, extensions
as $$
  with por_tipo as (
    select tipo,
           count(*)::integer as documentos,
           count(*) filter (where divergencias = 0)::integer as integros,
           coalesce(sum(divergencias), 0)::integer as divergencias
      from public.verificar_romaneios_selados()
     group by tipo
  )
      select 'saida'::text,
             coalesce((select documentos   from por_tipo where tipo = 'saida'), 0),
             coalesce((select integros     from por_tipo where tipo = 'saida'), 0),
             coalesce((select divergencias from por_tipo where tipo = 'saida'), 0)
  union all
      select 'retorno'::text,
             coalesce((select documentos   from por_tipo where tipo = 'retorno'), 0),
             coalesce((select integros     from por_tipo where tipo = 'retorno'), 0),
             coalesce((select divergencias from por_tipo where tipo = 'retorno'), 0)
  union all
      select 'TOTAL'::text,
             coalesce((select sum(documentos)   from por_tipo), 0)::integer,
             coalesce((select sum(integros)     from por_tipo), 0)::integer,
             coalesce((select sum(divergencias) from por_tipo), 0)::integer
  union all
      -- Fora do placar, e contado mesmo assim.
      select 'conflito (fora do placar)'::text,
             (select count(*)::integer from public.romaneios where status = 'conflito'),
             null::integer, null::integer;
$$;

revoke all on function public.verificar_integridade_resumo() from public, anon;
grant execute on function public.verificar_integridade_resumo() to authenticated;


-- =====================================================================
-- 4. OS ATRIBUTOS VOLTARAM IGUAIS? — e isto ABORTA, não avisa
--
-- Compara o que foi capturado antes do drop com o que existe agora. Uma
-- conferência que só imprime seria observação; esta é proteção, e a
-- diferença aparece justamente no dia em que ninguém está olhando o
-- resultado.
--
-- A ACL é comparada como CONJUNTO ORDENADO, não como texto: a ordem dos
-- `aclitem` depende da ordem dos grants, e falhar por causa disso seria o
-- instrumento reprovando um resultado certo — coisa que este projeto já
-- pagou várias vezes.
--
-- `verificar_integridade_resumo` fica de fora: é função nova, não tem
-- "antes" com que comparar.
-- =====================================================================

do $$
declare
  v_antes jsonb := nullif(current_setting('app.verificador_antes', true), '')::jsonb;
  v_dif   text := '';
  d       record;
begin
  if v_antes is null then
    raise exception 'não achei a captura de atributos feita antes do drop — a transação foi desfeita';
  end if;

  for d in
    select a ->> 'proname'                as proname,
           a ->> 'owner'                  as owner_antes,
           pg_get_userbyid(p.proowner)    as owner_agora,
           a ->> 'provolatile'            as vol_antes,
           p.provolatile::text            as vol_agora,
           (a ->> 'prosecdef')::boolean   as sec_antes,
           p.prosecdef                    as sec_agora,
           a -> 'proconfig'               as cfg_antes,
           to_jsonb(coalesce(p.proconfig, '{}'::text[])) as cfg_agora,
           a -> 'acl'                     as acl_antes,
           to_jsonb((select coalesce(array_agg(x::text order by x::text), '{}'::text[])
                       from unnest(coalesce(p.proacl, '{}'::aclitem[])) x)) as acl_agora,
           (p.proname is null)            as sumiu
      from jsonb_array_elements(v_antes) as a
      -- `lateral` e não join direto: sem o filtro de schema DENTRO da
      -- busca, uma função de mesmo nome em outro schema casaria e a
      -- conferência compararia a errada.
      left join lateral (
        select p2.proname, p2.proowner, p2.provolatile, p2.prosecdef, p2.proconfig, p2.proacl
          from pg_proc p2
          join pg_namespace n on n.oid = p2.pronamespace
         where n.nspname = 'public' and p2.proname = a ->> 'proname'
      ) p on true
  loop
    -- Função que existia antes e não voltou é o pior caso: o drop pegou e
    -- o create não. Sem esta checagem a migration "passaria" deixando o
    -- banco sem verificador — e é durante uma migration do verificador
    -- que ninguém tem como medir se está tudo bem.
    if d.sumiu then
      v_dif := v_dif || format(E'  %s: existia antes do drop e NÃO voltou\n', d.proname);
      continue;
    end if;
    if d.owner_antes is distinct from d.owner_agora then
      v_dif := v_dif || format(E'  %s: owner %s -> %s\n', d.proname, d.owner_antes, d.owner_agora);
    end if;
    if d.vol_antes is distinct from d.vol_agora then
      v_dif := v_dif || format(E'  %s: volatilidade %s -> %s\n', d.proname, d.vol_antes, d.vol_agora);
    end if;
    if d.sec_antes is distinct from d.sec_agora then
      v_dif := v_dif || format(E'  %s: security definer %s -> %s\n', d.proname, d.sec_antes, d.sec_agora);
    end if;
    if d.cfg_antes is distinct from d.cfg_agora then
      v_dif := v_dif || format(E'  %s: SET %s -> %s\n', d.proname, d.cfg_antes, d.cfg_agora);
    end if;
    if d.acl_antes is distinct from d.acl_agora then
      v_dif := v_dif || format(E'  %s: ACL %s -> %s\n', d.proname, d.acl_antes, d.acl_agora);
    end if;
  end loop;

  if jsonb_array_length(v_antes) <> 2 then
    v_dif := v_dif || format(E'  esperava 2 funções capturadas antes do drop, achei %s\n',
                             jsonb_array_length(v_antes));
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'verificar_romaneio') then
    v_dif := v_dif || E'  verificar_romaneio NÃO existe depois do create\n';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'verificar_romaneios_selados') then
    v_dif := v_dif || E'  verificar_romaneios_selados NÃO existe depois do create\n';
  end if;

  if v_dif <> '' then
    raise exception E'A recriação mudou atributos das funções — a transação foi desfeita:\n%', v_dif;
  end if;
end $$;

commit;


-- =====================================================================
-- COMO CONFERIR DEPOIS DE APLICAR
--
-- 1. A EXTRAÇÃO NÃO MEXEU NA SAÍDA. É o único teste que importa agora, e
--    ele é binário:
--
--      select * from public.verificar_integridade_resumo();
--
--    Esperado, com nenhum retorno selado ainda:
--
--      saida                       10   10   0
--      retorno                      0    0   0
--      TOTAL                       10   10   0
--      conflito (fora do placar)    N   null null
--
--    **Qualquer coisa diferente de 10 · 10 · 0 na linha `saida` e a
--    extração mexeu em algo. Para ali** — não siga pro retorno, não
--    "ajuste" a fórmula. O corpo da fórmula histórica foi movido sem uma
--    vírgula de mudança; se o resultado mudou, alguma outra coisa mudou
--    junto, e descobrir isso agora custa muito menos.
--
-- 2. A coluna nova aparece e diagnostica:
--
--      select * from public.verificar_romaneio(
--        (select id from public.romaneios where status='selado' order by numero limit 1));
--
--    Esperado: 4 linhas (documento, assinatura:caixa, assinatura:motoboy,
--    final), todas com `resultado = 'OK'`.
--
-- 3. Conflito continua fora do denominador:
--
--      select numero, tipo, status from public.romaneios where status = 'conflito';
--      -- nenhum deles pode aparecer em verificar_romaneios_selados()
--      select count(*) from public.verificar_romaneios_selados() s
--        join public.romaneios r on r.id = s.romaneio_id
--       where r.status <> 'selado';
--      -- esperado: 0
--
-- 4. O retorno só dá pra verificar quando existir um selado, e o primeiro
--    vem da 2D. Quando vier, o esperado é:
--
--      saida     10  10  0
--      retorno    1   1  0
--      TOTAL     11  11  0
--
--    com as camadas `documento`, `assinatura:responsavel_loja`,
--    `assinatura:motoboy`, `final` e mais `saida_referenciada` — cinco,
--    porque o retorno tem uma camada estrutural a mais que a saída.
-- =====================================================================
