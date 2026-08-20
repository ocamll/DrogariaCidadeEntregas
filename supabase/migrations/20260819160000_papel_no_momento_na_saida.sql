-- =====================================================================
-- `papel_no_momento` NA ASSINATURA DA SAÍDA — etapa 2A item 7
--
-- MUDANÇA DELIBERADAMENTE ESTREITA. Uma coluna a mais no INSERT da
-- assinatura interna, e nada mais:
--
--   * `tipo_signatario` continua 'caixa'
--   * o canônico da saída NÃO muda
--   * a fórmula do `signature_hash` NÃO muda um byte
--   * a fórmula do `final_hash` NÃO muda um byte
--   * nada é reescrito, nada é preenchido retroativamente
--
-- O baseline de 2026-08-19 — 9 verificados, 9 válidos, 0 divergências —
-- tem que continuar exatamente igual depois desta migration. É o item 8
-- da etapa, e se mexer em qualquer hash existente, PARA ALI.
--
-- ---------------------------------------------------------------------
-- POR QUE ESTA COLUNA EXISTE
-- ---------------------------------------------------------------------
-- `tipo_signatario = 'caixa'` é o nome do SLOT ("o lado da farmácia"),
-- não uma afirmação sobre o cargo de quem assinou. Medido em 2026-08-19:
-- "Nova corrida" não tem gate de papel e `selar_romaneio_interno` só
-- checa escopo de filial, então um gerente pode selar uma saída hoje — e
-- a linha fica 'caixa' com o `user_id` dele.
--
-- Sem `papel_no_momento`, responder "quem entregou essa corrida, caixa ou
-- gerente?" seis meses depois exigiria olhar `profiles.papel`, que é o
-- papel de HOJE. Se a pessoa for promovida, um romaneio antigo passaria a
-- afirmar que o ato foi praticado por um gerente. Mesmo defeito que a
-- regra 7 descreve, noutra coluna.
--
-- ---------------------------------------------------------------------
-- POR QUE ISSO É SEGURO
-- ---------------------------------------------------------------------
-- A identidade do signatário interno NUNCA vem do cliente:
--
--   online   `selar_romaneio` sequer aceita um `p_caixa_id` — passa
--            `auth.uid()`
--   offline  a Edge Function valida o JWT, confere contra o dono da
--            operação na fila, e passa `p_caixa_id: auth.user.id`
--
-- Ler `profiles` por esse id é ler o cargo de uma identidade já provada.
-- **Se algum dia esse id passar a entrar por parâmetro do cliente,
-- `papel_no_momento` vira registro falso com cara de auditoria** — pior
-- que não ter.
--
-- ---------------------------------------------------------------------
-- FALHAR EM VEZ DE GRAVAR NULO — E ONDE FALHAR
-- ---------------------------------------------------------------------
-- Decisão do usuário: se o papel não puder ser resolvido, a selagem
-- FALHA. As assinaturas antigas seguem NULL (nunca tiveram o dado, e
-- preenchê-las com o papel de hoje seria inventar exatamente o que a
-- coluna existe pra evitar); as novas passam a ter garantia.
--
-- Mas ONDE checar muda o comportamento num caso que importa.
--
-- Checar cedo, logo depois de buscar o perfil, faria uma selagem que
-- viraria CONFLITO passar a falhar. E o caminho do conflito é o que
-- preserva os traços das duas assinaturas quando a saída é recusada — a
-- retirada física aconteceu, e essa prova não pode sumir. Derrubá-lo por
-- causa de um papel seria trocar a prova por uma exceção.
--
-- Então a checagem fica IMEDIATAMENTE ANTES do INSERT da assinatura, que
-- é o único ponto onde a coluna existe. O caminho do conflito grava em
-- `romaneios.conflito`, não em `assinaturas`, e segue intocado.
--
-- Na prática o único papel que dispara isto é `'agencia'`, que
-- `profiles.papel` aceita desde o schema inicial e que não deveria estar
-- selando saída nenhuma. Sem a checagem explícita, ele bateria no CHECK
-- da coluna lá adiante e derrubaria a transação com uma mensagem que não
-- explica nada.
--
-- ---------------------------------------------------------------------
-- ATENÇÃO A QUEM FOR REESCREVER ESTA FUNÇÃO DE NOVO
-- ---------------------------------------------------------------------
-- Ela já foi substituída uma vez: `20260816180000` corrigiu a ordem da
-- FK da autorização (item 40 do NOTAS — a que fazia NENHUM selo
-- funcionar). O corpo abaixo parte DAQUELA versão, não da original de
-- `20260816140000`. Copiar da primeira reintroduziria o bug.
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
  v_papel text;              -- NOVO: o cargo no instante da selagem
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

  -- O `papel` entra nesta busca que já existia — uma consulta, não duas.
  -- A VALIDAÇÃO dele fica lá embaixo, junto do INSERT da assinatura; ver
  -- o cabeçalho pra por quê.
  select p.tenant_id, p.papel into v_tenant, v_papel from public.profiles p
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
  --
  -- **AS DUAS FÓRMULAS ABAIXO NÃO MUDARAM UM BYTE NESTA MIGRATION.**
  -- `papel_no_momento` é metadado ao lado; ele NÃO entra em hash nenhum
  -- da saída. Quem for mexer aqui: o baseline do verificador
  -- (`verificar_romaneios_selados()`) é o que prova isso, e ele tem que
  -- continuar devolvendo 9 · 9 · 0.
  v_hash_caixa := encode(digest(
    v_hash || '|caixa|' || p_caixa_id::text || '|' || p_caixa_strokes::text
           || '|' || v_agora::text || '|sessao_autenticada', 'sha256'), 'hex');

  v_hash_motoboy := encode(digest(
    v_hash || '|motoboy|' || p_motoboy_id::text || '|' || p_motoboy_strokes::text
           || '|' || v_agora::text || '|' || p_modo, 'sha256'), 'hex');

  -- ---- a checagem do papel, no único ponto onde a coluna existe -------
  -- Aqui e não lá em cima: cedo demais, isto derrubaria também o caminho
  -- do CONFLITO, que grava em `romaneios.conflito` e existe justamente
  -- pra não perder a prova de uma retirada que aconteceu.
  --
  -- Falhar em vez de gravar NULL é decisão explícita: as assinaturas
  -- antigas seguem sem o dado, as novas passam a ter garantia. Um NULL
  -- novo seria indistinguível de um antigo, e aí a coluna não garantiria
  -- nada.
  if v_papel is null or v_papel not in ('caixa', 'gerente', 'admin') then
    raise exception
      'Não dá pra registrar o papel de quem assinou (perfil % tem papel %). A saída não foi selada.',
      p_caixa_id, coalesce(v_papel, '(nenhum)')
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.assinaturas
    (tenant_id, corrida_id, romaneio_id, tipo_signatario, strokes, hash_sha256,
     user_id, auth_method, document_hash, signature_hash, assinado_em_local,
     ip, geolocalizacao, papel_no_momento)
  values
    (v_tenant, p_corrida_id, p_romaneio_id, 'caixa', p_caixa_strokes, v_hash_caixa,
     p_caixa_id, 'sessao_autenticada', v_hash, v_hash_caixa, p_ocorrido_em_local,
     p_ip, p_geolocalizacao, v_papel);

  -- O motoboy NÃO recebe `papel_no_momento`: ele não é um `profiles`, é
  -- um `mototaxistas`, e o domínio da coluna é caixa/gerente/admin. O
  -- que identifica a autenticação dele é `auth_method` e a credencial.
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


-- =====================================================================
-- DEPOIS DE APLICAR — ITENS 8 E 9 DA ETAPA
--
--   -- 8. o verificador de novo
--   select * from public.verificar_romaneios_selados();
--
--   -- 9. o baseline tem que continuar IDÊNTICO
--   select count(*) as verificados,
--          count(*) filter (where divergencias = 0) as validos,
--          coalesce(sum(divergencias), 0) as divergencias
--     from public.verificar_romaneios_selados();
--
-- Esperado: 9 · 9 · 0, exatamente como em 2026-08-19.
--
-- **SE MEXEU EM QUALQUER HASH, PARA AQUI e não segue pro E2E.** Esta
-- migration não toca em fórmula nenhuma, então uma divergência aqui
-- significa que alguma coisa ao lado mudou junto — e descobrir isso agora
-- custa muito menos que descobrir depois de selar uma saída de verdade.
--
-- E a checagem de que a coluna passou a ser preenchida só pode ser feita
-- DEPOIS do E2E (item 10), porque nenhuma assinatura nova existe até lá:
--
--   select tipo_signatario, papel_no_momento, count(*)
--     from public.assinaturas
--    where romaneio_id is not null
--    group by 1, 2 order by 1, 2;
--
-- Antes do item 10 isso devolve só linhas com `papel_no_momento` nulo —
-- as antigas, que nunca tiveram o dado. É o esperado, não um defeito.
-- =====================================================================
