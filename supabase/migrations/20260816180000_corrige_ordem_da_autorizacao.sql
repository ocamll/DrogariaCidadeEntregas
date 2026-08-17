-- =====================================================================
-- Corrige a ordem do consumo da autorização — TODO SELO ESTAVA FALHANDO
--
-- Sintoma:
--
--   insert or update on table "motoboy_autorizacoes" violates foreign
--   key constraint "motoboy_autorizacoes_consumida_por_romaneio_fkey"
--
-- A causa é uma referência pra frente que passou despercebida: o consumo
-- da autorização gravava `consumida_por_romaneio = p_romaneio_id` ANTES
-- do `insert into romaneios`. Essa coluna tem FK pra `romaneios(id)`, e
-- a FK é verificada na hora — a linha ainda não existia, então o Postgres
-- recusava e a transação inteira ia embora.
--
-- Consequência: **nenhuma saída selava**, nem online nem pela fila. A
-- tela caía no caminho de "registrada offline" (o catch que existe pra
-- falha de rede), e a fila retentava pra sempre com o mesmo erro. O
-- sintoma dizia "offline" quando o problema não tinha nada a ver com
-- rede.
--
-- Nada ficou pela metade: como era exceção, cada tentativa fez rollback
-- completo. Os vales seguem `pendente`, sem corrida, e as operações que
-- estão na fila passam a sincronizar sozinhas depois desta migration.
--
--
-- A CORREÇÃO, EM DUAS PARTES
--
-- O consumo continua ACONTECENDO CEDO, e isso é de propósito: marcar
-- `consumida_em` antes de criar qualquer coisa é o que garante uso único
-- e recusa a saída antes de mexer em vale nenhum. O que se move pra
-- depois é só o ponteiro `consumida_por_romaneio`, que é a única parte
-- que depende de o documento existir.
--
--   1. claim  → set consumida_em, valida uso único/prazo/document_hash
--   2. ...cria corrida, vales em rota, romaneio...
--   3. amarra → set consumida_por_romaneio
--
-- Trocar a ordem pra "criar o romaneio primeiro e consumir depois" seria
-- pior: abriria uma janela em que a corrida já existe e a autorização
-- ainda podia ser recusada.
--
--
-- POR QUE ISSO NÃO APARECEU ANTES
--
-- Este projeto não tem Postgres local (sem Docker, sem CLI linkada), e
-- eu nunca consegui EXECUTAR nenhuma das migrations — só escrevê-las. Um
-- erro que só existe em tempo de execução, como este, passa por qualquer
-- revisão de leitura. Achado no primeiro uso real da tela.
-- =====================================================================


create or replace function public.selar_romaneio_interno(
  p_caixa_id uuid,
  p_romaneio_id uuid,
  p_corrida_id uuid,
  p_loja_id uuid,
  p_agencia_id uuid,
  p_motoboy_id uuid,
  p_entrega_ids uuid[],
  p_document_hash text,
  p_autorizacao_id uuid,
  p_caixa_strokes jsonb,
  p_motoboy_strokes jsonb,
  p_ocorrido_em_local timestamptz,
  p_modo text,
  p_ip inet,
  p_geolocalizacao jsonb
)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions as $$
declare
  v_tenant uuid;
  v_existente record;
  v_canonico text;
  v_hash text;
  v_conflitos jsonb;
  v_numero text;
  v_agora timestamptz := now();
  v_hash_caixa text;
  v_hash_motoboy text;
  v_final text;
  v_credencial_id uuid;
  v_ordem smallint := 0;
  v_entrega_id uuid;
begin
  -- ---- reenvio da fila offline ---------------------------------------
  -- Vem ANTES de qualquer lock pra não segurar linha à toa. Olha o
  -- STATUS, não só a existência: um romaneio em conflito também tem
  -- número, e devolvê-lo como "ok, já existia" esconderia o conflito
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

  select p.tenant_id into v_tenant from public.profiles p
   where p.id = p_caixa_id and p.ativo;
  if v_tenant is null then
    raise exception 'Caixa inexistente ou inativo.' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(array_length(p_entrega_ids, 1), 0) = 0 then
    raise exception 'Romaneio sem vale nenhum.' using errcode = 'check_violation';
  end if;
  if p_caixa_strokes is null or p_motoboy_strokes is null then
    raise exception 'Romaneio exige as duas assinaturas.' using errcode = 'check_violation';
  end if;

  -- ---- trava os vales ANTES de validar --------------------------------
  -- Sem o FOR UPDATE, dois caixas leem "pendente" ao mesmo tempo e os
  -- dois selam. Com ele, o segundo espera o primeiro commitar e então
  -- enxerga corrida_id preenchido — vira conflito, que é o certo.
  --
  -- O `order by` é pra reduzir deadlock quando duas saídas têm vales em
  -- comum em ordens diferentes. Se ainda assim der deadlock, o Postgres
  -- aborta uma das duas, que é falha segura: nenhuma sela pela metade.
  perform 1 from public.entregas e
   where e.id = any(p_entrega_ids)
   order by e.id
   for update;

  -- ---- conflito: vale que não está mais disponível ---------------------
  select jsonb_agg(jsonb_build_object(
           'entrega_id', e.id, 'numero_vale', e.numero_vale,
           'status_entrega', e.status_entrega, 'corrida_id', e.corrida_id,
           'motivo', case
             when e.tenant_id <> v_tenant then 'outro_tenant'
             when e.loja_id <> p_loja_id then 'outra_filial'
             when e.corrida_id is not null then 'ja_em_corrida'
             else 'status_nao_permite'
           end))
    into v_conflitos
    from public.entregas e
   where e.id = any(p_entrega_ids)
     and (e.tenant_id <> v_tenant
       or e.loja_id <> p_loja_id
       or e.corrida_id is not null
       or e.status_entrega <> 'pendente');

  -- Vale que sumiu do banco também é conflito, não "some da lista".
  if (select count(*) from public.entregas e where e.id = any(p_entrega_ids))
     <> array_length(p_entrega_ids, 1) then
    v_conflitos := coalesce(v_conflitos, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('motivo', 'vale_inexistente'));
  end if;

  if v_conflitos is not null then
    return public.registrar_conflito_romaneio(
      p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
      p_ocorrido_em_local, p_modo, p_ip, p_geolocalizacao, v_conflitos,
      p_entrega_ids, p_caixa_strokes, p_motoboy_strokes);
  end if;

  -- ---- o hash tem que bater com o que foi assinado --------------------
  -- Recalculado a partir do BANCO, não do que o cliente mandou. É isso
  -- que faz o hash significar alguma coisa: se o conteúdo do vale mudou
  -- entre assinar e selar, os bytes mudam e a assinatura não vale mais.
  v_canonico := public.romaneio_canonico(v_tenant, p_loja_id, p_agencia_id,
                                         p_motoboy_id, p_caixa_id, p_entrega_ids);
  v_hash := encode(digest(v_canonico, 'sha256'), 'hex');

  if v_hash <> p_document_hash then
    return public.registrar_conflito_romaneio(
      p_romaneio_id, v_tenant, p_loja_id, p_caixa_id, p_document_hash,
      p_ocorrido_em_local, p_modo, p_ip, p_geolocalizacao,
      jsonb_build_array(jsonb_build_object(
        'motivo', 'documento_alterado',
        'hash_assinado', p_document_hash, 'hash_atual', v_hash)),
      p_entrega_ids, p_caixa_strokes, p_motoboy_strokes);
  end if;

  -- ---- consome a autorização ------------------------------------------
  -- Uso único, prazo curto e amarrada ao document_hash, tudo na mesma
  -- cláusula: se qualquer uma falhar, zero linhas e a saída é recusada.
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

  -- ---- ORDEM DAQUI PRA BAIXO IMPORTA ----------------------------------
  -- corrida → vales em rota → romaneio → vínculo → assinaturas.
  --
  -- O UPDATE dos vales tem que acontecer ANTES de existir romaneio_entregas
  -- ou assinatura, senão o trigger de imutabilidade (seção 9) vê o
  -- documento já selado e barra o próprio selo — a saída falharia sempre,
  -- e o erro apontaria pro lugar errado. Mesma armadilha que o código
  -- antigo de criarCorridaComAssinatura já contornava.
  insert into public.corridas
    (id, tenant_id, loja_id, mototaxista_id, agencia_id, status,
     saida_por, saida_em_local)
  values
    (p_corrida_id, v_tenant, p_loja_id, p_motoboy_id, p_agencia_id, 'aberta',
     p_caixa_id, p_ocorrido_em_local);

  update public.entregas
     set corrida_id = p_corrida_id, status_entrega = 'em_rota'
   where id = any(p_entrega_ids);

  insert into public.romaneios
    (id, tenant_id, loja_id, corrida_id, status, modo, payload, canonico,
     document_hash, ocorrido_em_local, selado_em, criado_por, ip, geolocalizacao)
  values
    (p_romaneio_id, v_tenant, p_loja_id, p_corrida_id, 'selado', p_modo,
     public.romaneio_payload(p_loja_id, p_agencia_id, p_motoboy_id, p_caixa_id, p_entrega_ids),
     v_canonico, v_hash, p_ocorrido_em_local, v_agora, p_caixa_id,
     p_ip, p_geolocalizacao)
  returning numero into v_numero;

  -- Só AGORA dá pra apontar a autorização pro romaneio: a FK exige que
  -- a linha exista, e ela nasceu no insert logo acima.
  update public.motoboy_autorizacoes
     set consumida_por_romaneio = p_romaneio_id
   where id = p_autorizacao_id;

  foreach v_entrega_id in array p_entrega_ids loop
    insert into public.romaneio_entregas (romaneio_id, entrega_id, tenant_id, ordem)
    values (p_romaneio_id, v_entrega_id, v_tenant, v_ordem);
    v_ordem := v_ordem + 1;
  end loop;

  -- ---- assinaturas -----------------------------------------------------
  -- signature_hash amarra documento + quem assinou + os traços + o
  -- relógio do servidor + como autenticou. Trocar qualquer um muda o
  -- hash. `strokes::text` serve de forma canônica de graça: jsonb já
  -- ordena chave e normaliza número.
  --
  -- `hash_sha256` (coluna do schema inicial, not null) recebe o mesmo
  -- signature_hash. Ela existia pra guardar "o hash desta assinatura" e
  -- continua sendo isso — só que agora o hash cobre bem mais coisa.
  v_hash_caixa := encode(digest(
    v_hash || '|caixa|' || p_caixa_id::text || '|' || p_caixa_strokes::text
           || '|' || v_agora::text || '|sessao_autenticada', 'sha256'), 'hex');

  v_hash_motoboy := encode(digest(
    v_hash || '|motoboy|' || p_motoboy_id::text || '|' || p_motoboy_strokes::text
           || '|' || v_agora::text || '|' || p_modo, 'sha256'), 'hex');

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, strokes, hash_sha256,
     user_id, auth_method, document_hash, signature_hash, assinado_em_local,
     ip, geolocalizacao)
  values
    (v_tenant, p_corrida_id, p_romaneio_id, 'caixa', p_caixa_strokes, v_hash_caixa,
     p_caixa_id, 'sessao_autenticada', v_hash, v_hash_caixa, p_ocorrido_em_local,
     p_ip, p_geolocalizacao);

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, strokes, hash_sha256,
     motoboy_id, credencial_id, autorizacao_id, auth_method, document_hash,
     signature_hash, assinado_em_local, ip, geolocalizacao)
  values
    (v_tenant, p_corrida_id, p_romaneio_id, 'motoboy', p_motoboy_strokes, v_hash_motoboy,
     p_motoboy_id, v_credencial_id, p_autorizacao_id,
     case p_modo when 'online' then 'physical_card_pin_server_verified'
                 else 'physical_card_pin_offline_then_verified' end,
     v_hash, v_hash_motoboy, p_ocorrido_em_local, p_ip, p_geolocalizacao);

  v_final := encode(digest(v_hash || '|' || v_hash_caixa || '|' || v_hash_motoboy,
                           'sha256'), 'hex');
  update public.romaneios set final_hash = v_final where id = p_romaneio_id;

  insert into public.eventos (tenant_id, corrida_id, tipo, payload, user_id, ocorrido_em_local)
  values (v_tenant, p_corrida_id, 'romaneio_selado',
          jsonb_build_object('romaneio_id', p_romaneio_id, 'numero', v_numero,
                             'modo', p_modo, 'vales', array_length(p_entrega_ids, 1),
                             'final_hash', v_final),
          p_caixa_id, p_ocorrido_em_local);

  return jsonb_build_object('ok', true, 'ja_existia', false,
                            'romaneio_id', p_romaneio_id, 'numero', v_numero,
                            'document_hash', v_hash, 'final_hash', v_final);
end;
$$;

-- Continua fora do alcance de quem não é a Edge Function ou a porta
-- online: quem a alcançasse escolheria de quem é a saída.
revoke all on function public.selar_romaneio_interno(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid, jsonb, jsonb,
  timestamptz, text, inet, jsonb
) from public, anon, authenticated;
