-- =====================================================================
-- ROMANEIO DE RETORNO — etapa 1 de 6: só o schema
--
-- Esta migration não cria função nenhuma e não muda comportamento
-- nenhum. Ela abre espaço. Depois dela o app continua funcionando
-- exatamente como antes: `selar_romaneio_interno` segue gravando
-- `tipo = 'saida'` pelo default e `tipo_signatario = 'caixa'`, que o
-- CHECK novo continua aceitando.
--
-- O desenho completo está no CLAUDE.md, seção "O Romaneio de Retorno".
-- Leia antes de escrever a etapa 2 — metade das decisões existe pra
-- evitar uma segunda migration conceitual.
--
-- ---------------------------------------------------------------------
-- RODE ISTO ANTES, E CONFIRME QUE AS TRÊS VOLTAM ZERO LINHAS
-- ---------------------------------------------------------------------
-- Os índices únicos abaixo falham se o dado já os violar, e falhar no
-- meio de uma migration é pior que não começar.
--
--   -- 1. corrida com mais de um romaneio (quebraria o UNIQUE novo)
--   select corrida_id, count(*)
--     from public.romaneios
--    where corrida_id is not null
--    group by 1 having count(*) > 1;
--
--   -- 2. duas assinaturas do mesmo tipo no mesmo documento
--   select romaneio_id, tipo_signatario, count(*)
--     from public.assinaturas
--    where romaneio_id is not null
--    group by 1, 2 having count(*) > 1;
--
--   -- 3. duas assinaturas legadas do mesmo tipo na mesma corrida
--   select corrida_id, tipo_signatario, count(*)
--     from public.assinaturas
--    where romaneio_id is null
--    group by 1, 2 having count(*) > 1;
--
-- A terceira deve voltar zero porque o índice antigo garantia isso; ela
-- está aqui porque é justamente esse índice que a migration derruba, e
-- confiar numa garantia enquanto se remove a garantia é como o projeto
-- perde dado em silêncio.
-- =====================================================================


-- =====================================================================
-- 1. ROMANEIOS GANHAM TIPO
--
-- Todo romaneio que existe hoje é de saída, então o default resolve o
-- backfill sem UPDATE nenhum — e sem inventar passado, porque não há
-- outro valor que eles pudessem ter tido.
-- =====================================================================

alter table public.romaneios
  add column if not exists tipo text not null default 'saida'
    check (tipo in ('saida', 'retorno')),

  -- O retorno APONTA pra saída e nunca a modifica. É a regra 7: o
  -- segundo documento referencia o primeiro, e reconstruir "o que
  -- voltou" a partir de um romaneio que foi sendo alterado é exatamente
  -- o que este desenho existe pra impedir.
  add column if not exists romaneio_saida_id uuid references public.romaneios(id);

create index if not exists romaneios_saida_referenciada
  on public.romaneios (romaneio_saida_id)
  where romaneio_saida_id is not null;

-- A referência é obrigatória no retorno e proibida na saída. Escrito
-- como igualdade de booleanos porque as duas metades importam: retorno
-- órfão não se explica, e saída apontando pra outra saída seria um ciclo
-- esperando acontecer.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'romaneio_retorno_referencia_saida'
  ) then
    alter table public.romaneios
      add constraint romaneio_retorno_referencia_saida
        check ((tipo = 'retorno') = (romaneio_saida_id is not null));
  end if;
end $$;

-- Uma saída e um retorno por corrida, no máximo. É o que impede dois
-- retornos criados por engano — o caso do duplo clique, ou da fila
-- offline reenviando com um id novo.
--
-- ELE ISENTA OS CONFLITOS DE GRAÇA: romaneio em conflito tem
-- `corrida_id` nulo por construção (a corrida nunca chegou a existir), e
-- no Postgres nulo não colide com nulo. Não precisa de índice parcial.
create unique index if not exists romaneios_corrida_tipo
  on public.romaneios (corrida_id, tipo);


-- =====================================================================
-- 2. O SIGNATÁRIO INTERNO DEIXA DE SER "O CAIXA"
--
-- Na saída normalmente é o caixa; no retorno pode ser gerente ou admin.
--
-- O CHECK É AMPLIADO, NUNCA RENOMEADO, e o motivo não é conservadorismo:
-- o literal do papel entra no hash da assinatura, em
-- `selar_romaneio_interno`:
--
--     v_hash_caixa := encode(digest(
--       v_hash || '|caixa|' || p_caixa_id::text || '|' || ...
--
-- e o `final_hash` é digest(document_hash | hash_caixa | hash_motoboy).
-- Reescrever `caixa` pra `responsavel_loja` nas linhas existentes faria
-- todo romaneio já selado deixar de se verificar. O vocabulário virou
-- dado assinado, e a regra 7 alcança aqui.
--
-- REGRA PRO DIA EM QUE EXISTIR UM VERIFICADOR DE HASH: ele tem que ler
-- `tipo_signatario` da própria linha e usar aquele literal. Fixar
-- 'caixa' ou 'responsavel_loja' no código torna impossível verificar as
-- duas eras com a mesma função. Hoje nada recomputa esses hashes — são
-- gravados e exibidos truncados —, então isto é dívida registrada, não
-- defeito ativo.
-- =====================================================================

-- O CHECK antigo é descoberto, não adivinhado.
--
-- Ele nasceu de um `add column ... check (...)`, então o Postgres o
-- batizou sozinho — provavelmente `assinaturas_tipo_signatario_check`,
-- mas "provavelmente" aqui tem um custo alto e silencioso: um
-- `drop constraint if exists` com o nome errado não faz nada, o
-- `add constraint` seguinte cria o novo do lado do velho, e a migration
-- "passa". O CHECK antigo continua recusando `responsavel_loja`, e o
-- erro só aparece na etapa 2 apontando pro lugar errado.
--
-- Então: derruba todo CHECK desta tabela que mencione a coluna, seja
-- qual for o nome que ele tenha.
do $$
declare
  v_nome text;
begin
  for v_nome in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'assinaturas'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%tipo_signatario%'
  loop
    execute format('alter table public.assinaturas drop constraint %I', v_nome);
  end loop;

  alter table public.assinaturas
    add constraint assinaturas_tipo_signatario_check
      check (tipo_signatario in ('caixa', 'motoboy', 'responsavel_loja'));
end $$;

-- O cargo de quem assinou, NO MOMENTO em que assinou.
--
-- Não dá pra derivar de `profiles.papel`, que é o papel ATUAL: se a
-- pessoa for promovida, um romaneio de seis meses atrás passaria a
-- afirmar que o ato foi praticado por um gerente. É o mesmo defeito que
-- a regra 7 descreve, noutra coluna.
--
-- Nullable de propósito: as assinaturas que já existem não têm esse
-- dado, e preenchê-las com o papel de hoje seria inventar exatamente o
-- que a coluna existe pra evitar.
alter table public.assinaturas
  add column if not exists papel_no_momento text
    check (papel_no_momento in ('caixa', 'gerente', 'admin'));


-- =====================================================================
-- 3. A UNICIDADE PASSA A SER POR DOCUMENTO
--
-- Era o bloqueio que motivou a frente inteira:
--
--     create unique index assinaturas_corrida_signatario
--       on public.assinaturas (corrida_id, tipo_signatario);
--
-- Cada CORRIDA aceitava uma assinatura de cada tipo. O retorno precisa
-- de um segundo par na mesma corrida, então a invariante correta é por
-- documento — mas as assinaturas legadas (anteriores ao romaneio) têm
-- `romaneio_id` nulo e ficariam sem proteção nenhuma.
--
-- Daí dois índices parciais em vez de um: cada linha cai em exatamente
-- um deles, e nenhum dado histórico é tocado.
-- =====================================================================

drop index if exists assinaturas_corrida_signatario;

-- Modelo novo: uma assinatura de cada tipo POR DOCUMENTO. É isto que
-- permite saída e retorno coexistirem na mesma corrida.
create unique index if not exists assinaturas_romaneio_signatario
  on public.assinaturas (romaneio_id, tipo_signatario)
  where romaneio_id is not null;

-- Legado: as assinaturas de antes do romaneio existir. Continuam
-- protegidas pela regra antiga, que pra elas nunca deixou de ser a
-- certa. `corrida_id` é `not null` na tabela, então o índice sempre tem
-- por onde pegar.
create unique index if not exists assinaturas_corrida_signatario_legado
  on public.assinaturas (corrida_id, tipo_signatario)
  where romaneio_id is null;


-- =====================================================================
-- O QUE ESTA MIGRATION DELIBERADAMENTE NÃO FAZ
--
--   * não cria `selar_romaneio_retorno` nem canônico nenhum — etapa 2,
--     e é a etapa perigosa: o canônico do retorno tem mais campos que o
--     da saída (desfecho por vale, previsto × realizado, motivo de
--     insucesso), então são dois gêmeos TypeScript/SQL de novo. Ver "As
--     duas implementações gêmeas" no CLAUDE.md antes de escrever
--     qualquer um dos dois lados.
--   * não mexe em `selar_romaneio_interno`. Ela continua gravando
--     `tipo_signatario = 'caixa'`, o que o CHECK novo aceita, e **assim
--     fica**: decidido em 2026-08-19 que a saída não migra pra
--     `responsavel_loja`. Os dois nomes descrevem momentos com regras
--     diferentes (na saída quem entrega é o caixa; no retorno quem
--     recebe pode ser caixa, gerente ou admin), e reabrir a fórmula do
--     hash da saída por uniformidade conceitual seria risco sem retorno.
--
--     O que a etapa 2 VAI fazer nela: acrescentar `papel_no_momento` ao
--     INSERT da assinatura da saída — uma coluna a mais, lida de
--     `profiles` no instante da selagem. **A fórmula do hash não muda
--     um byte.** Isso existe porque `tipo_signatario = 'caixa'` é o
--     nome do slot, não o cargo: nada impede um gerente de selar uma
--     saída hoje.
--
--     Seguro porque a identidade nunca vem do cliente — online
--     `selar_romaneio` passa `auth.uid()` e sequer aceita o parâmetro;
--     offline a Edge Function valida o JWT e passa `auth.user.id`. Se
--     um dia esse id passar a vir do cliente, `papel_no_momento` vira
--     registro falso com cara de auditoria.
--   * não mexe em RLS. `romaneios` e `assinaturas` já têm policy, e
--     coluna nova entra no mesmo escopo.
--   * não precisa de GRANT. Diferente de `motoboy_credenciais`, que tem
--     grant POR COLUNA pra esconder `token_hash`/`pin_hash`,
--     `assinaturas` tem grant de tabela — e grant de tabela cobre coluna
--     futura.
--   * não toca na fila offline. `fechamento_corrida` continua existindo
--     e continua sendo drenado pelo handler legado; ver a janela de duas
--     releases no CLAUDE.md.
-- =====================================================================


-- =====================================================================
-- RODE ISTO DEPOIS, PRA CONFIRMAR QUE PEGOU
--
-- "Sem erro" não prova que a migration fez efeito — o CHECK ampliado, em
-- particular, tem um caminho de falha silenciosa (ver a seção 2). As
-- quatro consultas abaixo respondem, cada uma, uma coisa que a etapa 2
-- vai assumir como verdadeira.
--
--   -- 1. O CHECK aceita o valor novo? Tem que devolver EXATAMENTE UMA
--   --    linha, e a definição tem que citar 'responsavel_loja'.
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.assinaturas'::regclass
--      and contype = 'c'
--      and pg_get_constraintdef(oid) like '%tipo_signatario%';
--
--   -- 2. Os dois índices parciais existem e o antigo sumiu?
--   --    Esperado: assinaturas_romaneio_signatario e
--   --    assinaturas_corrida_signatario_legado, e NADA chamado
--   --    assinaturas_corrida_signatario.
--   select indexname, indexdef
--     from pg_indexes
--    where schemaname = 'public' and tablename = 'assinaturas'
--      and indexname like '%signatario%';
--
--   -- 3. Todo romaneio existente virou 'saida'?
--   select tipo, count(*) from public.romaneios group by 1;
--
--   -- 4. A referência do retorno está travada nos dois sentidos?
--   --    Esperado: as duas linhas de baixo falharem.
--   --    (rode dentro de uma transação e dê rollback)
--   -- begin;
--   --   update public.romaneios set tipo = 'retorno' where id = (select id from public.romaneios limit 1);
--   --   -- ^ tem que falhar: retorno sem romaneio_saida_id
--   -- rollback;
-- =====================================================================
