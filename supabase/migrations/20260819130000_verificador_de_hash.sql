-- =====================================================================
-- VERIFICADOR DE HASH DOS ROMANEIOS — etapa 2A, item 1
--
-- Até aqui o projeto GERAVA evidência criptográfica sem conseguir
-- VERIFICÁ-LA: `signature_hash` e `final_hash` eram calculados, gravados
-- e exibidos truncados, nunca recomputados. Isto fecha esse buraco.
--
-- Ele existe primeiro por um motivo prático: a etapa 2A acrescenta
-- `papel_no_momento` ao INSERT da assinatura da saída, com a promessa de
-- que a fórmula do hash não é tocada. Provar isso por leitura de código é
-- fraco. Com o verificador vira medição: roda antes (baseline), roda
-- depois, e o número tem que ser o mesmo.
--
-- É o método do item 22 do NOTAS (reaplicar `white-space: nowrap` pra
-- medir o "antes" na mesma tela) e do 49 (montar as duas versões lado a
-- lado): sem o par, lê-se só o "depois" e conclui-se certo por sorte.
--
-- ---------------------------------------------------------------------
-- AS QUATRO REGRAS, decididas com o usuário em 2026-08-19
-- ---------------------------------------------------------------------
--   1. Reproduzir a fórmula HISTÓRICA exatamente — concatenação, ordem,
--      casts, representação dos strokes, timestamp e literais. Não "uma
--      fórmula equivalente".
--   2. `tipo_signatario` vem SEMPRE da linha, nunca fixado. Um
--      verificador com literal fixo passaria nos romaneios de uma era e
--      falharia nos da outra.
--   3. READ-ONLY. Nunca "corrigir" hash. Divergiu: reporta o quê, onde e
--      os dois valores, e para.
--   4. NÃO afirmar "todos passam" antes de medir. O gate é rodar o
--      baseline e exigir explicação para qualquer divergência.
--
-- ---------------------------------------------------------------------
-- A ARMADILHA DO FUSO, e ela é séria
-- ---------------------------------------------------------------------
-- A fórmula concatena `v_agora::text`, e `timestamptz::text` NÃO é
-- estável: depende do `TimeZone` da sessão.
--
--     mesmo instante, TimeZone=UTC     -> 2026-08-19 12:00:00.123+00
--     mesmo instante, America/Sao_Paulo -> 2026-08-19 09:00:00.123-03
--
-- `selar_romaneio_interno` não fixa fuso — herda o da conexão. Todas as
-- selagens vieram por PostgREST (a porta online e a Edge Function),
-- que roda em UTC, então UTC é a reconstrução certa. Mas isso é
-- reconstrução, não fato gravado: o fuso da selagem não está registrado
-- em lugar nenhum.
--
-- Por isso este verificador FIXA `timezone` e `datestyle`. Se o baseline
-- acusar divergência em TODOS os romaneios, o fuso é o primeiro suspeito,
-- muito antes do hash.
--
-- LIÇÃO PRA FÓRMULA NOVA (o retorno, na etapa 2B): **não colocar cast de
-- timestamptz em hash.** Use `to_char(..., 'YYYY-MM-DD HH24:MI:SS.USOF')`
-- ou epoch, que não dependem de GUC de sessão. O canônico da saída já faz
-- certo — esta fragilidade está só na fórmula da assinatura.
--
-- ---------------------------------------------------------------------
-- O QUE ELE NÃO VERIFICA, declarado ANTES de rodar
-- ---------------------------------------------------------------------
-- Sem isto o primeiro baseline mostra "divergências" que não são, e
-- alguém entra em pânico ou conserta o que não está quebrado:
--
--   * romaneios em CONFLITO (R-000002, R-000004) — não têm `final_hash`
--     nem corrida, e as assinaturas deles vivem em `romaneios.conflito`,
--     não em `assinaturas`. Reportados como 'nao_aplicavel'.
--   * assinaturas LEGADAS (`romaneio_id is null`) — o `hash_sha256`
--     delas vem da fórmula do schema inicial, que é outra coisa. Não
--     entram: a consulta parte de `romaneios`.
--   * o CANÔNICO contra o dado de hoje — de propósito. O documento é
--     imutável mas o vale pode ter sido corrigido depois (regra 7), então
--     recalcular o canônico do zero acusaria divergência legítima. O que
--     se verifica é `digest(canonico_gravado) = document_hash`: que os
--     bytes assinados produzem o hash assinado.
--
-- E um caso que verifica SIM, e que é o mais valioso do conjunto:
-- romaneio offline sincronizado (R-000010). Ele só bate se o último
-- componente sair de `romaneios.modo` em vez do literal 'online' — é ele
-- que prova a regra 2 na prática.
-- =====================================================================


-- =====================================================================
-- 1. VERIFICAR UM ROMANEIO, CAMADA POR CAMADA
--
-- `security invoker` de propósito: o verificador enxerga exatamente o que
-- quem chama enxerga, então a RLS continua valendo e um caixa não
-- verifica romaneio de outra filial. Um `security definer` aqui seria
-- privilégio sem necessidade.
-- =====================================================================

create or replace function public.verificar_romaneio(p_romaneio_id uuid)
returns table (
  camada           text,
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
  r              record;
  a              record;
  v_recalc       text;
  v_ultimo       text;
  v_id           text;
  v_hash_interna text;
  v_hash_motoboy text;
  v_final        text;
begin
  select ro.id, ro.numero, ro.status, ro.modo, ro.canonico,
         ro.document_hash, ro.final_hash, ro.selado_em
    into r
    from public.romaneios ro
   where ro.id = p_romaneio_id;

  if not found then
    return query select 'romaneio'::text, false, null::text, null::text,
                        'não encontrado (ou fora do alcance da RLS)'::text;
    return;
  end if;

  -- Conflito não é falha de verificação: é documento de outra natureza.
  -- Ele não tem final_hash e as assinaturas dele estão em
  -- `romaneios.conflito`, guardadas justamente porque a retirada física
  -- aconteceu. Dizer 'nao_aplicavel' é a resposta honesta.
  if r.status <> 'selado' then
    return query select 'nao_aplicavel'::text, true, null::text, null::text,
                        format('romaneio %s tem status %s', r.numero, r.status);
    return;
  end if;

  -- ---- camada 1: o canônico produz o document_hash -------------------
  -- Note que NÃO se recalcula o canônico a partir de `entregas`. O
  -- documento é imutável, mas o vale pode ter sido corrigido depois
  -- (regra 7), e aí a divergência seria legítima e o verificador estaria
  -- medindo a coisa errada. O que se prova aqui é que os bytes assinados
  -- produzem o hash assinado.
  v_recalc := case when r.canonico is null then null
                   else encode(digest(r.canonico, 'sha256'), 'hex') end;
  return query select 'documento'::text,
                      v_recalc is not null and v_recalc = r.document_hash,
                      r.document_hash, v_recalc,
                      case when r.canonico is null then 'canônico ausente'::text
                           else null::text end;

  -- ---- camada 2: cada assinatura -------------------------------------
  for a in
    select s.tipo_signatario, s.user_id, s.motoboy_id, s.strokes,
           s.signature_hash, s.hash_sha256
      from public.assinaturas s
     where s.romaneio_id = p_romaneio_id
     order by case s.tipo_signatario when 'motoboy' then 2 else 1 end
  loop
    -- REGRA 2 EM AÇÃO: o papel vem da linha. É `tipo_signatario` que
    -- decide qual id e qual último componente entram, e é por isso que a
    -- mesma função serve as duas eras ('caixa' e 'responsavel_loja') sem
    -- saber qual delas está lendo.
    if a.tipo_signatario = 'motoboy' then
      v_id     := a.motoboy_id::text;
      -- O motoboy fecha com `p_modo`, NÃO com `auth_method`. Parece
      -- inconsistente com o lado da farmácia e não é: a fórmula original
      -- concatena o modo do romaneio ali. `auth_method` guarda outra
      -- coisa (`physical_card_pin_*`) e nunca entrou no hash.
      v_ultimo := r.modo;
    else
      v_id     := a.user_id::text;
      -- O lado da farmácia fecha com o literal, que é o que a fórmula
      -- tem escrito. Ler de `auth_method` daria o mesmo valor hoje, mas
      -- seria "uma fórmula equivalente" — e a regra 1 proíbe.
      v_ultimo := 'sessao_autenticada';
    end if;

    v_recalc := case
      when v_id is null or a.strokes is null or r.selado_em is null then null
      else encode(digest(
        r.document_hash || '|' || a.tipo_signatario || '|' || v_id
          || '|' || a.strokes::text
          || '|' || r.selado_em::text
          || '|' || v_ultimo, 'sha256'), 'hex')
    end;

    if a.tipo_signatario = 'motoboy' then
      v_hash_motoboy := a.signature_hash;
    else
      v_hash_interna := a.signature_hash;
    end if;

    return query select ('assinatura:' || a.tipo_signatario)::text,
                        v_recalc is not null and v_recalc = a.signature_hash,
                        a.signature_hash, v_recalc,
                        case when v_recalc is null then 'componente nulo na fórmula'::text
                             when a.signature_hash is distinct from a.hash_sha256
                               then 'signature_hash e hash_sha256 divergem entre si'::text
                             else null::text end;
  end loop;

  -- ---- camada 3: o envelope ------------------------------------------
  -- A ordem é documento, farmácia, motoboy — e é a ordem da fórmula, não
  -- a ordem de inserção das linhas. Por isso o loop acima guarda cada uma
  -- pelo tipo em vez de acumular numa lista.
  v_final := case
    when v_hash_interna is null or v_hash_motoboy is null then null
    else encode(digest(r.document_hash || '|' || v_hash_interna
                       || '|' || v_hash_motoboy, 'sha256'), 'hex')
  end;
  return query select 'final'::text,
                      v_final is not null and v_final = r.final_hash,
                      r.final_hash, v_final,
                      case when v_hash_interna is null then 'sem assinatura do lado da farmácia'::text
                           when v_hash_motoboy is null then 'sem assinatura do motoboy'::text
                           else null::text end;
end;
$$;

revoke all on function public.verificar_romaneio(uuid) from public, anon;
grant execute on function public.verificar_romaneio(uuid) to authenticated;


-- =====================================================================
-- 2. O BASELINE — uma linha por romaneio selado
--
-- É esta que se roda antes e depois de mexer no INSERT da assinatura. O
-- resultado esperado é `camadas = divergencias_zero` em todas as linhas;
-- mas ver a regra 4: o gate é MEDIR, não afirmar.
-- =====================================================================

create or replace function public.verificar_romaneios_selados()
returns table (
  romaneio_id  uuid,
  numero       text,
  modo         text,
  camadas      integer,
  divergencias integer,
  onde         text
)
language sql stable security invoker
set search_path = public, extensions
as $$
  select ro.id, ro.numero, ro.modo,
         count(*)::integer,
         count(*) filter (where not v.ok)::integer,
         -- só as camadas que divergiram, pra a linha dizer onde olhar
         nullif(string_agg(v.camada, ', ' order by v.camada)
                filter (where not v.ok), '')
    from public.romaneios ro
    cross join lateral public.verificar_romaneio(ro.id) v
   where ro.status = 'selado'
   group by ro.id, ro.numero, ro.modo
   order by ro.numero;
$$;

revoke all on function public.verificar_romaneios_selados() from public, anon;
grant execute on function public.verificar_romaneios_selados() to authenticated;


-- =====================================================================
-- COMO RODAR O BASELINE
--
--   -- resumo: uma linha por romaneio selado
--   select * from public.verificar_romaneios_selados();
--
--   -- o número que vira o baseline
--   select count(*) as verificados,
--          count(*) filter (where divergencias = 0) as validos,
--          coalesce(sum(divergencias), 0) as divergencias
--     from public.verificar_romaneios_selados();
--
--   -- detalhe de um que divergiu
--   select * from public.verificar_romaneio('<uuid>');
--
-- Rodar como ADMIN: a função é `security invoker`, então um caixa vê só
-- a filial dele e o baseline sairia parcial sem avisar.
-- =====================================================================
