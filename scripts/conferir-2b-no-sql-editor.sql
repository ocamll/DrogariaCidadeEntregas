-- =====================================================================
-- ETAPA 2B — CONFERÊNCIA DEPOIS DE APLICAR
--
-- Cole INTEIRO no SQL Editor e rode de uma vez. São dois blocos: o
-- primeiro só lê, o segundo escreve e desfaz sozinho.
-- =====================================================================


-- =====================================================================
-- BLOCO 1 — só leitura. As três primeiras conferências numa consulta só,
-- porque o editor mostra apenas o resultado do ÚLTIMO statement e três
-- selects separados fariam dois desaparecerem.
--
-- ESPERADO: 7 linhas, todas com ok = true. As que falharem vêm primeiro.
-- =====================================================================

with instaladas as (
  select p.proname,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated_executa
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('selar_romaneio_retorno', 'selar_romaneio_retorno_interno',
                       'registrar_conflito_retorno', 'romaneio_retorno_payload')
),
baseline as (
  select count(*) as verificados,
         count(*) filter (where divergencias = 0) as validos,
         coalesce(sum(divergencias), 0) as divergencias
    from public.verificar_romaneios_selados()
),
conferencia(ordem, o_que, ok, observado) as (
      select 1, 'as 4 funções da 2B estão instaladas',
             (select count(*) from instaladas) = 4,
             (select count(*)::text || ' de 4' from instaladas)

  -- A porta ONLINE é a única que `authenticated` alcança. As outras três
  -- rodam com SECURITY DEFINER e não podem ser chamadas direto: a
  -- `_interno` aceita `p_responsavel_id` por parâmetro, e é justamente
  -- isso que faria `papel_no_momento` virar registro falso.
  union all select 2, 'só `selar_romaneio_retorno` é executável por authenticated',
             (select count(*) from instaladas where authenticated_executa) = 1,
             coalesce((select string_agg(proname, ', ' order by proname)
                         from instaladas where authenticated_executa), '(nenhuma)')

  union all select 3, 'nenhuma das internas ficou exposta',
             not exists (select 1 from instaladas
                          where authenticated_executa
                            and proname <> 'selar_romaneio_retorno'),
             coalesce((select string_agg(proname, ', ')
                         from instaladas
                        where authenticated_executa
                          and proname <> 'selar_romaneio_retorno'), 'nenhuma')

  -- Esta migration NÃO encosta em `selar_romaneio_interno`. Se o baseline
  -- das SAÍDAS mudou, alguma coisa ao lado mudou junto — e descobrir isso
  -- agora custa muito menos que descobrir depois de selar um retorno.
  union all select 4, 'baseline das saídas: 10 verificados',
             (select verificados from baseline) = 10,
             (select verificados::text from baseline)
  union all select 5, 'baseline das saídas: 10 válidos',
             (select validos from baseline) = 10,
             (select validos::text from baseline)
  union all select 6, 'baseline das saídas: 0 divergências',
             (select divergencias from baseline) = 0,
             (select divergencias::text from baseline)

  -- Se voltar 0, o BLOCO 2 não tem o que testar: sele uma saída pela Nova
  -- Corrida e NÃO feche a corrida.
  union all select 7, 'existe corrida aberta pro bloco 2',
             (select count(*) from public.romaneios r
                join public.corridas c on c.id = r.corrida_id
               where r.tipo = 'saida' and r.status = 'selado'
                 and c.status = 'aberta') > 0,
             (select count(*)::text || ' corrida(s) aberta(s)'
                from public.romaneios r
                join public.corridas c on c.id = r.corrida_id
               where r.tipo = 'saida' and r.status = 'selado'
                 and c.status = 'aberta')
)
select ordem, o_que, ok, observado from conferencia order by ok, ordem;


-- =====================================================================
-- BLOCO 2 — AS RECUSAS, contra dado real, SEM DEIXAR NADA NO BANCO
--
-- O caminho feliz exige cartão + PIN e não dá pra exercitar daqui: o PIN
-- vive no servidor e ninguém o digita em nome do motoboy. O E2E completo
-- é da etapa 2D, pela tela.
--
-- As RECUSAS não precisam de PIN nenhum — a autorização só é consumida
-- DEPOIS de todas elas, de propósito. Então dá pra provar hoje que a
-- função recusa o que tem que recusar E guarda a prova.
--
-- ---------------------------------------------------------------------
-- POR QUE ISTO TERMINA EM `raise exception`, E NÃO EM `rollback`
-- ---------------------------------------------------------------------
-- Duas razões, e as duas vieram de errar antes:
--
--   1. O caso (d) levanta exceção de propósito. Num `begin … rollback`
--      escrito à mão, essa exceção abortaria a transação inteira e
--      levaria junto os resultados de (a) a (c) — a conferência mostraria
--      só o erro do último caso. Aqui ele é capturado por um bloco
--      aninhado, que desfaz só a própria subtransação.
--
--   2. Num `begin … rollback`, o editor mostra o resultado do ÚLTIMO
--      statement — que seria o `rollback`, ou seja, nada. Pôr o `select`
--      por último resolveria a exibição e deixaria a transação ABERTA,
--      dependendo de alguém lembrar de desfazer. Conferência que depende
--      de ninguém esquecer não é conferência.
--
-- A exceção final resolve os dois: ela desfaz TUDO que o bloco escreveu
-- (os romaneios de conflito e os eventos de (a) a (c)) e o relatório sai
-- na mensagem. **O erro vermelho no fim é o resultado esperado.**
-- =====================================================================

do $$
declare
  a            record;
  v_resp       uuid;
  v_resp_nome  text;
  v_ret        jsonb;
  v_out        jsonb;
  v_hash       text;
  v_rel        text := '';
  v_strokes    jsonb := '{"strokes":[],"canvas":{"w":600,"h":200}}'::jsonb;
begin
  -- A corrida ainda aberta mais recente. `for update` de propósito NÃO:
  -- este bloco desfaz tudo, e travar linha de produção pra conferir não
  -- se justifica.
  select r.id as saida_id, r.document_hash, r.numero, c.id as corrida_id,
         c.mototaxista_id,
         (select array_agg(re.entrega_id order by re.entrega_id)
            from public.romaneio_entregas re where re.romaneio_id = r.id) as vales
    into a
    from public.romaneios r
    join public.corridas c on c.id = r.corrida_id
   where r.tipo = 'saida' and r.status = 'selado' and c.status = 'aberta'
   order by r.recebido_em_servidor desc
   limit 1;

  if a.saida_id is null then
    raise exception E'Nenhuma corrida aberta. Sele uma saída pela Nova Corrida e NÃO feche a corrida.';
  end if;

  select p.id, p.nome into v_resp, v_resp_nome
    from public.profiles p where p.ativo and p.papel in ('caixa','gerente','admin') limit 1;

  v_rel := v_rel || format(E'saída %s · corrida %s · %s vale(s) · responsável %s\n\n',
                           a.numero, a.corrida_id,
                           coalesce(array_length(a.vales, 1), 0), v_resp_nome);

  -- O retorno COMPLETO e bem formado: todos os vales entregues, sem
  -- pagamento nenhum. É o que (b), (c) e (d) usam — assim a única coisa
  -- errada em cada um é a que o caso quer testar.
  select jsonb_agg(jsonb_build_object(
           'entrega_id', v, 'desfecho', 'entregue',
           'motivo', null, 'detalhe', null,
           'pagamentos_realizados', '[]'::jsonb))
    into v_ret from unnest(a.vales) as v;

  -- ---- (a) VALE FALTANDO ----------------------------------------------
  if coalesce(array_length(a.vales, 1), 0) > 1 then
    v_out := public.selar_romaneio_retorno_interno(
      v_resp, gen_random_uuid(), a.saida_id, a.document_hash, a.mototaxista_id,
      jsonb_build_array(jsonb_build_object(
        'entrega_id', a.vales[1], 'desfecho', 'entregue',
        'motivo', null, 'detalhe', null, 'pagamentos_realizados', '[]'::jsonb)),
      repeat('0', 64), gen_random_uuid(), v_strokes, v_strokes,
      now(), 'online', null, null);
    v_rel := v_rel || format(E'(a) vale faltando          -> %s\n',
                             coalesce(v_out #>> '{conflitos,0,motivo}', v_out::text));
  else
    v_rel := v_rel || E'(a) vale faltando          -> nao aplicavel (a corrida tem 1 vale so)\n';
  end if;

  -- ---- (b) OUTRO MOTOBOY -----------------------------------------------
  v_out := public.selar_romaneio_retorno_interno(
    v_resp, gen_random_uuid(), a.saida_id, a.document_hash,
    gen_random_uuid(),                       -- ninguém
    v_ret, repeat('0', 64), gen_random_uuid(), v_strokes, v_strokes,
    now(), 'online', null, null);
  v_rel := v_rel || format(E'(b) outro motoboy          -> %s\n',
                           coalesce(v_out #>> '{conflitos,0,motivo}', v_out::text));

  -- ---- (c) SAIDA_HASH QUE NÃO BATE --------------------------------------
  v_out := public.selar_romaneio_retorno_interno(
    v_resp, gen_random_uuid(), a.saida_id, repeat('a', 64), a.mototaxista_id,
    v_ret, repeat('0', 64), gen_random_uuid(), v_strokes, v_strokes,
    now(), 'online', null, null);
  v_rel := v_rel || format(E'(c) saida_hash nao confere -> %s\n',
                           coalesce(v_out #>> '{conflitos,0,motivo}', v_out::text));

  -- ---- (d) TUDO CERTO, MENOS A AUTORIZAÇÃO ------------------------------
  -- O mais informativo dos quatro. Chegar na autorização só acontece se a
  -- saída foi encontrada, o hash bateu, a corrida está aberta, não existe
  -- retorno ainda, os vales conferem EXATAMENTE, o motoboy é o da
  -- custódia, o DCRR1 foi reconstruído e o hash do documento fechou.
  -- Qualquer uma dessas falhando teria devolvido conflito antes.
  --
  -- O bloco aninhado com EXCEPTION é o que impede a exceção esperada de
  -- abortar a conferência inteira: ela desfaz só a própria subtransação.
  begin
    v_hash := encode(digest(public.romaneio_retorno_canonico(
                a.saida_id, a.document_hash, a.mototaxista_id, v_resp, v_ret
              ), 'sha256'), 'hex');

    v_out := public.selar_romaneio_retorno_interno(
      v_resp, gen_random_uuid(), a.saida_id, a.document_hash, a.mototaxista_id,
      v_ret, v_hash, gen_random_uuid(), v_strokes, v_strokes,
      now(), 'online', null, null);

    -- Chegar aqui seria grave: significaria que uma autorização
    -- inexistente foi aceita.
    v_rel := v_rel || format(E'(d) so falta a autorizacao -> NAO RECUSOU! %s\n', v_out::text);
  exception when others then
    v_rel := v_rel || format(E'(d) so falta a autorizacao -> %s | %s\n', sqlstate, sqlerrm);
  end;

  raise exception E'\n\n=== CONFERÊNCIA DA 2B — NADA FOI GRAVADO ===\n\n%\nESPERADO:\n  (a) vales_nao_conferem\n  (b) outro_motoboy\n  (c) saida_hash_nao_confere\n  (d) 42501 | Autorização inválida, expirada, já usada ou de outro documento.\n', v_rel;
end $$;
