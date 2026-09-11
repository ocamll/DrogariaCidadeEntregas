-- =====================================================================
-- 4B.2b — o verificador aprende a LER A VERSÃO de cada evidência
--
-- E ele aprende ANTES de existir o primeiro documento versão 2. A ordem
-- não é zelo: `verificar_romaneios_selados()` filtra por `status`, não
-- por versão, então o primeiro selo novo já entraria no placar — e
-- entraria com as duas camadas de assinatura DIVERGENTES, porque o
-- verificador aplicaria a fórmula com `strokes::text` a um documento que
-- não tem traço nenhum.
--
-- Isso já aconteceu uma vez neste projeto, com o retorno: é a 2B.4, e o
-- texto dela vale aqui palavra por palavra — *instrumento que acusa
-- defeito onde não há é pior que instrumento que não mede*. O primeiro
-- custa uma investigação e a confiança no resto do placar.
--
--
-- O QUE MUDA, E O QUE NÃO PODE MUDAR
--
--   lê `versao_evidencia` DA LINHA          como já lê `tipo_signatario`
--   versão 1 → fórmulas históricas          MOVIDAS, nunca melhoradas
--   versão 2 → public.evidencia_hash_v2     congelada na 4B.2a
--   versão desconhecida → INVARIANTE_VIOLADA, e não um palpite
--
-- A regra do §2B.4 continua sendo a que governa: **um verificador lê o
-- discriminador da própria linha, jamais fixa o literal**. Antes era o
-- `tipo_signatario`; agora são dois — o tipo e a versão.
--
-- E a fórmula da versão 1 continua exatamente como estava, defeitos
-- históricos incluídos (o `selado_em::text` da saída, que depende do fuso
-- e por isso o `set timezone = 'UTC'` da função não pode sair). Consertá-la
-- aqui transformaria a ferramenta de medir em fonte de divergência.
--
--
-- A PROVA QUE ESTA MIGRATION TRAZ EMBUTIDA
--
-- Ela mede o placar ANTES, recria a função, mede DEPOIS e **se recusa a
-- aplicar** se qualquer documento mudar de resultado. Não é "li o código
-- e não mudou": é medição no mesmo instrumento, que é o método que o
-- projeto usa desde o §22.
--
-- Hoje isso quer dizer: 22 documentos, 22 íntegros, 0 divergências, com
-- as mesmas camadas nas mesmas linhas — e nenhuma assinatura versão 2,
-- porque ninguém escreve uma ainda (isso é a 4B.2c).
-- =====================================================================

begin;

do $$
declare
  v_antes jsonb;
begin
  -- O placar inteiro, documento a documento e camada a camada. Comparar
  -- só o TOTAL deixaria passar duas trocas que se cancelam.
  select coalesce(jsonb_agg(jsonb_build_object(
           'romaneio', s.numero,
           'camadas',  s.camadas,
           'diverg',   s.divergencias,
           'onde',     coalesce(s.onde, '')
         ) order by s.numero), '[]'::jsonb)
    into v_antes
    from public.verificar_romaneios_selados() s;

  perform set_config('app.placar_antes', v_antes::text, true);

  raise notice 'Placar antes: % documento(s).', jsonb_array_length(v_antes);
end $$;


create or replace function public.verificar_romaneio(p_romaneio_id uuid)
returns table (
  camada           text,
  resultado        text,
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
  v_interna_esp    text;
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

  if r.status <> 'selado' then
    return query select 'nao_aplicavel'::text, 'NAO_APLICAVEL'::text, null::boolean,
                        null::text, null::text,
                        format('romaneio %s tem status %s — evidência de tentativa recusada, não documento selado',
                               r.numero, r.status);
    return;
  end if;

  if r.tipo = 'retorno' then
    v_protocolo   := 'DCRR1';
    v_interna_esp := 'responsavel_loja';
  else
    v_protocolo   := 'DCR1';
    v_interna_esp := 'caixa';
  end if;

  -- ---- camada 0 (só retorno): o chão citado é o chão real -------------
  if r.tipo = 'retorno' then
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
  -- Não muda com a versão da evidência: o documento é o mesmo, o que
  -- mudou foi a manifestação das partes sobre ele.
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

  -- ---- camada 2: cada assinatura, pela versão DELA ---------------------
  for a in
    select s.tipo_signatario, s.user_id, s.motoboy_id, s.strokes,
           s.signature_hash, s.hash_sha256, s.papel_no_momento,
           -- O QUE ENTROU NA 4B: a versão manda na fórmula, e os três
           -- campos abaixo são o conteúdo novo que ela cobre.
           s.versao_evidencia, s.credencial_id, s.auth_method,
           s.validador_profile_id, s.motivo_excecao
      from public.assinaturas s
     where s.romaneio_id = p_romaneio_id
     order by case s.tipo_signatario when 'motoboy' then 2 else 1 end
  loop
    v_violou := null;

    if a.tipo_signatario not in (v_interna_esp, 'motoboy') then
      v_violou := format('tipo_signatario "%s" não pertence ao protocolo %s (esperado "%s" ou "motoboy")',
                         a.tipo_signatario, v_protocolo, v_interna_esp);
    elsif a.tipo_signatario = any(v_vistos) then
      v_violou := format('duas assinaturas "%s" no mesmo documento', a.tipo_signatario);
    end if;
    v_vistos := v_vistos || a.tipo_signatario;

    -- VERSÃO DESCONHECIDA NÃO VIRA PALPITE. Tentar a fórmula "mais
    -- parecida" reportaria DIVERGENTE — e mandaria quem investiga
    -- procurar adulteração onde há um formato que este verificador não
    -- conhece. O CHECK do banco já impede gravar; isto é o que acontece
    -- se alguém contornar o CHECK por outro caminho.
    if v_violou is null and a.versao_evidencia not in (1, 2) then
      v_violou := format('versão de evidência desconhecida (%s) — este verificador conhece a 1 e a 2',
                         a.versao_evidencia);
    end if;

    if a.tipo_signatario = 'motoboy' then
      v_id     := a.motoboy_id::text;
      v_ultimo := r.modo;
    else
      v_id     := a.user_id::text;
      v_ultimo := 'sessao_autenticada';
    end if;

    if v_violou is null and v_id is null then
      v_violou := format('assinatura "%s" sem id de quem assinou', a.tipo_signatario);
    elsif v_violou is null and a.versao_evidencia = 1 and a.strokes is null then
      -- Só a versão 1. Na 2, traço AUSENTE é o esperado — é o que a
      -- decisão de 2026-09-11 significa —, e o CHECK do banco recusa a
      -- linha que tiver um.
      v_violou := format('assinatura "%s" sem traços', a.tipo_signatario);
    elsif v_violou is null and r.selado_em is null then
      v_violou := 'romaneio selado sem selado_em — a fórmula não tem instante';
    elsif v_violou is null and a.versao_evidencia = 2 and a.auth_method is null then
      -- Na versão 2 o método entra DENTRO do digest. Nulo ali não é
      -- "hash que não bate": é documento que não dá pra recalcular.
      v_violou := 'assinatura versão 2 sem auth_method — ele entra no digest, então o hash não é recalculável';
    end if;

    -- A guarda do papel continua sendo da VERSÃO 1 do retorno. Na versão
    -- 2 o nulo tem serialização definida ('-'), então ele é verificável
    -- em vez de impeditivo — e `papel_no_momento` entra no digest também
    -- na saída.
    if v_violou is null
       and a.versao_evidencia = 1
       and r.tipo = 'retorno'
       and a.tipo_signatario <> 'motoboy'
       and a.papel_no_momento is null then
      v_violou := 'papel_no_momento ausente em assinatura de Romaneio de Retorno — '
                  || 'ele entra no digest do DCRR1, então o hash não é recalculável';
    end if;

    if v_violou is not null then
      return query select ('assinatura:' || a.tipo_signatario)::text,
                          'INVARIANTE_VIOLADA'::text, false,
                          a.signature_hash, null::text, v_violou;
      continue;
    end if;

    if a.versao_evidencia = 2 then
      -- FÓRMULA EV2, congelada na 4B.2a e provada lá por nove vetores.
      -- Ela é a mesma para saída e retorno: o que diferencia os dois
      -- documentos já está no `document_hash`, e repetir a distinção aqui
      -- criaria uma segunda fonte pra mesma coisa.
      --
      -- Na exceção, `credencial_id` é o cartão do GERENTE — o que foi de
      -- fato autenticado — e `validador_profile_id` diz de quem ele é. O
      -- documento nunca afirma que o motoboy autenticou.
      v_recalc := public.evidencia_hash_v2(
        r.document_hash,
        a.tipo_signatario,
        case when a.tipo_signatario = 'motoboy' then a.motoboy_id else a.user_id end,
        a.papel_no_momento,
        a.credencial_id,
        a.validador_profile_id,
        a.motivo_excecao,
        r.selado_em,
        a.auth_method);
    elsif r.tipo = 'retorno' then
      -- FÓRMULA DCRR1 — versão 1, intocada.
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
  -- A composição NÃO muda com a versão: documento, interna, motoboy. O
  -- que mudou foram as entradas das duas camadas de cima.
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
-- A PROVA — mesmo instrumento, antes e depois, dentro da transação
--
-- Qualquer documento que mude de resultado desfaz tudo. É o gate do §22
-- e o da 2A: "nada moveu" só vale como MEDIÇÃO, nunca como leitura de
-- código.
-- =====================================================================

do $$
declare
  v_antes  jsonb := current_setting('app.placar_antes', true)::jsonb;
  v_depois jsonb;
  v_dif    text := '';
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'romaneio', s.numero,
           'camadas',  s.camadas,
           'diverg',   s.divergencias,
           'onde',     coalesce(s.onde, '')
         ) order by s.numero), '[]'::jsonb)
    into v_depois
    from public.verificar_romaneios_selados() s;

  if v_antes is null then
    raise exception 'Não achei o placar de antes — o bloco do começo não rodou nesta transação.';
  end if;

  if v_antes <> v_depois then
    v_dif := E'\nantes:  ' || v_antes::text || E'\ndepois: ' || v_depois::text;
    raise exception E'A recriação MOVEU o placar — transação desfeita.%', v_dif;
  end if;

  raise notice 'Placar idêntico: % documento(s), camada por camada.',
    jsonb_array_length(v_depois);
end $$;

commit;


-- =====================================================================
-- CONFERÊNCIAS — no SQL Editor, depois de aplicar
--
-- (a) o placar continua o mesmo
--
--   select * from public.verificar_integridade_resumo();
--   -- esperado: 22 · 22 · 0, com saída 16 e retorno 6
--
--
-- (b) um documento abre camada por camada, como antes
--
--   select * from public.verificar_romaneio(
--     (select id from public.romaneios where status='selado' and tipo='saida'
--       order by numero limit 1));
--   -- esperado: documento, assinatura:caixa, assinatura:motoboy, final —
--   -- todas OK
--
--
-- (c) A PROVA DA VERSÃO 2, sem selar nada e sem gravar nada
--
--   Pega um documento selado real, calcula o que a fórmula EV2 daria para
--   uma evidência de motoboy autorizada pelo gerente, e confere que o
--   verificador usaria exatamente esse valor. É o ensaio do que a 4B.2c
--   vai gravar de verdade.
--
--   with d as (
--     select id, document_hash, selado_em from public.romaneios
--      where status = 'selado' order by numero limit 1
--   )
--   select public.evidencia_texto_v2(
--            d.document_hash, 'motoboy',
--            '00000000-0000-4000-8000-000000000002',
--            null, '00000000-0000-4000-8000-000000000003',
--            '00000000-0000-4000-8000-000000000004', 'cartao_perdido',
--            d.selado_em, 'gerente_card_pin_server_verified') as texto
--     from d;
--   -- esperado: a linha começando em EV2| e terminando no método, com o
--   -- instante em UTC e o motivo por extenso
--
--
-- (d) versão desconhecida é recusada, e não chutada
--
--   O CHECK impede gravar, então o teste é do CAMINHO do verificador:
--
--   select count(*) from public.assinaturas where versao_evidencia not in (1, 2);
--   -- esperado: 0 — e é por isso que o ramo de recusa não aparece hoje
-- =====================================================================
