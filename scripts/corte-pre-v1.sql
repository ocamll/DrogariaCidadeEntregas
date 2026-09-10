-- =====================================================================
-- O CORTE PRÉ-V1 — procedimento, e o SQL da parte destrutiva
--
-- Escrito em 2026-08-25. NADA AQUI FOI EXECUTADO.
--
-- Este arquivo existe porque o corte é a única operação do projeto que
-- viola uma regra inviolável, e uma operação assim não pode ser
-- improvisada no dia.
--
-- ---------------------------------------------------------------------
-- LEIA ISTO ANTES: A REGRA 4
--
--     "Nunca deletar entrega. DELETE em `entregas`, `corridas`,
--      `pagamentos`, `assinaturas` ou `eventos` é proibido."
--
-- O bloco 2 faz exatamente isso, nas cinco tabelas. Não é contorno: é a
-- exceção declarada, e ela só é defensável por um motivo que **deixa de
-- valer no instante seguinte** — não existe produção. O sistema nunca
-- rodou fora de localhost, não há conta na Cloudflare, e todo dado no
-- banco nasceu de teste.
--
-- **Depois do go-live, este arquivo vira uma arma.** Se você estiver
-- lendo isto com o sistema em uso na farmácia, a resposta é não.
-- ---------------------------------------------------------------------


-- =====================================================================
-- A ORDEM, E POR QUE ELA É ESTA
--
--   1. censo        ver o que vai ser destruído, ANTES
--   2. wipe         o banco (este arquivo, bloco 2)
--   3. sementes     tenant, cidades, lojas, agência, admin
--   4. Edge Function  publicar a `sync-romaneio` nova
--   5. cliente      publicar o front
--   6. terminais    abrir e deixar a Dexie v7 limpar
--   7. conferência  o placar do zero
--
-- **4 ANTES DE 5, e isto não é detalhe.** A função nova RECUSA cliente
-- antigo: desde 2026-08-25 `tipo` é obrigatório no corpo e no envelope,
-- e a ausência responde `tipo_ausente`. Publicar o cliente primeiro é
-- inofensivo; publicar a função primeiro também. O que não pode é
-- alguém OPERAR no meio — daí fazer os dois antes de abrir os terminais.
--
-- **6 depois de 5, pelo mesmo motivo ao contrário.** A limpeza local
-- (Dexie v7) só acontece quando o terminal carrega o bundle novo. Um
-- terminal com aba antiga aberta continua com a fila velha na memória e
-- com o bundle velho — e é o cenário mais provável do dia da virada,
-- porque zerar o Supabase não fecha aba de ninguém.
--
--     Em cada terminal: fechar TODAS as abas do sistema, e só então
--     abrir de novo. F5 não basta se houver outra aba viva.
--
-- ---------------------------------------------------------------------
-- OS PASSOS 5 E 6 NÃO SÃO EXECUTÁVEIS HOJE
--
-- Não existe deploy. Não há conta na Cloudflare, nem projeto do Pages,
-- nem site no ar — conferido em 2026-08-18 e ainda verdade. "Publicar o
-- cliente" é: criar conta, criar o projeto, conectar ao repositório,
-- escolher a branch, pôr as CINCO variáveis (`VITE_SUPABASE_URL`,
-- `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID`,
-- `VITE_ROMANEIO_KEY_ID`, `VITE_ROMANEIO_PUBKEY`) e **rebuildar** — o
-- Vite embute no build, então acrescentar sem rebuildar não muda nada —,
-- mais a URL do Pages nas origens autorizadas do cliente OAuth do Google.
--
-- Enquanto isso não existir, o "corte" alcança só o banco, e os
-- terminais são esta máquina.
-- ---------------------------------------------------------------------


-- =====================================================================
-- O QUE MORRE JUNTO, E NÃO É ÓBVIO
--
-- * **Todo cartão impresso deixa de valer.** `motoboy_credenciais` vai
--   junto, então o v3 que foi bipado no leitor da farmácia em 17/08
--   deixa de ser reconhecido. Cartões novos precisam ser emitidos e
--   impressos ANTES de a operação começar.
--
-- * **Os PINs somem com as credenciais.** Cada motoboy cria o dele na
--   primeira saída — o fluxo já existe e não precisa de nada.
--
-- * **As sequências NÃO voltam sozinhas.** `entregas_numero_vale_seq` e
--   `romaneios_numero_seq` foram criadas soltas (`create sequence`, sem
--   `owned by`), então `truncate ... restart identity` não as alcança.
--   Sem o bloco 3 abaixo, o primeiro vale real nasce `V-000047` e o
--   primeiro romaneio `R-000027`.
--
-- * **O segredo `credencial_hmac` do Vault FICA.** Ele só importa para
--   conferir tokens, e não haverá token antigo para conferir. Trocá-lo
--   não melhora nada e acrescenta um passo que pode falhar.
--
-- * **As contas de teste.** Elas têm senha fraca, e a senha está no
--   HISTÓRICO do repositório desde o primeiro push (ver "Segredo nenhum
--   no repositório", no CLAUDE.md). Apagar as contas aqui resolve na
--   raiz — some o login, não só a exposição.
--
--   **Repetir a senha AQUI seria gravá-la no repositório outra vez**, e
--   é exatamente o erro que aquela seção registra. Se precisar saber
--   quais são, olhe as contas em Authentication → Users; se precisar da
--   senha, ela não deveria estar num arquivo de projeto.
--
--   O que conferir depois: que nenhuma conta REAL nasceu com senha
--   fraca no lugar.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCO 1 — CENSO. Não escreve nada. Rode e LEIA antes do bloco 2.
--
-- Ele existe para o corte ser uma decisão, não um susto. Se algum número
-- aqui surpreender, pare.
-- ---------------------------------------------------------------------
select 'tenants'            as tabela, count(*) from public.tenants
union all select 'cidades',            count(*) from public.cidades
union all select 'lojas',              count(*) from public.lojas
union all select 'profiles',           count(*) from public.profiles
union all select 'agencias',           count(*) from public.agencias
union all select 'mototaxistas',       count(*) from public.mototaxistas
union all select 'motoboy_credenciais',count(*) from public.motoboy_credenciais
union all select 'convenios',          count(*) from public.convenios
union all select 'entregas',           count(*) from public.entregas
union all select 'pagamentos',         count(*) from public.pagamentos
union all select 'corridas',           count(*) from public.corridas
union all select 'romaneios',          count(*) from public.romaneios
union all select 'romaneio_entregas',  count(*) from public.romaneio_entregas
union all select 'assinaturas',        count(*) from public.assinaturas
union all select 'motoboy_autorizacoes', count(*) from public.motoboy_autorizacoes
union all select 'eventos',            count(*) from public.eventos
union all select 'auth.users',         count(*) from auth.users
order by 1;

-- E o que se perde de documento selado, dito por extenso — porque
-- "13 romaneios" não dá a dimensão de apagar cadeia de custódia:
select tipo, modo, status, count(*)
  from public.romaneios
 group by 1, 2, 3
 order by 1, 2, 3;


-- ---------------------------------------------------------------------
-- BLOCO 2 — O WIPE. IRREVERSÍVEL.
--
-- Um `truncate` só, com todas as tabelas na mesma instrução: assim não
-- há ordem de FK para acertar e **não é preciso `cascade`**, que é o que
-- poderia levar junto uma tabela que ninguém listou.
--
-- `tenants` FICA de fora de propósito: é a farmácia, não dado de teste,
-- e tudo referencia o id dela. Se você quiser recomeçar o tenant também,
-- acrescente-o à lista e recrie no bloco 4.
--
-- DESCOMENTE PARA RODAR. Está comentado porque um arquivo que apaga o
-- banco ao ser colado inteiro é um acidente esperando acontecer.
-- ---------------------------------------------------------------------
-- truncate table
--   public.eventos,
--   public.assinaturas,
--   public.motoboy_autorizacoes,
--   public.romaneio_entregas,
--   public.romaneios,
--   public.pagamentos,
--   public.entregas,
--   public.corridas,
--   public.motoboy_credenciais,
--   public.mototaxistas,
--   public.agencias,
--   public.convenios,
--   public.profiles,
--   public.lojas,
--   public.cidades;

-- Os usuários do Auth são outra história: eles vivem fora de `public`, e
-- `profiles` só tem o espelho. Apague pelo painel (Authentication →
-- Users) ou aqui — mas confira antes que não há nenhuma conta que você
-- queira preservar.
-- delete from auth.users;


-- ---------------------------------------------------------------------
-- BLOCO 3 — AS SEQUÊNCIAS. Sem isto o corte fica pela metade.
--
-- `truncate ... restart identity` não alcança sequência que não é
-- `owned by` uma coluna, e estas duas não são. O sintoma seria silencioso
-- e permanente: o primeiro vale da farmácia nasceria com um número que
-- sugere 46 vales anteriores que não existem.
-- ---------------------------------------------------------------------
-- alter sequence public.entregas_numero_vale_seq restart with 1;
-- alter sequence public.romaneios_numero_seq     restart with 1;


-- ---------------------------------------------------------------------
-- BLOCO 4 — AS SEMENTES
--
-- Dado real trazido pelo usuário em 2026-08-25: oito filiais em
-- São Gabriel/RS, tarifa de R$ 9,00 em todas, agência Gabrielense.
--
-- Tudo aqui é RE-RODÁVEL: cada insert é `where not exists`, porque não
-- há unique em `nome` pra apoiar um `on conflict`. Rodar duas vezes não
-- duplica nem quebra.
--
-- ---------------------------------------------------------------------
-- DUAS DECISÕES QUE ESTE BLOCO TOMA, E VOCÊ PODE DESFAZER
--
-- **1. Os números das filiais vão com DOIS DÍGITOS** — `Filial 02`,
-- `Filial 04`, `Filial 09`… A lista veio misturada ("Filial 2" e
-- "Filial 09"), e a escolha não é estética:
--
--   * o nome da loja vira NOME DE PASTA no Google Drive
--     (`Romaneios › <Filial> › AAAA-MM › …`), e pasta é para sempre;
--   * ordenação por nome é alfabética, então `Filial 10` viria ANTES de
--     `Filial 2`. É o mesmo argumento que fez as pastas de mês serem
--     `AAAA-MM` e não `08/2026`.
--
-- Se a farmácia escreve "Filial 2" na porta e no dia a dia, troque —
-- mas troque ANTES do primeiro romaneio subir pro Drive.
--
-- **2. A Matriz não vira "Filial 01".** Ela é a Matriz no vocabulário da
-- casa, e renomeá-la aqui criaria um segundo nome pra mesma loja.
--
-- ---------------------------------------------------------------------
-- O QUE FALTA, E EU NÃO INVENTEI
--
--   * ~~**CONVÊNIOS.**~~ **Deixou de faltar em 2026-09-10**: o convênio
--     não é mais identificado, então não há empresa a cadastrar. Ver o
--     bloco (5).
--   * **MOTOTAXISTAS.** Ficam para o painel (Cadastros → Mototaxistas),
--     que é o caminho normal e já existe. Só a agência precisa nascer
--     aqui, porque motoboy sem agência não aparece no dropdown.
--   * **AS OUTRAS FILIAIS — RESPONDIDO em 2026-08-25.** As oito daqui
--     são as de SÃO GABRIEL; as demais ficam em outras cidades e entram
--     depois. O "17 filiais" do CLAUDE.md não estava errado: é o total
--     da rede, não o desta cidade.
--
--     ATUALIZADO EM 2026-09-03: o total da rede é DEZOITO. A filial a
--     mais é de cidade já mapeada, então `cidades` não muda. Confirme
--     se ela é de São Gabriel antes de rodar este bloco — se for, ela
--     falta na lista abaixo.
--
--     **Os números são da REDE, não da cidade**, e é por isso que a
--     sequência daqui é esburacada — 02, 04, 09, 10, 12, 15, 18. Os que
--     faltam estão nas outras cidades. Ninguém deve "consertar" os
--     buracos nem renumerar: o número da filial é como a farmácia a
--     chama, e renumerar quebraria a correspondência com a placa da
--     porta, com o Trier e com as pastas já criadas no Drive.
--
--     **Cada cidade nova custa mais que lojas.** Pela regra do projeto
--     — uma agência de tele por cidade, e agência sem cidade não
--     aparece no dropdown de filial nenhuma —, abrir uma cidade é:
--
--         cidades → lojas → agencias → mototaxistas → credenciais
--
--     Repetir o bloco 4 trocando o nome da cidade e a agência resolve.
--     O que NÃO resolve é acrescentar só as lojas: elas ficariam sem
--     agência que as atenda, e a Nova Corrida não abriria naquela
--     cidade — cadastrado e inoperante, que é o mesmo modo de falha da
--     agência sem cidade.
-- ---------------------------------------------------------------------

-- (1) A cidade. Uma agência de outra cidade não pode aparecer para uma
--     filial daqui — é isto que a FK de cidade garante.
insert into public.cidades (tenant_id, nome, uf)
select t.id, 'São Gabriel', 'RS'
  from public.tenants t
 where not exists (
   select 1 from public.cidades c
    where c.tenant_id = t.id and c.nome = 'São Gabriel' and c.uf = 'RS'
 );

-- (2) As oito lojas DE SÃO GABRIEL. As outras cidades entram depois,
--     repetindo este bloco inteiro (cidade, lojas, agência) — ver a
--     nota "AS OUTRAS FILIAIS" acima.
--
--     `tarifa_entrega_cents` explícito mesmo sendo igual ao default: o
--     valor do vale é a regra de dinheiro mais central do sistema, e ela
--     não deve depender de um default que alguém pode mudar numa
--     migration futura sem olhar aqui.
insert into public.lojas (tenant_id, nome, cidade_id, tarifa_entrega_cents)
select c.tenant_id, nome.n, c.id, 900
  from public.cidades c
  cross join (values
    ('Matriz'),
    ('Filial 02'),
    ('Filial 04'),
    ('Filial 09'),
    ('Filial 10'),
    ('Filial 12'),
    ('Filial 15'),
    ('Filial 18')
  ) as nome(n)
 where c.nome = 'São Gabriel' and c.uf = 'RS'
   and not exists (
     select 1 from public.lojas l
      where l.tenant_id = c.tenant_id and l.nome = nome.n
   );

-- (3) A agência. COM `cidade_id` — sem ele ela é cadastrada e fica
--     invisível: não entra no dropdown de Nova Corrida de filial
--     nenhuma, e a lista de Cadastros a marca em vermelho.
insert into public.agencias (tenant_id, nome, cidade_id)
select c.tenant_id, 'Gabrielense', c.id
  from public.cidades c
 where c.nome = 'São Gabriel' and c.uf = 'RS'
   and not exists (
     select 1 from public.agencias a
      where a.tenant_id = c.tenant_id and a.nome = 'Gabrielense'
   );

-- (4) O PRIMEIRO ADMIN — o único passo que não tem tela.
--
--     O painel de usuários exige um admin logado pra criar usuário, então
--     o primeiro não pode nascer por lá. Crie a conta no dashboard
--     (Authentication → Add user, com "Auto Confirm User" ligado) e
--     depois rode isto.
--
--     O e-mail é a chave, e NÃO um uuid colado à mão: uuid copiado
--     errado cria um perfil órfão que o app nunca acha, e o sintoma é
--     "logo, mas não vejo nada".
--
--     TROQUE o e-mail e o nome antes de rodar.
-- insert into public.profiles (id, tenant_id, loja_id, nome, papel, email)
-- select u.id, l.tenant_id, l.id, 'NOME DO ADMIN', 'admin', u.email
--   from auth.users u
--   cross join public.lojas l
--  where u.email = 'admin@EXEMPLO.com'
--    and l.nome  = 'Matriz'
--    and not exists (select 1 from public.profiles p where p.id = u.id);

-- (5) Convênios: NÃO SE SEMEIAM MAIS — passo 1, 2026-09-10.
--
--     O convênio deixou de ser identificado. A forma de pagamento
--     "Convênio" continua, e é ELA que gera a pendência de papel
--     (`GERAM_DOCUMENTO_FISICO` no cliente, `romaneio_documentos_esperados`
--     no servidor); `entregas.convenio_id` nasce nulo. A tabela
--     `public.convenios` continua existindo e continua no wipe acima, mas
--     nenhuma linha dela é necessária pra operar.
--
--     O modelo que ficava aqui ensinava a preencher `exige_assinatura` —
--     que nunca governou a custódia, ao contrário do que o comentário
--     dele afirmava — e `farmacia_paga_entrega_integral`, que existia pro
--     vale extra do endereço distante, extinto no mesmo passo.

-- (6) Conferência das sementes, antes de seguir pro passo 4 do roteiro:
--
--   select l.nome, l.tarifa_entrega_cents, c.nome as cidade, c.uf
--     from public.lojas l left join public.cidades c on c.id = l.cidade_id
--    order by l.nome;
--
--   esperado: 8 linhas, todas com cidade São Gabriel/RS e 900. E repare
--   que a ordem alfabética sai certa — é o teste do zero à esquerda.
--
--   select a.nome, c.nome as cidade from public.agencias a
--     left join public.cidades c on c.id = a.cidade_id;
--
--   esperado: Gabrielense / São Gabriel. Cidade nula aqui é a falha
--   silenciosa deste bloco: cadastra e não aparece.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- BLOCO 5 — A CONFERÊNCIA DO CORTE
--
-- Rode DEPOIS de tudo. O que ele responde é "o zero é um zero limpo?".
-- ---------------------------------------------------------------------
-- (a) o placar de integridade parte do zero, e sem NULL escondido
--
--   select count(*) as verificados,
--          count(*) filter (where divergencias = 0) as validos,
--          coalesce(sum(divergencias), 0) as divergencias
--     from public.verificar_romaneios_selados();
--
--   esperado: 0 · 0 · 0
--
-- (b) as sequências realmente voltaram
--
--   select last_value, is_called from public.entregas_numero_vale_seq;
--   select last_value, is_called from public.romaneios_numero_seq;
--
--   esperado: last_value = 1 e is_called = false nas duas. `is_called`
--   é o que distingue "vai entregar 1" de "já entregou 1" — e olhar só
--   o `last_value` confunde os dois.
--
-- (c) o schema ficou INTEIRO. O wipe é de dado; se alguma destas sumir,
--     alguém rodou um `drop` no lugar de um `truncate`.
--
--   select count(*) as funcoes_da_custodia
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('selar_romaneio', 'selar_romaneio_retorno',
--                        'verificar_romaneio', 'romaneio_canonico',
--                        'romaneio_retorno_canonico', 'autorizar_saida',
--                        'autenticar_credencial', 'obter_contexto_retorno');
--
--   esperado: 8
--
-- (d) o trigger que guarda o DCRR1 continua armado — ele é invariante de
--     banco, e o corte não é motivo pra perdê-lo
--
--   select tgname from pg_trigger
--    where not tgisinternal and tgrelid = 'public.entregas'::regclass;
--
-- (e) e o primeiro terminal limpou o lado dele. No console do navegador,
--     depois de abrir o sistema com o bundle novo:
--
--       (await (await import('/src/lib/db.ts')).db.filaOperacoes.count())
--
--     esperado: 0, e um `console.warn` do corte pré-V1 no log.
-- =====================================================================
