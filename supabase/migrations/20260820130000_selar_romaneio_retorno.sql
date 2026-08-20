-- =====================================================================
-- ROMANEIO DE RETORNO — etapa 2B: `selar_romaneio_retorno`, transacional
--
-- O desenho está no CLAUDE.md, seção "O Romaneio de Retorno". Leia antes
-- de mexer aqui: metade das decisões abaixo existe pra evitar uma
-- segunda migration conceitual, e a outra metade veio da 2A.
--
-- O QUE ESTA TRANSAÇÃO FAZ, na ordem:
--
--   valida a saída e o saida_hash
--   → confere que os vales são EXATAMENTE os do romaneio de saída
--   → confere o motoboy da custódia e o responsável server-side
--   → reconstrói o DCRR1 e compara com o que foi assinado
--   → consome a autorização de uso único (cartão + PIN)
--   → sela o romaneio de retorno com as duas assinaturas
--   → grava desfecho, pagamentos realizados e a DIVERGÊNCIA DERIVADA
--   → gera os eventos
--   → fecha a corrida
--
-- Tudo ou nada. `fecharCorrida` deixa de ser ação de usuário e passa a
-- viver DENTRO daqui: não existirão dois caminhos pra encerrar uma
-- corrida.
--
-- ---------------------------------------------------------------------
-- TRÊS COISAS QUE A 2A DESCOBRIU E QUE ESTE ARQUIVO OBEDECE
-- ---------------------------------------------------------------------
-- 1. **NENHUM CAST DE `timestamptz` NA FÓRMULA DO HASH.**
--    `timestamptz::text` depende do `TimeZone` da sessão: o mesmo
--    instante vira `12:00:00+00` em UTC e `09:00:00-03` aqui. A fórmula
--    da SAÍDA tem esse problema latente, e o verificador só funciona
--    porque fixa UTC e porque todas as selagens vieram por PostgREST.
--    Aqui o instante entra por `to_char(... at time zone 'UTC', máscara
--    explícita)`, que não depende de sessão nenhuma.
--
-- 2. **`papel_no_momento` ENTRA NO HASH desde o primeiro dia.** Na saída
--    ele é metadado ao lado, porque a fórmula já estava assinada e
--    reabri-la quebraria todo romaneio selado. Aqui a fórmula é nova, não
--    há o que retrofitar, e o cargo de quem recebeu a custódia é parte do
--    que o documento afirma.
--
-- 3. **O VERIFICADOR TEM QUE LER `tipo_signatario` DA LINHA.** O literal
--    entra no digest, e no retorno ele é `responsavel_loja`, não `caixa`.
--    Uma função que fixasse qualquer um dos dois seria incapaz de
--    verificar as duas eras. O `verificar_romaneio` de
--    `20260819130000` já faz certo; a extensão dele pro retorno é
--    trabalho próprio e ainda não existe — ver o rodapé.
--
-- ---------------------------------------------------------------------
-- POR QUE `responsavel_loja` E NÃO `caixa`
-- ---------------------------------------------------------------------
-- São dois momentos com regras diferentes. Na saída quem entrega a
-- custódia é o caixa; no retorno quem recebe pode ser caixa, gerente ou
-- admin, e o rótulo tem que comportar os três.
--
-- E o vocabulário dividido é um FATO DATADO, não uma inconsistência a
-- limpar: renomear `caixa` nas linhas existentes quebraria a verificação
-- de todo romaneio de saída já selado, porque o literal está dentro do
-- digest. O CHECK foi ampliado em `20260819120000`, nunca renomeado.
--
-- ---------------------------------------------------------------------
-- RECUSA DISCRIMINADA vs. EXCEÇÃO — a mesma regra da saída
-- ---------------------------------------------------------------------
-- Devolve `jsonb` discriminado nos casos previstos em vez de levantar
-- exceção, e isso não é preguiça: quando o retorno chega aqui, **o
-- motoboy já devolveu os vales e as duas partes já assinaram**. Um
-- `raise` daria rollback e levaria junto a prova de que essa entrega de
-- custódia aconteceu.
--
-- Então: tudo que pode acontecer com um retorno legítimo (a corrida já
-- foi fechada por outro caminho, o documento não bate, um vale a mais ou
-- a menos, outro motoboy) vira `romaneios` com `status = 'conflito'`
-- guardando os traços das duas assinaturas — exatamente como o
-- `R-000004` da saída.
--
-- Continua sendo exceção o que não tem prova a preservar: sessão
-- inválida, saída inexistente, autorização inválida, papel que a coluna
-- não aceita.
-- =====================================================================


-- =====================================================================
-- 1. O SNAPSHOT DO RETORNO
--
-- Espelha `romaneio_payload` da saída: é pra LER e consultar, enquanto
-- `canonico` guarda os bytes que de fato foram hasheados. Guardar os
-- dois é redundante de propósito — reconstruir o canônico a partir do
-- payload anos depois arriscaria reconstruir DIFERENTE, e aí o documento
-- não se verifica mais.
--
-- Ele carrega o PREVISTO ao lado do REALIZADO. Sem isso, "por que este
-- vale ficou divergente?" exigiria consultar `pagamentos` como ela está
-- hoje — que é o dado vigente, não o que foi assinado.
-- =====================================================================

create or replace function public.romaneio_retorno_payload(
  p_saida_id uuid, p_retorno jsonb
)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'versao', 'DCRR1',
    'saida_romaneio_id', p_saida_id,
    'vales', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entrega_id', e.id,
               'numero_vale', e.numero_vale,
               'tipo', e.tipo,
               'cliente_nome', e.cliente_nome,
               'desfecho', v.value ->> 'desfecho',
               -- NORMALIZADO igual ao canônico: `entregue` não tem motivo
               -- nem detalhe por definição. Sem isto o snapshot poderia
               -- mostrar um motivo que o documento assinado não afirma —
               -- e o PDF do retorno sai do snapshot, como o da saída.
               'motivo', case when (v.value ->> 'desfecho') = 'entregue'
                              then null else v.value ->> 'motivo' end,
               'detalhe', case when (v.value ->> 'desfecho') = 'entregue'
                               then null else v.value ->> 'detalhe' end,
               'pagamentos_previstos', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'pagamento_id', pg.id, 'forma', pg.forma,
                          'valor_cents', pg.valor_cents, 'troco_cents', pg.troco_cents
                        ) order by pg.id::text collate "C"), '[]'::jsonb)
                   from public.pagamentos pg
                  where pg.entrega_id = e.id and pg.momento = 'previsto'
               ),
               'pagamentos_realizados',
                 coalesce(v.value -> 'pagamentos_realizados', '[]'::jsonb)
             ) order by e.id::text collate "C")
        from jsonb_array_elements(p_retorno) as v(value)
        join public.entregas e on e.id = (v.value ->> 'entrega_id')::uuid
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.romaneio_retorno_payload(uuid, jsonb)
  from public, anon, authenticated;


-- =====================================================================
-- 2. O CONFLITO DO RETORNO — a prova sobrevive à recusa
--
-- Gêmeo de `registrar_conflito_romaneio`, com duas diferenças que o
-- schema impõe:
--
--   * `tipo = 'retorno'` exige `romaneio_saida_id` preenchido (CHECK
--     `romaneio_retorno_referencia_saida`), e temos esse id mesmo quando
--     tudo o mais falha;
--   * `corrida_id` fica NULO, que é o que isenta o conflito do
--     `UNIQUE (corrida_id, tipo)` — no Postgres nulo não colide com
--     nulo. Um retorno recusado não consome a única vaga de retorno
--     daquela corrida, e é isso que permite tentar de novo depois de
--     resolver o problema.
-- =====================================================================

create or replace function public.registrar_conflito_retorno(
  p_romaneio_id uuid, p_saida_romaneio_id uuid, p_tenant uuid, p_loja_id uuid,
  p_responsavel_id uuid, p_document_hash text, p_ocorrido_em_local timestamptz,
  p_modo text, p_ip inet, p_geolocalizacao jsonb, p_conflitos jsonb,
  p_retorno jsonb, p_responsavel_strokes jsonb, p_motoboy_strokes jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_numero text;
begin
  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, tipo, romaneio_saida_id, status, modo,
     payload, canonico, document_hash, ocorrido_em_local, criado_por, ip,
     geolocalizacao, conflito)
  values
    (p_romaneio_id, p_tenant, p_loja_id, null, 'retorno', p_saida_romaneio_id,
     'conflito', p_modo,
     -- O payload cru, sem join: se o conflito for justamente "vale que
     -- não é deste romaneio", montar o snapshot bonito falharia ou
     -- esconderia o vale estranho. Aqui interessa o que foi DECLARADO.
     jsonb_build_object('retorno_declarado', p_retorno),
     null, p_document_hash, p_ocorrido_em_local, p_responsavel_id, p_ip,
     p_geolocalizacao,
     jsonb_build_object('motivos', p_conflitos,
                        'responsavel_strokes', p_responsavel_strokes,
                        'motoboy_strokes', p_motoboy_strokes))
  on conflict (id) do nothing;

  select r.numero into v_numero from public.romaneios r where r.id = p_romaneio_id;

  insert into public.eventos (tenant_id, tipo, payload, user_id, ocorrido_em_local)
  values (p_tenant, 'conflito_retorno',
          jsonb_build_object('romaneio_id', p_romaneio_id, 'numero', v_numero,
                             'saida_romaneio_id', p_saida_romaneio_id,
                             'modo', p_modo, 'conflitos', p_conflitos),
          p_responsavel_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', false, 'motivo', 'conflito',
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'conflitos', p_conflitos);
end;
$$;

revoke all on function public.registrar_conflito_retorno(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, inet, jsonb, jsonb,
  jsonb, jsonb, jsonb
) from public, anon, authenticated;


-- =====================================================================
-- 3. SELAR O RETORNO — tudo ou nada
-- =====================================================================

create or replace function public.selar_romaneio_retorno_interno(
  p_responsavel_id uuid,
  p_romaneio_id uuid,              -- o id do RETORNO, uuidv7 do cliente
  p_saida_romaneio_id uuid,
  p_saida_document_hash text,
  p_motoboy_id uuid,
  p_retorno jsonb,                 -- vales ANINHADOS com seus pagamentos
  p_document_hash text,            -- o DCRR1 que o cliente assinou
  p_autorizacao_id uuid,
  p_responsavel_strokes jsonb,
  p_motoboy_strokes jsonb,
  p_ocorrido_em_local timestamptz,
  p_modo text,
  p_ip inet,
  p_geolocalizacao jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_existente     record;
  v_saida         record;
  v_corrida       record;
  v_tenant        uuid;
  v_papel         text;
  -- Snapshot do nome, porque `notificacoes.ts` lê `payload.autor_nome`.
  -- O Registro de Auditoria resolve o autor por join com `profiles`, mas
  -- as Notificações e a aba Ocorrências não — e um evento sem este campo
  -- aparece lá com o autor em branco.
  v_autor_nome    text;
  v_motivo        text;
  v_conflitos     jsonb;
  v_canonico      text;
  v_hash          text;
  v_numero        text;
  v_agora         timestamptz := now();
  v_agora_txt     text;
  v_hash_resp     text;
  v_hash_motoboy  text;
  v_final         text;
  v_credencial_id uuid;
  v_ordem         smallint := 0;
  v_do_retorno    uuid[];
  v_da_saida      uuid[];
  v_vale          jsonb;
  v_pag           jsonb;
  v_entrega_id    uuid;
  v_desfecho      text;
  v_detalhe       text;
  v_previsto      text[];
  v_realizado     text[];
  v_divergiu      boolean;
begin
  -- ---- reenvio da fila offline ---------------------------------------
  -- Antes de qualquer lock, pra não segurar linha à toa. Olha o STATUS e
  -- não só a existência: um retorno em conflito também tem número, e
  -- devolvê-lo como "ok, já existia" esconderia o conflito de quem
  -- precisa resolvê-lo.
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

  -- ---- quem recebe a custódia -----------------------------------------
  -- Uma consulta, tenant e papel juntos. A VALIDAÇÃO do papel fica lá
  -- embaixo, junto do INSERT da assinatura — pelo mesmo motivo da saída:
  -- checar cedo derrubaria também o caminho do conflito, que existe pra
  -- preservar a prova.
  select p.tenant_id, p.papel, p.nome into v_tenant, v_papel, v_autor_nome
    from public.profiles p where p.id = p_responsavel_id and p.ativo;
  if v_tenant is null then
    raise exception 'Responsável inexistente ou inativo.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_responsavel_strokes is null or p_motoboy_strokes is null then
    raise exception 'Romaneio de retorno exige as duas assinaturas.'
      using errcode = 'check_violation';
  end if;

  -- ---- a saída, travada -----------------------------------------------
  -- `for update` porque duas tentativas simultâneas de fechar a mesma
  -- corrida têm que ser serializadas aqui: a segunda espera e então
  -- enxerga o retorno da primeira, virando conflito em vez de duplicata.
  select r.id, r.tenant_id, r.loja_id, r.corrida_id, r.tipo, r.status,
         r.document_hash
    into v_saida
    from public.romaneios r
   where r.id = p_saida_romaneio_id
   for update;

  if v_saida.id is null or v_saida.tipo <> 'saida' then
    raise exception 'Romaneio de saída % não existe.', p_saida_romaneio_id
      using errcode = 'no_data_found';
  end if;
  if v_saida.tenant_id <> v_tenant then
    raise exception 'Romaneio de saída não é desta farmácia.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_saida.status <> 'selado' or v_saida.corrida_id is null then
    raise exception 'Romaneio de saída % não está selado — não há corrida pra fechar.',
      p_saida_romaneio_id using errcode = 'check_violation';
  end if;

  -- ---- daqui pra baixo, recusa é CONFLITO ------------------------------
  -- O `saida_hash` é o que amarra o retorno ao conteúdo da saída. Não
  -- batendo, o documento assinado fecha algo que não é esta saída.
  if v_saida.document_hash is distinct from p_saida_document_hash then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'saida_hash_nao_confere',
        'hash_assinado', p_saida_document_hash,
        'hash_da_saida', v_saida.document_hash)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  select c.id, c.status, c.mototaxista_id into v_corrida
    from public.corridas c where c.id = v_saida.corrida_id for update;

  -- A corrida já fechada é o caso da janela de compatibilidade: o item
  -- legado `fechamento_corrida` da fila offline pode ter drenado antes.
  -- Recusa, mas guarda — as assinaturas foram colhidas de verdade.
  if v_corrida.status = 'fechada' then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'corrida_ja_fechada', 'corrida_id', v_corrida.id)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  if exists (select 1 from public.romaneios r
              where r.corrida_id = v_corrida.id and r.tipo = 'retorno') then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'retorno_ja_existe', 'corrida_id', v_corrida.id)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- O motoboy da CUSTÓDIA, que é quem `corridas` registra. Reautenticar
  -- outra pessoa fecharia a cadeia com quem nunca a abriu.
  if v_corrida.mototaxista_id is distinct from p_motoboy_id then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'outro_motoboy',
        'motoboy_da_corrida', v_corrida.mototaxista_id,
        'motoboy_apresentado', p_motoboy_id)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- ---- o documento é inválido por si só? -------------------------------
  -- `romaneio_retorno_canonico` levanta exceção com entrada inválida, e
  -- exceção aqui daria rollback e levaria a prova junto. Então valida-se
  -- ANTES, e o motivo — que é o mesmo dos dois gêmeos — vira conflito.
  v_motivo := public.romaneio_retorno_validar(p_saida_document_hash, p_retorno);
  if v_motivo is not null then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object('motivo', 'retorno_invalido',
                                           'detalhe', v_motivo)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- ---- nem falta nem sobra vale ----------------------------------------
  -- Os dois sentidos importam. Faltando, o documento fecha uma corrida
  -- deixando vale sem desfecho; sobrando, ele afirma o desfecho de um
  -- vale que nunca saiu nessa corrida.
  select array_agg(re.entrega_id order by re.entrega_id) into v_da_saida
    from public.romaneio_entregas re where re.romaneio_id = p_saida_romaneio_id;

  select array_agg(x order by x) into v_do_retorno
    from (select distinct (v.value ->> 'entrega_id')::uuid as x
            from jsonb_array_elements(p_retorno) as v(value)) t;

  if v_da_saida is distinct from v_do_retorno then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'vales_nao_conferem',
        'faltando', to_jsonb(array(select unnest(v_da_saida)
                                   except select unnest(coalesce(v_do_retorno, '{}'::uuid[])))),
        'sobrando', to_jsonb(array(select unnest(coalesce(v_do_retorno, '{}'::uuid[]))
                                   except select unnest(v_da_saida))))),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- Trava os vales na mesma ordem da saída, pelo mesmo motivo dela:
  -- reduzir deadlock quando duas transações tocam os mesmos vales.
  perform 1 from public.entregas e
   where e.id = any(v_da_saida) order by e.id for update;

  -- ---- o hash tem que bater com o que foi assinado ---------------------
  -- Reconstruído AQUI, do input estruturado, nunca recebido pronto. É
  -- isso que faz o hash significar alguma coisa.
  v_canonico := public.romaneio_retorno_canonico(
    p_saida_romaneio_id, p_saida_document_hash, p_motoboy_id, p_responsavel_id,
    p_retorno);
  v_hash := encode(digest(v_canonico, 'sha256'), 'hex');

  if v_hash <> p_document_hash then
    return public.registrar_conflito_retorno(
      p_romaneio_id, p_saida_romaneio_id, v_tenant, v_saida.loja_id,
      p_responsavel_id, p_document_hash, p_ocorrido_em_local, p_modo, p_ip,
      p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'documento_alterado',
        'hash_assinado', p_document_hash, 'hash_atual', v_hash)),
      p_retorno, p_responsavel_strokes, p_motoboy_strokes);
  end if;

  -- ---- consome a autorização -------------------------------------------
  -- Cartão + PIN DE NOVO, e não é redundância: são duas transferências de
  -- custódia em sentidos opostos, e reaproveitar a autenticação das 18h42
  -- pra provar um ato das 20h17 não prova nada.
  --
  -- Uso único, prazo curto e amarrada ao document_hash DO RETORNO, tudo
  -- na mesma cláusula: qualquer uma falhando, zero linhas e recusa.
  update public.motoboy_autorizacoes a
     set consumida_em = v_agora
   where a.id = p_autorizacao_id
     and a.tenant_id = v_tenant
     and a.motoboy_id = p_motoboy_id
     and a.document_hash = p_document_hash
     and a.consumida_em is null
     and a.expira_em > v_agora
  returning a.credencial_id into v_credencial_id;

  if v_credencial_id is null then
    raise exception 'Autorização inválida, expirada, já usada ou de outro documento.'
      using errcode = 'insufficient_privilege';
  end if;

  -- ---- o documento ------------------------------------------------------
  -- A ordem que a SAÍDA precisava (vales antes do vínculo) não se aplica
  -- aqui, e vale dizer por quê pra ninguém "consertar": lá o UPDATE tinha
  -- que preceder o vínculo porque o trigger de imutabilidade passaria a
  -- ver documento selado e barraria o próprio selo. Aqui os vales JÁ
  -- estão congelados pela saída, e nada do que o retorno escreve neles
  -- (status, motivo, observações) está na lista congelada.
  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, tipo, romaneio_saida_id, status, modo,
     payload, canonico, document_hash, ocorrido_em_local, selado_em,
     criado_por, ip, geolocalizacao)
  values
    (p_romaneio_id, v_tenant, v_saida.loja_id, v_corrida.id, 'retorno',
     p_saida_romaneio_id, 'selado', p_modo,
     public.romaneio_retorno_payload(p_saida_romaneio_id, p_retorno),
     v_canonico, v_hash, p_ocorrido_em_local, v_agora, p_responsavel_id,
     p_ip, p_geolocalizacao)
  returning numero into v_numero;

  update public.motoboy_autorizacoes
     set consumida_por_romaneio = p_romaneio_id
   where id = p_autorizacao_id;

  foreach v_entrega_id in array v_da_saida loop
    insert into public.romaneio_entregas (romaneio_id, entrega_id, tenant_id, ordem)
    values (p_romaneio_id, v_entrega_id, v_tenant, v_ordem);
    v_ordem := v_ordem + 1;
  end loop;

  -- ---- desfecho, pagamentos e a divergência DERIVADA --------------------
  for v_vale in select v.value from jsonb_array_elements(p_retorno) as v(value)
  loop
    v_entrega_id := (v_vale ->> 'entrega_id')::uuid;
    v_desfecho   := v_vale ->> 'desfecho';
    -- Só no insucesso, pela mesma razão da normalização do payload: o
    -- canônico força `-` em vale entregue, e gravar um detalhe que o
    -- documento assinado não afirma poria a operação em desacordo com o
    -- documento — o defeito que a regra 7 existe pra impedir.
    v_detalhe    := case when v_desfecho = 'insucesso'
                         then nullif(btrim(coalesce(v_vale ->> 'detalhe', '')), '')
                         else null end;

    -- `observacoes` só é tocada quando há detalhe de verdade: mandar o
    -- null do caso "entregue" apagaria observação que o vale já tivesse.
    -- Mesmo cuidado que `fecharCorrida` já tinha, e pela mesma razão.
    update public.entregas
       set status_entrega  = v_desfecho,
           insucesso_motivo = case when v_desfecho = 'insucesso'
                                   then v_vale ->> 'motivo' else null end,
           observacoes = case when v_detalhe is not null then v_detalhe
                              else observacoes end
     where id = v_entrega_id;

    -- O PAYLOAD ESPELHA O QUE AS TELAS JÁ LEEM. `notificacoes.ts` e
    -- `auditoria.ts` esperam `motivo_detalhe` e `autor_nome`; um evento
    -- com outro formato aparece nas duas com o texto e o autor em branco,
    -- sem erro nenhum. Chave a mais é inofensiva, chave faltando não.
    if v_detalhe is not null then
      insert into public.eventos
        (tenant_id, entrega_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
      values
        (v_tenant, v_entrega_id, v_corrida.id, 'insucesso_detalhado',
         jsonb_build_object('motivo', v_vale ->> 'motivo',
                            'motivo_detalhe', v_detalhe,
                            'autor_nome', v_autor_nome,
                            'romaneio_retorno_id', p_romaneio_id),
         p_responsavel_id, p_ocorrido_em_local);
    end if;

    -- Os pagamentos realizados, um por forma. `pagamento_id` é uuidv7 do
    -- cliente (regra 5) — é o que permite ele entrar no canônico sem
    -- violar a regra 1 e o que torna o reenvio um no-op.
    for v_pag in
      select p.value
        from jsonb_array_elements(coalesce(v_vale -> 'pagamentos_realizados',
                                           '[]'::jsonb)) as p(value)
    loop
      insert into public.pagamentos
        (id, tenant_id, entrega_id, momento, forma, valor_cents, troco_cents,
         registrado_por, registrado_em_local)
      values
        ((v_pag ->> 'pagamento_id')::uuid, v_tenant, v_entrega_id, 'realizado',
         v_pag ->> 'forma', (v_pag ->> 'valor_cents')::integer,
         (v_pag ->> 'troco_cents')::integer,
         p_responsavel_id, p_ocorrido_em_local)
      on conflict (id) do nothing;
    end loop;

    -- A DIVERGÊNCIA É CONSEQUÊNCIA DOS FATOS, NÃO DECISÃO MANUAL.
    --
    -- Durante o retorno não existe "marcar divergência": o operador
    -- informa o que de fato voltou, e o servidor compara com o previsto.
    -- É isso que impede "o caixa registrou o retorno e esqueceu de
    -- clicar".
    --
    -- Compara o MULTICONJUNTO (forma, valor) dos dois lados, ordenado —
    -- trocar a ordem das formas não é divergência, trocar valor ou forma
    -- é. Vale de transferência tem os dois lados vazios e nunca diverge.
    --
    -- Insucesso fica de fora: não virou venda, e o eixo dele é
    -- `status_entrega`, não o financeiro.
    if v_desfecho = 'entregue' then
      select coalesce(array_agg(pg.forma || '|' || pg.valor_cents
                                order by pg.forma || '|' || pg.valor_cents), '{}')
        into v_previsto
        from public.pagamentos pg
       where pg.entrega_id = v_entrega_id and pg.momento = 'previsto';

      select coalesce(array_agg(x order by x), '{}') into v_realizado
        from (select (p.value ->> 'forma') || '|' || (p.value ->> 'valor_cents') as x
                from jsonb_array_elements(
                       coalesce(v_vale -> 'pagamentos_realizados', '[]'::jsonb)
                     ) as p(value)) t;

      v_divergiu := v_previsto is distinct from v_realizado;

      if v_divergiu then
        -- NUNCA sobrescreve 'conferido' nem 'divergente' que já existam:
        -- apagar a marca faria o problema chegar na administração sem
        -- sinalização, que é o oposto do que ela existe pra fazer.
        update public.entregas
           set status_financeiro = 'divergente'
         where id = v_entrega_id and status_financeiro = 'na_ordem';

        -- MESMO FORMATO do evento que `marcarDivergencia` grava, porque
        -- são as MESMAS telas que leem: `de` (forma prevista), `para`
        -- (array de forma+valor), `justificativa` e `autor_nome`. Um
        -- payload próprio faria Notificações e Auditoria mostrarem "Era
        -- undefined, virou undefined" — sem erro, sem pista.
        --
        -- `justificativa` aqui NÃO é texto de ninguém: a divergência do
        -- retorno é derivada, não digitada. A frase diz isso com todas as
        -- letras, senão a gestão leria como se alguém tivesse explicado.
        insert into public.eventos
          (tenant_id, entrega_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
        values
          (v_tenant, v_entrega_id, v_corrida.id, 'pagamento_alterado',
           jsonb_build_object(
             'de', (select pg.forma from public.pagamentos pg
                     where pg.entrega_id = v_entrega_id and pg.momento = 'previsto'
                     order by pg.id::text collate "C" limit 1),
             'para', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'forma', p.value ->> 'forma',
                        'valor_cents', (p.value ->> 'valor_cents')::integer)
                      order by p.value ->> 'forma')
                 from jsonb_array_elements(
                        coalesce(v_vale -> 'pagamentos_realizados', '[]'::jsonb)
                      ) as p(value)), '[]'::jsonb),
             'justificativa',
               'Divergência derivada do Romaneio de Retorno ' || v_numero ||
               ' — o realizado informado no balcão não bateu com o previsto. ' ||
               'Ninguém digitou esta justificativa.',
             'autor_nome', v_autor_nome,
             'origem', 'romaneio_retorno',
             'romaneio_retorno_id', p_romaneio_id,
             'previsto', to_jsonb(v_previsto),
             'realizado', to_jsonb(v_realizado)),
           p_responsavel_id, p_ocorrido_em_local);
      end if;
    end if;
  end loop;

  -- ---- assinaturas -------------------------------------------------------
  -- A FÓRMULA É NOVA. Duas coisas que a da saída não tem, e as duas por
  -- decisão da 2A:
  --
  --   * `papel_no_momento` DENTRO do digest. Na saída ele é metadado ao
  --     lado porque a fórmula já estava assinada; aqui não há o que
  --     retrofitar, e o cargo de quem recebeu a custódia é parte do que
  --     o documento afirma.
  --   * o instante entra por `to_char(... at time zone 'UTC', máscara)`,
  --     NUNCA por `::text`. `timestamptz::text` depende do `TimeZone` da
  --     sessão, e um verificador rodando com outro fuso recalcularia
  --     hashes diferentes pro mesmo documento. A saída tem esse problema
  --     latente; o retorno não nasce com ele.
  --
  -- QUEM FOR ESCREVER O VERIFICADOR: leia `tipo_signatario` da LINHA. O
  -- literal está no digest e aqui ele é `responsavel_loja`, não `caixa`.
  v_agora_txt := to_char(v_agora at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US');

  if v_papel is null or v_papel not in ('caixa', 'gerente', 'admin') then
    raise exception
      'Não dá pra registrar o papel de quem recebeu (perfil % tem papel %). O retorno não foi selado.',
      p_responsavel_id, coalesce(v_papel, '(nenhum)')
      using errcode = 'insufficient_privilege';
  end if;

  v_hash_resp := encode(digest(
    v_hash || '|responsavel_loja|' || p_responsavel_id::text || '|' || v_papel
           || '|' || p_responsavel_strokes::text
           || '|' || v_agora_txt || '|sessao_autenticada', 'sha256'), 'hex');

  v_hash_motoboy := encode(digest(
    v_hash || '|motoboy|' || p_motoboy_id::text || '|' || p_motoboy_strokes::text
           || '|' || v_agora_txt || '|' || p_modo, 'sha256'), 'hex');

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, strokes, hash_sha256,
     user_id, auth_method, document_hash, signature_hash, assinado_em_local,
     ip, geolocalizacao, papel_no_momento)
  values
    (v_tenant, v_corrida.id, p_romaneio_id, 'responsavel_loja',
     p_responsavel_strokes, v_hash_resp, p_responsavel_id, 'sessao_autenticada',
     v_hash, v_hash_resp, p_ocorrido_em_local, p_ip, p_geolocalizacao, v_papel);

  -- O motoboy não recebe `papel_no_momento`: ele é `mototaxistas`, não
  -- `profiles`, e o domínio da coluna é caixa/gerente/admin.
  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, strokes, hash_sha256,
     motoboy_id, credencial_id, autorizacao_id, auth_method, document_hash,
     signature_hash, assinado_em_local, ip, geolocalizacao)
  values
    (v_tenant, v_corrida.id, p_romaneio_id, 'motoboy', p_motoboy_strokes,
     v_hash_motoboy, p_motoboy_id, v_credencial_id, p_autorizacao_id,
     case p_modo when 'online' then 'physical_card_pin_server_verified'
                 else 'physical_card_pin_offline_then_verified' end,
     v_hash, v_hash_motoboy, p_ocorrido_em_local, p_ip, p_geolocalizacao);

  v_final := encode(digest(v_hash || '|' || v_hash_resp || '|' || v_hash_motoboy,
                           'sha256'), 'hex');
  update public.romaneios set final_hash = v_final where id = p_romaneio_id;

  -- ---- e SÓ AGORA a corrida fecha ---------------------------------------
  -- `fecharCorrida` vive aqui dentro, nunca como ação de usuário: não
  -- existem dois caminhos pra encerrar uma corrida. `retorno_em` é
  -- carimbado pelo trigger `fn_corrida_registrar_retorno` com o relógio
  -- do SERVIDOR; o cliente só manda o `_local` (regra 8).
  update public.corridas
     set status = 'fechada',
         retorno_em_local = p_ocorrido_em_local,
         retorno_por = p_responsavel_id
   where id = v_corrida.id;

  insert into public.eventos
    (tenant_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
  values
    (v_tenant, v_corrida.id, 'romaneio_retorno_selado',
     jsonb_build_object('romaneio_id', p_romaneio_id, 'numero', v_numero,
                        'saida_romaneio_id', p_saida_romaneio_id,
                        'modo', p_modo,
                        'vales', coalesce(array_length(v_da_saida, 1), 0),
                        'final_hash', v_final),
     p_responsavel_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', true, 'ja_existia', false,
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'document_hash', v_hash, 'final_hash', v_final);
end;
$$;

revoke all on function public.selar_romaneio_retorno_interno(
  uuid, uuid, uuid, text, uuid, jsonb, text, uuid, jsonb, jsonb, timestamptz,
  text, inet, jsonb
) from public, anon, authenticated;


-- =====================================================================
-- 4. A PORTA ONLINE
--
-- Não aceita `p_responsavel_id`, e isso é a garantia que faz
-- `papel_no_momento` valer alguma coisa: a identidade do signatário
-- interno vem de `auth.uid()`, nunca do corpo do request. Se um dia esse
-- id entrar por parâmetro, a coluna vira registro falso com cara de
-- auditoria.
--
-- A porta OFFLINE (`selar_romaneio_retorno_sincronizado`, só
-- `service_role`) é da etapa 2C, junto do envelope e da fila.
-- =====================================================================

create or replace function public.selar_romaneio_retorno(
  p_romaneio_id uuid, p_saida_romaneio_id uuid, p_saida_document_hash text,
  p_motoboy_id uuid, p_retorno jsonb, p_document_hash text,
  p_autorizacao_id uuid, p_responsavel_strokes jsonb, p_motoboy_strokes jsonb,
  p_ocorrido_em_local timestamptz, p_geolocalizacao jsonb default null
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_ip inet;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = 'insufficient_privilege';
  end if;

  -- O IP não pode vir do cliente (ele diria o que quisesse). Mesma
  -- extração da saída: se não vier, ou vier em formato que não é IP,
  -- fica nulo — registrar nulo é honesto, inventar não é.
  begin
    v_ip := trim(split_part(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1
    ))::inet;
  exception when others then
    v_ip := null;
  end;

  return public.selar_romaneio_retorno_interno(
    auth.uid(), p_romaneio_id, p_saida_romaneio_id, p_saida_document_hash,
    p_motoboy_id, p_retorno, p_document_hash, p_autorizacao_id,
    p_responsavel_strokes, p_motoboy_strokes, p_ocorrido_em_local, 'online',
    v_ip, p_geolocalizacao);
end;
$$;

revoke all on function public.selar_romaneio_retorno(
  uuid, uuid, text, uuid, jsonb, text, uuid, jsonb, jsonb, timestamptz, jsonb
) from public, anon;
grant execute on function public.selar_romaneio_retorno(
  uuid, uuid, text, uuid, jsonb, text, uuid, jsonb, jsonb, timestamptz, jsonb
) to authenticated;


-- =====================================================================
-- O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ
--
--   * não estende `verificar_romaneio` pro retorno. A fórmula acima é
--     nova, então verificá-la exige um ramo próprio que leia
--     `tipo_signatario` da linha e use `to_char` em vez do cast. Enquanto
--     isso não existir, o baseline `verificar_romaneios_selados()`
--     continua contando só as SAÍDAS — e vai continuar em 10 · 10 · 0
--     mesmo depois do primeiro retorno selado. **Isso é esperado, não
--     regressão**, e é a primeira coisa a fazer depois de a 2B ser
--     testada.
--   * não toca na fila offline. `fechamento_corrida` continua existindo e
--     continua sendo drenado pelo handler legado — a janela de duas
--     releases do CLAUDE.md. Converter um item legado em romaneio de
--     retorno é impossível: faltam assinatura, PIN e snapshot, que nunca
--     foram coletados.
--   * não representa a custódia do papel do crediário (o bloco `d`
--     conversado em 2026-08-20). Fica pra depois de levantado o fluxo
--     real, e antes do primeiro retorno selado.
--   * não constrói o fluxo excepcional (PIN recusado → intervenção de
--     gestor, `is_gerente()`, online por construção). Etapa própria.
--   * não renomeia `autorizar_saida`. O retorno REUSA essa função: ela
--     nunca soube o que é uma saída — recebe um `document_hash` e amarra
--     a autorização a ele, seja o DCR1 ou o DCRR1. O nome ficou estreito,
--     e trocá-lo custaria mexer numa função que o caminho crítico da
--     saída chama. Se um dia for renomeada, `autorizar_documento` é o
--     nome certo, e o call site da saída tem que ir junto.
--
-- ---------------------------------------------------------------------
-- COMO CONFERIR DEPOIS DE APLICAR
-- ---------------------------------------------------------------------
-- 1. As funções instaladas, com a assinatura certa:
--
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('selar_romaneio_retorno',
--                        'selar_romaneio_retorno_interno',
--                        'registrar_conflito_retorno',
--                        'romaneio_retorno_payload')
--    order by 1;
--
-- 2. Ninguém autenticado alcança o que não deve. Esperado: só
--    `selar_romaneio_retorno` com EXECUTE.
--
--   select p.proname, has_function_privilege('authenticated', p.oid, 'execute')
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname like '%retorno%' order by 1;
--
-- 3. O baseline das SAÍDAS não pode ter se mexido — esta migration não
--    encosta em `selar_romaneio_interno`, então qualquer mudança aqui
--    significa que outra coisa mudou junto:
--
--   select count(*) as verificados,
--          count(*) filter (where divergencias = 0) as validos,
--          coalesce(sum(divergencias), 0) as divergencias
--     from public.verificar_romaneios_selados();
--
--   Esperado: 10 · 10 · 0.
--
-- 4. AS RECUSAS, contra dado real e SEM DEIXAR NADA NO BANCO.
--
--    O caminho feliz exige cartão + PIN, e não dá pra exercitá-lo daqui:
--    o PIN vive no servidor e ninguém o digita em nome do motoboy. O E2E
--    completo é da etapa 2D, pela tela.
--
--    As RECUSAS não precisam de PIN nenhum — a autorização só é
--    consumida DEPOIS de todas elas, de propósito. O roteiro completo
--    está em "scripts/conferir-2b-no-sql-editor.sql"; cole inteiro no
--    SQL Editor.
--
--    DUAS COISAS QUE A PRIMEIRA VERSÃO DESTE RODAPÉ ERRAVA, e que valem
--    pra qualquer conferência deste tipo:
--
--      * o caso (d) LEVANTA EXCEÇÃO de propósito. Num "begin … rollback"
--        escrito à mão, ela abortaria a transação inteira e levaria
--        junto os resultados dos casos anteriores — a conferência
--        mostraria só o erro do último. O script põe o (d) num bloco
--        aninhado com "exception when others", que desfaz só a própria
--        subtransação.
--      * num "begin … rollback", o editor mostra o resultado do ÚLTIMO
--        statement, que é o rollback: nada. Pôr o select por último
--        resolveria a exibição e deixaria a transação ABERTA, dependendo
--        de alguém lembrar de desfazer. O script termina em
--        "raise exception" com o relatório na mensagem: desfaz tudo e
--        mostra o resultado sem depender de ninguém.
--
--    MEDIDO EM 2026-08-20, contra a corrida aberta do R-000014:
--
--      (a) vale faltando          nao aplicavel (corrida de 1 vale)
--      (a2) vale sobrando         vales_nao_conferem
--      (b) outro motoboy          outro_motoboy
--      (c) saida_hash nao confere saida_hash_nao_confere
--      (d) so falta a autorizacao 42501 | Autorização inválida, …
--
--    O (d) é o mais informativo dos cinco. Parar na autorização só
--    acontece se a saída foi encontrada, o hash bateu, a corrida está
--    aberta, não existe retorno ainda, os vales conferem EXATAMENTE, o
--    motoboy é o da custódia, o DCRR1 foi reconstruído e o hash do
--    documento fechou — porque qualquer uma dessas falhando teria
--    devolvido conflito antes.
--
--    E o (a2) existe porque o (a) não era exercitável: com um vale só na
--    corrida não há como FALTAR vale, mas há como SOBRAR. É o mesmo ramo
--    e a mesma linha de código, pelo outro lado.
-- =====================================================================
