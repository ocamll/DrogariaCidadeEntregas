# Notas de trabalho — 2026-08-09 a 2026-08-20

Registro de trabalho, não é documentação permanente do projeto (isso é o
CLAUDE.md). Decisões duráveis já foram incorporadas lá; aqui fica o que é
mais "estado da sessão" — útil pra retomar, mas não é regra.

Vários dias de trabalho, várias frentes seguidas. Ordem cronológica
abaixo: itens 1 a 20 são de 09 e 10/08, 21 e 22 de 11/08, 23 a 25 de
12/08, 26 a 30 de 12 e 13/08, e 31 e 32 de 16/08 — com a parte de PDF e
Google Drive do item 29 também sendo de 16/08.

**Onde o projeto está:** funcionalmente completo. A checklist "Dentro" do
MVP fechou no item 6, e por cima dela entraram cancelamento, fechamento de
caixa, gestão de usuários, tarifa/vales, permissões por filial, cidade,
exportação em .xlsx e PDF, e envio ao Google Drive. De 16 a 19/08 entrou a
frente maior de todas — a cadeia de custódia da saída (itens 33 a 57), que
já foi exercitada nos três caminhos possíveis: online (`R-000003`),
conflito com as assinaturas preservadas (`R-000004`) e offline
sincronizada (`R-000010`), mais o cartão físico lido no leitor da farmácia
e a credencial CR80 conferida contra o desenho original. O item 57 fechou
o envio do romaneio ao Drive.

Em 19 e 20/08 entrou a frente do **Romaneio de Retorno**: desenho fechado
antes de qualquer código (item 58), schema aplicado, e a **etapa 2A
fechada** (item 59) — verificador de hash, golden vectors, os dois
canônicos gêmeos e o teste de transporte. **Nada disso tem tela ainda**;
o retorno continua sendo o `fecharCorrida` de sempre, e nada mudou pra
quem opera. O item 60 traz quatro defeitos de tela que a 2A expôs de
passagem, e o **item 61** fecha o rastro que ele deixou: o rótulo do
signatário interno em mais quatro lugares (dois na página, dois no PDF) e
os relógios do romaneio, que trocavam de coluna conforme o romaneio. O
**item 62** conserta o aviso "— sincronizando…" das telas de lançamento,
que nunca era apagado e dizia a mesma coisa tendo a operação subido ou
falhado; o **63** estende as reticências animadas aos outros 41 rótulos
de processo do app.

Ainda em 20/08 a frente do retorno andou bastante, e é o grosso do que
está aberto: **item 64 — a etapa 2B** (`selar_romaneio_retorno`
transacional, com o defeito do domínio de `forma` que ela achou no
contrato congelado), **a 2B.4** (o verificador passando a despachar por
protocolo, com fórmulas internas separadas) e **item 65 — a 2B.5** (o
bloco `d` da custódia física de papel, e as três cópias do conversor
domínio → jsonb que ele expôs). Cinco migrations, todas aplicadas e
conferidas no banco.

Fecham a frente o **item 66** — o teste de transporte passando a
perguntar sobre o bloco `d`, que ele nunca exercitou — e o **item 67**,
o **desenho da 2C fechado contra o código antes da primeira linha**. O 67
é o que ler antes de retomar: ele achou que a porta offline do retorno
não existe, que o fechamento legado não é RPC (logo o guard é trigger), e
transformou a proteção da regra 7 contra escrita tardia de ordenação de
fila em **gate de segurança**. Nada dele está construído.

*(O parágrafo acima foi escrito quando a 2C ainda não existia. Ela
fechou — ver o seguinte.)*

**Não há deploy**, e isso vale para tudo neste arquivo: nem conta na
Cloudflare, nem site no ar. Tudo rodou em localhost, numa máquina só, e
a premissa de dois dispositivos (PC do caixa + tablet do motoboy) nunca
foi exercitada de verdade.

Ainda em 20/08 a frente do retorno andou até a **2D**. A **2C fechou
inteira** (itens 68 a 75): porta offline, trigger de obsolescência, Dexie
v5, o tipo `romaneio_retorno` na fila, o contrato criptográfico do
envelope, o despacho por tipo na Edge Function, a proteção local e as
regressões. Depois vieram o **desenho da 2D** (item 76), o **contexto do
retorno** (77) e a **invariante do pagamento realizado** (78), que nasceu
de um achado no vale impresso: o `pagamento_id` do previsto é o uuid da
entrega, e copiá-lo pro realizado faria um documento selar afirmando um
pagamento que não existe.

*(Os dois parágrafos acima são de 20/08. Em 21 e 25/08 a 2D fechou — ver
o seguinte.)*

**Onde parou, em 2026-08-25:** o **Romaneio de Retorno funciona ponta a
ponta**, online e offline. A tela existe (`RetornoCorrida.tsx` deixou de
enfileirar `fechamento_corrida`), e três retornos reais foram selados:

```
saida    13 · 13 · 0    52 camadas
retorno   3 ·  3 · 0    15 camadas
                        R-000023  online
                        R-000025  online
                        R-000026  offline_sincronizada
```

O caminho até aqui, nos itens 79 a 81: a máquina de custódia corrigida
(o envelope não era construível no passo do PIN), a política de falha de
rede pós-assinaturas, o componente, e dois defeitos que só o uso real
achou — `[object Object]` engolindo o erro do PostgREST, e uma função
`SECURITY DEFINER` que `authenticated` não podia executar.

**A 2D.6 mudou de natureza em 2026-08-25** (item 83). Ela era "provar
que o sistema novo convive com o passado"; virou **corte limpo pré-V1** —
não haverá passado, porque o rollout é precedido de limpeza do banco E do
estado local dos terminais. A compatibilidade de desenvolvimento foi
REMOVIDA, o trigger de integridade FICOU, e o roteiro do corte está em
`scripts/corte-pre-v1.sql` (nada dele foi executado).

**E DESDE 2026-08-25 CORRE OUTRA FRENTE.** Com a cadeia de custódia
fechada, o usuário abriu uma frente de **produto e UX** de nove itens,
que roda ANTES do corte pré-V1. Ela não reabre 2A–2D — respeita as
invariantes já construídas.

```
E1   normalização de texto livre     ✓  itens 84 e 85
E1.1 busca sem acento                ✓  migration aplicada
E2   estados visuais de consulta     ✓  item 86 — 18 de 18 migrados
E3   id próprio do pagamento previsto  ✓  item 87 — aplicada e conferida
E4   duas formas de pagamento no cadastro  ✓  itens 88 e 90 — E2E aceito
E5   login por username                 ✓  item 89 — aceite medido
E10  admin operando por filial   SERVIDOR FECHADO (91–92) — falta cliente
E11  visibilidade do offline     backlog, sem contrato
E12  continuidade operacional offline  CONTRATO FECHADO (94), sem código
E6..E9  router, divergência, agência, endereço
```

**A ORDEM ATÉ PRODUÇÃO MUDOU EM 2026-09-08** — item 95. A linha antiga era
`E10 E11 E12 E6 E9 E7 E8 → STAGING → corte`, e foi substituída pelo escopo
pré-V1 revisado (`docs/escopo-pre-v1-revisado.md`):

```
0  alinhar CLAUDE.md/NOTAS ao escopo revisado   ← feito em 08/09
1  um vale sem adicional · convênio genérico · sem "Outro"
2  "Cargo" · filial obrigatória · E10 completo (2, 3 e 4)
3  snapshot histórico da filial nos documentos
4  concluir o contrato de assinaturas/envelope
5  fechamento diário com exceções e aprovação auditável
6  painel da agência: cobrança discriminada e conferência
7  corte/reset coordenado e aceite completo
   → STAGING → produção → piloto em 1 filial
```

**O E10 deixou de ser adiável**: a decisão de esconder a filial do cadastro
do admin torna as três telas de escrita inoperantes para ele sem o E10.2+.
E o **painel da agência saiu da lista "Fora"** do `CLAUDE.md` — é a maior
frente nova, não um item de limpeza.

**E4 e E5 fecharam depois deste texto original.** O E4 passou no E2E real
com duas formas previstas e retorno fiel; o E5 criou `camiloadmin` pelo
painel e entrou digitando só o username. Os dois PRs foram mergeados na
`main` antes de o E10 começar.

**O E3 achou uma SEGUNDA suposição 1:1**, escondida onde ninguém
olharia: o evento `pagamento_alterado` escolhia UM previsto com
`limit 1`, e com dois teria gravado auditoria errada. Corrigido antes de
existir qualquer caminho capaz de criar o segundo — que é a diferença
entre consertar um defeito e descobri-lo depois de selar um documento.

**E o E4 achou mais DUAS, e uma delas escrevia auditoria.**
`pagamento_alterado` tem **dois escritores** — o E3.B corrigiu o do
servidor e ninguém perguntou quem mais gravava aquele evento;
`marcarDivergencia` ficou escalar. A outra: o cliente decidia divergência
por **contagem de linhas**, enquanto o servidor compara conjuntos de
`forma|valor` — com um previsto só os dois concordavam por acidente.

**O E4 não precisou de migration nenhuma**, e isso diz algo do trabalho
de 16 a 25/08: a cadeia de custódia foi construída sobre a cardinalidade
REAL da tabela, não sobre a que a UI usava. O canônico do DCR1 e o gêmeo
TypeScript já varriam N previstos. Uma feature de produto inteira caiu
dentro dela sem tocar no banco.

**⚠️ O E3 ESTÁ NUMA BRANCH, não na `main`:**

```
main                            f2fe300  E1
                                9b5afcc  E2      ← último estado na main
feat/e3-pagamentos-previstos    220e6c9  E3
                                ???????  E3: conferência pós-migration
```

**Mas a MIGRATION já está aplicada no banco de desenvolvimento** — git
não isola Supabase. Então a `main` sozinha já não corresponde ao banco:
ela não tem os leitores bicompatíveis do E3.A, e o evento novo escreve
`de` como lista. Na prática, **trabalhe a partir da branch**, e faça o
merge quando quiser — ele não tem conflito com nada.

**O E2 não foi padronização de markup.** Ele achou um defeito de
comportamento em nove telas: com a query PAUSADA (offline sem cache) o
`isLoading` do TanStack vem `false`, e a cadeia
`if (isLoading) … if (!data) → "nenhum registro"` cai no último ramo e
AFIRMA vazio sem ter havido resposta. O pior deles negava um documento
de custódia selado; o segundo era a tela pós-login do caixa. Ver o item
86 — inclusive as três vezes em que o gate reprovou o próprio autor.

**O que ainda NÃO existe, e é fácil supor errado:** não há deploy — nem
conta na Cloudflare, nem projeto do Pages, nem site no ar. Isso não é
configuração pendente, é infra inteira, e os passos 5 e 6 do roteiro do
corte dependem dela.

**Se você está retomando, leia primeiro `docs/escopo-pre-v1-revisado.md` e
depois "PRÓXIMA SESSÃO", perto do fim deste arquivo.** O escopo revisado de
08/09 é o que manda hoje; a seção "PRÓXIMA SESSÃO" diz onde o trabalho
parou. O `CLAUDE.md` já foi alinhado ao escopo novo (item 95) e traz notas
datadas separando o que foi **decidido** do que está **construído** — não
leia uma coisa pela outra.

**ONDE O TRABALHO VIVE MUDOU NO E3.** Até o E2 era tudo na `main`; o E3
foi para uma branch porque passou a mexer em banco:

```
git checkout feat/e3-pagamentos-previstos
```

A `main` está no E2 (`9b5afcc`) e **já não corresponde ao banco** — a
migration do E3 foi aplicada no mesmo Supabase de desenvolvimento, e
branch do git não isola banco. Merge quando quiser: não há conflito.

## 1. Fila offline nas outras 4 escritas

Até o início desta sessão, a fila offline (IndexedDB/Dexie) só cobria
cadastro de entrega. Estendida pras outras 4 escritas do app (transferência
entre filiais, corrida com assinatura, marcar divergência de pagamento,
fechamento de corrida) — todas passam a gravar local primeiro e sincronizar
em segundo plano, sem bloquear a tela.

- `src/lib/db.ts`: Dexie subiu pra versão 2. Store único `filaOperacoes`
  (genérico, com `tipo`) substituiu o antigo `filaEntregas`; upgrade migra
  itens pendentes automaticamente.
- `src/data/filaOffline.ts`: `enfileirarOperacao`/`processarFilaOperacoes`
  despacham por tipo pra cada função de escrita.
- Idempotência caso a caso (detalhe completo no CLAUDE.md): `entregas`/
  `corridas` usam `upsert` (têm policy de UPDATE); `pagamentos`/
  `assinaturas` usam `insert` + trata `23505` como sucesso; `eventos`
  ganhou coluna `idempotency_key` + checagem `select`-antes-de-inserir.
- As 4 páginas trocaram mutation direta por "enfileira e libera a tela na
  hora". Hooks `useMutation` antigos removidos.

Testado com `navigator.onLine` bloqueado via devtools pros 4 fluxos, um de
cada vez — ficou só no IndexedDB, religou, sincronizou sozinho sem
duplicata. Dedupe de `eventos` validado direto contra o banco (segunda
inserção com a mesma `idempotency_key` voltou `23505`).

## 2. Bug do Dialog — achado de passagem, corrigido em sessão paralela

`src/components/ui/dialog.tsx` usava classes Tailwind `data-open:`/
`data-closed:` que não existiam como custom variant no `index.css` — fechar
qualquer `Dialog` deixava um overlay invisível de tela cheia travado pra
sempre, bloqueando clique até recarregar a página. Disparei uma sessão em
background pra corrigir (trocar por `data-[state=open]:`/
`data-[state=closed]:`, sintaxe nativa) — mesmo bug também existia e foi
corrigido em `dropdown-menu.tsx` e `select.tsx`. Commit `503dbf9`,
mergeado em `master`. Confirmado resolvido nos testes das sessões
seguintes (dialogs abrindo/fechando repetidas vezes sem travar).

## 3. Cadastros: agências, mototaxistas, convênios

Aba "Cadastros" (admin/gerente) com sub-abas pra cada entidade — tabela +
dialog de criar/editar + toggle inline de ativo/inativo. Tabelas já
existiam no schema (RLS pronta) — foi só UI + `src/data/cadastros.ts`, sem
migration. Não entra na fila offline (tela de admin, uso ocasional).

Testado de ponta a ponta: agência nova → apareceu no dropdown de Nova
corrida; motoboy associado → filtrado certo; desativei a agência → sumiu
do dropdown mas continuou listada (inativa), motoboy associado continuou
editável mostrando "(inativa)".

## 4. Receita, documentos pendentes, notificações unificadas

Encadeando o cadastro de convênio com a pendência de documentos de
convênio, mais 3 pedidos: custódia de receita física (só existência/
retorno — **confirmado com o usuário que não é dado de saúde**, regra 9),
motivo "outro" do insucesso com detalhe, e generalização de "Alterações de
pagamento" pra "Notificações".

- Cadastro de entrega ganhou convênio (condicional, só forma="Convênio") e
  checkbox "Precisa de receita" — **fora** da cadeia de Enter, fluxo
  rápido não regrediu (testado).
- Aba "Documentos" nova (visível pra todo mundo, não só gerência).
- `src/data/eventos.ts` novo — extraí o padrão de dedupe de eventos
  (`idempotency_key` + `select`-antes-de-inserir) que já existia dentro de
  `marcarDivergencia`, reaproveitado em mais dois lugares.
- `src/data/notificacoes.ts` novo — agrega os 3 tipos de evento
  "que precisam de atenção" (`pagamento_alterado`, `falta_receita`,
  `insucesso_detalhado`).
- Renomeados: `NotificacoesPagamento`→`Notificacoes`,
  `AlteracaoPagamentoCard`→`NotificacaoCard`,
  `DivergenciasEntregas`→`Ocorrencias`,
  `MarcarDivergenciaDialog`→`NotificarOcorrenciaDialog` (ganhou seletor de
  duas opções). Arquivos antigos deletados, não só esvaziados.

Testado de ponta a ponta: entrega com convênio + receita → apareceu nas
duas listas de "Documentos", marquei as duas como recebidas; insucesso
"outro" com texto → apareceu em Notificações e Ocorrências; "Falta de
receita" pelo seletor → foi pra fila offline, sincronizou.

## 5. Relatório: seta de vales por motoboy → hierarquia agência → motoboy → vale

Usuário notou uma diferença entre a soma "por motoboy" e o total "por
agência" no relatório. Investigado: corrida antiga do Pedro Souza sem
`agencia_id` (de antes do formulário exigir escolher agência primeiro) —
conta pro motoboy mas não pra nenhuma agência. Pedido inicial: uma seta
"mostrar vales" em cada motoboy pra investigar isso na tela. No mesmo fio,
pensando em escala (muitos motoboys por poucas agências), virou pedido
maior: motoboy morar DENTRO da agência em vez de duas tabelas soltas.

Reestruturado pra 3 níveis, cada um com sua seta: Agência → Motoboy →
Vale. `RelatorioGrupo`/`RelatorioAgencia` novos em `src/data/relatorios.ts`
— agregação em duas camadas de `Map`. Corrida sem agência virou grupo
"(sem agência)" em vez de sumir da soma. Estado de expansão do motoboy usa
chave composta `agência::motoboy` — um motoboy que rodou pra mais de uma
agência (caso real: Pedro Souza) aparece uma vez em cada uma, cada linha
expansível independente.

Testado: expandi duas agências e 3 motoboys ao mesmo tempo, números batem
em todo nível.

## 6. Registro de Auditoria (log de eventos) — última pendência do MVP original

Botão de cabeçalho "Registro de auditoria", à esquerda de "Notificações"
(pedido explícito — não é aba do Painel), mesmo gate admin/gerente. Mostra
os **5 tipos** de evento já gravados em `eventos`, não só os 3 curados
pelas Notificações — inclusive os 2 que o trigger `fn_log_entrega` grava
sozinho e nunca tiveram tela (`entrega_criada`, `status_alterado`).
Filtrável por período (De/Até) e por filial.

- Migration `20260809220000_eventos_user_fk.sql` (FK `eventos.user_id` →
  `profiles.id`) — antes de rodar, verifiquei direto no banco que nenhum
  `user_id` gravado ficaria órfão (49 eventos, 2 usuários distintos, zero
  órfãos).
- **Bug real achado no teste:** `entregas` tem duas FKs pra `lojas`
  (`loja_id` de origem, `loja_destino_id` de transferência) — embed do
  Supabase sem hint dá erro de ambiguidade (`PGRST201`). Resolvido com
  `lojas!entregas_loja_id_fkey(nome)`. Se mexer em outro embed
  `entregas → lojas` no projeto, lembrar disso.
- `src/data/auditoria.ts` separado de `notificacoes.ts` de propósito
  (duplica um pouco de texto-por-tipo em vez de compartilhar) — decisão
  consciente pra não arriscar regressão numa feature já testada.
- **Contexto de negócio que veio à tona aqui e foi pro CLAUDE.md:** a
  farmácia real tem 18 filiais (hoje só 2 nos dados de teste). Não criei
  as outras 16 — só confirmei que `useLojas()` já escala sem mudança de
  código. Aproveitei pra corrigir uma entrada ambígua na lista "Fora" do
  CLAUDE.md que citava só "multi-loja" (parecia dizer que múltiplas lojas
  não são suportadas, quando na verdade só a *criação* de loja pela UI
  que é fora de escopo).

Testado: os 5 tipos aparecendo com resumo correto, autor resolvido nos 2
tipos novos (antes só tinham `user_id` cru), filtro de filial isolando
Matriz de Filial 02 corretamente (inclusive vale de transferência
aparecendo na filial de origem, não na de destino).

## 7. Continuação em 2026-08-10: fechando os 2 gaps conhecidos

Retomei do NOTAS.md com o MVP já 100%. Perguntei o que fazer a seguir
(painel de usuários vs. gaps conhecidos) — usuário escolheu os gaps.

**Dois relógios em `corridas.retorno_em`:** só existia o valor mandado
pelo cliente (`new Date()` do navegador), sem par de servidor — ao
contrário de `saida_em`/`saida_em_local`. `retorno_em_local` passou a
guardar o relógio do dispositivo; `retorno_em` passou a ser preenchido
por um trigger (`fn_corrida_registrar_retorno`) com `now()` do servidor
no instante em que o fechamento é de fato aplicado (útil se a fila
offline sincronizar atrasada). `FecharCorridaInput.retornoEm` virou
`retornoEmLocal`; o `update` de corridas parou de mandar `retorno_em`
do cliente.

**RLS de `eventos` era tenant-wide:** o gate "só admin/gerente vê
Notificações/Ocorrências/Auditoria" sempre foi só de UI — qualquer
autenticado do tenant conseguia ler todo evento via query direta.
Policy de SELECT reescrita: gerente/admin continuam vendo tudo do
tenant; caixa só vê os próprios eventos (`user_id = auth.uid()`) —
suficiente pro select-antes-de-inserir de `inserirEventoIdempotente`
continuar funcionando, já que quem insere sempre grava o próprio id.

Testado no browser logado como admin: fechei a corrida do João Silva
(vale V-000012, virou "Entregue"), fila offline (IndexedDB) esvaziou
sozinha — só acontece se o sync deu certo contra o schema novo.
Registro de Auditoria confirmou o evento `status_alterado`
correspondente, autor resolvido, RLS não quebrou nada pro admin.

## 8. Estendendo dois relógios pra `pagamentos` e `eventos`

Usuário perguntou "ele salva o horário de quando é feito ação offline?"
— resposta revelou que a lacuna dos gaps conhecidos era maior: nem
`pagamentos.registrado_em` nem `eventos.ocorrido_em` tinham QUALQUER
par de dispositivo (pior que o caso de `corridas`, que ao menos tinha
`saida_em_local`). Usuário pediu pra estender a correção pros dois.

- `pagamentos.registrado_em_local` novo. `criarPagamentoPrevisto` e
  `marcarDivergencia` passaram a receber/gravar o relógio do
  dispositivo — reaproveitado de `ocorridoEmLocal` da entrega quando o
  previsto nasce junto com o cadastro, ou capturado no próprio dialog
  de divergência (`NotificarOcorrenciaDialog.tsx`) quando é ação
  isolada.
- `eventos.ocorrido_em_local` novo. Os 3 tipos que passam pela fila
  offline (`pagamento_alterado`, `falta_receita`, `insucesso_detalhado`)
  passaram a receber o valor via `inserirEventoIdempotente`.
  `entrega_criada` (gerado pelo trigger `fn_log_entrega`) ganhou o
  valor de graça, direto de `entregas.ocorrido_em_local` da própria
  linha — sem precisar de nada novo do cliente.
- `status_alterado` **ficou sem** `ocorrido_em_local` de propósito —
  pode vir de um UPDATE em lote (fechamento de corrida com vários
  vales) sem um relógio de dispositivo confiável por linha até a
  entrega. Gap novo, documentado no comentário da migration, não uma
  regressão.

**Achado de teste real:** a primeira tentativa de testar a divergência
pareceu funcionar (fila offline vazia) mas na verdade não gravou nada
— o console mostrou dezenas de HMR (`hot updated`) disparando em
arquivos que eu nem tinha tocado (`CadastroEntrega.tsx`, `index.css`,
etc.), quase certamente o OneDrive tocando timestamps da pasta inteira
do projeto e o watcher do Vite reagindo, derrubando o estado do dialog
no meio da interação. Só percebi porque fui conferir direto no banco
(via `import('/src/lib/supabase.ts')` no console do browser) em vez de
confiar na fila vazia. Recarreguei a página do zero e repeti — aí sim
confirmado, com os pares `_local`/servidor batendo no milissegundo
entre pagamento e evento. **Lição: depois de qualquer ação de teste,
conferir o resultado direto no banco, não só o estado da tela — ainda
mais nesta máquina, onde o projeto vive dentro do OneDrive.**

Verificado no fim que o burst de HMR tinha parado sozinho (~19min sem
recorrência, olhando o log do servidor Vite, não só o console
acumulado do browser).

## 9. Auditoria do app — varredura atrás de gaps, sem alvo prévio

Pedido aberto ("procura gaps atuais e resolve"), então varri o código
contra as 9 regras invioláveis e o schema, em vez de ir num alvo já
conhecido. Achei 3 no código + 1 que dependia de decisão.

**RLS de `pagamentos` e `assinaturas` era tenant-wide** — o mais sério, e
exatamente a mesma classe do buraco de `eventos` do item 7, que passou
despercebido lá porque eu só olhei `eventos`. `entregas` e `corridas`
sempre escoparam o caixa à própria loja; essas duas ficaram só com
`tenant_id` desde o schema inicial. Um caixa da Filial 02 lia por query
direta o valor e a forma de pagamento de toda entrega da Matriz, a
justificativa de cada divergência (`pagamentos.observacao`) e os traços
de assinatura do tenant inteiro. Nenhuma das duas tem `loja_id` próprio,
então o escopo vem da entrega/corrida dona, via helpers
`pode_ver_entrega`/`pode_ver_corrida` SECURITY DEFINER (mesmo motivo de
`current_tenant_id()`: ler a tabela de dentro da policy sem disparar
recursão de RLS).

**Relatório somava dinheiro sobre `select` sem `limit` nem `range`** —
era a única query do app sem teto (as outras têm limite explícito).
Passando do `max-rows` do PostgREST os totais viriam silenciosamente
menores, sem erro: o cenário da regra 1. Novo `src/lib/paginacao.ts`
pagina por `range()` **avançando pelo tamanho do lote realmente
recebido**, não pelo pedido — assim funciona mesmo se o teto do servidor
for menor que a página.

**`fecharCorrida` zerava `observacoes`** — escrevia
`observacoes: insucessoDetalhe` incondicionalmente, e pra vale marcado
Entregue isso é `null`. Latente (nada mais escreve a coluna hoje), mas é
perda silenciosa de dado.

**Custódia de papel gravava um relógio só** (`documento_recebido_em`,
`receita_recebida_em` vindo do navegador). Levei pro usuário porque
tinha dois caminhos: trocar pelo `now()` do servidor (mais simples, mas
tecnicamente ainda um relógio) ou colunas `_local` + trigger como no
resto do projeto. Ele escolheu o consistente. Diferente dos casos do
item 8, esses não passam pela fila offline — o risco não é sync atrasado
e sim o relógio do PC estar errado em termos absolutos, sem como
perceber depois.

**Testado com conta de caixa real** (`caixateste@drogcidade.sg`, Filial
02) — foi o que fechou a prova nos dois sentidos: antes enxergava todos
os pagamentos do tenant, depois zero de outra loja e zero assinaturas;
e criando uma entrega nova (V-000017) ele volta a ver o pagamento dela,
inclusive pelo embed que a tela "Hoje" usa. Ou seja, apertou o que devia
sem apertar o que não devia. Trigger de custódia confirmada gravando os
dois relógios com 275ms de diferença.

## 10. Histórico paginado e filtro de filial

Usuário perguntou o que o `limit(5000)` do histórico implicava. A
resposta virou trabalho: o teto real é `min(5000, max-rows)`, a
ordenação é `registrado_em desc` (então o corte derruba justamente os
**mais antigos**, que é o que a busca existe pra achar), e é silencioso.
Ele foi direto ao ponto: não pode ter teto, a farmácia procura vale de 3
meses atrás.

Paginação server-side de verdade — `range()` + `count: 'exact'`, 50 por
página, páginas numeradas com janela deslizante (`1 … 5 6 7 … 84`) pra
lista não virar parede de botões. Sem teto nenhum, e carregando **menos**
por vez: a tabela não virtualiza e monta um dropdown Radix por linha,
então 5000 linhas travariam o PC do caixa antes de o dado ser o
problema. `keepPreviousData` pra não piscar entre páginas; filtro novo
sempre volta pra página 1.

Filtro de filial no histórico, só pra admin/gerente (pro caixa a RLS já
prende à própria loja). Server-side junto da paginação — client-side
filtraria só os 50 da página atual, pior que não ter. Filtra por
`loja_id` (origem), mesma semântica do Registro de Auditoria.

Testado baixando `TAMANHO_PAGINA_HISTORICO` pra 5 temporariamente (com
19 vales e página de 50 não dava pra ver paginação nenhuma): 4 páginas,
página 3 com "11–15 de 19" e linhas certas — inclusive um vale de
07/08/**25**, um ano atrás, que é o caso que o teto quebrava. Filial 02
filtrou 2 de 19, batendo com `count` direto no banco, e resetou pra
página 1. Restaurado pra 50 e reconferido depois.

## 11. Aba "Hoje" paginada — fecha o último gap de truncamento

`buscarEntregasDeHoje` era o que sobrava sem teto e ordenado
descendente: pro caixa nunca chegaria perto (um dia, uma loja), mas
admin/gerente enxergam as 18 filiais juntas e num dia movimentado o
corte silencioso derrubaria justamente os vales da manhã.

Antes de mexer, conferi as outras queries sem limite (documentos de
convênio, receitas pendentes, corridas abertas, entregas pendentes sem
corrida) — **todas ordenam ascendente**, mais antigo primeiro. Se
truncarem, perdem o mais novo, que é a direção benigna numa fila de
trabalho: você limpa pelo topo e os novos sobem. Por isso não paginei
nenhuma delas. Só "Hoje" tinha o problema de verdade.

Componente `src/components/Paginacao.tsx` extraído (o do item 10 morava
dentro de `HistoricoEntregas.tsx`), agora com `Paginacao` +
`ResumoPagina` usados pelas duas telas. Página de 100 em "Hoje" (é tela
de trabalho — o caixa quer o dia inteiro sem clicar) contra 50 no
histórico. O `ResumoPagina` só aparece quando passa de uma página, pra
não poluir o caso normal de 20 vales no dia.

Com isso o `max-rows` do PostgREST deixou de importar em qualquer lugar
que crescesse sem limite — não porque alguém descobriu o número, mas
porque nenhuma query depende mais dele.

Testado baixando `TAMANHO_PAGINA_HOJE` pra 2: 4 vales em 2 páginas.
**Realtime confirmado junto da paginação** — estando na página 2 ("3–3
de 3"), inseri um vale novo e a página aberta se atualizou sozinha pra
"3–4 de 4" com as linhas certas, sem reload. Isso funciona porque a
invalidação usa `['entregas-hoje']`, que casa por prefixo com
`['entregas-hoje', pagina]` no TanStack Query. Restaurado pra 100.

Detalhe de teste que quase virou falso alarme: o console da aba onde eu
estava editando acusava `entregas.map is not a function` — resíduo de
HMR do momento em que o hook já devolvia objeto e a tela ainda esperava
array. Aba nova: zero erros. É o mesmo fenômeno já anotado mais abaixo,
e a técnica da aba limpa resolveu de novo.

## 12. Máscara de moeda — mata a ambiguidade do separador na raiz

Eu tinha anotado o `toCents('1.234')` como gap aceitável (só quebra com
ponto de milhar sem centavos, jeito que ninguém digita). O usuário
inverteu o enquadramento: em vez de discutir *quando* o parser adivinha
certo, tirar do caixa a possibilidade de confundir "," com "." — o campo
formata sozinho enquanto ele digita.

Máscara de centavos, igual maquininha de cartão: só dígitos, preenchendo
da direita. `1` `2` `3` `4` `5` `6` → `0,01` → `0,12` → `1,23` → `12,34`
→ `123,45` → `1.234,56`. Como separador nunca é digitado, não existe
mais o que interpretar — o bug some por construção, não por heurística
melhor.

- `src/components/CampoMoeda.tsx` novo. O estado do pai guarda a **string
  de dígitos crua** ('' vazio, '123456' pra R$ 1.234,56), não o texto
  formatado — sem fonte de verdade duplicada nem desformatar pra salvar.
  Campo vazio mostra vazio, não "0,00" (transferência tem valor 0
  legítimo; o caixa precisa distinguir "não preenchi" de "é de graça").
- `centsFromDigits` / `formatCentsInput` em `money.ts`. **`toCents` foi
  deletado** — ficou sem nenhum uso e era justamente o que tinha o caso
  ambíguo. Prefixo "R$" fica fora do valor editável, pra não atrapalhar
  cursor.
- Aplicado nos 3 lugares que digitam dinheiro: cadastro de entrega,
  divergência de pagamento e o filtro de valor do histórico. Esse último
  não estava no pedido, mas deixar a busca com formato diferente do
  lançamento seria a mesma confusão de volta.
- CLAUDE.md atualizado: a convenção citava `toCents` pelo nome, e ganhou
  a regra "campo de dinheiro é sempre `<CampoMoeda>`, nunca `<Input>`
  cru".

**Sobre o teste dos 25 segundos:** não regride, e na maioria dos casos
melhora. Valor com centavos economiza uma tecla (`12399` em vez de
`123,99`); valor redondo custa duas a mais (`2500` em vez de `25`).
Compra de farmácia quase nunca é redonda — nos próprios dados de teste
tem R$ 123,99 e R$ 132,90.

Testado no navegador digitando dígito a dígito: progressão exata acima,
"," / "." / letras ignorados, backspace natural (`12.345,67` →
`1.234,56` → `123,45`), apagar tudo volta pro vazio. E o round-trip
completo: digitei `1.234,56`, o banco gravou `valor_compra_cents =
123456` (com o `pagamentos.previsto` batendo) e a lista exibiu
`R$ 1.234,56`. Justamente o valor que o parser antigo erraria.

**O campo nasceu alinhado à direita e o usuário mandou corrigir** — o
número agora cresce da esquerda, logo depois do "R$", no sentido da
leitura e onde ele está olhando.

**Transferência não tem campo de valor** — checado a pedido do usuário:
a tela tem um campo só, o select de filial de destino (vale de
transferência não tem valor de venda, por design). Nada de máscara pra
aplicar lá. Testei o fluxo mesmo assim pra garantir que não regrediu:
V-000020 gravado com valores 0 e nenhum `pagamentos` criado, como
esperado.

## 13. Fechando as dívidas anotadas: max-rows e saida_em

**max-rows:** a correção não foi descobrir o número do dashboard — foi
fazer nenhuma query depender dele. Os 11 SELECTs sem limite ganharam teto
explícito. Nos dois que crescem por inércia (documentos de convênio e
receitas pendentes, que só encolhem quando alguém marca como recebido)
entrou o truque do "+1" (`buscarComTeto`): pede uma linha a mais do que
mostra e, se ela vier, avisa na tela. Funciona sem saber o max-rows,
contanto que nosso teto seja bem menor que o dele.

Antes de sair paginando tudo, conferi a ordenação de cada lista: as
filas de trabalho (documentos, corridas abertas, entregas pendentes sem
corrida) ordenam **ascendente**, então truncar perderia o mais novo — a
direção benigna numa fila que se limpa pelo topo. Por isso nenhuma delas
virou paginada, só ganharam teto.

**saida_em era pior do que a nota dizia.** Não era "não passa por
trigger": `saida_em` e `saida_em_local` recebiam o **mesmo**
`ocorridoEmLocal`. O par existia só no nome, não havia relógio de
servidor nenhum na saída. Trigger carimba `now()` agora e o cliente manda
só o `_local`. O caso delicado é o reenvio da fila offline, que vira
UPDATE no upsert — se remarcasse `now()` ali, a saída passaria a ser o
horário do sync, pior que o bug original; por isso só carimba quando
ainda não há valor. Sem backfill: o horário de servidor das corridas
antigas nunca existiu, inventar seria pior.

Testado com o relógio do dispositivo 40 min atrasado (o cenário da regra
8): `saida_em_local` 20:37 (errado, como mandado), `saida_em` 21:17
(servidor) — 40 min de diferença que antes seria invisível. Reenvio
preservou ao milissegundo.

## 14. Painel de admin para criar e gerenciar usuários

Primeira peça de backend do projeto. Escopo decidido com o usuário:
cria, edita nome/papel/loja, bloqueia/libera — **senha fica fora**
(definir a inicial faz parte da criação; trocar depois é direto no
Supabase, decisão dele). Só `admin`, não `is_gerente()`.

Só a **criação** passa pela Edge Function, porque mexer no Auth exige a
`service_role`. Editar e bloquear são `UPDATE` comum em `profiles`
resolvido pela RLS — a função ficou com uma rota só, a menor superfície
possível rodando com aquela chave.

**A armadilha que a migration fecha, e que eu quase criei.**
`marcarNotificacoesPagamentoLidas` faz o usuário dar UPDATE no próprio
profile, então precisava existir policy de auto-update. Uma policy
simples de `id = auth.uid()` deixaria **qualquer caixa rodar
`update profiles set papel='admin'` na própria linha** — escalação de
privilégio introduzida por mim, não pré-existente. RLS não restringe por
coluna, então a policy sozinha não resolve: a policy libera a linha e o
trigger `fn_profiles_protege_campos` barra nome/papel/loja/ativo/email
pra quem não é admin. Testado com a conta de caixa: as três tentativas
de escalar voltaram bloqueadas e o caminho legítimo (marcar notificação
lida) continuou funcionando.

**Bug real achado no teste:** `functions.invoke` não anexava o JWT da
sessão — mandava a anon key, a função não achava perfil de admin e
devolvia 403 mesmo com admin logado. Descobri porque a chamada idêntica
via `fetch` com o header na mão passava com 200. Agora o `Authorization`
vai explícito no invoke. **Se alguém mexer nisso e "simplificar"
removendo o header, o painel quebra com 403 e o motivo não é óbvio.**

Testado de ponta a ponta: criar pelo painel → logar com a conta nova →
RLS prendeu à filial dela (20 entregas, uma loja só) → editar os três
campos → bloquear → confirmar que o bloqueado ainda autentica mas não
enxerga nada, nem o próprio perfil, caindo na tela "Perfil não
encontrado ou inativo". Negativo: caixa chamando a função devolve 403,
sem credencial devolve 401.

Um susto no meio que vale registrar como método: cliquei num toggle com
uma referência de elemento velha e nada aconteceu. Antes de concluir
qualquer coisa, verifiquei se eu não tinha bloqueado **outro** usuário
por engano — não tinha. O toggle funcionou nos dois sentidos quando
localizei o botão pela linha certa, e o `UPDATE` direto no banco já
tinha provado que a camada de dados estava correta.

## 15. O teste dos 25 segundos foi medido de verdade

O usuário cronometrou com uso real, já com a máscara de moeda no ar:
**~15 a 18 s** pelo sistema, contra ~1 min pra um vale no papel e
~1 min 30 s pra dois. Folga de 7 a 10 segundos sobre o alvo.

Isso encerra a única incógnita que o CLAUDE.md tratava como aberta — a
seção "O teste que decide o projeto" tinha literalmente um `X segundos`
de placeholder no lugar da linha de base do papel, desde o começo do
projeto. Agora tem número dos dois lados.

**Correção de entendimento que veio junto** (eu tinha lido errado): "dois
vales" não são duas entregas — é **uma** entrega de endereço distante. E
"os dois papéis" do CLAUDE.md são vale do tele + linha na planilha de
controle da farmácia, não duas vias do mesmo vale. Entrega distante
multiplica os dois lados: 2 vales + 2 linhas = 4 escrituras, 1min40.

Detalhe de negócio que apareceu aí e que o projeto inteiro não sabia: **o
valor da entrega é R$ 9,00 fixo, nunca outro valor.** A única variação é
endereço distante, que cobra 2 vales (R$ 18,00). Ver a pergunta em aberto
no fim deste arquivo — isso tem consequência de desenho na tela de
cadastro e possivelmente nos relatórios.

Duas coisas que isso muda pra quem retomar:

- A máscara de moeda (item 12) **não** regrediu o tempo, apesar de ter
  mudado o jeito de digitar valor. A previsão era neutra ou levemente
  melhor porque compra de farmácia raramente é redonda; bateu.
- A folga agora é mensurável. Campo novo na tela de cadastro continua
  exigindo justificativa, mas dá pra cronometrar de novo em vez de
  discutir no abstrato.

## 16. Tarifa fixa, quantidade de vales e quem paga cada um

Veio de uma conversa que começou como "confirma o baseline do papel" e
virou a descoberta de que **o sistema modelava o dinheiro da tele
errado**. Detalhe por detalhe, cada resposta do usuário abriu uma camada:
tarifa é fixa (R$ 9) → endereço distante cobra 2 vales → o segundo vale o
cliente paga em mãos ao motoboy → menos no convênio Minerva.

A consequência: `valor_entrega_cents` era tratado como número livre, e o
relatório somava o total como se a farmácia devesse tudo. Numa entrega
distante ela deve metade — **o acerto com a agência vinha inflado**. Esse
era o bug de verdade, e ninguém tinha notado porque o caso distante nunca
tinha sido lançado no sistema.

Regra completa e as 3 combinações estão no CLAUDE.md (seção "Tarifa de
entrega e vales"). O que vale registrar aqui é o que **não** virou
coluna: a taxa de R$ 9 embutida na compra abaixo de R$ 100. Ela existe,
mas não muda o acerto (a farmácia deve os R$ 9 à agência de qualquer
jeito) e **já vem somada do Trier** — se alguém "melhorar" isso fazendo o
sistema somar, vira cobrança dobrada.

Na tela do caixa o campo de valor da entrega **sumiu**: virou seletor de
1/2 vales, já em 1. São 3 teclas a menos por entrega (`900`) e some a
chance de digitar valor errado num campo que nunca deveria variar.

Testado os 3 casos conferindo centavos no banco:

| caso | total | farmácia deve | cliente |
|---|---|---|---|
| V-000021 (1 vale) | 900 | 900 | 0 |
| V-000022 (2 vales) | 1800 | 900 | 900 |
| V-000023 (2 vales + Minerva) | 1800 | 1800 | 0 |

E no relatório: total R$ 81,50 contra R$ 72,50 de "Farmácia deve" — a
diferença de exatos R$ 9,00 é o vale que o cliente pagou em mãos. Os 3
níveis da hierarquia renderizam a coluna nova com as colunas pareadas
(7/7/5).

## 17. Cancelamento de vale — a regra que descrevia um caminho impossível

Era o mais concreto dos 3 buracos que levantei quando o usuário perguntou
que ideias existiam além das obrigatórias. O schema tinha tudo desde o
início (`cancelado_em`, `cancelado_por`, `motivo_cancelamento` e um CHECK
exigindo o motivo) e a regra 4 descrevia o fluxo em detalhe — mas nada no
app nunca escreveu esse status. A palavra 'cancelada' aparecia no código
só como rótulo. Vale digitado errado ficava pendente pra sempre.

Detalhes de desenho no CLAUDE.md. O que vale registrar aqui:

**Zero linhas não é erro no PostgREST.** O `UPDATE` filtra por
`status_entrega = 'pendente'`, e sem conferir as linhas afetadas o
cancelamento falharia **calado** em dois casos reais: o vale saiu de
pendente entre abrir o dialog e confirmar, ou ainda está na fila offline
e nem existe no banco. O caixa acharia que cancelou.

**O menu "⋮" sumia em transferência sem receita** — então transferência
digitada errada não teria como ser cancelada. Agora ele aparece se houver
qualquer ação disponível.

**Bug pré-existente que só apareceu agora:** o Registro de Auditoria fica
**sempre montado** (o componente é quem desenha o botão do cabeçalho),
então a query dele carrega junto com a página e nada invalidava
`eventos-auditoria` depois. Cancelei um vale, o banco tinha 14 eventos e
a tela mostrava os 12 de antes. Isso valia pra **todos** os tipos de
evento, não só cancelamento — a fila offline invalidava
`notificacoes-*` mas nunca a auditoria. Corrigido em
`QUERY_KEYS_POR_TIPO` (todas as 6 operações) e no cancelamento.

**Ajuste depois de conversar sobre o relatório:** o usuário confirmou que
a leitura dele batia com o que foi construído — cancelamento acontece
antes de o tele chegar na farmácia, então o vale não pertence a agência
nem a motoboy nenhum, e o lugar dele é no relatório da farmácia. A única
mudança pedida foi **promover "Vales cancelados" a bloco próprio** no
topo (em vermelho quando > 0), porque dentro da lista "por status" ficava
escondido. Continua fora do dinheiro.

Fica anotado o que **não** foi feito: o bloco que soma por agência não
checa cancelamento — hoje isso não importa porque cancelado nunca tem
corrida, mas é garantia por consequência, não por regra. Ofereci a
guarda de 2 linhas duas vezes e o assunto não foi retomado; se alguém
liberar cancelar vale em rota, esse é o primeiro lugar a olhar.
*(Feito no item 21, em 2026-08-11.)*

Testado: motivo vazio barrado com o vale intacto; cancelamento gravando
os dois relógios (329ms de diferença) + motivo + autor; evento
`entrega_cancelada` com o motivo no payload; vale sumindo de "Nova
corrida"; totais caindo **exatamente** o valor do vale (compra −1500,
entrega −500); soma dos status fechando com o total (9+2+3+10 = 24); e o
caminho negativo — cancelar um vale em insucesso volta bloqueado.

## 18. O eixo `status_financeiro` estava morto — os dois lados

Segundo dos 3 buracos que eu tinha levantado. A coluna existe desde o
schema inicial com três valores e o CLAUDE.md defende os três eixos como
independentes ("não colapsar em um enum linear"), mas **zero ocorrências
no código**: todo vale ficava em `na_ordem` pra sempre, inclusive os que
tinham divergência de pagamento registrada em `pagamentos` e evento no
log.

**Lado `divergente`** (inequívoco, feito direto): `marcarDivergencia`
passou a gravar. Idempotente no reenvio da fila, e como o UPDATE dispara
`fn_log_entrega`, a mudança já aparece sozinha no Registro de Auditoria
como "financeiro Na ordem → Divergente". Migration só de dado corrigiu o
passado. O relatório passou a mostrar os dois eixos em blocos separados
— misturar numa lista só sugeriria que são estados alternativos, quando
um vale pode estar entregue e com dinheiro por conferir.

**Lado `conferido`**: aqui eu parei e perguntei, porque encostava na
linha do "fechamento mensal" (lista Fora) e porque havia várias leituras
possíveis. Foi a decisão certa — a resposta mudou o que eu ia construir.

## 19. Fechamento de caixa — o que o usuário contou mudou o desenho

Perguntei *quando* e *quem* confere. A resposta trouxe o problema real:
o operador fecha o caixa, aparece se sobrou ou faltou, e aí *"é passado
pra gestão fazer os procedimentos deles, ou justificar ao financeiro
caso falte dinheiro, **coisa que fica meio à mercê da memória do
caixa**"*.

Ou seja: o problema não era marcar um status. Era o caixa não ter a
explicação na tela.

**Limite que eu levantei antes de construir, e que muda tudo:** o
sistema **não consegue calcular sobra nem falta**, porque só conhece
tele-entrega — venda de balcão é a maior parte do caixa e vive no Trier.
Somar os vales e chamar de "esperado na gaveta" daria número errado. O
usuário confirmou que só o lado da tele já ajuda, e a tela diz isso
explicitamente pra ninguém somar achando que é o caixa inteiro. **Se um
dia entrar o total do Trier, aí sim dá pra falar em sobra/falta. Sem
esse dado, não inventar o número.**

A aba "Fechamento" (admin/gerente) responde uma pergunta só: *o que, do
lado da tele, explica uma diferença hoje?* As quatro causas já estavam
no banco, nunca reunidas: divergência de pagamento, **vale extra pago em
mãos ao motoboy** (o que mais parece falta sem ser — R$ 9,00 que vão do
cliente pro motoboy e nunca entram na gaveta), cancelado e insucesso.

**Fluxo, que o usuário precisou corrigir uma vez:** operador marca
divergências → gestor confere → **o dia inteiro sobe pra administração**,
conferidos e divergentes. Eu tinha escrito na tela que "o divergente é
que sobe", dando a entender que conferido parava no gestor. Errado: sobe
tudo, e o que a marca faz é dizer **quais precisam de ação lá**, porque
o gestor não resolve divergência sozinho. Por isso conferir nunca
sobrescreve `divergente` — apagar a marca faria o problema chegar lá em
cima sem sinalização.

Conferência é ato de supervisão, então a guarda ficou no **banco**:
trigger `fn_entrega_protege_conferencia`. Não dá com policy — `entregas`
precisa de UPDATE liberado pro caixa (cadastro, corrida, retorno,
cancelamento) e RLS não restringe coluna, mesma limitação de `profiles`.

Testado: backfill marcando os 5 divergentes sem inconsistência; aba com
dados reais (8 vales, as 4 causas certas); conferir o dia marcando 6 e
**preservando** divergente e cancelado; caixa bloqueado ao conferir mas
ainda podendo marcar divergente; aba invisível pro caixa.

**Lição de teste que vale mais que o resultado:** na primeira tentativa
do caminho negativo eu escolhi um vale que **já estava `conferido`**. A
transição não existiu, a trigger não teve o que barrar, e o teste
"passou" — eu quase reportei isso como guarda funcionando. Só peguei
porque fui conferir qual vale tinha usado antes de concluir. **Testar
transição de estado exige garantir que a transição existe.** (Na
segunda rodada a falha era real: a migration da trigger ainda não tinha
rodado.)

## 20. O projeto ganhou um repositório remoto

Até aqui os 25 commits existiam **só nesta máquina**, dentro do OneDrive —
o repo não tinha remote nenhum. Notei isso ao conferir o estado pro
usuário dar clear, e ele pediu pra resolver.

Criado em `github.com/ocamll/DrogariaCidadeEntregas`, **privado**, branch
`main` (a local era `master`; renomeada, `master` apagada dos dois lados
depois de conferir que as duas apontavam pro mesmo commit).

**Varredura de segredo antes do push**, porque publicar é irreversível:
`.env` está no `.gitignore` e nunca foi commitado (conferido no histórico
inteiro); nenhuma chave JWT em arquivo rastreado; `service_role` só
aparece em texto explicativo, nunca a chave.

**Mas achei um problema que é meu:** eu tinha anotado neste arquivo as
credenciais das contas de teste, com senha, como nota de retomada. Fazia
sentido num arquivo local; não faz nenhum num repositório. São logins
**válidos** de um Supabase de produção, um deles admin — e `2026` é uma
senha de 4 caracteres. Antes de empurrar, confirmei pela API do GitHub
que o repo estava mesmo privado (404 sem autenticação).

**Pendência que fica pro usuário:** trocar essas senhas em Authentication
→ Users. Isso resolve na raiz, inclusive pro histórico já gravado —
reescrever histórico não vale a pena aqui, porque este arquivo referencia
hashes de commit e a reescrita quebraria todas as referências. A regra
pra frente está no CLAUDE.md, seção "Segredo nenhum no repositório".

Sobrou também uma branch local `claude/sharp-haibt-2b1db4` de sessão
anterior — não subiu, não atrapalha, e não apaguei porque não sei se tem
algo dentro.

## 21. Continuação em 2026-08-11: a guarda do cancelamento no relatório

Retomei do NOTAS.md. Ofereci as pendências que sobraram (correção de vale
assinado, limpeza dos dados de teste, esta guarda) e o usuário escolheu a
guarda — a menor das três, e a única que eu já tinha oferecido duas vezes
sem retomar.

A regra "cancelado não soma dinheiro" existia escrita **só no total
geral**. Agência e motoboy acertavam por consequência (só cancela vale
pendente; pendente nunca tem corrida). Virou um predicado único,
`entraNoDinheiro`, usado pelos **três** acumuladores — a mesma regra num
lugar só, em vez de uma regra escrita e duas implícitas.

**Como provei uma guarda que hoje não muda número nenhum.** O caso que ela
protege (vale cancelado com corrida) é impossível de criar pelo app, e
fabricá-lo no banco significaria sujar dados de produção justo enquanto a
limpeza é pendência aberta. Então foram duas metades:

- **A guarda em si**, com linhas sintéticas passadas pra `acumularAgencia`
  de verdade (export temporário, revertido depois; nenhuma escrita no
  banco). Dois vales normais numa agência — 1 vale (900/0) e 2 vales
  (1800/900) — dão `entrega 2700` / `deve 1800`, batendo com a tabela de
  tarifa. Entrou um terceiro, `cancelada` **com corrida**: contagem 2→3,
  dinheiro parado em 2700/1800, `entregues` intacto, e o vale continuando
  na lista do 3º nível marcado "Cancelada". Sem a guarda seriam 4500/2700.
  Vale pros dois níveis, porque `acumularGrupo` é exercitado por dentro.
- **A não-regressão**, contra o dado real: conferi antes no banco que
  `canceladas com corrida = 0` (é o que torna "os números não podem mudar"
  uma previsão testável, não uma esperança), calculei os totais esperados
  direto do Supabase com os mesmos limites de período do relatório, e
  comparei com a tela em "Este mês". Bateu em tudo: 24 vales, 2 cancelados,
  compra R$ 2.210,75, entrega R$ 130,50, farmácia deve R$ 121,50; por
  status 9+2+3+10 = 24; Ágil Motos 11/9/2/R$ 40,00/R$ 40,00 e "(sem
  agência)" 2/1/1/R$ 14,00/R$ 14,00. Expandido, o 2º nível fecha com o 1º
  (João Silva 7 + Pedro Souza 4 = 11 vales, 6+3 = 9 entregues, R$ 40,00 +
  R$ 0,00). Zero erro no console. `tsc -b` OK.

**Nota de método pra próxima vez:** o `screenshot` falhou duas vezes de
jeitos diferentes — uma mostrando a tela *anterior* ao clique, outra com
"Browser pane not displayed". A leitura do DOM (`get_page_text` e uma
query juntando as `<tr>`) deu prova melhor e mais checável que a imagem
teria dado. E o HMR do OneDrive apareceu de novo no meio: a aba voltou
sozinha de Relatórios pro Histórico entre um comando e outro, porque a
navegação é `useState<View>` e o remount perde o estado. Não é bug do app.

## 22. Transferência tem valor, e a lista parou de rolar pra o lado

Dois pedidos do usuário depois de conferir a operação na farmácia.

**A transferência vale R$ 9,00.** O sistema tratava vale de transferência
como "sem valor nenhum" desde que foi criado — `quantidade_vales = 0`,
`valor_entrega_cents` no default 0. A informação que faltava é simples:
quem leva o produto de uma filial pra outra é o motoboy da agência, e ela
cobra a corrida como qualquer outra. **É o espelho exato do bug do item
16**: lá o relatório inflava o acerto (somava o vale que o cliente paga em
mãos), aqui ele encolhia (não somava a transferência) — a mesma coluna,
errada nas duas direções, por dois motivos diferentes.

- Sempre **1 vale**, e isso não é preguiça: a variação de 2 vales é
  endereço distante do *cliente*, e transferência é entre filiais nossas.
- `entrega_paga_cliente_cents` fica 0 — não há cliente pra pagar em mãos,
  então a farmácia deve o valor inteiro à agência.
- Venda continua zero (`valor_compra_cents`, nenhum `pagamentos`).
  Transferência não é compra; o que mudou é entrega, não venda.
- A tarifa é lida da loja de origem no **cadastro** e vai no payload da
  fila offline, não é buscada no sync — se ela mudar enquanto o vale
  espera, o certo é gravar a de quando o vale foi criado. Mesmo princípio
  das duas colunas guardadas em vez de derivadas do item 16.
- A tela ganhou uma linha só de leitura ("Valor da entrega · 1 vale —
  R$ 9,00"). Não é campo: o caixa não digita valor de entrega em lugar
  nenhum do sistema. Custa zero tecla e mostra o que vai ser registrado.
- Se a tarifa ainda não carregou, salvar é **barrado**. Sem isso o vale
  iria pro banco valendo zero e ninguém notaria — a transferência sumiria
  do acerto em silêncio, que é o bug que esta sessão veio corrigir.
- `EntregasTable` mostrava `—` na coluna Entrega pra transferência. Agora
  mostra o valor; Compra continua `—`.

Testado ponta a ponta: V-000024 criado pela tela, gravado com
`valor_entrega_cents = 900`, `quantidade_vales = 1`,
`entrega_paga_cliente_cents = 0` e compra 0 (conferido direto no banco,
não só pela tela); fila offline esvaziou sozinha; lista mostrando
"— | R$ 9,00"; relatório do dia somando R$ 9,00 em "Valor de entrega" e
em "Farmácia deve à agência".

**Sem backfill.** V-000003, V-000004, V-000008 e V-000020 continuam
valendo 0 — são de antes da regra, e reescrevê-los inventaria passado. Se
a decisão for outra, é `update` manual, mas convém junto da limpeza dos
dados de teste, que já é pendência.

**A lista não rola mais na horizontal.** O pedido foi literal: do número
do vale ao "⋮", tudo visível sem arrastar. A `Table` do shadcn põe
`whitespace-nowrap` em toda célula, então a tabela crescia até o texto
mais longo (endereço) e empurrava as últimas colunas pra fora do container
`overflow-x-auto` — o "⋮", justamente, era o que sumia.

A correção é deixar as colunas de texto livre quebrarem linha
(`COLUNA_TEXTO`): como a `<table>` é `w-full`, o layout automático encolhe
essas e mantém valor/status/ações inteiros. **Quebrar, não truncar** —
endereço em duas linhas é melhor que endereço cortado com reticências. A
coluna "Data" do histórico ("10/08/26, 23:22") entrou junto: era a maior
célula fixa depois do endereço, e quebrando em data/hora liberou 39px.

Medido, não estimado — a largura mínima que a tabela exige:

| | largura mínima da tabela | viewport mínima |
|---|---|---|
| antes | 1123px | ~1202px |
| depois | 779px | ~858px |

A viewport onde eu estava testando tinha 1142px, ou seja, **caía bem no
meio** — é por isso que o usuário via a rolagem. O teste que vale é esse
par: reapliquei `white-space: nowrap` por CSS injetado pra medir o "antes"
na mesma tela, em vez de confiar que a mudança tinha feito efeito. Sem
isso eu teria lido "sobra: 0" e concluído certo por sorte.

Confirmado com `sobra = 0` e todos os "⋮" dentro da borda do container em
1142px e em 1024px. Abaixo de ~858px ainda rola — o `overflow-x-auto`
continua ali de propósito, como rede, então nada fica inalcançável.

## 23. Gerente deixa de ver as outras filiais

Pergunta do usuário: "gestor e caixa só visualizam a própria filial, admin
todas — isso já acontece?" Fui conferir nas policies em vez de responder
de memória. **Metade.** Caixa sim; gerente não.

A causa era uma função com nome enganoso: `is_gerente()` quer dizer
"gerente OU admin", e era ela que liberava o cross-filial em toda policy
de visibilidade. Gerente e admin enxergavam exatamente a mesma coisa — e
não era teórico: a aba "Hoje" não tem filtro de filial, sai direto da RLS,
então um gerente da Filial 02 via o movimento da Matriz na tela principal.

Duas migrations. A troca é `is_gerente()` → `is_admin()` na cláusula de
escopo, e **`is_gerente()` não some**: continua significando "capacidade
de gestão", com um uso só (a trigger da conferência). Poder conferir não é
enxergar outra filial.

- `pagamentos` e `assinaturas` vieram de graça: elas não têm `loja_id`, o
  escopo vem dos helpers `pode_ver_entrega`/`pode_ver_corrida`, então
  trocar as duas funções cobriu as quatro policies delas.
- `eventos` foi o único que exigiu desenho próprio (sem `loja_id`, só
  `entrega_id`/`corrida_id`, ambos nullable) — os três papéis ficaram
  explícitos na policy.
- **Fechei escrita junto com leitura.** Enxergar nada e ainda poder
  gravar em outra filial seria pior que o bug original.

**O buraco que eu mesmo abri, e como quase passou.** Testei a escrita em
Cadastros com um UPDATE e li "sem erro" como "a policy falhou" — quando no
PostgREST **RLS bloqueando devolve zero linhas sem erro**, a mesma
armadilha já documentada no cancelamento (item 17). Só não virou conclusão
errada porque fui conferir o nome da agência no banco antes de escrever
qualquer coisa: estava intacto, ou seja, tinha sido bloqueado.

Mas investigar isso revelou o problema de verdade: **numa policy `for all`,
`using` governa SELECT/UPDATE/DELETE e `with check` governa INSERT.** Eu
tinha escrito `with check (tenant_id = ...)` copiando a forma da policy
original — então UPDATE e DELETE fechavam e **o INSERT continuava aberto**.
O buraco é pré-existente do schema inicial, mas eu o reproduzi em vez de
fechar. O mesmo padrão estava em `entregas_update`/`corridas_update`: o
`using` prendia à filial e o `with check` não, ou seja, dava pra pegar um
vale da própria loja e gravar `loja_id` de outra filial. Corrigi os dois
arquivos e o usuário rodou de novo (as duas migrations são `drop policy` +
`create policy`, reaplicar é seguro).

Testado como gerente de verdade (`gerentepainel@`, Matriz) — com admin
todo teste de restrição passa por engano:

| | resultado |
|---|---|
| entregas visíveis | 24, **nenhuma** de outra filial; V-000017 (Filial 02) sumiu |
| pagamentos / assinaturas / eventos | 24 / 9 / 73, todos escopados |
| INSERT em Cadastros | bloqueado, `42501`, nada criado |
| UPDATE em Cadastros | 0 linhas afetadas, nome intacto |
| UPDATE legítimo na própria filial | OK, 1 linha |
| mover vale pra outra filial | bloqueado, `42501`, `loja_id` intacta |

Antes de aplicar, conferi que nenhum perfil ativo está sem `loja_id` — se
houvesse, `current_loja_id()` voltaria nulo e a pessoa passaria a não ver
**nada**.

Na tela: aba Cadastros só pro admin; Fechamento/Ocorrências/Relatórios
continuam pro gerente (a RLS é que limita o conteúdo); filtro de filial do
Histórico e da Auditoria virou exclusivo do admin; e no Fechamento o
gerente vê a filial dele em texto no lugar do select — deixar "Todas as
filiais" ali seria promessa falsa, porque escolher outra traria vazio e
pareceria dia sem movimento em vez de acesso negado.

## 24. O layout dos vales

O usuário abriu com "as proporções estão estranhas" e eu **não conseguia
ver a tela** (o screenshot exige o painel do navegador visível). Diagnostiquei
pelo DOM, e o número que explicou tudo: as linhas variavam de 45 a 58px,
porque o selo "Transferência" quebrava pra baixo do número do vale e
inflava a largura mínima daquela coluna — 188px, a mais larga da tabela,
por causa de 4 linhas em 24.

Duas vezes eu montei um detector errado no meio do caminho: medi
`td.getBoundingClientRect().height` pra saber se a célula quebrava, mas a
célula **estica junto com a linha**, então acusava quebra em "—" e
"Pendente". A medida certa foi o rect do **nó de texto** (via `Range`)
comparado com o do selo. Fica a regra: pra saber se conteúdo quebrou,
medir o conteúdo, nunca a caixa que o contém.

O que ficou:

- Selo ao lado do número, nunca embaixo (célula `nowrap`), e menor (77px),
  pra parar de inflar a coluna inteira.
- **Data em cima, hora embaixo, sempre** — duas linhas explícitas. Antes eu
  deixava a célula quebrar sozinha, então dependia da largura sobrando e um
  vale aparecia diferente do vizinho. Conferido linha a linha: 24 de 24 com
  exatamente 2 linhas.
- **Cliente e endereço empilhados na mesma coluna.** Separados custavam
  ~360px pra dizer "pra quem e onde"; foi isso que pagou a coluna nova sem
  trazer a rolagem de volta.
- **"Registrado por"**, pedido do usuário: cada caixa tem login próprio, e
  agora a lista responde quem lançou o vale sem abrir a auditoria. Vem por
  join com `profiles`, não snapshot — se a pessoa trocar de nome, a lista
  acompanha. Testei o embed **antes** de escrever o código, porque
  `entregas` tem 4 colunas apontando pra `profiles` e sem hint dá
  `PGRST201` (o mesmo erro do embed de `lojas` no item 6).
- Status virou pastilha colorida, em tons claros pra não competir com o
  vermelho da marca. Conferi no `getComputedStyle` que as classes venceram
  o `variant` do Badge — o `tailwind-merge` resolve o conflito a favor da
  className.

Resultado em 1280 (a largura do usuário): **24 linhas de 53px, todas
iguais**, sobra horizontal zero.

**Segundo passo, no dia seguinte:** o usuário disse que as colunas ainda
estavam "meio tortas". Estavam mesmo, e sobrou da própria mudança que
empilhou Cliente/endereço e Data/hora: a `TableCell` do shadcn é
`align-middle`, então numa linha com células de alturas diferentes as de
uma linha só ficavam centralizadas e as de duas começavam no topo.
Medido na mesma tela, injetando `vertical-align: middle` pra comparar:
**9px de desalinhamento máximo antes, 1px depois** (o 1px é medida de
elemento contra nó de texto, não diferença real). `[&>td]:align-top` na
linha resolve. "Registrado por" virou **"Usuário"**, também a pedido.

## 25. Polimento pedido em lote

Oito itens numa mensagem só. Os que valem registro:

**O Fechamento tinha um bug de verdade.** A tela mostrava a contagem de
pendentes e o botão "Marcar dia como conferido" — e nenhum vale. Dava pra
conferir o dia inteiro sem ter olhado vale nenhum, que é o oposto do que
conferência significa. Agora lista os vales a conferir (número, cliente,
valor, forma prevista) usando **a mesma regra do botão**, pra a lista
mostrar exatamente o que ele vai alcançar. Testado no dia 09/08: contador
"A conferir: 6" e a lista com esses 6.

**Cancelamento com autor e motivo** no painel de gestão. O motivo diz o
quê, o autor diz com quem falar.

**Documentos desalinhado** — eram duas tabelas independentes, uma com 5
colunas e outra com 4, cada uma calculando larguras pelo próprio conteúdo.
Viraram a mesma tabela com `table-fixed`, que é o que garante alinhamento:
só igualar a contagem de colunas não bastaria, o layout automático ainda
poria o "Cliente" de uma num x diferente do da outra. Medido: as duas
começam em `73, 252, 588, 834, 991`. A coluna do meio existe nas duas — em
receitas mostra "Receita" em vez de sumir.

**O peso dos pop-ups tinha causa única:** o Registro de Auditoria fica
**sempre montado** (é ele que desenha o botão do cabeçalho), então a query
mais cara do app — eventos com join de entregas, lojas e profiles — rodava
a cada carga de página pra todo admin/gerente, mesmo sem ninguém abrir.
Agora só dispara quando o dialog abre. Confirmado pela rede: antes de
abrir, zero chamada REST a `eventos`. Somei `staleTime` em auditoria e
notificações (1 min) e em `useLojas` (5 min) — esse é chamado por quatro
telas e refazia a query a cada montagem.

O resto: cinza do endereço/hora de `oklch(0.556)` pro texto principal a
70%; paginação de 25 nas duas listas; "O que explica diferença no caixa" →
**"Ocorrências"**; bloco do vale extra removido (**e o tile do resumo
junto** — era o mesmo dado, avisei o usuário); "Farmácia deve à agência" →
**"A pagar à agência"**; seção "Por status" removida do relatório.
`porStatus`/`porStatusFinanceiro` continuam sendo calculados de propósito:
a soma dos status é o que prova que nenhum vale se perdeu na agregação,
só não têm mais superfície na tela. E `pagosEmMaos`/`pagoEmMaosCents`
continuam em `fechamento.ts` sem uso na UI — dá pra remover, mas deixei
porque devolver a seção é mais barato assim.

## 26. Fechando o layout da lista de vales

Sequência de ajustes pedidos um a um, todos na mesma tabela. Vale junto
porque a lição é a mesma: **cada correção de layout revelou a próxima**, e
o que parecia gosto pessoal tinha causa medível.

- **Colunas tortas** — a `TableCell` do shadcn é `align-middle`, e numa
  linha onde Cliente e Data ocupam duas linhas e valor/status ocupam uma,
  os de uma linha ficavam centralizados. Medido: 9px de desalinho entre a
  primeira e a última coluna. `[&>td]:align-top` resolveu (1px, que é
  diferença de medição, não visual).
- **Dado começando na primeira letra do título** — centralizei corpo e
  cabeçalho juntos. Centralizar só um dos dois dá a mesma sensação,
  invertida.
- **Cliente voltou pra esquerda** a pedido, e aí apareceu a armadilha:
  `[&>th]:text-center` na linha tem especificidade MAIOR que um
  `text-left` na célula, então a exceção perdia pra regra que deveria
  contrariar. Virou classe por célula.
- **Endereço longo afastando a linha** — com a tabela em `w-full`, a
  sobra é repartida proporcionalmente e quem mais recebe é a coluna de
  maior conteúdo. Como Cliente é a única alinhada à esquerda, a sobra
  virava vão morto à direita do texto (90px com um endereço de teste).
  Largura fixa (`w-56`) resolveu na origem. **Duas alternativas que
  pareciam boas e ficaram piores**: teto de `max-width` no bloco interno
  (a coluna caiu de 382 pra 306, mas o vão continuou — quem cria o vão é
  a célula, não o conteúdo) e uma coluna `w-full` no fim pra absorver a
  sobra (aproximou tudo, mas espremeu as demais até o *mínimo* e o
  endereço passou a quebrar em 4 linhas).
- **Selo "Transferência" mudou de coluna** — ao lado do número do vale ele
  inflava a largura mínima daquela coluna (206px) por causa de poucas
  linhas, e todo vale normal herdava o espaço vazio. Foi pra coluna
  Cliente, na linha do nome — que na transferência guardaria só a filial
  de destino, já dita na rota logo abaixo. Precisou de `flex` no wrapper:
  como item de linha de texto o selo herda espaço de baseline e deixava a
  linha 2px mais alta.
- "Registrado por" virou **"Usuário"**, e os botões do painel foram
  reordenados (Transferência → Retorno → Nova corrida → Nova entrega).

**Nota de método que se repetiu três vezes:** pra saber se uma célula
quebrou, medir `td.getBoundingClientRect().height` NÃO serve — a célula
estica junto com a linha, então o detector acusa quebra em "—" e
"Pendente". O certo é o rect do nó de texto, via `Range`. Errei isso duas
vezes antes de perceber.

## 27. Transferência: direção invertida e aba própria

**O sistema gravava a direção ao contrário**, e isso passou despercebido
desde que a transferência foi criada. O fluxo real: a filial que está SEM
o produto é quem pede; o motoboy vai primeiro na que TEM, pega, entrega na
que pediu, e é lá que assina e recolhe o vale.

A filial escolhida no select ia pra `loja_destino_id` como se fosse
destino, quando é a **fornecedora** — e a rota saía invertida em todas as
9 transferências já lançadas.

O que já estava certo e não mudou: `loja_id` é a filial que pede, dona do
vale, quem recebe, assina e paga a tele. Por isso a tarifa sai dela e a
RLS/relatório escopam nela. O erro estava só no outro lado da relação.

Coluna renomeada pra `loja_origem_id` (migration `20260812130000`), junto
com o CHECK que também dizia "destino". Nome que afirma o oposto do que a
coluna guarda é o tipo de coisa que faz alguém inverter a lógica de novo
daqui a seis meses.

**Cinco das nove transferências ficaram com a rota antiga de propósito**:
já tinham assinatura, e a trigger de imutabilidade congela cliente e valor
(regra 7). Contornar é proibido, e eram vales de teste.

Na mesma frente, **aba "Transferências"**: "Hoje" e "Histórico" passaram a
filtrar `tipo = 'cliente'` e a aba nova filtra o contrário, sem corte por
dia (o volume é baixo, então a mesma lista serve de movimento e de
histórico). Lá as colunas de venda somem via `ocultarVenda` — seriam "—"
em 100% das linhas. Consequência que morde: a aba tem query key própria,
então **toda invalidação que mexe nos dois tipos precisa citar as duas
chaves**; corrida, fechamento, cancelamento e o Realtime foram
atualizados juntos.

## 28. Papel que não volta

Pergunta do usuário: vale de convênio e vale com receita geram pendência
em Documentos, mas na hora de conferir só dá pra marcar recebido — se o
convênio volta sem assinatura ou a receita não vem, não há como notificar.

Estava certo. A aba só tinha o caminho feliz. Pra receita existia meia
saída (o evento `falta_receita`), mas escondida no menu "⋮" do vale, na
outra aba — descobrir o problema num lugar e ter que registrá-lo em outro
é o mesmo descolamento que a conferência do fechamento tinha. Pra convênio
não existia nada.

Cada linha da fila ganhou **"Não voltou"** com justificativa obrigatória,
gravando `falta_receita` ou o tipo novo `falta_documento_convenio`, que
entram em Notificações, Ocorrências e Auditoria.

**Notificar NÃO tira o item da fila** — decisão do usuário: convênio e
receita costumam aparecer dias depois, e a pendência só se encerra com o
papel na mão. Por isso `status_documental = 'extraviado'` **continua sem
quem escreva**: encerrar ao notificar seria o caso dele, e foi justamente
o que se decidiu não fazer.

## 29. Exportação do acerto: .xlsx, PDF e Google Drive

O acerto é pago fora do sistema e redigitar números numa planilha é onde o
erro aparece. Saiu em três etapas, com o usuário decidindo cada uma.

**Planilha (.xlsx).** ExcelJS, não SheetJS: o pacote `xlsx` está
descontinuado no npm e a versão que o npm serve carrega o CVE-2023-30533.
O `npm audit` acusa um aviso moderado em `uuid` (transitivo) que **não se
aplica** — é sobre `v3/v5/v6` recebendo buffer e o ExcelJS só chama `v4()`,
conferido no código da dependência; `audit fix --force` rebaixaria pra
3.4.0 e quebraria a API.

**Dinheiro vai como NÚMERO com `numFmt` de moeda, nunca texto.** Célula de
texto transforma o arquivo numa imagem de tabela: não soma, não filtra,
não serve pra conferir com a agência.

**Uma página, sempre.** Começou com duas abas (resumo e vales); o usuário
achou desconexo, porque quem confere pula do subtotal pro vale que o
compõe o tempo todo. Ficou uma folha só, e o que muda entre uma agência e
várias é só a existência da coluna "Agência".

**PDF.** jsPDF + jspdf-autotable. Feito pra ser impresso, assinado e
arquivado, então carrega o que um papel solto precisa pra se explicar
sozinho meses depois: logo, período, **data e hora de emissão, quem
emitiu, e quais filtros valiam**. Esse último é o que evita a pergunta
"esse acerto é de qual filial?" na frente da agência.

Dois achados: a instalação trouxe uma vulnerabilidade **alta** no `nanoid`
(corrigida com `npm audit fix`, não-quebrante), e o PDF saía com 180 kB
porque o jsPDF grava imagem sem compressão por padrão — com `'FAST'` no
`addImage`, 27 kB.

**Google Drive.** A única integração externa do projeto. Desenho escolhido
pra ser o menos invasivo possível:

- escopo **`drive.file`**, não `drive`: o app enxerga só os arquivos que
  ele mesmo criou. É também o que torna seguro procurar a pasta pelo nome
  — não há risco de "adotar" uma pasta homônima do usuário.
- **token só na memória**, sem refresh token. Vale ~1h e morre no reload.
  Guardar refresh token no navegador seria expor credencial de longa
  duração no cliente.
- o **Client ID é público** (vai no bundle, mora em `VITE_GOOGLE_CLIENT_ID`).
  O "client secret" não é usado neste fluxo e não deve existir aqui.
- estrutura `Drogaria Cidade Entregas - Acertos › Acertos dd-mm-aaaa a
  dd-mm-aaaa › arquivos`. Reenviar o mesmo período cai na mesma subpasta.

**Um erro de configuração que vale registrar** porque a mensagem do Google
engana: "o app não concluiu o processo de verificação" quase sempre quer
dizer que a conta não está em *Usuários de teste*, não que falte
verificação. `drive.file` é escopo não sensível e não exige verificação.

**Como testei sem poder baixar:** `montarWorkbook`/`montarPdf` ficaram
separados de quem baixa, então dá pra gerar o arquivo e ler de volta. A
planilha foi conferida lendo o zip (`xl/worksheets/sheetN.xml`) e o PDF
pelos bytes (`%PDF-`, `/XObject` da logo, textos e valores). O clique real
no link de download **trava o renderer com o painel do navegador oculto** —
não é bug do app; neutralizando só o clique do link, a exportação completa
normalmente.

## 30. Cidade amarrando filial e agência

Em cada cidade **uma** agência de tele atende **todas** as filiais dali.
Uma agência de Alegrete não pode aparecer pra uma filial de São Gabriel —
e o sistema não sabia disso.

`cidades` virou tabela, não `cidade text` nas duas pontas: com string, a
associação dependeria de dois textos baterem exatamente ("São Gabriel" ≠
"Sao Gabriel"), e um acento errado desassociaria a agência em silêncio, no
que decide dinheiro.

**Não criei constraint de "uma agência por cidade"**, e isso é decisão, não
esquecimento: o usuário disse "por enquanto vamos supor que é assim", e
travar no banco criaria uma migration de desfazer no dia em que a
suposição cair. Quem se adapta é a tela — **o mesmo predicado (uma agência
no resultado?) governa o chevron do relatório e o formato da planilha**.

A tela some com o NÍVEL, nunca com a informação: com uma agência só, o
nome dela continua aparecendo com os totais e os motoboys logo abaixo,
sem chevron. O clique some, o dado não.

Testado criando Alegrete/RS com a agência "Alegretense Tele" — ativa,
cadastrada, e ausente do dropdown de uma filial de São Gabriel. Sem uma
segunda cidade no banco essa regra não era testável.

## 31. Exclusão de dados de teste — exceção consciente à regra 4

O grupo "(sem agência)" do relatório era uma corrida antiga sem
`agencia_id` e dois vales. Levantei que **`DELETE` em `entregas`/`corridas`
é proibido pela regra 4** e propus o contrário: apontar a corrida pra
agência do próprio motoboy, o que faria o grupo sumir *e* devolveria os
R$ 14,00 pro acerto.

O usuário reafirmou com razão explícita: a regra protege trilha de
auditoria de entrega **real**, e aquilo era dado de teste antes do
primeiro deploy. Decisão dele, executada por ele no SQL Editor (o app não
tem policy de DELETE, então o cliente não conseguiria nem se quisesse).

**A regra 4 continua escrita como está no CLAUDE.md** — a partir do deploy
ela volta a ser inviolável. Se em produção aparecer corrida sem agência, o
caminho é o que propus, não o delete.

Conferido depois: zero corridas sem agência, zero pagamentos órfãos, e os
totais caindo **exatamente** R$ 14,00 — o número fechando é o que prova
que nada mais foi junto.

## 32. O envio ao Drive quebrou na segunda vez

Funcionou no primeiro teste e falhou depois, com "não consegui autorizar
no Google". O que mudou entre um e outro foi só o tempo: o token de ~1h
tinha vencido, então o segundo envio precisou abrir a janela de
autorização de novo — e aí apareceu o problema.

**Causa provável, e é de ordem das operações.** O fluxo era: clique →
carrega bibliotecas → gera a planilha → gera o PDF → **só então** pede o
token. São centenas de milissegundos e vários `await`; a essa altura o
navegador não trata mais o pop-up como resposta ao clique e bloqueia. Na
primeira vez passou porque a janela já tinha sido aberta no fluxo
inicial, quando ainda não havia arquivo pra gerar.

Corrigido invertendo a ordem — autorizar primeiro, gerar depois — e
pré-carregando o script do Google quando a aba Relatórios monta, pra o
clique não gastar o "gesto do usuário" esperando rede.

**E o `error_callback` estava engolindo a causa:** devolvia "não consegui
autorizar" pra qualquer tipo de erro. Agora separa pop-up bloqueado,
janela fechada pelo usuário e recusa do Google — três casos que pedem
ações diferentes.

**Não confirmei o diagnóstico.** O fluxo depende de consentimento OAuth,
que é autenticação e eu não faço em nome do usuário; ataquei a causa
mecânica mais provável. Se voltar a falhar, a mensagem nova identifica
qual dos três casos é — e aí o conserto é dirigido, não chute.

**Pendente de teste do usuário.**

## 33. Cadeia de custódia — a maior frente do projeto até agora

Pedido longo e detalhado do usuário: transformar a saída da tele numa
cadeia de custódia digital, e não "salvar uma assinatura do motoboy". Ele
pediu explicitamente análise e plano ANTES de qualquer código, e revisou o
plano ponto a ponto. Foram seis etapas, cada uma aplicada por ele antes da
seguinte começar.

O que a arquitetura ficou está no CLAUDE.md ("Cadeia de custódia — o
Romaneio de Saída"). Aqui fica o que é estado de sessão.

**Três propostas minhas contra o texto original, todas aceitas:**

1. **PIN offline com chave pública (RSA-OAEP + AES-GCM)** em vez de
   criptografia simétrica local. O furo da simétrica: a chave precisa
   ficar acessível ao navegador, então quem controla a página decifra
   também. Com pública, o cliente sela e não reabre. O usuário aceitou e
   acrescentou o token do cartão ao envelope e a rotação por `key_id` —
   os dois entraram.
2. **Não construir credencial verificável offline.** Ele mesmo tinha
   pedido pra avaliar antes; avaliado, não compensa.
3. **Não criar valor novo em `status_entrega`.** Ele chamou essa de "a
   melhor das três" — a superfície de regressão daquela coluna é o
   projeto inteiro.

**A decisão de negócio que ele reverteu**, e que estava pendente desde
11/08: vale assinado passa a poder receber correção, desde que o documento
não mude. Ele deu a razão que faltava (proibir empurra a operação pra fora
do sistema — WhatsApp, papel, memória) e desenhou a separação entre *dado
assinado* e *dado operacional atual*, mais as três categorias de correção.
Regra 7 do CLAUDE.md reescrita. **A memória que dizia o contrário foi
substituída.**

## 34. Três bugs sérios achados no caminho

**O da fila offline é o pior, e estava em produção.** `NovaCorrida`
enfileirava com id = `payload.corridaId`; `RetornoCorrida` enfileirava com
**o mesmo** `corridaId`. E `enfileirarOperacao` faz `put`, que substitui
pela chave primária. Offline: cria a corrida, motoboy volta, fecha a
corrida → **o fechamento sobrescreve a criação**. A corrida nunca é criada,
e o fechamento seguinte faz `update` em 0 linhas, que no PostgREST não é
erro. Perda silenciosa, mesma armadilha já documentada no cancelamento.

Reproduzido no navegador antes de corrigir: enfileirei os dois e sobrou um
item só, do tipo `fechamento_corrida`. Corrigido dando chave própria ao
item da fila (`uuidv7`) e tornando a dependência explícita.

**Ordem dentro da transação do selo.** Eu tinha escrito o insert de
`romaneio_entregas` antes do UPDATE dos vales — e aí o trigger de
imutabilidade via o romaneio já selado e barrava o próprio selo. **Toda
saída falharia**, com o erro apontando pro lugar errado. Achado relendo o
que eu mesmo tinha escrito, antes de entregar.

**Comentário JSX virando texto na tela.** Ao envolver a linha da tabela
num `<Fragment>`, um `/* ... */` que era comentário JS dentro do
`return(...)` passou a ser filho do JSX — o React renderizaria o texto do
comentário dentro da tabela. **O `tsc` não pega**: é JSX válido.

## 35. Restrição física que mudou o formato do token

Ao dimensionar o cartão descobri que o token de 47 caracteres vira um Code
128 de 138mm, e cartão de crédito tem 85,6mm. Não cabe em formato nenhum.
Encurtei o segredo de 32 pra 20 caracteres (100 bits) → 82mm na densidade
mínima de leitor laser.

**Errei a conta na primeira vez**: estimei 420 módulos contando 35
caracteres, e o token tem 36. Rodei o codificador de verdade e são 431.
Corrigi nos dois lugares onde o número aparecia. A tela de emissão mostra
a largura em mm e avisa quando cai abaixo de 0,19mm/módulo.

## 36. Como testei sem conseguir logar

Não tenho credencial e não digito senha em nome de ninguém, então o fluxo
real (bipar → PIN → duas assinaturas → selar) **continua sem teste ponta a
ponta**. O que deu pra provar de verdade, e provei:

- **Canônico**: 15 casos em `scripts/canonico.spec.mts` (ordenação,
  pagamentos em bloco separado, TAB/LF virando espaço, acento preservado,
  UUID minúsculo, determinismo). Roda com `npx tsx`.
- **Envelope**: ponta a ponta em Node com o formato exato dos dois lados —
  832 bytes, PIN e token ausentes da forma serializada, privada abre e
  confere, chave errada não abre.
- **`offline_event_hash`**: extraí a função direto do `index.ts` da Edge
  Function (sem reescrever, pra o teste não virar terceira cópia) e
  comparei com o valor medido no navegador. Batem.
- **Código de barras**: `bwipjs.raw()` deu 431 módulos, batendo com a
  conta; e no navegador o canvas saiu com 1317px e 118 barras, que é
  exatamente o que Code 128 produz com 36 caracteres. Fundo transparente
  descoberto aí e corrigido com `backgroundcolor`.
- **Dexie v2→v3**: semeei um banco na v2, recarreguei a página e o item
  ganhou dono herdando `criadoPor`, com `criadoEm` preservado.
- **Assinatura desenhada**: renderizei o componente React de verdade no
  navegador com dados no formato do `signature_pad` — 814 pixels de tinta,
  caixa dentro dos 260×90, 96% da largura aproveitada, ponto único
  desenhando e `strokes` nulo não quebrando.
- **Migrations e Edge Function**: conferidas por HTTP, sem credencial
  nenhuma — RPC que existe devolve `42501` pro anon, RPC que não existe
  devolve `PGRST202`.

**Nota de método:** na primeira rodada o teste do upgrade do Dexie deu
negativo, e eu quase reportei como bug. Era defeito do teste — apaguei o
IndexedDB com a conexão do app ainda aberta. Refeito com `db.close()` e
reload, passou. É a terceira vez neste projeto que um teste "falha" por
causa do teste; conferir o instrumento antes de concluir continua valendo.

## 37. O 404 da Edge Function

Depois de o usuário aplicar tudo, chequei e a função dava 404 em todas as
variações de nome. Não era erro de URL: `criar-usuario` respondia 401 no
mesmo endereço. Ele então disse o nome que tinha usado — **`sync-romaneio`**,
não `sincronizar-romaneio`.

Adaptei o cliente ao nome dele e renomeei a pasta local junto, pra o
repositório espelhar o que está publicado. Confirmado que é o meu código
rodando: `OPTIONS` devolveu `ok`, que é a primeira linha do meu handler (o
`verify_jwt` da plataforma deixa OPTIONS passar).

**Lição de instrução:** eu tinha mandado `npm run dev` e `node scripts/...`
sem lembrar que **nem `node` nem `npm` estão no PATH desta máquina** — está
anotado neste arquivo desde 10/08 e eu passei por cima. E o snippet do
teste do canônico eu deixei metade como pseudocódigo, o que o tornava
impossível de rodar. Virou `scripts/conferir-canonico-no-console.js`,
completo.

## 38. O passo do Vault, e o bcrypt em 12

Ao tentar emitir a primeira credencial o usuário bateu em `Segredo
credencial_hmac ausente no Vault`. Não é bug: o segredo do HMAC não nasce
de migration nenhuma, é um passo manual de uma vez só no SQL Editor. As
migrations rodam sem erro porque a função só falha quando é chamada.

**A instrução foi minha e estava errada**: passei o comando dentro de um
`echo`, que só imprime o texto em vez de executar. É a segunda vez nesta
sessão que erro a forma de um comando — a primeira foi mandar `node` e
`npm` sem lembrar que não estão no PATH desta máquina, coisa que está
anotada neste arquivo desde 10/08. O comando certo, e o sintoma de
esquecê-lo, agora estão no CLAUDE.md.

A versão que ficou usa dois `gen_random_uuid()` concatenados em vez de
`gen_random_bytes`: dá 64 caracteres hex sem depender de o pgcrypto estar
no schema `public` ou no `extensions`, que varia por instalação.

**bcrypt subiu de custo 10 pra 12**, a pedido dele. Eu tinha escolhido 10
pesando o tempo no balcão; revendo, ele está certo — os ~300ms a mais
acontecem uma vez por saída, no passo do motoboy, e não no cadastro de
entrega, que é o fluxo cronometrado contra os 25 segundos. Num espaço de
6 dígitos, cada dobra de custo vale muito.

Sem migração de dado: o hash do bcrypt carrega o custo dentro dele, então
PIN antigo continua validando com o custo antigo e só sobe na próxima
redefinição. Reidratar seria impossível de qualquer jeito — exigiria
conhecer o PIN, e ninguém conhece.

**O ciclo de vida da credencial que ele descreveu já era o construído.**
Conferi item a item: cartão emitido sem PIN, ativação online obrigatória,
bcrypt no servidor, tela mostrando só "configurado", "Redefinir" sem
"Mostrar", auditoria de quem supervisionou sem registrar o PIN, e a
ativação exigindo as quatro coisas juntas (sessão interna + cartão físico
+ credencial sem PIN + motoboy digitando). A ativação dentro da primeira
Nova Corrida, em vez de cerimônia administrativa própria, era o que já
estava lá — e é o que ele disse preferir.

O que mudei foi vocabulário e visibilidade: "Aguardando ativação" no lugar
de "Aguardando o motoboy", e as colunas de emissão e último uso na tela de
Cadastros.

Vale registrar por quê a ativação é online por construção e não por
checagem de tela: `definir_pin` resolve o tenant por `current_tenant_id()`,
que depende de `auth.uid()`. Sem sessão a função não roda. Não há como
alguém contornar mexendo no frontend.

## 39. A tela dizia que aceitou antes de o servidor ter falado

Achado pelo usuário no primeiro teste real, e ele reagiu certo:
"inaceitável". Depois de criar o PIN, qualquer número de 6 dígitos
"passava" — a seção de Custódia liberava e o botão de confirmar
habilitava.

**O servidor nunca aceitou PIN errado.** O próprio teste dele provou:
`PIN errado` recusado, `PIN certo` aceito. Nenhuma saída foi selada
indevidamente, e o `bcrypt` guardou o que o motoboy escolheu.

O que estava errado era o gate da tela:

```js
const podeConfirmar = ... && !pinAceitavel(pin)
```

`pinAceitavel()` valida **formato** — seis dígitos, não sequência, não
repetido. Nada mais. A verificação de identidade só acontecia no
"Confirmar saída", depois de já ter colhido as duas assinaturas.

Pra quem está no balcão, formato bem escrito e identidade confirmada
eram a mesma coisa — e é assim que se lê uma tela que desbloqueia.

**A lição, que vale além deste caso:** validação de formato nunca pode
ocupar o lugar visual de validação de identidade. Se a tela desbloqueia,
ela está afirmando alguma coisa; aqui ela afirmava o que não sabia.

O mockup original do usuário (§16 do pedido) já tinha o passo que faltava
— `✓ Identidade confirmada` embaixo do campo de PIN. Eu simplesmente não
implementei, e ninguém notou até o primeiro uso real.

**Correção:** botão explícito "Confirmar identidade" que pergunta ao
servidor (`autenticar_credencial`) antes de liberar a Custódia.

Três decisões dentro dela:

- **Botão, e não conferência automática ao completar 6 dígitos.** Cada
  tentativa errada conta pro bloqueio progressivo; quem se atrapalha
  digitando queimaria o bloqueio do motoboy sem ter errado o PIN.
- **`autenticar_credencial` e não `autorizar_saida`.** A autorização vale
  2 minutos e é amarrada ao `document_hash` — emitida na conferência,
  expiraria enquanto o motoboy assina. Aqui só se pergunta "é ele?"; a
  autorização de uso único nasce fresca no confirmar. São duas passadas
  de bcrypt online (~600ms), barato perto de descobrir o erro depois das
  assinaturas.
- **Depois de criar o PIN, o motoboy digita de novo.** Antes o campo
  ficava vazio e qualquer coisa passava; agora ele passa pelo servidor, o
  que prova que quem acabou de escolher lembra do que escolheu.

Offline não há como conferir (o bcrypt vive no servidor), e a tela passa
a dizer isso — "PIN guardado, mas **não conferido**" — em vez de parecer
que conferiu.

## 40. O que só o uso real achou

Três defeitos que passaram por revisão de leitura, `tsc`, lint e build, e
só apareceram quando o usuário rodou a tela com um cartão na mão. Vale
listar juntos porque a causa comum é a mesma: **nada disso é detectável
sem executar.**

**A FK que fazia nenhum selo funcionar.** `selar_romaneio_interno`
gravava `consumida_por_romaneio = p_romaneio_id` no consumo da
autorização, ANTES do `insert into romaneios`. A coluna tem FK pro
romaneio e a checagem é imediata — a linha não existia, o Postgres
recusava, a transação inteira ia embora.

Consequência: nenhuma saída selava, nem online nem pela fila. E o sintoma
apontava pro lugar errado — a tela dizia "registrada offline", porque
qualquer exceção no selo caía no `catch` que existe pra queda de rede.

Corrigido partindo em dois: o `claim` (`consumida_em`) continua cedo,
porque é ele que garante uso único e recusa antes de mexer em vale
nenhum; só o ponteiro `consumida_por_romaneio` foi pra depois do insert.
Inverter tudo seria pior — abriria janela com a corrida já criada e a
autorização ainda recusável.

Nada ficou pela metade: era exceção, então todo rollback foi completo.

**A tela chamando recusa do servidor de "offline".** Consequência do
anterior, e defeito por si só: mandar pra fila algo que o servidor
recusou faz o caixa ir embora achando que deu certo, e a fila repete o
mesmo erro pra sempre. Agora erro do PostgREST (que vem com SQLSTATE) é
distinguido de falha de `fetch` — o primeiro aparece na tela, só o
segundo vira fila.

**A lista de vales servindo dado velho.** A query filtrava certo
(`pendente` + sem corrida), mas ninguém invalidava `vales-para-saida`.
Com cache de 60s e retenção de 30min, a tela seguia oferecendo vales que
acabaram de sair — e mandar o mesmo vale de novo custa duas assinaturas e
um romaneio de conflito. É provavelmente como o `R-000002` deste teste
nasceu.

Três frentes na correção: a chave entrou em toda operação da fila que
muda quais vales estão pendentes e no selo online (que não passa pela
fila); `staleTime` foi a zero, contra o padrão do app, porque esta lista
decide o que sai fisicamente e é aberta uma vez por saída; e vale que já
está numa operação DA FILA some da lista — offline ele continua
`pendente` no servidor, então sem isso sairia duas vezes de verdade.

Ordenação virou do mais novo pro mais antigo, a pedido: o vale
recém-lançado é o que vai sair agora e estava no fim.

## 41. Uma armadilha de desenvolvimento que custou um diagnóstico

O botão "Já anotei, dispensar" não fazia nada. Não era bug de código:
**módulo velho em memória**. O componente recarregou por HMR (por isso o
botão novo aparecia), mas `filaOffline.ts` continuou sendo a versão sem a
função — clicar disparava `TypeError` e nada acontecia.

Reproduzi no painel: antes do reload, `descartarItemTerminal` vinha
`undefined`; depois, a função funciona (item terminal descartado, item
não-terminal recusado). `Ctrl+Shift+R` resolve, e em produção não existe.

Fica junto do fenômeno de HMR espúrio do OneDrive já anotado mais abaixo:
nesta máquina, **estado de tela não é prova de estado de código**. Antes
de investigar comportamento estranho em dev, recarregar do zero.

## 42. Primeira saída selada de ponta a ponta

Depois das correções acima, o usuário fez uma saída limpa: cartão bipado,
PIN conferido pelo servidor, duas assinaturas, **romaneio selado**. O
`R-000001` foi conferido pelo chevron do vale — duas assinaturas
renderizadas e a página do romaneio abrindo.

Isso fecha a prova que faltava desde a etapa 3: a cadeia inteira funciona
com dado real, online.

**Correção de 2026-08-19, achada pelo verificador de hash:** o `R-000001`
está gravado com **`modo = 'offline_sincronizada'`**, não `online`. A
conclusão deste item sobrevive — a cadeia funciona, e o caminho online
está provado por seis outros romaneios (`R-000003`, `05`, `07`, `08`,
`11`, `12`). O que estava errado era a citação.

A explicação mais provável, e ela é **hipótese, não fato apurado**: a
selagem caiu no caminho offline (foi pra fila e sincronizou depois) e eu
registrei "online" pelo que a tela mostrava. É exatamente o defeito do
item 40 — *"a tela chamando recusa do servidor de offline"* —, que estava
em vigor naquele dia e foi corrigido logo em seguida.

Vale registrar o método: isto não apareceu em revisão de código, nem em
teste, nem lendo o NOTAS. Apareceu porque alguém finalmente **consultou o
banco** com uma pergunta específica. É o mesmo padrão do item 51 (a aba
"Transferências" virando "s"): defeito que nenhuma camada de código
mostra.

**Ainda não testado (quando este item foi escrito):** o caminho offline
ponta a ponta (registrar sem rede, religar, ver a fila drenar pela
`sync-romaneio`), e o `conferir-canonico-no-console.js`.

*Atualização de 2026-08-17:* o canônico **foi conferido e bateu** —
`iguais: true`, 873 bytes sobre 3 vales reais. O caminho offline deixou
de estar apoiado numa suposição não verificada; falta só exercitá-lo de
ponta a ponta, que agora é o item de maior risco em aberto. Ver "Estado
em 2026-08-17" no fim do arquivo, inclusive pra ressalva de cobertura
(os 3 vales sorteados não tinham acento nem transferência).

**Dados de teste que ficaram:** `R-000001` (selado, válido) e `R-000002`
(conflito, dos mesmos vales — nasceu do bug da FK). Entram na limpeza que
o NOTAS já lista como pendência antes do uso real.

## 43. O token virou numérico, e o motivo é contraintuitivo

O usuário voltou com uma especificação física boa (CR80 de 85,6 × 54mm,
área de 75 × 16mm pro código, 5mm de margem, zona de silêncio de 10X) e
uma proposta de encurtar o token de ~48 pra ~34 caracteres, trocando
base32 por base64url.

Duas correções saíram da medição, feita com o codificador de verdade e
não estimada:

**O token já não tinha 48 caracteres** — eu o havia encurtado pra 36
quando dimensionei o cartão na etapa 2. Ele estava avaliando o exemplo da
spec original.

**E nem a proposta dele cabia.** A 75mm com piso de 0,19mm por módulo:

    v1   DCM1.<10>.<20> base32   36 car → 431 mod → 0,174mm  NÃO
    b32  DC2.<6>.<24>            35 car → 420 mod → 0,179mm  NÃO
    b64  DC2.<6>.<22>            34 car → 409 mod → 0,183mm  NÃO
    v2   2<10><31> só dígitos    42 car → 266 mod → 0,262mm  SIM

**Code 128 tem um modo numérico (Set C) que empacota dois dígitos por
símbolo.** Texto gasta 11 módulos por caractere, seja qual for o
alfabeto — trocar base32 por base64 reduz caracteres, não módulos o
bastante. Um token só de dígitos, mesmo com MAIS caracteres, ocupa quase
metade da largura. O bwip-js troca de set sozinho.

Corolário que decidiu o formato: **sem separadores.** Um ponto no meio
quebra a corrida numérica e força troca de set — `DC2.0102…` com pontos
volta pra 398 módulos e deixa de caber. Campos de largura fixa.

E some de graça o problema que o alfabeto Crockford existia pra mitigar:
com só dígitos não há `O`/`0` nem `I`/`1`/`L`.

**Cartão v1 continua valendo.** `public_id_do_token` (SQL) e
`publicIdDoToken` (TS) conhecem os dois formatos e são os únicos pontos
que sabem disso.

Detalhe pequeno com razão: `gerar_digitos` faz rejeição amostral (descarta
byte ≥ 250). Sem ela os dígitos 0-5 sairiam em 60,96% em vez de 60% —
medido em 300 mil amostras — porque 256 não é múltiplo de 10. No base32
do v1 isso não existia: 256 é múltiplo exato de 32.

## 44. O cartão em SVG, e um erro que só a medição pegou

Imprimir pelo navegador não dá controle de escala pra um CR80, então a
tela passou a oferecer download do `.svg` no tamanho físico.

Três decisões que valem registro:

- **SVG e não canvas.** Eu vinha renderizando canvas com `scale: 3` e
  esticando por CSS até 90mm, o que reamostra. Em vetor a escala é exata.
- **Duas passadas no bwip-js.** Ele decide a proporção a partir da altura
  em mm, e eu precisava do inverso: dada a largura de 75mm, qual altura
  natural faz as barras saírem com 16mm num escalonamento **uniforme**.
  Sem isso seria preciso esticar na vertical.
- **`scale: 1`.** Sem isso a unidade do viewBox é pixel (escala 2 por
  padrão) e a conta da largura do módulo sai **pela metade** — e é ela
  que decide se o leitor lê. Peguei isso conferindo, não pensando.

**O erro que a medição pegou:** a primeira versão pôs o token em fonte 10,
e o texto saiu com **81,8mm — mais largo que o cartão de 75mm**,
escapando pra fora do SVG. Teria ido pro software de impressão assim.
Testei seis tamanhos e ficou fonte 8: texto de 60,4mm, 7,3mm de margem de
cada lado, tudo dentro da caixa, cartão em 75 × 20,2mm.

O token vive DENTRO do SVG (não numa linha de HTML ao lado), então o que
está na tela é byte a byte o que o arquivo contém. Só código de barras e
token — sem nome de motoboy e sem filial, a pedido: cartão perdido não
deve dizer de quem é nem de onde veio.

**Ressalva que ficou escrita na tela:** o arquivo É o cartão. Quem tiver
ele imprime uma cópia que funciona, e o desenho todo parte de o token
existir só no papel. Um `.svg` no disco — ainda mais dentro do OneDrive —
estende isso indefinidamente. A tela avisa pra apagar depois de imprimir.

## 45. O cache de dependências do Vite

`Failed to fetch dynamically imported module: .../bwip-js_browser.js?v=4d1215e6`
ao emitir um cartão. Não era bug do app.

O Vite descobre dependência de `import()` dinâmico só no instante em que
ele roda, e aí re-otimiza o cache no meio da sessão. A página aberta
continua segurando a URL com o hash antigo, que passa a responder 504.
Confirmado por HTTP: o hash atual serve 200, o antigo dá 504.

`optimizeDeps.include` no `vite.config.ts` faz a descoberta acontecer na
inicialização, antes de qualquer página existir. As quatro bibliotecas
pesadas entraram juntas — corrigir só a que falhou deixaria a mesma
armadilha esperando no exceljs e no jspdf. O build de produção não muda:
conferido que os quatro continuam em chunks separados.

Junto com o item 41 (módulo velho em memória depois de HMR), fica o
padrão: **nesta máquina, comportamento estranho em desenvolvimento merece
um reload — e às vezes um restart do servidor — antes de virar
investigação.**

## 46. O cartão em PDF, e por que não bastava o .svg

O usuário perguntou duas coisas: se o código de barras está o mais nítido
possível, e como mandá-lo pra gráfica sem perder qualidade.

**A primeira pergunta tem uma resposta que dispensa trabalho:** o arquivo
é vetor, não tem resolução, não existe versão "mais nítida" dele. Mandar
PNG de 1200 dpi seria pior, nunca melhor. O que decide se o leitor lê é
um número físico — 0,262mm por módulo contra um piso de 0,19mm, ~38% de
folga — e esse número já está no máximo que a largura do CR80 permite.

**A segunda revelou dois furos que não são do desenho, e sim do trajeto
até a gráfica.** Nenhum dos dois aparece na tela; os dois só aparecem
depois de impresso:

- **A fonte.** O token no `.svg` é texto vivo em Courier New. Máquina sem
  a fonte substitui, a largura muda, e 60,4mm dentro de 75mm viram algo
  que escapa do cartão. A gráfica imprimiria assim sem desconfiar — é
  exatamente o mesmo erro que a primeira versão do `.svg` cometeu com
  fonte 10 (81,8mm), só que dessa vez acontecendo na máquina deles,
  depois de sair daqui, onde nenhuma medição minha alcança.
- **O preto.** RGB(0,0,0) convertido por RIP vira preto composto das
  quatro cores. Erro de registro é da ordem de décimos de milímetro — a
  MESMA escala do módulo — então borra a borda das barras.

Os dois se resolvem no formato: PDF com Courier base-14 (métrica é do
formato, não da máquina) e preto gravado como CMYK 0/0/0/100. Vira botão
"Baixar PDF" ao lado do "Baixar .svg", `src/lib/cartaoPdf.ts`.

**A decisão que mais importa ali não é sobre PDF.** As barras são LIDAS
do mesmo SVG que está na tela, não recodificadas: `barrasDoSvg` interpreta
os `<path>` do bwip-js (linha vertical no centro de cada barra, com
`stroke-width` = largura em módulos, logo `cx ± w/2`). Chamar o bwip-js de
novo pro PDF criaria duas codificações do mesmo token capazes de divergir
sem ninguém notar. É o problema das duas implementações do canônico — com
a diferença de que aqui dá pra **evitá-lo**, e não só administrá-lo.

**Como testei** (`npx tsx scripts/cartao-pdf.spec.mts`, 25 casos): página
com 212,60pt × 57,24pt, que é 75,00 × 20,19mm exatos; `0. 0. 0. 1. k` no
content stream descomprimido; 74 retângulos pra 73 barras mais o fundo;
`/BaseFont /Courier` sem arquivo de fonte embutido; nenhum `rg`; zonas de
silêncio começando em 10 e terminando em 276.

E o caso que vale mais que os outros 24: as 73 barras lidas do SVG,
comparadas **uma a uma** com o `raw()` do bwip-js. Todo o resto confere o
SVG contra ele mesmo — se a minha leitura do `<path>` estivesse errada de
um jeito consistente (meio módulo pra esquerda, por exemplo), passaria em
tudo e o cartão sairia deslocado. `raw()` é outra saída do codificador,
então é uma segunda opinião de verdade.

**Duas correções que a medição impôs, de novo:**

- `orientation: 'landscape'` não é decoração. Com `'portrait'` o jsPDF
  ordena o `format` pelo menor lado e a página sairia 20 × 75, em pé.
- O primeiro teste ACUSOU FALHA no preto CMYK e o PDF estava certo: o
  jsPDF escreve `0.` e `1.`, com o ponto e sem casa decimal, e meu regex
  exigia dígito depois do ponto. É a quarta vez neste projeto que um
  teste "falha" por defeito do próprio teste. Conferir o instrumento
  antes de concluir continua sendo a regra mais lucrativa daqui.

**O que NÃO mudou, de propósito:** o formato do token, a largura do
módulo, a geometria e o `.svg`, que continua sendo o desenho de origem e
segue disponível pra quem preferir editar em vetor. O PDF é sobre o
trajeto, não sobre o desenho.

Build conferido: `jspdf` continua em chunk próprio (399 kB, só desce ao
clicar) e `cartaoPdf.ts` não puxa nada pesado pro bundle inicial.

## 47. Token v3 — encurtar pra poder testar em papel

Logo depois do PDF ficar pronto, o usuário disse que estava achando o
código muito longo e que precisava **testar num papel antes de mandar
pra gráfica**: "precisa ser mais leve, mas mantendo segurança".

**A primeira metade da resposta contraria a intuição, e é a lição do item
43 de novo:** número de caracteres não é o que deixa o código largo. O v1
alfanumérico tinha 36 caracteres e não cabia; o v2 numérico tem 42 e cabe
com folga. Então "está muito longo" não se resolve olhando o token.

**A segunda metade é que encurtar ajuda mesmo — só que por outro motivo.**
O número que decide o teste em papel não é o milímetro por módulo, é
**quantos pontos da impressora cabem num módulo**:

    dígitos  módulos  mm/módulo  pontos/módulo @300dpi  folga sobre o piso
    42 (v2)      286     0,2622                    3,1                +38%
    30           220     0,3409                    4,0                +79%
    26           198     0,3788                    4,5                +99%
    22 (v3)      176     0,4261                    5,0               +124%

A 3,1 pontos por módulo o arredondamento da impressora já vale ±16% na
largura da barra — e papel comum espalha mais tinta que PVC. A 5,0 isso
deixa de importar. Ou seja: o pedido tinha razão, mas por uma razão
diferente da que o motivou.

**O lado da segurança, quantificado antes de escolher.** A 50 tentativas
por segundo contra o servidor, com 30 cartões ativos:

    segredo   bits   um cartão específico   qualquer cartão
    31 (v2)    103              absurdo            absurdo
    19          63       3 bi de anos       106 mi de anos
    15 (v3)     50        317 mil anos        11 mil anos

Levei as três opções ao usuário com esses números; ele escolheu **22
dígitos** (`3` + public_id de 6 + segredo de 15). Eu recomendava 26, por
retorno decrescente — mas a escolha dele é defensável e o argumento é o
mesmo que já está escrito no projeto desde o v1: **quem protege a
credencial é o PIN, o bloqueio progressivo e a revogação**, não a
entropia do cartão. Acertar o token não abre nada sozinho.

**`public_id` caiu de 10 pra 6 dígitos** sem custo: ele não é segredo
(fica em claro na tabela, é a chave de busca) e quem autentica é o
`token_hash` conferido logo depois. Não colide com os de 10 dígitos já
emitidos — comprimentos diferentes.

### Três coisas que a medição pegou e que eu não teria pensado

**1. A altura da barra estourou a especificação.** O teste acusou 16,19mm
onde a spec diz 16mm. Causa: o bwip-js só produz altura em número inteiro
de módulos, e as duas passadas deixavam ELE arredondar. Com o v2 o módulo
era pequeno e o erro sumia no ruído; com o v3 ele é 1,6x maior e o erro
apareceu. O alvo virou explícito e arredondado **pra baixo**
(`Math.floor`), e as barras passaram a sair com 15,77mm — dentro, nunca
fora. Bug latente desde a etapa 2, revelado só porque o módulo cresceu.

**2. A tabela de formatos do CLAUDE.md estava sobre base errada.** Ela
dividia 75mm pelos módulos do código **sem as duas zonas de silêncio**,
que ocupam 20 módulos dentro dos mesmos 75mm. Por isso o cabeçalho da
migration do v2 diz 0,282mm enquanto a tela sempre mostrou 0,262mm — a
tela divide por `unidadesLargura`, que já inclui o padding. Nada foi
decidido com o número errado (o v2 cabia pelas duas contas), mas a tabela
foi corrigida.

**3. Os números alfanuméricos daquela tabela não se reproduzem.** Fui
remedir as linhas do v1 e das propostas base32/base64 e deram diferente
do registrado. O motivo é real e interessante: **num token alfanumérico o
bwip-js troca pra Set C sozinho nos trechos de dígitos**, então a largura
depende da mistura de caracteres que o sorteio produzir — dois cartões do
mesmo formato podem sair com larguras diferentes. Aquelas linhas viraram
aproximações declaradas como tais, e isso virou argumento a favor do
formato numérico: **largura previsível vale mais que largura pequena em
média**, quando o que está em jogo é caber num cartão físico.

### O que mudou de arquivo

- `supabase/migrations/20260817130000_token_v3.sql` — parser com os três
  formatos e emissão em v3. **Ainda não aplicada** (ver pendências).
- `src/lib/tokenCartao.ts` **novo**: o parser saiu de `data/credenciais.ts`
  pra `lib/`, **sem importar nada**. Ele é gêmeo de uma função SQL, e o
  projeto já aprendeu com o canônico que gêmeo que só roda dentro do app
  é gêmeo que ninguém confere. `credenciais.ts` reexporta, então nenhum
  call site mudou.
- `scripts/cartao-pdf.spec.mts` — 34 casos agora, incluindo 9 do parser
  (os três formatos válidos e seis entradas que têm que ser recusadas).
- `scripts/cartao-de-teste.mts` **novo** — gera cartão com token fictício
  pro teste de impressão. Existe porque testar impressora não deveria
  custar uma credencial de verdade: emitir pelo app revoga o cartão
  anterior e o token só aparece uma vez. O token de teste é v3 bem
  formado (o leitor lê, o formato se prova) mas **não existe no banco**,
  então bipá-lo devolve "credencial não reconhecida" — exatamente o que
  se quer de uma cobaia.

**Cartões v1 e v2 continuam válidos.** Nenhum é reemitido.

### Fecho: o v3 foi impresso e lido no mesmo dia

Migration aplicada e conferida no banco (7 casos do parser + `pg_proc`
confirmando a `emitir_credencial` nova), e logo depois o teste que
motivou tudo: **cartão v3 impresso em laser, papel comum, e o leitor da
farmácia transcreveu os 22 dígitos exatos.**

Vale registrar o que isso prova e o que não prova. Prova a cadeia física
inteira — formato do token → largura do módulo → impressão → leitura —
com hardware real, e no substrato mais difícil (papel espalha mais tinta
que PVC, então a gráfica tende a sair melhor que isto).

**Não prova que o v3 era necessário.** O v2 talvez passasse igual;
ninguém testou. O que o v3 comprou foi margem — 2,24x o piso do leitor
contra 1,38x —, e margem não se testa no dia bom, se cobra no dia ruim:
impressora pior, cartão sujo, leitor velho. É honesto dizer que a
decisão foi de folga, não de necessidade demonstrada.

## 48. A saída offline rodou ponta a ponta — e falhou no último passo

Primeira execução real do caminho offline. **Toda a infraestrutura
passou; falhou só a conferência do PIN**, e vale entender por que isso é
um resultado bom.

### O que cada erro que NÃO aconteceu prova

A Edge Function recusa em etapas, com `motivo` distinto em cada uma. Como
o processo foi até o fim e parou só na autenticação, cada etapa anterior
ficou provada:

| motivo que não veio | fica provado |
|---|---|
| `envelope` | **o par de chaves confere** — `VITE_ROMANEIO_PUBKEY` e o secret `ROMANEIO_KEYS` são o mesmo par |
| `payload_alterado` | os gêmeos do `offline_event_hash` concordam **em produção**, não só no teste |
| `envelope_trocado` | as amarrações `operationId`/`documentHash` bateram |
| `outro_usuario` | o gate de dono da fila aceitou a conta certa |
| 401/403 | o `Authorization` explícito chegou (o bug histórico do `functions.invoke`) |

Ou seja: selar offline → fila → drenar sozinha ao voltar a rede → Edge
Function → abrir envelope → conferir payload → transação → registrar o
resultado. **Tudo funcionou.** O único passo que falhou foi o `crypt()`
do PIN.

Era o par de chaves o maior desconhecido — a privada foi apagada desta
máquina em 17/08 e não havia como conferir o pareamento sem uma execução
real. Confere.

### A prova preservada, verificada com dado real

`R-000004`, `status='conflito'`, `modo='offline_sincronizada'`, com
`conflito.motivos = [{autenticacao_falhou, pin_incorreto}]` e **os traços
das duas assinaturas dentro**: 1 traço do caixa, 4 do motoboy, com pontos
e timestamps.

Isto é a promessa central do desenho de conflito, agora verificada em vez
de apenas escrita: *a retirada física aconteceu, e essa prova não pode
sumir*. O selo foi recusado e mesmo assim nada se perdeu — porque
`selar_romaneio_interno` devolve `jsonb` discriminado em vez de levantar
exceção nos casos previstos, e por isso o registro do conflito commitou.

E a classificação funcionou: recusa por PIN virou item **terminal**, sem
retry. Sem isso, cada retentativa queimaria uma tentativa e o bloqueio
progressivo derrubaria o motoboy sozinho.

### Por que o PIN não conferiu — e por que não é bug

A credencial estava sendo ativada: o cartão não tinha PIN. Como
`definir_pin` depende de `auth.uid()`, criar PIN é **online por
construção**. Então o fluxo foi: offline → bipa → "precisa de internet" →
liga a rede → cria o PIN → desliga a rede → digita o PIN de novo → assina
→ confirma.

Esse segundo toque nunca passou pelo servidor. Offline não há como
conferir (o bcrypt vive lá), então a tela aceita qualquer PIN bem formado
e sela — exatamente como documentado ("PIN guardado, mas não conferido").
Os dois toques diferiram.

**Conferi que não é defeito de estado**, porque a hipótese óbvia seria o
PIN selado não ser o digitado: `handleCriarPin` limpa o campo e zera
`pinConferido`; o input trava (`disabled={pinConferido !== null}`) depois
de confirmado **e** qualquer edição zera a confirmação. Dupla proteção. O
PIN selado é o digitado.

Linha do tempo no banco, batendo com isso: `credencial_emitida` 04:27 →
`credencial_pin_definido` 04:41 → `credencial_pin_incorreto` 04:43,
`tentativas = 1`.

**Confirmado logo depois:** o usuário refez o fluxo com o PIN que
conhecia, e o servidor aceitou — selo concluído, vales em rota. Ou seja,
o PIN gravado por `definir_pin` estava correto o tempo todo; o que
divergiu foi o segundo toque, offline, que ninguém tinha como conferir.
Fecha a hipótese de defeito e confirma a de digitação.

### O que este teste NÃO provou, e é o que falta

**O caminho feliz.** `selar_romaneio_interno` com `modo =
'offline_sincronizada'` e PIN correto nunca rodou: não houve corrida
criada, vale nenhum foi pra `em_rota`, nenhum `final_hash` foi calculado
por esta via. O que se provou foi todo o transporte e o caminho do
conflito.

Repetir com um PIN de que se tenha certeza fecha o item. Cuidado ao
repetir: **já há 1 tentativa gasta** na credencial `171233`; a 3ª dispara
30s de bloqueio. Na dúvida, redefinir o PIN pelo Cadastros sai mais barato
que adivinhar.

### O gap que isto expôs

Um PIN **recém-criado** é qualitativamente diferente de um já em uso: a
única evidência de que está certo é a memória de quem o digitou, e offline
não há como testá-la. Como criar PIN exige internet por construção, quem
acabou de criar estava online segundos antes — dá pra exigir **uma**
confirmação online antes de permitir selar offline, e isso custa nada.

O caso geral (motoboy erra o PIN numa saída offline comum) **não tem
conserto**: guardar qualquer hash local de um PIN de 6 dígitos seria
quebrável em segundos, e é por isso que ele só vive no servidor. O preço
de errar continua sendo um romaneio em conflito — que é caro, mas é o
desenho, e a prova fica guardada.

## 49. "Não consigo ficar offline" era bug do app, não do DevTools

Depois do teste do item 48, o usuário foi repetir e relatou que a tela
"aparece sempre online", sem conseguir alternar. Não era o DevTools.

**O app não tinha listener de conectividade nenhum.** `navigator.onLine`
era lido DENTRO do JSX da Nova Corrida em dois pontos — o aviso "Sem
internet" e o rótulo do botão. Ler assim devolve o valor certo, mas só no
instante do render; e como nada assinava `online`/`offline` (o único
listener do projeto é o da fila, e só de `'online'`, pra drenar), o React
não tinha motivo pra renderizar de novo. Quem tirasse a rede com a tela
já aberta continuava vendo **"Confirmar saída"** e nenhum aviso.

O comportamento por baixo estava certo — `handleConfirmar` lê
`navigator.onLine` na hora e teria tomado o caminho offline. **O que
estava errado era a tela afirmar o contrário do que ia fazer.** Isso é da
mesma família do §39: lá o botão liberava dizendo "identidade conferida"
tendo checado só o formato; aqui ele prometia selo imediato quando o
clique só ia enfileirar. Nos dois casos a tela afirma o que não sabe, e
nos dois o preço é pago depois de colher duas assinaturas.

### Reproduzido antes de corrigir, lado a lado

Montei os dois componentes na mesma página, com o React do próprio app,
e forcei a queda como o app a enxerga (`navigator.onLine` sobrescrito +
`dispatchEvent`):

    navigator.onLine = false
      versão antiga (lendo no render) → "Confirmar saída"        ← mentia
      versão nova (useOnline)         → "Registrar saída offline"

É o mesmo método do §22, quando reapliquei `white-space: nowrap` por CSS
pra medir o "antes" na mesma tela: sem o par, eu teria lido só o "depois"
e concluído certo por sorte.

### A correção

`src/lib/useOnline.ts`, com `useSyncExternalStore` — e não
`useState` + `useEffect`, que deixa uma janela entre o primeiro render e
o efeito assinar, onde um evento se perde. Medido: 1 render inicial →
evento `offline` → 2 renders → evento `online` → 3 renders. Sem loop.

**A separação que importa e que ficou escrita nos dois arquivos:** o hook
é pra EXIBIÇÃO; as decisões (`handleConfirmar`, criar PIN, conferir
identidade) continuam lendo `navigator.onLine` na hora da ação. Entre o
render e o clique a rede pode mudar, e ali o que vale é o instante da
ação. Trocar tudo por estado reativo seria "consertar" a parte que já
estava certa.

### Como forçar offline sem depender do DevTools

O app decide só por `navigator.onLine`, então dá pra simular no console:

    Object.defineProperty(navigator, 'onLine', {configurable: true, get: () => false})
    window.dispatchEvent(new Event('offline'))

e desfazer com `delete navigator.onLine` + `dispatchEvent(new Event('online'))`
— o `delete` remove a propriedade própria e revela de volta o getter
nativo do prototype (conferido).

**Não é equivalente ao DevTools**, e a diferença importa: aqui a rede
continua funcionando de verdade, então isto exercita a lógica de decisão
do app mas não a falha de rede em si. Pro teste fiel, o DevTools continua
sendo o certo. Pra destravar quando ele não coopera, isto serve.

## 50. Cinco defeitos que só o uso offline de verdade achou

O usuário rodou o fluxo offline como ele aconteceria na farmácia — lançar
vale sem rede, mandar sair, religar — em vez do roteiro mínimo. Apareceram
cinco coisas, e elas se dividem em uma limitação de arquitetura e quatro
bugs.

### 1. Vale criado offline não pode sair offline — e isso é arquitetura

Foi o primeiro sintoma relatado ("o vale criado offline não passa para a
tabela de vales selecionáveis"). A hipótese natural, que o próprio usuário
levantou, era cache: "acho que para carregar os vales precisa de internet,
eles não ficam salvos".

Cache é parte, mas não é a causa. **`numero_vale` é gerado pelo BANCO** —
sequência `V-000001…`, regra antiga do projeto pra o caixa nunca inventar
número — e o número **entra no canônico**, conferido nos dois lados
(`textoCanonico(vale.numeroVale)` no TS, `texto_para_canonico(numero_vale)`
no SQL). Vale que ainda não subiu não tem número, logo não tem como
constar do documento que as duas partes assinam.

Ou seja: **guardar a lista localmente não resolveria**, porque o que falta
não é o dado, é o número. Qualquer "solução" que gerasse número no cliente
quebraria a sequência do banco ou o documento assinado.

As alternativas foram avaliadas e nenhuma compensa: número no cliente
quebra a regra e arrisca colisão; trocar o número pelo UUID no canônico
mexeria nas duas implementações gêmeas — a área mais frágil do projeto —
pra tirar do romaneio impresso justamente o identificador que um humano
lê. Fica como está, **mas a tela passou a dizer**, com a contagem de
quantos vales estão nessa situação, em vez de deixar o caixa concluir que
o lançamento sumiu.

### 2. "Nenhum vale pendente pra sair agora" mentia

Com a página recarregada offline não há lista nenhuma, e a tela exibia
aquela frase — que é uma **afirmação sobre o estoque de vales**, não sobre
a rede. É o mesmo defeito do §39 e do §49: a tela afirmando o que não
sabe. Agora distingue os três casos (sem rede e sem lista / falhou com
rede / lista vazia de verdade).

### 3. A lista não filtrava por filial — e isso custou um conflito

`R-000009` falhou com `V-000032 — é de outra filial`. Não era bug de
sincronização: `buscarValesParaSaida` não tinha filtro de loja nenhum,
confiando só na RLS. Pro caixa e pro gerente a RLS prende à própria
filial, mas o **admin enxerga o tenant inteiro** — então a tela oferecia
vale de outra filial numa saída que `selar_romaneio_interno` recusa
sempre (`e.loja_id <> p_loja_id` → `outra_filial`).

Filtro por `loja_id` no cliente. Não é "confiar em filtro de cliente" nem
redundância com a RLS: o servidor continua sendo quem recusa. O ponto é
não OFERECER o impossível, porque descobrir custa duas assinaturas
colhidas, o motoboy já a caminho e um romaneio de conflito.

Repare que este bug **só aparece testando como admin**. É o espelho do
§23, onde só testando como gerente de verdade a restrição ficou provada:
o papel de quem testa muda o que dá pra ver.

### 4. A fila podia travar pra sempre, em silêncio

O mais grave. O usuário relatou uma saída offline que, depois de religar,
"ainda está para sincronizar, não saiu da fila" e com o botão "tentar
novamente" inerte.

`processarFilaOperacoes` abre com `if (processando) return`. Isso era uma
trava **de mão única**: `processando` só volta a `false` no `finally`, e
se algum `await` nunca resolver, o `finally` nunca roda. **Não há timeout
em ponto nenhum da cadeia** — `functions.invoke` não tem, `fetch` sem
`signal` espera indefinidamente. Um request pendurado congela a fila
inteira até um F5.

E o sintoma não parece erro: o item fica `pendente` ("Na fila"), com
`tentativas` em 0 e nenhuma mensagem, e não é tentado nem ao reconectar.

Correção: `processando` ganhou relógio (`LIMITE_RODADA_MS`, 90s). Passado
o limite, a rodada seguinte segue mesmo assim. Duas rodadas se
sobreporem é seguro — toda operação da fila é idempotente por construção,
que é exatamente a propriedade construída na sessão da fila offline. Fila
parada pra sempre não é segura.

### 5. O botão "Tentar agora" não alcançava o item preso

Consequência do anterior e defeito por si só:

    disabled={comErro.length === 0}

O item preso está em `pendente`, não em `erro` — porque nunca chegou a ser
executado. Então o botão ficava desabilitado justamente pro caso que mais
precisa dele. **Item sem erro escrito nele é o mais aflitivo de todos**:
não há o que ler, e a única ação disponível está cinza.

Agora habilita pra qualquer item retentável (`pendente` ou `erro`), e
`tentarAgora` zera `processando` antes de rodar — senão o clique cairia no
guard e não faria nada, que é a sensação exata de botão quebrado que foi
relatada.

**Verificado no navegador** semeando um item idêntico ao do relato
(`pendente`, 0 tentativas, `proximaTentativaEm` no futuro): regra antiga
do botão → DESABILITADO; regra nova → HABILITADO; e depois de
`tentarAgora`, `proximaTentativaEm` foi de `2026-08-18T16:10` pra
`1970-01-01`, ou seja, destravou.

Na primeira rodada desse teste o `destravou` deu `false` — **e era o
módulo velho em memória**, o fenômeno do §41. Recarreguei e passou. É a
quinta vez neste projeto que um teste "falha" por causa do instrumento;
conferir o instrumento antes de concluir continua pagando.

## 51. A aba "Transferências" virou "s" — e não era o app

O usuário mandou print: a barra de abas mostrando `Hoje | Histórico | s |
Documentos | …`. O rótulo, não o conteúdo.

**O que eu descartei antes de achar, e por que cada descarte importou:**

- **O fonte está íntegro.** Linha 71 do `Painel.tsx` é a string literal
  `Transferências`, com os codepoints conferidos um a um
  (`…66 65 72 ea 6e 63 69 61 73`), e o arquivo não é tocado desde agosto
  — nada do que eu mexi no dia passou perto.
- **Não é layout.** Montei os 8 gaveteiros REAIS em 1180, 900, 760, 640,
  520, 420 e 360px. A `TabsList` nunca encolhe (fica em 679px e
  transborda o container em vez de cortar), e a caixa do rótulo mede
  110px pra um texto de 96px. **Nenhuma largura corta.**
- **Não é o bundle.** `index-*.js` do build de produção contém
  `Transferências` inteiro.
- **Não é o app.** Os mesmos componentes, renderizados no meu navegador,
  saem corretos.

Quatro descartes apontando pra fora do código. E a pista que fechou:
**"s" é exatamente o que sobra de "Transferências" quando se remove
"Transferência"** — não é truncamento, é substituição.

### A causa

`index.html` tinha **`<html lang="en">`**, sobra do template do Vite que
ninguém trocou. Página declarada em inglês, conteúdo todo em português: o
Chrome conclui que precisa TRADUZIR e reescreve os nós de texto. Um
render isolado em navegador sem tradução ativa nunca mostraria isso.

### Por que isso é mais grave que um rótulo torto

Traduzir esta tela é reescrever **número de vale, valor, endereço e
status** — num sistema cuja regra central é a tela nunca afirmar o que
não sabe. É a mesma família dos §39, §49 e §50 (a tela dizendo o que não
sabe), com um agravante novo: **a corrupção vem de fora do código**.
Nenhuma revisão de fonte, nenhum `tsc`, nenhum teste e nenhum build
mostrariam.

Fica a regra de diagnóstico no CLAUDE.md: texto truncado ou trocado sem
explicação → **suspeitar do tradutor antes do React**.

### As duas travas

`lang="pt-BR"` impede a tradução AUTOMÁTICA, que era a causa. Não impede
alguém pedir tradução no menu — e o usuário decidiu fechar isso também,
no mesmo dia. Entraram `translate="no"` no `<html>` (atributo padrão do
HTML) e `<meta name="google" content="notranslate">`.

Conferido na página servida, e o que importa é a última linha:

    lang                              pt-BR
    atributo translate                "no"
    documentElement.translate         false   ← o que o navegador consulta
    document.body.translate           false   ← HERDADO pela árvore inteira
    meta google                       notranslate

O atributo sozinho não provaria nada: quem decide é a **propriedade**
`translate`, e o fato de `document.body` já vir `false` é o que garante
que não precisa repetir a marca elemento por elemento.

A decisão é defensável porque o cálculo é assimétrico: não há nada a
ganhar traduzindo uma tela operacional em português pra quem fala
português, e há o que perder — vale, valor, endereço e status reescritos
em silêncio.

## 52. A credencial CR80 — desenho pronto, integração e três defeitos no spec

O usuário trouxe o desenho da credencial pronto (frente e verso em SVG,
mais logo e cruz), com o código do gerador escrito e uma instrução clara:
não redesenhar, não mexer em coordenada, cor, tamanho ou opacidade. E uma
ressalva que definiu o método: *"se for algo que prejudique o sistema,
avise antes de implementar"*.

Avisei três coisas antes, e uma quarta apareceu no teste.

### 1. O spec gravava as credenciais em disco

`credential-service.ts` usava `node:fs` pra escrever `frente.svg` e
`verso.svg` numa pasta. Dois problemas, e o segundo é o que importa: não
há backend aqui (a emissão roda no navegador do admin), e **um diretório
com todas as credenciais funcionais é exatamente o que o desenho deste
projeto evita** — "o arquivo É o cartão", e a tela manda apagar depois de
imprimir.

O usuário concordou e mandou a versão em memória com download. Foi a
única adaptação estrutural; o desenho não mudou um caractere.

### 2. A credencial passou a identificar o portador

Nome e agência impressos revertem a decisão registrada no CLAUDE.md
("cartão perdido não deve dizer de quem é nem de onde veio"). É escolha
dele, veio junto do desenho, e é defensável: o cartão perdido já
carregava o token, que é o que de fato importa, e a resposta continua
sendo revogar. Registrado como reversão consciente.

### 3. Uma segunda implementação de Code 128

O projeto tem regra explícita contra duas codificações do mesmo dado —
foi ela que fez o PDF do cartão antigo LER as barras do SVG em vez de
chamar o bwip-js de novo. A credencial precisa das barras como `<rect>`
dentro de um SVG maior, então a segunda implementação passou a ser
necessária.

O que a torna aceitável não é cuidado ao escrevê-la: é
`scripts/code128.spec.mts` conferindo **barra a barra contra o bwip-js**
em 24 comprimentos (2 a 44 dígitos) mais os tokens v3 e v2 reais.
Posição e largura idênticas em todos. O bwip-js segue sendo o
padrão-ouro; divergiu, quem está errado é o arquivo novo.

Achado bonito no caminho: **o `15.767` do desenho não é arbitrário**. É
exatamente a altura uniforme de 37 módulos para um token de 22 dígitos
(37 × 75/176 = 15,767mm). O desenho e o formato do token se encaixam por
construção — e é por isso que o gerador EXIGE o v3.

### 4. Um teste de aceitação do próprio spec falhava

"Nome longo não ultrapassa o cartão", da lista que ele mesmo escreveu.
`fitSansFontSize` para de encolher no piso de 2,9, então acima de ~46
caracteres o nome transborda a borda. "Maria Aparecida da Conceição do
Nascimento Silva" (47) dá 77,95mm numa área de 75,2mm. Nome brasileiro
comprido não é caso raro.

Resolvido **sem tocar no desenho**: `ajustarNomeParaCaber` abrevia os
nomes do meio, mantendo primeiro e último por extenso e preservando as
partículas ("da", "do"), como faria qualquer documento de identidade. O
que muda é a string, que é dado; coordenada, cor e corpo seguem intactos.

    "Maria Aparecida da Conceição do Nascimento Silva"
      → "Maria A. da Conceição do Nascimento Silva"     75,20mm
    "Jose Ricardo Wanderley Albuquerque Cavalcanti Montenegro Filho"
      → "Jose R. W. A. Cavalcanti Montenegro Filho"     75,20mm

A alternativa seria recusar a emissão — que é o que o spec faz com o
token longo demais, e ali está certo, porque token tem tamanho fixo.
Recusar por nome comprido seria impedir de emitir cartão pra quem tem
nome comprido.

### O PDF, e a cor que eu não inventei

O usuário escolheu SVG **e** PDF. O motivo é o mesmo de 17/08 e ficou
maior: onde havia um campo de texto vivo, agora há três. Medido no
navegador, o mesmo token mede **66,45mm em Consolas e 72,04mm em Courier
New** — 5,6mm de diferença conforme a máquina que abrir o arquivo, num
campo de 75,2mm. No PDF as fontes são Courier e Helvetica base-14, cuja
métrica é do formato.

**O vermelho `#C9141A` ficou em RGB de propósito.** Converter cor de
marca pra CMYK é decisão de identidade visual, não de código: um chute
sairia impresso num tom que ninguém aprovou. O que a conversão poderia
estragar — as barras — já está travado em 100% K, e é preto sobre o
painel branco. Fica a recomendação de dizer à gráfica qual vermelho
(Pantone ou CMYK).

### O que a medição mostrou

- PDF: duas páginas de **85,60 × 54,00mm exatos**, `0. 0. 0. 1. k` nas
  barras, `/BaseFont /Courier` e `/Helvetica` sem arquivo de fonte
  embutido, e os **três textos medidos com a métrica real** cabendo
  (token 72,03mm, nome 67,63mm no pior caso, agência 17,57mm).
- No navegador, renderizado de verdade: proporção **1,5851** contra
  1,5852 do CR80, 43 barras no verso, nome abreviado corretamente, 99ms
  pra gerar.
- Os assets são **PNG e não vetor**, apesar do comentário no SVG de
  origem afirmar o contrário. Resolução folgada no tamanho final (847 e
  1074 dpi), então não é problema de qualidade — o custo é peso: ~900 kB
  por lado, ~2 MB no PDF.
- Segunda vez no dia em que um teste meu acusou falha com o arquivo
  correto: eu esperava o RGB com três casas decimais e o jsPDF grava com
  duas (`0.79 0.08 0.1 rg`). Volta pro mesmo byte.

### Efeito colateral bom

Com a troca, `src/lib/cartaoPdf.ts` ficou **órfão** e o **bwip-js saiu do
bundle de produção** — ele agora só roda nos testes. São ~930 kB a menos.
O `cartaoPdf.ts` e o spec dele continuam no repositório; removê-los é
decisão de limpeza, não urgência.

## 53. Limpeza: cartão antigo apagado e token reduzido ao v3

Depois de confirmar que a credencial CR80 sai idêntica ao desenho
original (comparada byte a byte com a frente gerada pelo GPT, só com os
dados do motoboy trocados), o usuário mandou apagar o que ficou pra trás
e descontinuar os formatos de token anteriores.

### O que foi apagado

`src/lib/cartaoPdf.ts`, `scripts/cartao-pdf.spec.mts` e
`scripts/cartao-de-teste.mts`. Ficaram órfãos com a substituição do
cartão de 75 × 20,2mm — código morto com teste passando continua sendo
código morto.

**Uma coisa quase saiu junto por acidente, e não podia.** Os testes de
`publicIdDoToken` moravam dentro do `cartao-pdf.spec.mts`. O parser NÃO
morreu com o cartão: `src/data/credenciais.ts` continua usando, e é ele
que identifica o cartão bipado — inclusive OFFLINE, onde só o cliente
responde. E ele é gêmeo de uma função SQL.

Perder cobertura de um gêmeo no meio de uma limpeza é a pior forma de
perder um teste: por acidente, sem ninguém notar, e o sintoma aparece
meses depois como "o cartão não é reconhecido sem internet". Os casos
foram pra `scripts/tokenCartao.spec.mts` antes de qualquer `git rm`.

### Só o v3, nos dois lados

Migration `20260818120000` + `src/lib/tokenCartao.ts`. Os gêmeos mudaram
juntos, como sempre têm que mudar.

**Aplicada e conferida em 18/08**, com a checagem de segurança rodando
antes e voltando zero linhas. Os quatro casos do parser bateram no banco
(v3 → `777777`; v2, v1 e token curto → nulo) e uma credencial nova foi
emitida em seguida, com o token funcionando.

O cabeçalho da migration traz a query que precisa rodar ANTES:

    select c.public_id, m.nome, length(c.public_id) as digitos
      from public.motoboy_credenciais c
      join public.mototaxistas m on m.id = c.motoboy_id
     where c.ativo and c.public_id !~ '^[0-9]{6}$';

Zero linhas = seguro. Alguma linha = aquele motoboy chega no balcão com
um cartão que o sistema não conhece mais. Conferido em 18/08: as duas
credenciais ativas já eram v3, e as antigas de 10 dígitos estão todas
revogadas (emitir cartão novo revoga o anterior).

**As linhas antigas não são apagadas.** Elas são histórico — dizem quando
um cartão foi emitido, por quem e quando foi revogado, e o Registro de
Auditoria referencia esses eventos. O que muda é só o parser deixar de
casar um token daquele formato.

O spec ganhou dois casos que parecem redundantes e não são: `v2 não é
mais lido` e `v1 não é mais lido`. Sem eles, "tirei o suporte" e "esqueci
de tirar" seriam indistinguíveis.

### Efeito colateral: o bwip-js saiu do bundle

Com o `cartaoPdf.ts` fora, nada no app importa o bwip-js — quem desenha
as barras agora é `src/lib/code128.ts`. Ele saiu também do
`optimizeDeps.include` do `vite.config.ts` (a entrada existe pra
dependência de import dinâmico, e não há mais nenhum). São ~930 kB que o
app não baixa mais.

Ele continua instalado e continua importante: é o **padrão-ouro** contra
o qual o `code128.ts` é conferido barra a barra nos specs. Só deixou de
ser código de produção.

### Duas decisões de calendário do usuário

Registradas pra não voltarem como alarme a cada sessão:

- **As senhas de teste ficam** (`adminteste@`/`caixateste@`, senha
  `2026`) até o sistema estar finalizado. Continua sendo exposição real
  num Supabase de produção, com o histórico do repo registrando; a
  diferença é que agora é prazo escolhido, não pendência esquecida.
- **A limpeza dos dados de teste é o último passo antes de apresentar.**
  Faz sentido: limpar antes significaria recriar massa de teste a cada
  frente nova.

## 54. Geolocalização: o que dá e o que não dá pra fazer offline

O usuário pediu que a geolocalização fosse **obrigatória** pra selagem
("é fundamental"), e perguntou se dava pra capturar coordenada de alguma
forma sem rede.

**Obrigatória não pode ser, e o motivo é de hardware.** O PC do balcão
não tem GPS. O navegador resolve posição mandando os WiFi vizinhos pro
serviço do Google — isso EXIGE rede. Offline não existe a quem
perguntar. Exigir coordenada seria proibir saída sem internet, ou seja,
desligar o caminho que a gente passou dias provando (itens 48 a 50).

E mesmo online, geolocalização de desktop por WiFi erra de centenas de
metros a quilômetros. Como prova de que "o caixa estava na farmácia", a
sessão autenticada diz mais.

**O que dá, e virou o desenho:**

- `aquecerGeolocalizacao()` pede uma leitura quando a Nova Corrida monta
  com internet — mesmo lugar do cache de credenciais. É isso que faz uma
  saída offline ter coordenada.
- Ao selar: leitura fresca com 8s (antes 3s, curtos demais pra alguém
  RESPONDER ao pedido de permissão — que é onde a permissão se decide);
  não vindo, aceita a do cache do navegador, até 10 minutos.
- **A leitura de cache é ROTULADA**: `obtida_em` guarda o horário real da
  medição, `origem` diz `fresca` ou `cache`, e a tela escreve "leitura de
  11:25, não do momento da selagem".
- **Sem coordenada, grava o MOTIVO** (`negada`, `sem_suporte`,
  `indisponivel`, `expirou`). O retorno nunca é `null`.

**Por que o usuário achava que não existia:** ela estava implementada
desde a etapa 3, mas devolvia `null` em silêncio e o campo sumia da tela.
"Não registrada" e "negada" eram indistinguíveis. Era o buraco, não a
ausência.

A função saiu de `data/romaneios.ts` pra `lib/geolocalizacao.ts` porque
passou a ter ramificação de verdade. `scripts/geolocalizacao.spec.mts`
cobre os cinco caminhos com um dublê de `navigator.geolocation` — única
forma de exercitar "negada" e "offline sem cache" sem depender de
permissão nem de rede.

Nada muda nos gêmeos do `offline_event_hash`: os dois lados serializam o
que recebem.

## 55. O PDF do romaneio

Pedido junto com "envio ao Drive" e "romaneio de retorno". Feito primeiro
porque é autocontido e é a fundação dos outros dois.

**A decisão que governa o arquivo inteiro: ele sai do SNAPSHOT.** Os
vales vêm de `romaneios.payload`, congelado na selagem — não de
`entregas`, que pode ter mudado. Correção posterior aparece em **seção
separada**, com a frase de que o documento acima não muda.

O usuário confirmou explicitamente: *"é pra aparecer o que foi assinado,
e se foi corrigido, aparecer como evento posterior"*.

**Duas vias**, porque os destinatários são dois. A da agência **omite o
valor da compra** — decisão dele: a agência precisa do valor da entrega
pro acerto, não do que o cliente comprou. A justificativa dele pra
agência ter acesso: no futuro painel da agência ela verá o histórico dos
vales que fez no mês. *(O painel continua fora de escopo — falta a policy
de `'agencia'`.)*

**Os quatro relógios finalmente têm tela.** Retirada, retorno e duração
saem de `corridas.saida_em`/`retorno_em`, que existem desde 2026-08-10 e
nunca tiveram superfície. O usuário pediu isso achando que faltava
capturar; faltava só exibir. **Consequência boa: o relatório de tempo
médio poderá ser calculado retroativamente**, sobre todas as corridas já
fechadas.

A duração usa o relógio do SERVIDOR nos dois lados — misturar com o do
dispositivo daria um intervalo que não aconteceu. Corrida ainda aberta é
DITA ("corrida ainda aberta"), não omitida.

Assinaturas em vetor, redesenhadas dos pontos. Rodapé com `final_hash`,
`document_hash`, IP, geolocalização e a frase de que o PDF é renderização
do registro, **não a fonte da verdade**.

`scripts/romaneio-pdf.spec.mts`, 30+ casos. O primeiro é o que importa:
um romaneio cujo snapshot diverge de propósito do "dado de hoje".
`scripts/romaneio-de-exemplo.mts` gera as duas vias com dado fictício.

## 56. A logo nova, e a marca num lugar só

O usuário mandou trocar a logo do romaneio pela nova (a mesma da
credencial) e, junto, "tudo que usava a logo antiga em PNG".

Mapeados e trocados: cabeçalho do app, tela de login, PDF do acerto,
credencial (já usava a nova) e o PDF do romaneio, que ganhou logo pela
primeira vez. `src/assets/logo.png` apagado.

**Coincidência que facilitou tudo:** a nova é 2008 × 320 e a antiga era
502 × 80 — exatamente quatro vezes, mesma proporção. Nenhum layout mudou.

`src/lib/marca.ts` virou o único ponto que sabe onde os arquivos estão.
Antes havia duas cópias da mesma extração de PNG embutido nos geradores
da credencial. De quebra sumiu o `<img>` que o PDF do acerto criava só
pra MEDIR a dimensão da logo a cada exportação.

**Os arquivos do designer ficam intactos** em `public/marca/`, com a
duplicata `href`/`xlink:href` e tudo. Comparar o repo com o que foi
entregue vale mais que os 137 kB.

**Um teste precisou mudar, e a correção é mais interessante que a
falha.** Havia um `sem imagem embutida`, criado pra provar que as
assinaturas são vetor; passou a falhar corretamente, porque agora existe
uma imagem legítima. Mas contagem absoluta também não serve: a logo é PNG
com transparência e o jsPDF emite **imagem + máscara alfa**, então uma
logo conta 2. O que prova é a contagem **não crescer** quando entram
assinaturas.

**Custo:** cabeçalho de 8,5 kB para 273 kB, PDF do romaneio de 5 kB para
130 kB. Uma busca por sessão, cacheada. O peso do PDF importa porque ele
vai subir pro Drive.

**O `favicon.svg` não é a logo da farmácia** — é ícone roxo genérico do
template do Vite, nunca trocado. Não entrou porque não era "a logo antiga
em PNG", mas continua sem relação com a Drogaria Cidade.

## 57. O romaneio sobe ao Drive — e a logo estava aparecendo pela metade

Sessão de 2026-08-19. O usuário respondeu as duas perguntas que ficaram
anotadas na retomada anterior, e acrescentou uma terceira coisa que virou
o achado da sessão.

**As respostas:** os romaneios vão pra `Romaneios › <Filial> › <mês> › <dia> › <via>`;
sobem as **duas** vias; e o envio é por **botão** na página do romaneio,
não automático na selagem.

**Uma delas ele reviu no mesmo dia**, e a revisão é boa. A resposta
original incluía um segundo destino, `Romaneios › Geral › <mês>`, com
todas as filiais juntas — construí, mostrei, e ele desfez: *"achei que
seria uma ideia boa mas não faz sentido, ninguém vai preferir procurar
uma agulha no palheiro"*. Está certo, e vale registrar por quê: uma pasta
que acumula tudo não resolve busca, só a adia. Quem procura um romaneio
sabe de que filial ele é.

Com a Geral saiu junto a capacidade de `enviarAoDrive` aceitar **vários**
destinos, que nasceu só pra servi-la. Deixá-la seria flexibilidade morta
esperando um segundo chamador que não existe — e o projeto já decidiu
isso antes, quando apagou o `cartaoPdf.ts` órfão no item 53. O spec
ganhou o caso `nenhum nível se chama "Geral"` pelo mesmo motivo dos
`v2 não é mais lido`: sem ele, "tirei" e "esqueci de tirar" ficariam
indistinguíveis.

### O achado: o letreiro nunca apareceu no romaneio

Junto das respostas veio "altera a logo dos PDFs de volta para a inicial,
documento não precisa de tanta qualidade quanto o sistema". Fui conferir
se a "inicial" era outra marca — e não era: recuperei a antiga do git
(`git show 31d93de^:src/assets/logo.png`) e extraí a nova de dentro do
`.svg`, e são **a mesma arte**, 502 × 80 contra 2008 × 320. O pedido era
sobre peso, não sobre identidade visual. Isso resolveu a ambiguidade sem
precisar perguntar de novo.

Mas ao olhar as duas imagens apareceu outra coisa. Decodifiquei os pixels
das duas: na região do letreiro, **cor média rgb(255,255,255) e 0,0% de
pixels escuros**. O "Drogaria Cidade" da arte é branco.

O PDF do **acerto** pinta uma faixa vermelha e desenha a logo em cima —
sempre funcionou. O do **romaneio** desenhava direto no papel branco.
Resultado: desde 18/08, quando o romaneio ganhou logo, ele saía com a
cruz solta e **sem o nome da farmácia**, pagando 130 kB por isso.

Ninguém notou porque a cruz aparecia. É o tipo de defeito que passa por
revisão de código, `tsc`, lint, build e até pelo spec — que checava
"tem imagem", e tinha.

**A faixa entrou** (`COR_MARCA`, que mudou de `exportarAcertoPdf.ts` pra
`marca.ts`, porque saber desenhar a marca inclui saber o fundo que ela
exige). E ganhou teste: a faixa tem que começar em x=0 e ter a largura da
página, senão "tem faixa" e "tem qualquer retângulo vermelho" ficariam
indistinguíveis.

**Sexta vez que um teste meu falhou com o arquivo correto.** Escrevi a
asserção esperando `0.929 0.114 0.141 rg` e o jsPDF grava com DUAS casas:
`0.93 0.11 0.14 rg`. Está anotado neste arquivo desde o item 52 e eu
passei por cima. Da segunda vez fui medir nos bytes em vez de supor.

**Peso: 130 kB → 16 kB**, oito vezes menor. Importa porque agora são
quatro arquivos por saída subindo pro Drive.

### O envio

- `enviarAoDrive` deixou de receber um período e passa a receber um
  **caminho de pasta** — uma lista de nomes que ele percorre criando o
  que faltar. O acerto continua indo pra pasta do período; o romaneio vai
  pra filial/mês. Nada é memorizado entre chamadas de propósito: id de
  pasta guardado vira id de pasta que o usuário apagou, e aí o envio
  pousaria dentro da lixeira sem reclamar.
- **Reenviar substitui.** Procura o arquivo pelo nome exato na pasta e,
  achando, faz `PATCH` com `uploadType=media`: troca só o conteúdo,
  preservando id, nome e link. O Drive aceita cinco arquivos homônimos na
  mesma pasta sem reclamar, e num documento de custódia isso é pior que
  inútil. **Vale pro acerto também**, que antes só reaproveitava a pasta.
- **O mês vem do relógio do servidor.** `selado_em`, ou o recebimento
  quando não há selo (romaneio de conflito). Regra 8: o relógio do PC do
  balcão pode estar errado, e romaneio arquivado no mês errado é romaneio
  que ninguém acha.
- `AAAA-MM` e não "agosto de 2026" — o Drive ordena pasta por nome.

### Onde a linha do testável foi traçada

`googleDrive.ts` lê `import.meta.env`, então não roda em `npx tsx`. Em vez
de contornar com `?.` (que poderia atrapalhar a substituição estática do
Vite justamente na variável que governa a integração inteira), separei:

- **`src/lib/caminhosNoDrive.ts`** decide QUAIS pastas e **não importa
  nada** — mesma disciplina de `canonico.ts` e `tokenCartao.ts`.
  `scripts/caminhosNoDrive.spec.mts`, 25 casos, incluindo os que fariam um
  romaneio sumir (filial nula, filial só com espaços, `' Matriz '` criando
  uma segunda pasta, acento preservado) e a ordenação dos meses na virada
  de ano.
- **`googleDrive.ts`** ficou só com o transporte, e reexporta a nomeação
  pra nenhum call site mudar — o mesmo arranjo de `credenciais.ts` com
  `tokenCartao.ts`.

O envio de verdade **não tem e não vai ter** teste automatizado: depende
de consentimento OAuth, que é autenticação e não se faz em nome do
usuário. O que dava pra provar, provei com um Drive falso em memória, no
navegador, com o módulo de verdade:

    1ª vez  → 4 pastas, 2 arquivos, 0 atualizados
    2ª vez  → 2 arquivos (SEM duplicata), 2 atualizados, conteúdo = v2
    3ª vez  → outro DIA, 5 pastas: só a pasta do dia nasceu
    4ª vez  → outra filial, 8 pastas: a raiz não duplicou

Virou `scripts/conferir-envio-drive-no-console.js`, pelo mesmo motivo e no
mesmo formato do `conferir-canonico-no-console.js`.

### A sangria do fim do dia, e a pergunta que a motivou

Depois de tudo pronto o usuário perguntou: *"Todos os romaneios vão subir
no drive?"* Não iam — e a resposta expôs o buraco. O botão da página do
romaneio é "compartilhar ESTE romaneio agora", e o caminho até ele é
longo: **não existe lista de romaneios no sistema**, você chega num pelo
vale (expandir o chevron → "Ver documento"). Subir tudo significaria fazer
isso a cada saída, várias vezes por dia, dependendo de alguém lembrar. Um
arquivo que depende de ninguém esquecer não é um arquivo.

Ele escolheu **"sangria" no fim do dia**, mais a pasta por dia pra evitar
bagunça. Foi pra aba **Fechamento**, que já É a tela do fim do dia e já
tinha os dois controles necessários — data com atalho "Hoje" e filial pro
admin. Zero controle novo.

**A assimetria que decide se funciona:** varre por
`recebido_em_servidor`, arquiva por `ocorrido_em_local`. Varrer pelo
`ocorrido_em_local` abriria um buraco permanente — saída offline de
segunda que sincroniza terça não entraria na sangria de terça (a data dela
é segunda) e a de segunda já rodou sem ela. Ninguém a pegaria nunca mais.
Arquivar pelo recebimento poria a retirada no dia errado. Então: varre por
quando o servidor soube, arquiva por quando aconteceu — e a tela avisa
quando um romaneio foi pra pasta de outro dia, senão pareceria erro.

**Duas correções no formato que ele propôs**, e as duas são de fora do
navegador. Ele pediu `Mês (02/2026)` e `Dia (01/02)`; ficou `2026-02` e
`2026-02-01`, porque o **Google Drive para Desktop renomeia pasta com `/`**
ao sincronizar pro disco, e porque `01/2027` cairia entre `01/2026` e
`02/2026` na ordenação por nome. A estrutura pedida é a mesma.

**E uma armadilha que só a pasta por DIA revelou.** Eu vinha fatiando a
string ISO (`.slice(0, 7)`), o que dá o dia em **UTC**. Uma saída às 21h em
São Gabriel é `T00:30Z` do dia seguinte — arquivada no dia errado, e a
sangria daquela noite não a acharia na pasta que acabou de criar. Com
pasta por mês isso errava uma vez por mês; com pasta por dia, **toda
noite**.

Virou `src/lib/datas.ts`, que é também a definição de "o dia" da aba
Fechamento (era uma cópia local chamada `localDateStr`; agora é a mesma
função — as duas discordarem faria a sangria arquivar num dia e a tela
mostrar outro).

O teste foi montado pra ser **independente de fuso**: o instante é
construído a partir de uma data local (`new Date(2026, 7, 18, 21, 30)`) em
vez de uma string UTC fixa. Confirmei que ele discrimina de verdade nesta
máquina (`America/Sao_Paulo`): o jeito ingênuo dava `2026-08-19` para uma
saída das 21h30 do dia 18. Num runner em UTC o teste passaria sem provar
nada — por isso a construção importa mais que a asserção.

### O primeiro envio real, e a pasta por via

**Funcionou contra o Google de verdade** — primeira vez que o envio ao
Drive passou por consentimento OAuth real, fechando um item que estava
aberto desde a correção do item 32.

Vendo o resultado, o usuário pediu uma pasta por via dentro do dia. Ficou
`Via da farmácia` / `Via da agência` — **"agência" e não "tele"**, que é
como ele falou: o sistema inteiro chama de agência (Cadastros, "A pagar à
agência", relatório por agência) e o Drive não é lugar pra um segundo
vocabulário.

**O nome do arquivo continua trazendo a via**, apesar de a pasta agora
dizer. PDF baixado e mandado por e-mail sai da pasta, e fora dela o nome
é a única coisa que diz qual via é. Manter também evitou trocar a chave
de dedupe — o que já estava no Drive continua reconhecível.

**Consequência avisada, não resolvida:** os arquivos do envio anterior
ficam soltos na pasta do dia, ao lado das subpastas novas. O app não
apaga nada no Drive e não deveria; a limpeza é manual.

**Duas vias viraram dois destinos, e isso ressuscitou o cache que eu
tinha removido.** Sem ele, cada romaneio refaria a busca de
raiz/filial/mês/dia duas vezes — medido no Drive falso: **6 buscas de
pasta com cache contra 30 sem**, pros mesmos 3 romaneios. Mas o cache é
do CHAMADOR (`novoCachePastas()`), não do módulo: memorizado
indefinidamente, id de pasta vira id de pasta que o usuário apagou, e o
envio pousaria na lixeira sem reclamar. Vivendo só durante uma sangria,
essa janela não existe.

**E ele impõe uma regra:** envios que compartilham cache têm que ser
sequenciais. Escrevi o script de conferência com `Promise.all` e percebi
antes de rodar — as duas vias errariam o cache juntas e criariam a mesma
pasta duas vezes. O app já era sequencial; o script passou a ser, porque
script de conferência tem que espelhar o app, não o que ficaria bonito
nele.

**Sétima vez que um teste meu falhou com o código certo**: três casos do
spec comparavam `caminho.slice(2)` com `[mês, dia]`, e a via entrou como
terceiro elemento. Virou `slice(2, 4)`.

**Um susto que valeu:** `npx tsc -b` **não cobre `scripts/`** — só `src`.
Uma chamada com argumento faltando no spec passou pelo typecheck e só
apareceu ao rodar o spec. Não confiar no `tsc` pra validar mudança em
script.

E o script de conferência passou a ser rodado **como arquivo**, buscado
do repositório e executado num `AsyncFunction`, em vez de eu reescrever
o mesmo teste no console. Assim o que se confere é o artefato que fica —
e todos os números que ele afirma (6, 2, 0 / 2, 2 / 9 / 14 / 6 vs 30)
bateram.

### Duas coisas menores que saíram no caminho

- **O dublê de `fetch` estava copiado em cinco scripts**, e a cópia
  deixou de ser inofensiva quando a logo de documento entrou como PNG
  solto: os dublês só sabiam `text()`, e `.png` precisa de
  `arrayBuffer()`. Virou `scripts/fetchDePublic.mts`.
- **O caminho novo do PNG foi verificado no navegador de verdade**, não só
  com dublê: `carregarImagemDaMarca` devolveu um data URI que o navegador
  decodificou como 502 × 80, com o cache servindo a segunda chamada.

### O que fica pendente disto

- **O envio nunca rodou contra o Google de verdade** — nem este, nem o do
  acerto depois da correção do item 32. É clique de usuário.
- O aviso `INEFFECTIVE_DYNAMIC_IMPORT` do build agora cita
  `Romaneio.tsx` além de `Relatorios.tsx`: as duas telas importam
  `googleDrive.ts` estaticamente (pra `driveConfigurado`) e
  dinamicamente (no clique). É cosmético — o módulo é pequeno e não puxa
  dependência pesada —, mas se for arrumar, arrume nas duas.

## 58. O desenho do Romaneio de Retorno, fechado antes do código

Sessão de 2026-08-19, depois do Drive. O usuário trouxe a modelagem
pronta e pediu conversa antes de qualquer linha — o que se provou certo,
porque a conversa mudou duas das decisões dele.

**A proposta dele estava certa no núcleo:** a assinatura hoje está presa
à *corrida* e deveria estar presa ao *documento*; o retorno é um segundo
documento que referencia a saída e nunca a altera; unicidade por
`romaneio_id` com índices parciais, sem reescrever histórico. Nada disso
precisou de ajuste.

O desenho final está no CLAUDE.md. Aqui fica o que a conversa **achou**.

### O que o código respondeu, e que ninguém teria adivinhado

**O papel do signatário está dentro do hash.**

```sql
v_hash_caixa := encode(digest(
  v_hash || '|caixa|' || p_caixa_id::text || '|' || ...
```

Ele queria renomear `tipo_signatario` de `caixa` pra `responsavel_loja`,
com um argumento bom (no retorno quem recebe pode ser gerente). Mas o
literal entra no `signature_hash`, e o `final_hash` é
`digest(document_hash | hash_caixa | hash_motoboy)` — renomear as linhas
existentes quebraria a verificação de **todo romaneio já selado**.

É a regra 7 alcançando um lugar onde ninguém procuraria: o vocabulário
virou dado assinado. A saída foi ampliar o CHECK em vez de renomear, e o
efeito colateral é bom — `papel_no_momento` vira coluna própria, que era
o que ele queria de verdade, e entra no hash do retorno desde o dia um.

**Ressalva honesta: nada recomputa esses hashes hoje.** São gravados e
exibidos truncados, nunca conferidos. Então o risco é latente, não ativo.
O que fica registrado é a regra pro dia em que alguém escrever um
verificador: ler `tipo_signatario` da linha, jamais fixar o literal.

**O bloqueio progressivo que ele propôs já existe.** Ele desenhou
"3 erros → pequeno atraso, mais → bloqueio temporário, gestor recupera".
O banco já faz exatamente isso desde 16/08: 30s → 2min → 5min → teto de
15min, e um acerto zera o contador. A preocupação com "5 erros e ninguém
fecha o dia" nunca foi o comportamento. Uma sessão economizada por ir
olhar em vez de aceitar a premissa.

**`redefinir_pin` exige `is_admin()`, não gestor.** A decisão dele dizia
"Gestor/Admin conclui o excepcional", mas o gerente não tem esse poder
hoje — e não é acidente, é a separação de 12/08 entre escopo de filial e
capacidade de gestão. O problema prático: o admin é o dono, não está no
balcão de cada filial às 20h, então excepcional restrito a admin
**paralisaria justamente o caso que ele existe pra destravar**. Ele
confirmou `is_gerente()`, e ficou registrado como ampliação deliberada —
segundo uso daquela função, que até aqui tinha um só.

### Duas coisas que simplificaram por si

**O fluxo excepcional é online por construção.** Offline não existe
"não foi possível autenticar": o PIN é selado no envelope RSA e o
servidor decide na sincronização. Não há a quem o servidor diga "não".
Uma máquina de estados a menos, de graça.

**`UNIQUE (corrida_id, tipo)` isenta os conflitos sozinho** — romaneio em
conflito tem `corrida_id` nulo por construção, e no Postgres nulo não
colide. Não precisa de índice parcial ali.

### A decisão de escopo que ele tomou, e o que ela custa

O retorno **substitui** o fechamento manual. Não vão existir dois
caminhos pra encerrar uma corrida — mesma família do "notificar não tira
da fila": dois caminhos pro mesmo fato, nenhum definitivo.

O custo é a fila offline. Um `fechamento_corrida` pendente no IndexedDB
**não tem como virar** um romaneio de retorno: falta assinatura, PIN e
snapshot, que nunca foram coletados. Ficou uma janela de compatibilidade
de duas releases, com o item legado executando o comportamento antigo e
gravando auditoria própria. Descartar em silêncio seria a perda que a
chave própria da fila veio corrigir em 16/08.

### O tamanho

Seis etapas, como a saída. A perigosa é a 2: o canônico do retorno tem
mais campos que o da saída — desfecho por vale, previsto contra
realizado, motivo de insucesso —, então são dois gêmeos TypeScript/SQL de
novo com mais superfície pra divergir num byte. Spec próprio e
`conferir-canonico-no-console.js` próprio, separados dos da saída.

## 59. Etapa 2A: verificar antes de mudar, e contratar antes de implementar

Sessão de 2026-08-19, depois do desenho do retorno. Duas peças, e as duas
existem pelo mesmo motivo: **provar em vez de afirmar**.

### O verificador, e o que ele achou

O projeto **gerava** evidência criptográfica sem conseguir **verificá-la**
— `signature_hash` e `final_hash` eram gravados e exibidos truncados,
nunca recomputados. Conferindo o schema, dava pra fechar isso hoje:
`v_agora` é persistido como `romaneios.selado_em`, e todos os outros
insumos da fórmula estão gravados.

Baseline: **9 verificados, 9 válidos, 0 divergências**, 4 camadas cada.

**A armadilha que quase invalidou tudo** foi o fuso. A fórmula concatena
`v_agora::text`, e `timestamptz::text` depende do `TimeZone` da sessão —
o mesmo instante vira `12:00:00+00` em UTC e `09:00:00-03` aqui.
`selar_romaneio_interno` não fixa fuso, e o fuso da selagem não está
gravado em lugar nenhum. UTC era a reconstrução certa (tudo veio por
PostgREST), mas era reconstrução: se estivesse errada, as camadas
`assinatura:*` divergiriam todas e a `documento` passaria, porque ela não
tem timestamp. Esse padrão não apareceu.

Ficou a regra pra fórmula do retorno: **nada de cast de timestamptz em
hash.** `to_char` com máscara ou epoch.

**E ele achou uma coisa que não é sobre hash:** o `R-000001` está gravado
como `offline_sincronizada`, enquanto o NOTAS o citava em quatro lugares
como a prova do caminho online. A conclusão sobreviveu (seis outros são
`online`), a citação não. Corrigido no item 42. O método vale mais que o
achado — isso não apareceu em revisão, em teste nem relendo as notas;
apareceu porque alguém consultou o banco com uma pergunta específica.

### Os golden vectors, e por que ANTES

A ideia é do usuário e a razão é sutil: comparar o gêmeo TS com o SQL
prova que **concordam**, não que estão **certos**. TS implementa um
defeito, SQL copia o mesmo entendimento, os dois concordam, o teste
passa. Com vetores revisados à mão passam a existir três referências.

Oito válidos e doze inválidos, 209 asserções, e **nenhuma linha de
canônico existe ainda**.

Os inválidos foram pedido dele e fecham uma classe que os válidos não
alcançam: **TS aceita, SQL rejeita**. Os dois lados podem produzir bytes
idênticos pra toda entrada válida e ainda discordar sobre o que é válido
— com o mesmo sintoma de sempre, meses depois.

**A lista de rejeição dele achou um defeito no que eu tinha entregue.**
O V007 (string vazia contra nulo) usava `motivo: 'outro'` com detalhe
vazio — e a regra congelada exige detalhe não-vazio pra `outro`. Um vetor
VÁLIDO codificando uma entrada que os INVÁLIDOS rejeitam. Trocado pra
`ausente`, onde detalhe é opcional. Foi o único hash que mudou.

**Um caso da lista dele que não virou vetor, e a ausência é a resposta:**
"pagamento apontando pra entrega_id que não existe no bloco `v`". No
TypeScript ele é indescritível, porque `pagamentosRealizados` é aninhado
no vale e o `entrega_id` da linha `pr` vem do pai. Tornar um erro
impossível de representar vale mais que rejeitá-lo — **e por isso o lado
SQL tem que espelhar o aninhamento**: um `select` plano de `pagamentos`
reabriria o caso que o TS fechou por construção.

O spec confere os vetores contra a **especificação**, não contra
implementação, e checa a recíproca também: nenhum dos oito válidos pode
disparar uma regra de rejeição. Sem isso, uma regra escrita larga demais
tornaria os válidos inválidos e ninguém notaria até a implementação
recusar tudo.

A contagem de bytes do V001 foi somada campo a campo na mão: 359, igual
ao que o Node reporta. E `bytes` virou critério separado do hash, a
pedido do usuário — quando algo diverge, contagem de bytes dá
diagnóstico muito melhor que "o hash deu outro".

### O triângulo fechou

```
TypeScript  60/60 contra os vetores
SQL         36/36 contra os MESMOS vetores
```

Os dois concordam com uma terceira referência escrita à mão antes de
ambos — logo concordam entre si, e não porque um foi traduzido do outro.

**Escrever o segundo gêmeo separado pagou duas vezes**, e as duas seriam
invisíveis numa tradução:

- JSON aceita `"valor_cents": "12345"` como STRING, e `->>` devolveria os
  MESMOS BYTES que o número. Passaria no SQL, seria recusado no TS por
  `Number.isInteger` — a divergência "TS rejeita, SQL aceita" que os
  vetores inválidos existem pra fechar. A checagem virou de TIPO JSON.
- Pior porque some sem erro: com `entrega_id` ausente, `lower(NULL)` é
  NULL, a concatenação vira NULL, e **`array_to_string` descarta linha
  nula em silêncio**. Um vale sumiria do documento assinado de um lado
  só. `coalesce` em volta de cada `lower`, e o mesmo no dedupe, onde
  `NULL = any(array)` é NULL e não false.

### O item 6 mudou de pergunta, e a resposta veio em 5 cenários

Com os vetores fechados dos dois lados, "TS × SQL concordam?" deixou de
ser a pergunta. O item 6 virou **teste de transporte**: o caminho
`supabase-js → PostgREST → jsonb` preserva o input que o navegador
assinou? É onde moram `undefined` sumindo no `JSON.stringify`, string
vazia virando nulo, número chegando como string e Unicode atravessando
quatro camadas.

**5 cenários, três critérios cada, todos verdes**, sobre o `R-000001`
com documento de 3 vales.

O que o canônico impresso provou e os booleanos não mostram:

- **a ordenação atravessou o fio** — o input mandou
  entregue/insucesso/entregue, a saída veio ordenada por `entrega_id`
  com o insucesso primeiro. Os dois lados reordenaram igual, com dado
  real;
- **o bloco `pr` convive com vale sem pagamento** — três `v` juntos,
  depois dois `pr`, e o vale de insucesso ausente do segundo bloco;
- **o par vazio/nulo escala**: 1 byte de diferença com 1 vale, 3 bytes
  com 3 vales. Um `-` por vale, exatamente.

**A exigência do usuário que fez o teste valer alguma coisa:** o canônico
local e o `p_retorno` enviado saem do MESMO objeto de domínio, pela mesma
função (`paraJsonbRetorno`). Sem isso o teste provaria que um SCRIPT
monta JSON certo, e a tela poderia montar outro formato depois —
assinando uma coisa e mandando outra.

### Três revisões do script, e o que cada uma achou

Vale registrar porque nenhuma foi capricho: cada uma expôs uma cobertura
que eu tinha declarado sem ter.

1. **A cobertura estava amarrada ao tamanho do documento.** Eu
   distribuía os casos entre os vales em rodízio, e o romaneio mais
   recente tinha UM vale — então só o caso `entregue` atravessou. Ficaram
   de fora justamente os dois que motivam testar transporte. Cada forma
   virou um cenário próprio.
2. **Escolher o romaneio mais recente era conveniência**, não critério.
   Passou a escolher o com mais vales.
3. **Nenhum romaneio selado tem mais de um vale**, então nem isso
   bastava. A saída foi outra: `conferir_canonico_retorno` é PURA e não
   valida pertencimento, então dá pra montar um documento multi-vale com
   `entrega_id` reais quaisquer. Não é fabricar dado — o que precisa ser
   real aqui são os UUID vindos do banco e o texto atravessando as
   camadas, não a relação de negócio. Na 2B a mesma liberdade seria erro.

E uma quarta coisa, que não é cobertura mas atrapalhava igual: **`const`
de topo no console do Chrome persiste entre colagens**, então rodar o
script duas vezes na mesma aba dava "Identifier ... has already been
declared" e nada rodava. Repetir um teste é o uso normal. Tudo passou a
viver dentro de um bloco.

### O item 7, e o baseline provando que nada moveu

`papel_no_momento` entrou no INSERT da assinatura da saída. Mudança
estreita de propósito: `tipo_signatario` continua `caixa`, o canônico não
muda, as fórmulas de `signature_hash` e `final_hash` não mudam um byte,
nada é reescrito nem preenchido retroativamente.

**Depois de aplicar: `9 · 9 · 0`, idêntico ao baseline.** 36 camadas de
hash recomputadas em 9 documentos, todas ainda verificando. É a diferença
entre "li o código e a fórmula não mudou" e medição no mesmo instrumento
— e é exatamente por isso que o verificador veio ANTES desta mudança.

**Conferido por diff antes, não só por leitura.** A função inteira
precisa ser reescrita pra ganhar uma coluna, e é a mais crítica do
projeto. O diff mostrou uma linha de declare, o `select` do perfil
ganhando `p.papel`, o bloco da checagem e a coluna no INSERT — e as três
linhas de `encode(digest(...))` NÃO apareceram nele. O hash do trecho das
fórmulas é o mesmo nos dois arquivos.

**Uma armadilha que quase peguei:** existem DUAS definições de
`selar_romaneio_interno` no repositório. A original de `20260816140000` e
a de `20260816180000`, que corrigiu a ordem da FK da autorização — o bug
do item 40, o que fazia NENHUM selo funcionar. Parti da segunda. Copiar
da primeira teria reintroduzido aquilo em silêncio, e só apareceria na
próxima saída real.

**Onde a checagem do papel ficou, e por quê.** O usuário pediu pra falhar
a selagem em vez de gravar NULL. Mas checar cedo — logo depois de buscar
o perfil — derrubaria também o caminho do CONFLITO, que existe justamente
pra preservar os traços das duas assinaturas quando a saída é recusada.
Trocar essa prova por uma exceção contraria o princípio mais forte do
desenho. A checagem ficou imediatamente antes do INSERT da assinatura, o
único ponto onde a coluna existe; o conflito grava em
`romaneios.conflito` e segue intocado.

Na prática o único papel que dispara isso é `agencia`, que
`profiles.papel` aceita desde o schema inicial e que não deveria estar
selando saída nenhuma.

### A 2A fechou — e o E2E prova mais que o baseline

`R-000013` selado em 2026-08-20, pelo fluxo normal de Nova Corrida:
cartão, PIN, as duas assinaturas de sempre. A assinatura do caixa veio
com `papel_no_momento = 'admin'`; a do motoboy, nula, como tem que ser
(ele não é um `profiles`). Verificador: **10 · 10 · 0**.

**Vale entender por que este resultado é mais forte que o `9 · 9 · 0`.**
Os nove antigos verificando provam que nada existente foi corrompido. O
NOVO verificando prova outra coisa: que a função REESCRITA produz hashes
que o verificador reproduz — e o verificador foi escrito a partir da
função ANTIGA. Se eu tivesse mudado a fórmula sem perceber, os nove
velhos continuariam batendo e só o `R-000013` divergiria.

E materializou-se a linha que a decisão previu, e que parece errada pra
quem lê o banco sem contexto:

    tipo_signatario  = 'caixa'    ← o slot: o lado da farmácia
    papel_no_momento = 'admin'    ← o cargo real de quem assinou

Não é inconsistência. É a separação funcionando: o rótulo estrutural não
afirma cargo, e o cargo tem coluna própria.

**Uma confusão que a minha explicação causou, e vale registrar:** o
usuário rodou o fluxo e estranhou que nada pedisse assinatura nova. Nada
devia mesmo — a mudança do item 7 é invisível na tela, e o "E2E" é só a
Nova Corrida de sempre. Eu tinha descrito o teste como se algo novo fosse
acontecer, quando o que se testa é o contrário: que **nada** mudou pra
quem opera, e que a coluna foi preenchida no servidor. Descrever teste de
regressão como se fosse teste de funcionalidade manda a pessoa procurar o
que não existe.

### Dois defeitos meus no gerador do SQL, e o método que os deixou passar

O gerador emitia **20 statements separados**, e o SQL Editor mostra só o
último — 19 conferências rodavam e desapareciam. O usuário mandou o
resultado do I012 e mais nada, o que era exatamente o sintoma. Virou uma
consulta só, com `union all` num CTE.

Aí o segundo: o laço punha `select` na frente de CADA conferência, quando
só a primeira pode ser `select`. Erro de sintaxe em `E'V002'`.

**O que deixou passar foi o método:** eu tinha conferido o começo e o fim
do arquivo gerado, e o defeito estava no MEIO, na fronteira entre o
primeiro vetor e o segundo. Ponta de arquivo não prova estrutura de
arquivo. A conferência virou estrutural — 1 ramo com `select`, 35 com
`union all select`, 36 no total, ordem dos rótulos, parênteses
balanceados fora dos literais, CTE fechando num statement.

E a correção não foi um contador no laço: foi separar O QUE É O RAMO de
COMO OS RAMOS SE LIGAM. Concatenar SQL cegamente dentro de um laço é como
esse erro nasce.

Junto, uma terceira coisa: os inválidos comparavam com `=`. Se o SQL
ACEITASSE um vetor inválido, `validar` devolve NULL e `NULL = 'motivo'` é
NULL — a linha viria em BRANCO, não `false`. Falha que se apresenta como
célula vazia é a pior forma de falha. Virou `is not distinct from`.

## 60. Quatro defeitos de tela que só o uso real achou

Depois de selar o `R-000013`, o usuário reparou em coisas que nenhum
teste desta sessão pegaria — todas da mesma família, a que este projeto
persegue desde o §39: **a tela afirmando o que não sabe, ou não dizendo o
que sabe.**

**1. "Assinatura do caixa" estava fixo no código.** Ele selou como admin
e a tela dizia "caixa". `tipo_signatario` é o nome do SLOT (o lado da
farmácia) e está dentro do hash — nunca foi afirmação sobre cargo, mas a
tela lia como se fosse. Virou "Assinatura DA FARMÁCIA", com o cargo real
vindo de `papel_no_momento`, que a 2A acabara de passar a gravar. Nas
assinaturas antigas a linha não aparece: derivar de `profiles.papel`
mostraria o cargo de HOJE pra um ato de meses atrás, que é exatamente o
que a coluna existe pra evitar.

**2. O romaneio não mostrava o retorno.** Ele esperava ver o horário e
não achou. O PDF mostra os quatro relógios desde 18/08; a PÁGINA não
mostrava nenhum. Corrida ainda aberta agora é DITA, não omitida.

`duracaoDaCorrida` mudou de `romaneioPdf.ts` pra `lib/datas.ts` —
importar aquele módulo só pela duração puxaria o gerador de PDF pro
bundle principal. Chunk conferido no build: continua separado.

**3. As corridas abertas vinham da mais antiga.** Virou descendente, a
pedido. Seguro porque `LIMITE_OPERACIONAL` é 500: não há truncamento
silencioso, que é o que tornaria a ordem uma decisão sobre o que se
PERDE em vez de sobre o que se vê primeiro.

**4. A lista não identificava a corrida.** Mostrava motoboy, horário e
"N vale(s)" — com duas corridas do mesmo motoboy, só o relógio
distinguia. Os vales JÁ VINHAM na consulta e simplesmente não eram
desenhados.

**O padrão que liga o 1 e o 2, e que vale mais que os quatro:** o PDF e a
tela evoluíram SEPARADOS. O PDF sabia dizer "corrida ainda aberta" e
mostrar os relógios; a tela não sabia. O mesmo documento contava duas
histórias conforme onde se olhava. Quando o Romaneio de Retorno ganhar
PDF (etapa final da frente), vale conferir os dois lado a lado antes de
considerar pronto.

**E uma coisa que eu fiz errado e vale registrar como método:** descrevi
o E2E do item 10 como se algo novo fosse aparecer na tela. Não era — a
mudança do item 7 é invisível por construção, e o teste era de
REGRESSÃO: provar que nada mudou pra quem opera. O usuário foi procurar
uma assinatura extra que nunca ia existir. Descrever teste de regressão
com vocabulário de teste de funcionalidade manda a pessoa procurar o que
não há.

## 61. O item 60 tinha consertado um lugar de três, e as colunas dos relógios

Sessão de 2026-08-20. O usuário voltou à página do romaneio e achou as
duas coisas: *"ainda têm o signatário como caixa"* e *"o Retorno (balcão)
tem que estar embaixo da Saída (balcão), lado do balcão com balcão,
servidor com servidor"*.

### O rótulo: consertei o bloco e esqueci a página em volta

O item 60 trocou "Assinatura do caixa" por "Assinatura DA FARMÁCIA" —
**dentro do `BlocoAssinatura`**. A mesma página dizia "caixa" em mais dois
lugares que eu não olhei, e o PDF em mais dois:

| onde | dizia | diz |
|---|---|---|
| `Romaneio.tsx`, campo do cabeçalho | `Caixa` | `Pela farmácia` |
| `Romaneio.tsx`, bloco Integridade | `assin. caixa` | `assin. farmácia` |
| `romaneioPdf.ts`, "quem e quando" | `Caixa` | `Pela farmácia` |
| `romaneioPdf.ts`, bloco da assinatura | `Caixa` | `Farmácia · <cargo>` |

**O PDF entrou porque o item 60 previu exatamente isto** — "o PDF e a
tela evoluíram SEPARADOS, o mesmo documento contava duas histórias
conforme onde se olhasse". Consertar só a tela repetiria o defeito com o
usuário imprimindo o papel e lendo "Caixa" de novo.

E o PDF perdia informação que a tela já tinha: ele não mostrava
`papel_no_momento`. Trocar o rótulo sem isso deixaria o documento
impresso sem dizer o cargo de ninguém. Agora sai `Farmácia ·
Administrador`, e `Farmácia` sozinho quando a coluna é nula (assinatura
anterior a 19/08) — derivar de `profiles.papel` mostraria o cargo de
HOJE, que é o que a coluna existe pra evitar.

`PAPEL_LABEL` virou **`src/lib/papeis.ts`**, importado pela tela e pelo
PDF, porque duas cópias dele seriam o defeito do item 60 outra vez — com
um rótulo no lugar de um relógio. Ele não importa nada, o que é o que
permite o `romaneio-pdf.spec.mts` continuar rodando em `npx tsx`
(importar de `data/` puxaria o cliente Supabase e `import.meta.env`, a
armadilha do item 57).

### As colunas: fluxo automático não pareia campo opcional

A seção era **um** grid `sm:grid-cols-2` de fluxo automático com os onze
campos soltos — e dois deles condicionais ("Recebido pelo servidor", só
offline; "Retorno (balcão)", só com a corrida fechada). Com fluxo, quem
decide a coluna é a contagem de itens anteriores: bastava o campo do
offline aparecer pra "Retorno (servidor)" cair na esquerda e "Retorno
(balcão)" na direita. **As colunas trocavam de lado conforme o
romaneio.**

A regra 8 só serve pra alguma coisa se der pra comparar os dois relógios
de bater o olho. Agora são **duas colunas explícitas** — um `div` por
coluna, balcão à esquerda, servidor à direita — e não ordem de fluxo. A
Duração ficou embaixo das duas, com `col-span-2`: ela é derivada dos
relógios de servidor dos dois lados, então não pertence a nenhuma
coluna. Identificação e IP saíram pra um bloco próprio acima.

### O terceiro estado que ninguém tinha visto

Mexendo ali apareceu que a página dizia **"corrida ainda aberta" para
romaneio em CONFLITO** — e conflito não tem corrida nenhuma
(`corrida_id` é nulo por construção). São três estados que não podem se
parecer, e um campo vazio diria a mesma coisa nos três:

    conflito                          → "sem corrida vinculada"
    corrida aberta                    → "corrida ainda aberta"
    fechada antes de 2026-08-10       → "não registrado"   (só no balcão:
                                         `retorno_em_local` não existia)

O terceiro é o que o "Retorno (balcão)" precisava e não tinha: ele era
condicional, sumia, e "o motoboy não voltou" ficava indistinguível de "a
coluna não existia naquele dia".

### Como testei sem logar

Chegar nesta tela pelo app exige senha, e senha não se digita em nome do
usuário. Então `scripts/conferir-romaneio-na-tela.js`, no formato dos
`conferir-*-no-console.js`: renderiza o componente **real** com um
QueryClient pré-semeado, três cenários (fechada online / offline com
corrida aberta / conflito), e **mede a posição X de cada rótulo** — é
isso que prova a coluna. Comparar texto não provaria nada: no grid antigo
os dois "Retorno" trocavam de lado e o texto continuava idêntico.

    Saída (balcão)    x=265 y=206  │  Selado (servidor)     x=645 y=206
    Retorno (balcão)  x=265 y=230  │  Recebido (servidor)   x=645 y=230
                                   │  Retorno (servidor)    x=645 y=254
    Duração           x=265

Sete asserções de rótulo e cinco de coluna, todas verdes, em aba limpa e
console sem erro. O spec do PDF ganhou seis casos no mesmo espírito —
inclusive os dois NEGATIVOS (`não chama de "Caixa"`, `assinatura legada
não inventa cargo`), pelo mesmo motivo dos `v2 não é mais lido` do item
53: sem eles, "tirei o rótulo errado" e "esqueci de tirar" ficam
indistinguíveis. Total: 36 casos, todos passando. `tsc -b` e `npm run
lint` limpos, chunk do `romaneioPdf` ainda separado (5,35 kB).

### Três armadilhas do próprio instrumento, de novo

É a oitava, nona e décima vez que o teste falha por causa do teste — e
as três só apareceram porque o script renderiza componente de verdade:

- **Tela em branco, console limpo.** Importar
  `/node_modules/.vite/deps/react.js` **sem o `?v=<hash>`** carrega uma
  SEGUNDA instância do React; os hooks rodam contra um dispatcher que não
  é o do root e nada renderiza, sem erro nenhum. O hash é lido do módulo
  transformado em tempo de execução, porque ele muda a cada re-otimização
  do Vite (item 45).
- **`import()` com expressão faz o Vite reescrever o arquivo**, injetando
  um `import` estático no topo — e aí ele para de rodar dentro de um
  `AsyncFunction` ("Cannot use import statement outside a module"). A
  chamada ficou escondida num `new Function`.
- **`innerText` devolve o texto RENDERIZADO**, com o `uppercase` do CSS
  já aplicado, então procurar `'Assinatura da farmácia'` dava falso
  negativo num título que a tela mostra em caixa alta.

E uma quarta que não é do instrumento e sim de onde ele roda: o painel do
navegador estava com **316px de viewport**, abaixo do breakpoint `sm:`,
então as colunas legitimamente empilhavam e as asserções davam `false`. O
script passou a devolver `viewport` e `duasColunas` junto do resultado —
número de layout sem a largura ao lado não quer dizer nada.

## 62. O "sincronizando…" que nunca terminava

Sessão de 2026-08-20, logo depois do item 61. Relato do usuário: *"'—
sincronizando…' às vezes não some, em alguns casos fica o texto lá"*,
mais um pedido — *"adicionar movimento às reticências"*.

### Não era "às vezes": era sempre, e o texto era uma afirmação falsa

As três telas de lançamento montavam a frase inteira à mão e a punham num
`useState` que **nada limpava**:

```ts
setStatus({ kind: 'ok', texto: `Entrega de ${nome} salva — sincronizando…` })
```

Ela só saía do ar quando outra gravação a substituía ou quando a tela era
desmontada. Ou seja: continuava dizendo que havia sincronização em curso
muito depois de a operação ter subido — e continuava **exatamente igual**
se a operação tivesse falhado, ficado presa por dependência, ou virado
conflito. Três desfechos opostos com a mesma aparência.

É o §39/§49/§51 de novo: a tela afirmando o que não sabe. Aqui com o
agravante de que a frase citava um processo em andamento que já tinha
acabado — e o que o usuário leu como "não some" era, na verdade, "nunca
teve fim".

Estavam assim `CadastroEntrega`, `CadastroTransferencia` e
`RetornoCorrida`. Os dois dialogs que também enfileiram
(`NotificarOcorrenciaDialog`) não têm o problema: eles fecham na hora.

### A frase passou a ser derivada da fila

`enfileirarOperacao` agora **devolve a chave da fila**, e
`useSituacaoDaOperacao(idFila)` traduz o estado real:

| fila | tela |
|---|---|
| item presente, `pendente` | "… salva — sincronizando" + reticências animadas |
| item some | "… salva — sincronizada", e o aviso se apaga sozinho em 2,5s |
| `erro` | "…, mas ainda não subiu — vou tentar de novo sozinho" |
| `terminal` | "…, mas a sincronização parou. Abre 'Precisa de atenção' no topo" |
| `bloqueado` | "…, está registrada por outra conta" |
| o `put` rejeitou | "Não consegui salvar neste computador: …" |

Só o caso feliz se apaga sozinho. **Aviso de problema que desaparece
enquanto ninguém olha seria o mesmo defeito de cabeça pra baixo.** E
offline a frase fica em "sincronizando" indefinidamente — porque é
verdade, e o indicador do cabeçalho conta quantas estão paradas.

O último caso é novo: `void enfileirarOperacao(...)` engolia uma falha de
`put` e o caixa via "salva" com nada salvo.

Tudo num componente só (`StatusDeGravacao.tsx`), e isso é parte do
conserto: com a lógica em cada tela, foram três telas esquecendo de
limpar. A cláusula de sincronização saiu das strings — as telas afirmam
só o fato consumado ("Entrega de José salva"), e quem escreve o resto é
quem olha a fila.

### Três defeitos que eu mesmo introduzi, e como cada um apareceu

Vale registrar porque nenhum apareceu por leitura — os três só existiram
porque o teste roda contra o IndexedDB de verdade e o React de verdade.

**1. O timer que nunca disparava (e reproduziria o bug relatado).** O
sumiço era um `setTimeout` num `useEffect` com `onLimpar` nas
dependências. As três telas passam uma arrow inline — **função nova a
cada render** —, então qualquer re-render do pai recriava o timer. O
caixa digitando a próxima entrega seguraria o aviso na tela pra sempre.
O defeito de origem, reintroduzido pela porta dos fundos. `onLimpar`
virou ref; o caso 9 do script força o pai a redesenhar durante a janela
inteira e **mede o maior intervalo entre redesenhos** (1.010ms < 2.500ms)
— sem essa medida o teste passaria por sorte.

**2. Uma corrida na largada.** A primeira versão do hook lia a fila
inteira e procurava o item na lista. Entre `idFila` aparecer e a
liveQuery reconsultar, o array em mãos ainda é o de ANTES do `put`: o
item "não está lá" e o aviso concluía **sincronizada** por um instante —
com o timer de sumiço já partindo, ou seja, a mensagem podia se apagar
antes de a operação subir. Apareceu como uma falha intermitente do
próprio script (`pontos[0] is undefined`, porque as reticências nem
chegaram a existir). A saída não foi timer nem heurística: consultar
**pelo id** e carimbar no resultado de qual id ele é. Enquanto o carimbo
não bate, a resposta honesta é "ainda não sei" — e "ainda não sei" aqui
se diz *sincronizando*, que é o que de fato está acontecendo.

**3. Rejeição não tratada no console.** Quem trata é o efeito, e efeito
roda num tick posterior: até lá o navegador já classificou a promessa
como `Uncaught (in promise)`. A tela mostrava a mensagem certa e o
console acusava erro ao lado. `gravacaoEnfileirada()` anexa um `.catch`
vazio no mesmo tick da criação — `.catch` registra uma reação sobre a
original, não a consome, então quem trata depois continua recebendo.

### O movimento, e a armadilha do `prefers-reduced-motion`

Três `<span>` pulsando em onda (opacidade + `translateY(-2px)`, atrasos
de 0 / 0,16 / 0,32s), em `Reticencias.tsx`, com a animação no
`index.css`. São três elementos e não um `…` animado por causa do
layout: eles ocupam sempre o mesmo espaço, enquanto animar `.` → `..` →
`...` mudaria a largura da frase três vezes por segundo. `translateY` e
não `top` pelo mesmo motivo — transform não participa do layout.

**E aí a medição pegou uma coisa que eu teria entregado quebrada.** Eu
tinha escrito o `@media (prefers-reduced-motion: reduce)` do jeito
padrão, `animation: none`. O navegador desta máquina **responde
`reduce`** — e o teste voltou `animacoes: 0` com `rodando: true`, porque
`every()` de lista vazia é `true`. Duas coisas de uma vez: o instrumento
concordando com o defeito (oitava vez no projeto), e a possibilidade real
de o PC do balcão estar igual e o usuário nunca ver movimento nenhum.

A correção mudou a regra em vez de burlá-la: com movimento reduzido some
o **deslocamento**, não o sinal. Fica o esmaecer, mais lento e sem sair
do lugar. `prefers-reduced-motion` é sobre movimento — deslizar, saltar,
parallax —, e o que informa aqui é o pulso; matar a animação inteira
devolveria exatamente o estado anterior, três pontos parados,
indistinguíveis de uma frase esquecida na tela.

O ramo cheio não dá pra exercitar (não se alterna media query pelo JS),
então o script força o keyframe inline e **amostra o `transform` ao
vivo**: `matrix(…, -1.88774)` no pico contra `matrix(…, 0)` no repouso.
Se `reticencia-pulsa` não existisse ou não mexesse em nada, as duas
leituras seriam iguais.

### O teste

`scripts/conferir-aviso-de-sincronizacao.js`, no formato dos outros
`conferir-*-no-console.js`. Dez casos contra o **IndexedDB real** e o
React real — a liveQuery da Dexie é metade do mecanismo, e um dublê
provaria o componente e não o acoplamento, que é onde os defeitos 1 e 2
moravam. Ele escreve um item na fila de verdade, exercita os cinco
desfechos, e o caso 10 confere que a fila voltou exatamente ao que era.

Dez de dez em três execuções seguidas, aba limpa, console sem erro.
`tsc -b`, lint e build limpos; o CSS sai no bundle de produção com os
dois keyframes.

## 63. As reticências no resto do app

Continuação direta do item 62, a pedido: *"sim, aplica nos outros
também"*. Quarenta e um rótulos de processo passaram a ter reticências
animadas.

### A regra que separa o que anima do que não anima

Não é "todo `…` anima". Ficou escrita em `EmAndamento.tsx` e no
CLAUDE.md:

```
reticência de PROCESSO     → anima   (Carregando, Salvando, Enviando…)
reticência de TRUNCAMENTO
       ou de PLACEHOLDER   → parada  (1 … 5 6 … 84, hash abc123…,
                                      Selecione…, Motivo…)
```

Movimento onde o `…` quer dizer "tem mais coisa" ou "escolha algo" seria
mentira — a mesma família de defeito que o item 62 corrigiu, com o sinal
trocado. Sobraram 19 reticências paradas no `src/`, e conferi uma a uma:
todas são truncamento de hash, corte de nome longo na credencial, vão da
paginação, placeholder de select, ou comentário.

### Três componentes, e cada um resolve um problema diferente

`src/components/EmAndamento.tsx` (o `Reticencias.tsx` do item 62 virou
este, pra os três morarem juntos):

- **`<Reticencias />`** — os três pontos, o primitivo.
- **`<Carregando />`** — o parágrafo. Existia como
  `<p className="text-sm text-muted-foreground">Carregando…</p>` copiado
  à mão em **19 lugares**, que é exatamente por que ele ia sair de 19
  lugares na hora de animar. Aceita `texto` (o "Carregando filiais" da
  transferência) e `className` (o `p-4` do romaneio, o `text-base` da
  tela de carregamento inicial).
- **`<EmAndamento>Salvando</EmAndamento>`** — o rótulo de botão, e o
  `<span>` dele não é supérfluo.

**O `<span>` é a única parte com risco real, e ela foi medida.** O
`Button` do shadcn é `inline-flex` com `gap-1.5`: `<Reticencias />` solto
lá dentro vira um item de flex separado do texto e ganha 6px de
distância — "Salvando   . . .". Envolvidos num `<span>`, são um item só.
O caso 11 do script monta **as duas formas lado a lado** e mede:

```
com <EmAndamento>   0px   ← colado
solto              -6px   ← o gap-1.5 do botão, exatamente
```

Sem montar a forma errada junto, a certa passaria sem provar nada — o
método do §22 e do §49.

### O que a aplicação em massa custou

Foram 41 substituições em 21 arquivos, feitas por script com contagem
exata (cada padrão tinha que casar N vezes, senão parava). O que o script
errou foi o **import**: ele inseria depois da última linha começando com
`import `, e num `import {` multi-linha isso cai DENTRO do bloco. Nove
arquivos ficaram com um import no meio de outro.

O conserto expôs uma segunda camada: **três desses arquivos são CRLF** e
a linha inserida era LF pura, então o `import {` anterior era na verdade
`"import {\r"` e o corretor não o reconhecia. Ficou anotado porque volta
a morder: nesta pasta convivem arquivos CRLF e LF, e comparação de linha
em script precisa tolerar o `\r`. Conferido no fim que **nenhum arquivo
ficou com fim de linha misto**.

### Uma advertência de lint que apontou pra um lugar melhor

`gravacaoEnfileirada` morava em `StatusDeGravacao.tsx`, e exportar
função não-componente ali desliga o Fast Refresh do arquivo — justamente
o que mais se mexe quando se ajusta texto de tela, numa máquina onde
módulo velho em memória já custou um diagnóstico (§41). Ela e o tipo
`Gravacao` foram pra `filaOffline.ts`, que é de quem eles falam. O
componente reexporta o tipo, então nenhum call site mudou de forma. Lint
voltou às 8 advertências pré-existentes.

### Verificação

Os casos 11 e 12 entraram no
`scripts/conferir-aviso-de-sincronizacao.js` (agora 12 casos), e o
`conferir-romaneio-na-tela.js` do item 61 foi rodado de novo — os dois
verdes, em aba limpa, console sem erro. `tsc -b`, lint e build limpos.

## 64. Etapa 2B — e o defeito que ela achou no contrato congelado

Sessão de 2026-08-20. Pedido: "vai para a etapa 2b". Antes da primeira
linha da transação, lendo o que ela ia encostar, apareceu uma coisa que
ela não podia ser construída por cima.

### O domínio de `forma` do DCRR1 era o do schema inicial

```
schema inicial, 2026-08-06   dinheiro credito debito pix convenio vale outro
migration 20260807123331     dinheiro credito debito pix convenio convcard crediario outro
DCRR1 congelado, 19/08       dinheiro credito debito pix convenio vale outro   ← o de cima
```

A lista foi transcrita do arquivo errado, doze dias depois de o banco ter
mudado. `vale` saiu ("não é usado, confundia com número do vale da
entrega") e continuou no contrato; `convcard` e `crediario` entraram e
não entraram nele.

**As duas metades custavam caro, na mesma transação e no pior momento.**
Um cliente pagando com cartão de convênio faria o canônico responder
`forma_invalida` e o retorno não selaria — depois de colhidas as duas
assinaturas, com o motoboy no balcão. E `vale` passaria pelo canônico pra
morrer no INSERT em `pagamentos`, dentro do selo.

O que torna isso inequívoco é que a **justificativa do próprio vetor
I010**, escrita à mão junto com o contrato, já dizia qual era a intenção:
*"O domínio é o CHECK de `pagamentos.forma`. Valor fora dele passaria
pelo canônico e morreria no INSERT, dentro da transação do selo — depois
de colhidas as duas assinaturas."*

**E aqui está a lição que vale além deste caso.** Os três lugares
concordavam — vetores, TS e SQL — porque os três copiaram o mesmo
engano. Golden vector trava a IMPLEMENTAÇÃO contra a ESPECIFICAÇÃO; não
trava a especificação estar certa sobre o banco. O triângulo de três
referências, que a 2A montou justamente pra não depender de dois gêmeos
concordarem, tinha o vértice de cima apontando pro lugar errado.

O usuário escolheu alinhar ao banco e trouxe o fluxo real de cada forma:
`convcard` é o cliente mandando os dados do cartão pra farmácia passar a
compra — pagamento de verdade, e o documento tem que poder dizê-lo.
`crediario` é a forma financeira **e** um papel que sai pra assinar.

**A parte do papel ficou fora, por decisão dele, e o motivo é bom:**
enfiar a custódia do carnê na linha `pr` faria o documento confundir "o
dinheiro foi combinado" com "o papel voltou assinado". Fica pra um bloco
`d` próprio, depois de levantado o fluxo (quem imprime, quem leva, quem
assina, se volta na mesma corrida, o que acontece quando não volta) —
e antes do primeiro retorno real ser selado, senão vira `DCRR2`. Isso
revisa parcialmente a decisão de manter toda custódia de papel fora do
retorno: o papel do crediário pertence ao ciclo da corrida, ao contrário
da receita e do convênio, que voltam dias depois.

Corrigido nos quatro lugares (os vetores, o `FORMAS` do spec deles, o
gêmeo TS e uma migration nova pro gêmeo SQL — a `20260819140000` já foi
aplicada e não se edita). Mais dois vetores válidos (V009 `convcard`,
V010 `crediario`) e um inválido (I013, `vale` **não é mais** forma, pelo
mesmo motivo dos casos `v2 não é mais lido` do parser do cartão).

**Nenhum hash existente se moveu** — o diff dos vetores só ACRESCENTA
linhas de `bytes`/`sha256`, e era isso que o usuário tinha pedido pra
provar. E as contagens dos dois novos foram somadas campo a campo na
mão antes de rodar o Node: 363 e 365, bateram.

**Conferido nos três lados, em 2026-08-20:**

```
vetores × especificação   259 asserções, 0 falhas
TypeScript × vetores       70 asserções, 0 falhas
SQL × vetores              43 de 43        ← rodado no banco pelo usuário
```

Duas linhas daquele 43 valem mais que as outras. **I013 verdadeiro** é o
que prova que a migration foi aplicada — só o validador novo recusa
`vale`, e com o antigo aquela linha viria `false`. E **V009/V010 nos três
critérios** provam a outra metade: se a migration não estivesse
aplicada, essas seis linhas nem viriam `false`, porque
`romaneio_retorno_canonico` levanta exceção com entrada inválida e a
consulta inteira teria morrido. As 24 de V001 a V008 seguem intactas,
que é a prova de que o domínio mudou sem nenhum documento válido mudar
de bytes.

Duas coisas menores que saíram junto: o spec dos vetores exigia "um vetor
por classe de erro", e a exceção do `forma_invalida` virou **nomeada** em
vez de a regra ser afrouxada — assim uma segunda duplicata, essa por
descuido, continua caindo. E o gerador do SQL trazia "36 linhas" e "20
selects" fixos no cabeçalho quando já eram 43: número escrito à mão
dentro de texto gerado envelhece calado, e quem vai rodar a conferência
lê o cabeçalho pra saber o que esperar.

### A 2B

`20260820130000_selar_romaneio_retorno.sql`, quatro funções:
`romaneio_retorno_payload`, `registrar_conflito_retorno`,
`selar_romaneio_retorno_interno` e a porta online
`selar_romaneio_retorno`.

O que ela obedece da 2A, e que não dá pra descobrir lendo só o desenho:

- **nenhum cast de `timestamptz` no hash.** `timestamptz::text` depende
  do `TimeZone` da sessão, e a fórmula da SAÍDA tem esse problema
  latente — o verificador só funciona porque fixa UTC. Aqui o instante
  entra por `to_char(... at time zone 'UTC', máscara)`;
- **`papel_no_momento` DENTRO do digest**, desde o primeiro dia. Na saída
  ele é metadado ao lado porque a fórmula já estava assinada;
- **`responsavel_loja`, não `caixa`** — e quem escrever o verificador tem
  que ler `tipo_signatario` da linha, senão não verifica as duas eras.

E a decisão de desenho que a 2B teve que tomar sozinha, porque o CLAUDE.md
não a cobria: **recusa é conflito, não exceção.** Quando o retorno chega
na função, o motoboy já devolveu os vales e as duas partes já assinaram;
um `raise` daria rollback e levaria a prova junto. Então corrida já
fechada, hash que não bate, vale a mais ou a menos, outro motoboy e
documento inválido viram `romaneios` com `status = 'conflito'` guardando
os dois traços — mesmo desenho do `R-000004` da saída. Continua sendo
exceção o que não tem prova a preservar: sessão inválida, saída
inexistente, autorização inválida, papel fora do domínio.

Detalhe do schema que cai bem: conflito de retorno tem `corrida_id` nulo,
então não colide no `UNIQUE (corrida_id, tipo)` — um retorno recusado
**não consome a única vaga** daquela corrida, e dá pra tentar de novo
depois de resolver.

### Quatro defeitos meus, achados relendo o que eu tinha acabado de escrever

Nenhum apareceria antes de a tela existir, e dois quebrariam telas atuais
em silêncio:

1. **`pagamento_alterado` com payload próprio.** `notificacoes.ts` e
   `auditoria.ts` leem `de`, `para`, `justificativa` e `autor_nome` — o
   meu tinha `previsto`/`realizado`, e as duas telas mostrariam "Era
   undefined, virou undefined". Passou a emitir o MESMO formato de
   `marcarDivergencia`, com as chaves extras ao lado.
2. **`insucesso_detalhado` sem `autor_nome`**, mesma família: o autor
   apareceria em branco nas Notificações.
3. **O snapshot não normalizava** motivo e detalhe de vale `entregue`, e o
   canônico normaliza. O PDF do retorno sai do snapshot, como o da saída
   — mostraria um motivo que o documento assinado não afirma.
4. **`observacoes` era gravada mesmo em vale entregue**, pelo mesmo
   descompasso.

A `justificativa` do evento derivado diz, com todas as letras, que
ninguém a digitou. A divergência do retorno é consequência dos fatos, não
decisão manual — e a gestão lê aquele campo como se fosse alguém
explicando.

### As duas migrations aplicadas, e as recusas medidas

Aplicadas pelo usuário em 2026-08-20, nesta ordem. O gêmeo SQL do DCRR1
voltou **43 de 43** (acima), e as recusas da 2B foram exercitadas contra
a corrida aberta do `R-000014`:

```
(a)  vale faltando            nao aplicavel — a corrida tem 1 vale só
(a2) vale sobrando            vales_nao_conferem
(b)  outro motoboy            outro_motoboy
(c)  saida_hash nao confere   saida_hash_nao_confere
(d)  so falta a autorizacao   42501 | Autorização inválida, expirada, …
```

**O (d) é o que prova mais.** Parar na autorização só acontece se a saída
foi encontrada, o `saida_hash` bateu, a corrida está aberta, não existe
retorno ainda, os vales conferem exatamente, o motoboy é o da custódia, o
DCRR1 foi reconstruído do input estruturado e o hash do documento fechou.
Qualquer uma dessas falhando teria devolvido conflito ANTES de chegar
lá — a autorização é consumida depois de todas, de propósito.

O (a) não era exercitável e o (a2) resolveu: com um vale só não há como
FALTAR vale, mas há como SOBRAR. Mesmo ramo, mesma linha de código, pelo
outro lado — e ele voltou `faltando []` com o uuid inventado em
`sobrando`, que é a recusa dizendo exatamente o que viu.

**Décima primeira vez que o instrumento mente, e desta vez com o
resultado certo do lado.** O `raise` do (a2) imprimiu `R-000014s` e um
uuid terminando em `s`: eu tinha escrito `%s` nos placeholders, e o
placeholder do `raise` do PL/pgSQL é `%` PURO — `%s` é do `format()`.
Não dá erro; o `s` sobra como literal grudado no valor. Os valores
estavam corretos, a leitura é que ficava mentindo. Corrigido no script.
Repare que o outro arquivo não tinha o problema justamente porque lá as
linhas de caso saem de `format()`, onde `%s` é o certo — as duas funções
têm sintaxe de placeholder diferente, e misturá-las é fácil.

### Dois defeitos no MEU roteiro de conferência, e eles se repetem fácil

O rodapé que eu tinha escrito na migration mandava rodar as recusas num
`begin … rollback`. Errado nas duas pontas:

- **o caso (d) levanta exceção de propósito**, e exceção aborta a
  transação inteira — os resultados de (a) a (c) sumiriam junto e o
  editor mostraria só o erro do último caso. O (d) precisa de um bloco
  aninhado com `exception when others`, que desfaz só a própria
  subtransação;
- **num `begin … rollback` o editor mostra o último statement**, que é o
  `rollback`: nada. Pôr o `select` por último resolveria a exibição e
  deixaria a transação ABERTA, dependendo de alguém lembrar de desfazer.
  Conferência que depende de ninguém esquecer não é conferência.

A versão que ficou (`scripts/conferir-2b-no-sql-editor.sql`) termina em
`raise exception` com o relatório na mensagem: desfaz tudo que escreveu e
mostra o resultado sem depender de ninguém. **O erro vermelho é o
resultado**, e isso está dito no cabeçalho — senão parece falha.

É a mesma família do defeito do gerador do DCRR1 em 19/08 (20 statements
onde o editor mostra um). Vale a regra: **conferência no SQL Editor
termina em UM resultado, e ela mesma tem que desfazer o que escreveu.**

### A ordem que vem, reordenada pelo usuário — e ele estava certo

```
2B.1  transação e recusas                    ✓
2B.2  DCRR1 no SQL                           ✓  43/43
2B.3  baseline das saídas                    ✓  10 · 10 · 0

2B.4  verificador de hashes do retorno       ✓  11 · 11 · 0
2B.5  bloco `d` do crediário                 ✓  65/65 e 8/8
2B.6  repetir vetores, gêmeos e verificador   ← agora (já verdes)

2C    fila offline + envelope + sync-romaneio
2D    tela + caminho feliz real
```

**O prazo do bloco `d` era mais curto do que eu tinha escrito.** Eu vinha
dizendo "antes do primeiro retorno real ser selado". O usuário apontou o
prazo verdadeiro: **antes da 2C**. A fila persiste em IndexedDB o payload
que produz o `document_hash`, e um item parado na fila de um caixa já é
um documento assinado esperando subir. Mudar o formato depois disso não
quebra só código — quebra o que está guardado no navegador de quem já
usou, contra um servidor que passou a esperar outra coisa. Construir
`sync-romaneio` sobre um contrato com uma última mudança gratuita
pendente é garantir retrabalho de DADO, não de código.

**E a correção sobre o verificador vale mais que a reordenação.** Eu
tinha escrito "um ramo próprio pra fórmula nova", que é ambíguo o
bastante pra alguém ler como "unificar as duas fórmulas". Não é isso:

```
verificar_romaneio(id)
  ├── lê `tipo_signatario` DA LINHA          (comum, sempre)
  ├── tipo = 'saida'   → fórmula histórica da saída
  ├── tipo = 'retorno' → fórmula DCRR1
  └── diagnóstico uniforme por camada
```

As duas já são criptograficamente diferentes: a saída concatena
`selado_em::text`, o retorno usa `to_char` com máscara e ainda inclui
`papel_no_momento` no digest. **O verificador reproduz o documento como
ele foi criado, defeitos históricos da fórmula incluídos** — o `to_char`
conserta a fórmula NOVA e não muda retroativamente o significado de
nenhum hash já assinado. "Melhorar" a fórmula da saída dentro do
verificador transformaria a ferramenta de medir em fonte de divergência.

O que continua comum é ler `tipo_signatario` da linha. Nunca
`if saida then 'caixa' / if retorno then 'responsavel_loja'`, que é fixar
o literal com passos extras.

### 2B.4 — e o baseline que não é um número fixo

Aplicada em 2026-08-20 (`20260820140000`). Ela não era opcional, e o
motivo eu tinha registrado ERRADO duas vezes: escrevi que
`verificar_romaneios_selados()` "conta só as saídas" e continuaria em
10 · 10 · 0 depois do primeiro retorno. Não conta — ela filtra por
`status = 'selado'`, **não por tipo**. Um retorno selado já entraria no
placar aplicando a fórmula da saída e reportando duas camadas de
assinatura como divergentes. O baseline iria pra `11 · 10 · 2`, e a
divergência não seria de integridade nenhuma: seria o instrumento
medindo a coisa errada. Instrumento que acusa defeito onde não há custa
uma investigação e a confiança no resto do placar.

**O resultado da aplicação foi `11 · 11 · 0`, e o gate era 10.** Não é
falha, e a diferença entre "não é falha" e "explicada" é justamente o que
o projeto cobra. A explicação fecha por contagem contra a sequência:

```
selados   11   R-000001 03 05 06 07 08 10 11 12 13 14
ausentes   3   R-000002 04 09        ← exatamente os 3 conflitos
------------------------------------
11 + 3 = 14 = maior número emitido
```

Todo número explicado, nenhum documento perdido. O 11º é o `R-000014`, a
saída selada no meio da própria sessão pra a conferência da 2B ter
corrida aberta.

**O gate nunca foi "o número é 10"** — é "as mesmas que verificavam
continuam verificando, e nenhuma sumiu". Eu enunciei mal ("qualquer coisa
diferente de 10 · 10 · 0, para"), e enunciar mal um gate é quase tão ruim
quanto não ter gate: da próxima vez que ele mover por um motivo legítimo,
alguém para sem precisar, ou pior, aprende a ignorá-lo. A forma checável
é a contagem acima, e é por isso que o resumo traz `conflito (fora do
placar)` em linha própria: sem esse número, os três buracos na sequência
não teriam como ser explicados, e `9 · 9 · 0` pareceria tão saudável
quanto `11 · 11 · 0`.

**Duas coisas que os dados provaram de graça**, e nenhuma delas eu teria
como afirmar sem elas:

- os três `offline_sincronizada` (`R-000001`, `06`, `10`) verificam, o
  que prova que o último componente da fórmula continua saindo de
  `romaneios.modo` e não virou literal na extração — é a regra 2
  sobrevivendo ao drop e recreate;
- o `R-000013` verifica, e ele é o ÚNICO com `papel_no_momento`
  preenchido. Se a extração tivesse acidentalmente incluído o papel no
  digest da saída, ele — e só ele — divergiria, com os outros dez
  passando. Um teste discriminante que aconteceu sozinho.

### O que ainda falta

- **O caminho feliz não tem como ser testado daqui**: exige cartão e PIN,
  e o E2E é de tela (2D).
- **O caso (a) por FALTA de vale** continua sem transporte real — a única
  corrida aberta tinha um vale. O ramo está coberto pelo outro lado
  (sobrando), e vale exercitar o lado que falta quando existir uma
  corrida de dois vales ou mais.
- **O verificador do RETORNO nunca rodou contra um retorno**, porque não
  existe nenhum. As cinco camadas dele (incluindo `saida_referenciada`)
  são código não exercitado até a 2D.

## 65. Etapa 2B.5 — o bloco `d`, e as TRÊS cópias do mesmo conversor

Sessão de 2026-08-20, depois da 2B.4. O usuário trouxe o processo real da
farmácia e mandou tratar como decisão de domínio.

### O que o fluxo real respondeu

Perguntei seis coisas antes de desenhar. As respostas decidiram o
contrato inteiro:

| pergunta | resposta | o que decidiu |
|---|---|---|
| quando o papel existe? | emitido na VENDA, sai com a entrega | a saída já sabe: obrigatoriedade sai do canônico assinado dela |
| quantas vias voltam? | UMA (a nota fiscal fica com o cliente) | `d` sem quantidade e sem id |
| volta na mesma corrida? | sim; excepcionalmente outro tele busca depois | ver `faltante` abaixo |
| e se não voltar? | "o tele PRECISA voltar e trazer" | `faltante` é pendência aberta, não desfecho |
| volta sem assinatura? | nunca aconteceu | o domínio não julga assinatura |
| e no insucesso? | não soube | já estava respondido, ver abaixo |

A sexta não precisava de estado novo, e vale registrar por quê: o papel
sai com a entrega, e se a entrega falha ele volta EM BRANCO — o que é
`recebido`, porque presença física é o que a palavra significa. O próprio
usuário já tinha escrito esse exemplo na especificação.

E a terceira abriu a consequência que mais vale guardar. Se o documento
chegar noutra corrida, a corrida B **não pode** declará-lo: aquele vale
não estava na saída dela. Então o DCRR1 da corrida A grava `faltante`,
que era verdade naquele instante, e a chegada posterior é evento sobre o
vale. Alguém vai querer "consertar" aquele `faltante` daqui a seis meses;
é a regra 7 dizendo que não.

### A fronteira, congelada pelo usuário

```
canônico PURO      domínio, duplicata, normalização, ordenação, bytes
                   NÃO sabe o que a saída esperava

selar_romaneio_    esperado = declarado, contra a saída selada
retorno
```

Eu tinha proposto e ele confirmou com uma frase que ficou no código:
**não é perder cobertura, é pôr a regra na camada que possui a
informação para prová-la.** Por isso "esperava crediário e não veio linha
`d`" não é golden vector — seria pedir a uma função pura que provasse o
que ela não tem como saber, e o preço seria a pureza que permitiu, na 2A,
montar um documento multi-vale quando nenhum romaneio selado tinha mais
de um.

E a igualdade é de CONJUNTO, não continência: "todo esperado apareceu"
deixaria sobra passar, e sobra é o documento afirmando custódia de papel
que aquela saída nunca gerou.

### O que ele corrigiu no meu plano

**O prazo do bloco `d` era antes da 2C, não antes do primeiro selo.** A
fila persiste em IndexedDB o payload que produz o `document_hash`, e um
item parado na fila do caixa já é documento assinado esperando subir.
Mudar o formato depois disso não quebra código — quebra o que está
guardado no navegador de quem já usou.

**`status_documental` subiu junto, e por recomputação ABSOLUTA.** Se o
DCRR1 diz `d E1 crediario faltante` e o banco diz `nao_aplica`, o
documento assinado afirma que falta papel e o estado operacional afirma
que não há questão documental. Absoluta e não incremental porque vale de
crediário antigo pode estar `nao_aplica` — depender do valor anterior
faria a correção não alcançar justamente os vales que ela existe pra
consertar. É AGREGADO por vale, e isso está dito: quando a conferência do
gestor exigir granularidade por `(entrega_id, tipo_documento)`, é tabela
própria.

**Precedência de erro:** documentos validam DEPOIS de pagamentos, dentro
do vale, na ordem recebida. Preserva o comportamento histórico — um
payload que respondia `pagamento_duplicado` continua respondendo isso
mesmo trazendo documento inválido.

### `convcard` não é convênio, e isso quase virou defeito

Três conceitos distintos: `convcard` é o cliente mandando os dados do
cartão pra farmácia processar — **não há papel saindo com ninguém**.
`convenio` e `crediario` geram cada um um documento físico. O usuário
mandou conferir os nomes reais no CHECK antes de mexer em enum, e foi o
que fez a distinção ficar limpa: `convcard` é forma de pagamento VÁLIDA
no bloco `pr` e tipo de documento INVÁLIDO no bloco `d`. O vetor I015
existe só pra travar essa assimetria.

Achado de passagem: **`convenios.exige_assinatura` não é lido por nada** —
só aparece em Cadastros. O que decide a pendência é
`convenioId ? 'pendente' : 'nao_aplica'`. Então "todo convênio gera
documento" É o comportamento atual, e derivar de `forma` bate com ele.
Fica a armadilha: se a flag um dia passar a valer, a obrigação do `d`
muda junto, e o canônico da saída não a carrega.

### O DEFEITO DA RODADA: três cópias do conversor

A conferência dos vetores contra o banco voltou com uma assinatura limpa
demais: **os 30 critérios dos dez vetores antigos e os treze inválidos
antigos, todos verdes; tudo que envolvia `d`, vermelho.**

Não era o SQL. Era `paraJsonbRetorno` — a função que converte o objeto de
domínio no `p_retorno` enviado ao servidor. Ela ficou sem o campo
`documentos` quando o bloco entrou no canônico. O banco recebeu vales sem
documento, não emitiu linha `d`, e o validador não teve o que recusar.

**Em produção seria o pior caso possível: a tela ASSINA UMA COISA E MANDA
OUTRA.** O servidor reconstrói o DCRR1 do que recebeu, chega noutro hash,
e recusa `documento_alterado` depois de colhidas as duas assinaturas, com
o motoboy no balcão. É exatamente o defeito que a nota da 2A item 6
descreveu com essas palavras — e ele aconteceu mesmo assim, porque
naquela sessão a função estava certa e ninguém previu que ela envelheceria.

E ao consertar apareceu a terceira: **o gerador do SQL tinha a própria
tradução domínio → jsonb, escrita à mão**, com o mesmo buraco. Ou seja, o
ferramental de teste teria concordado com o defeito de produção. Não
acrescentei o campo na terceira cópia — apaguei a cópia e fiz o gerador
usar `paraJsonbRetorno`. Uma tradução só, no lugar de três.

**A guarda, e a prova de que ela morde.** Entrou no
`canonico-retorno.spec.mts`: pra cada vetor, o payload enviado tem que ter
um item por linha assinada — um vale por `v`, um pagamento por `pr`, um
documento por `d` —, mais a checagem das chaves, porque contagem sozinha
passaria com os dois lados vazios. E medi: reintroduzi o defeito no
arquivo, os seis vetores acusaram; restaurei, voltou verde. Guarda que não
se prova contra o defeito que a motivou é decoração.

### Os números

```
vetores × especificação    552   ✓    (era 259)
TypeScript × vetores       156   ✓    (era 70; +a guarda nova)
SQL × vetores               65   ✓    (era 43)   ← no banco
conferência da 2B.5          8   ✓                ← no banco
16 válidos · 17 inválidos estruturais
os 10 hashes anteriores INTACTOS
```

Bloco vazio não gera linha, então acrescentar o `d` não moveu um byte de
nenhum documento que já existia — medido antes de qualquer outra coisa.

**E o censo que a 2C vai querer:** 1 das 11 saídas seladas espera papel
de volta (um convênio). É a única onde o bloco `d` importa hoje, e a
única onde `documentos_nao_conferem` é exercitável contra dado real.
**Nenhum vale de crediário foi lançado ainda** — a consulta de
levantamento voltou zero linhas, então a migration nasceu sem backfill, e
aquele caminho inteiro segue sem exercício até alguém vender um.

## 66. O teste de transporte passa a perguntar sobre o bloco `d`

Sessão de 2026-08-20, fechando o que a 2B.5 deixou aberto. O
`conferir-canonico-retorno-no-console.js` tinha cinco cenários e **zero
ocorrências de `documentos`**: respondia "o fio preserva o que os gêmeos
concordam?" sem nunca ter perguntado sobre a metade do contrato que
acabara de entrar.

**Não é um cenário faltando — é o defeito do item 65 sobrevivendo ao
próprio conserto.** O `paraJsonbRetorno` sem `documentos` foi pego pela
conferência dos vetores contra o banco; este script não pegou, e não
tinha como: a cobertura dele morava no comentário e não no código, que é
o mesmo defeito que as três revisões de 19/08 corrigiram, de volta por
outra porta no dia seguinte.

### Quatro cenários, e o que cada um alcança que os outros não

| cenário | a propriedade |
|---|---|
| `pr` e `d` no MESMO vale (crediário) | os TRÊS blocos cheios ao mesmo tempo — e `crediario` como forma só passa com a `20260820120000` aplicada |
| insucesso com papel em branco (V014) | `pr` É filtrado por desfecho, `d` não é. Bloco `pr` vazio com `d` cheio só sai daqui |
| convênio + crediário no mesmo vale, **fora de ordem no input** | a identidade é o PAR (entrega_id, tipo); com um documento por vale a ordenação seria indistinguível. Leva também o único `faltante` |
| `d` em DOIS de três vales, **vales invertidos no input** | vale sem papel não gera linha — bloco vazio é ausência, nunca placeholder — e a ordenação do bloco `d` **entre vales** |

Os dois últimos cobrem **eixos diferentes de ordenação**, e um achatamento
errado pode acertar um e errar o outro: tipo dentro do vale, e vale
dentro do bloco.

Os quatro primeiros cenários **continuam sem declarar `documentos`, e
isso fica**: é o formato de um item PARADO NA FILA, gravado no IndexedDB
antes de o campo existir. `paraJsonbRetorno` resolve `undefined` pra `[]`
e o canônico faz `?? []` — quem prova que os dois concordam em "nenhuma
linha `d`" é o fio, não a leitura do código.

### A cobertura saiu do comentário e foi pro resultado

A tabela ganhou `v`/`pr`/`d` por cenário e o rodapé diz em quantos deles
o bloco `d` apareceu. Sem isso, um conjunto que perdesse os documentos
voltaria `TRANSPORTE PRESERVA` com a mesma cara de sempre — que foi
exatamente a assinatura do defeito de 20/08: tudo verde, nada
exercitado.

E entrou um quarto critério, `payload`: a contagem de blocos do canônico
**assinado** contra a do payload **enviado**. Os três antigos já pegariam
o defeito (o servidor reconstrói de menos e o hash muda); o que este
acrescenta é o NOME — transforma "os bytes divergiram" em "o payload não
levou o campo", que é a diferença entre uma investigação e uma linha.

### A guarda foi medida contra o defeito que a motivou

Senão é decoração. Reintroduzi a remoção de `documentos` no
`paraJsonbRetorno` e rodei os cenários pelo gêmeo TypeScript real, lidos
DO ARQUIVO e não de uma cópia (mesmo princípio do §57): os **4 cenários
com `d` acusaram enquanto os 5 sem ficaram verdes** — a mesma assinatura
limpa demais do item 65, agora visível de dentro do script de transporte
em vez de só pela conferência contra o banco. Restaurado por
`git checkout` logo depois.

### Rodou contra o banco: 9 · 4 critérios · 0 divergências

O usuário colou no console. Todos os nove cenários verdes nos quatro
critérios, `bloco d: 4 de 9 cenários`, e os bytes locais batendo com os
do servidor um a um (929, 572, 392, 395, 833, 569, 998, 616, 692).

### E o canônico impresso pegou o que os booleanos escondiam

**Pela terceira vez nesta frente, o texto disse o que os `true` não
diziam.** O cenário multi-vale saiu com **uma linha `d` só** — e uma
linha não discrimina ordenação nenhuma: ela é a mesma em qualquer ordem.
O comentário dele afirmava que provava o reordenamento por `entrega_id`
antes do achatamento; o dado provava metade disso (vale sem papel não
gera linha, e o documento fica grudado no `entrega_id` certo), e o
eixo da ordenação entre vales ficava sem discriminação.

Repare que o argumento **não depende** de os `ids` terem voltado
ordenados do banco: com uma linha só, não há ordem a errar.

Corrigido pra DOIS documentos em vales diferentes, com situações
diferentes de propósito — trocá-los de lugar muda o TEXTO, não só a
posição. Agora o par sai no canônico na ordem INVERSA à que entrou.

E o instrumento passou a medir isso em vez de eu afirmar: o conferidor
offline compara a ordem de entrada com a de saída e conta quantos
cenários **discriminam**. Resultado: `14 linhas d · 2 discriminando`,
um por eixo (tipo dentro do vale, vale dentro do bloco). Cenário que não
discrimina não vira falha — os dois primeiros não existem pra isso —,
mas agora aparece rotulado, em vez de passar parecendo que prova.

**O que isso custa:** o script mudou depois do run verde, então a última
linha da tabela vai ter `d: 2` no lugar de `d: 1` e o rodapé vai dizer
14 linhas em vez de 13. **Precisa rodar de novo** — o run que está
registrado acima é do script anterior.

### Um risco descartado antes de dar por pronto

`conferir_canonico_retorno` é da migration `20260819150000`, **anterior
ao bloco `d`**. Se ela tivesse cópia própria da serialização, o script
passaria verde ignorando os documentos — a quarta cópia, no mesmo lugar
onde as outras três moravam. Não tem: ela delega a
`romaneio_retorno_canonico` pelo nome, e a `20260820150000` faz
`create or replace` com **assinatura idêntica** `(uuid, text, uuid, uuid,
jsonb)`, ou seja trocou o corpo em vez de criar sobrecarga. Se as
assinaturas diferissem, o `conferir_` continuaria chamando a versão
velha e nada acusaria.

## 67. O desenho da 2C, fechado contra o código antes da primeira linha

Sessão de 2026-08-20, com os gates A e B ainda abertos. Mesmo método do
item 58: o usuário trouxe um plano em quatro blocos e mandou ler a 2C
inteira em modo de desenho. A leitura mudou dois blocos, achou uma etapa
que não estava no plano, e o usuário barrou o plano num ponto — que era o
ponto certo. O desenho final está no CLAUDE.md, seção "A 2C". Aqui fica o
que a conversa **achou**.

### Duas coisas que só o código responde

**A porta offline do retorno não existe, e a 2B sabia.**
`selar_romaneio_retorno_interno` recebe `p_autorizacao_id`, não token e
PIN — e offline não há autorização, porque o PIN só se confere na
sincronização, a partir do envelope. A 2B construiu só a porta online e
deixou a outra anotada num comentário. Sem essa leitura, a 2C começaria
pela fila e descobriria o buraco na hora de chamar a transação.

**`fecharCorrida` não é RPC.** É um laço de UPDATEs diretos em `entregas`
mais um UPDATE em `corridas`, pelo PostgREST. Isso decidiu a forma do
gate de segurança abaixo: não há função onde pôr guard, então é trigger.

### O ponto em que o usuário barrou o plano, e ele estava certo

Eu tinha achado o cenário destrutivo — retorno sela, corrida fecha,
`fechamento_corrida` legado chega depois e reescreve o desfecho, e o
banco passa a dizer coisa diferente do documento assinado — e propus
resolvê-lo com a dependência da fila (`dependeDeChave`).

Ele recusou isso como proteção suficiente, com o argumento que fecha:
**pode existir fila antiga em outro computador, outra sessão, um
navegador dias offline, ou uma chamada de cliente antigo.** Ordenação em
IndexedDB não alcança nada disso. A dependência local continua valendo
como otimização e UX; a última linha de defesa da regra 7 tem que estar
no banco.

E aí o código endossou por outro caminho: como `fecharCorrida` não é RPC,
**guard em RPC jamais cobriria "cliente antigo"** — que era exatamente o
caso dele. O que cobre é trigger. Virou a **2C.2**, e o enquadramento
dele é o que vale registrar: *gate de segurança, não ordenação de fila*.

**A armadilha do trigger, que é o item 34 de volta:** o interno insere o
romaneio `'selado'` ANTES de gravar os desfechos vale a vale. Um trigger
ingênuo dispararia durante o próprio selo e bloquearia todo retorno —
*toda saída falharia, com o erro apontando pro lugar errado*.

### Duas coisas que eu errei lendo, e uma que quase virou nota errada

**Achei que faltava o guard de reenvio no retorno.** Li as checagens de
`corrida_ja_fechada` e `retorno_ja_existe` no meio da função e concluí
que um reenvio bem-sucedido viraria conflito — o que quebraria o modelo
inteiro da fila. Está lá: é a PRIMEIRA coisa do corpo, mesmo formato da
saída (`selado` → `ok/ja_existia`; `conflito` → devolve o conflito em vez
de escondê-lo). Ler o meio de uma função de 400 linhas e concluir sobre o
começo dela é o mesmo defeito do gerador do DCRR1 em 19/08: **ponta de
arquivo não prova estrutura de arquivo**, e meio de função não prova
ausência no topo.

**E `conferir_canonico_retorno` quase virou uma quarta cópia na minha
cabeça.** Ela é de `20260819150000`, anterior ao bloco `d` — se tivesse
serialização própria, o teste de transporte passaria verde ignorando
documentos. Não tem: delega pelo nome, e a `20260820150000` faz
`create or replace` com assinatura idêntica. Risco descartado por
medição, não por suposição.

### O particionamento, medido porque foi perguntado

O usuário mandou conferir, sem assumir pendência. A resposta é parcial e
muda por camada — está inteira no CLAUDE.md. O resumo: o caso que ele
nomeou (A captura, B loga depois) está coberto duas vezes, mas por
`user_id` sozinho; `tenantId` e `lojaId` são gravados no item e nunca
comparados; tenant não é problema porque o servidor o deriva do perfil;
**loja é o ponto fraco e só na saída**, porque `SECURITY DEFINER` ignora
RLS e a conferência prova consistência interna, não competência.

**O retorno já nasce imune** — não tem `p_loja_id`, a loja sai do
romaneio de saída selado. Por isso o buraco da saída ficou como gap
anotado em vez de entrar na 2C: não é alcançável pelo caminho normal, e a
frente nova não o herda.

### Nada construído

Os gates A e B seguem abertos. Foi leitura e desenho; o único arquivo de
código tocado nesta frente continua sendo o script de transporte do item
66.

## 68. Etapa 2C.1 — a porta offline do retorno

Sessão de 2026-08-20, com os gates A e B fechados e a 2C declarada
liberada. `20260820170000_selar_romaneio_retorno_sincronizado.sql`,
**escrita e ainda não aplicada**. Espelho literal de
`selar_romaneio_sincronizado`: autentica cartão e PIN vindos do envelope,
confere que o cartão é do motoboy que o documento nomeia, **cunha** a
autorização efêmera amarrada ao `document_hash` do retorno, e entrega ao
`selar_romaneio_retorno_interno` com `p_modo = 'offline_sincronizada'`.

O que essa forma compra e é o motivo de não improvisar outra: **online e
offline convergem no mesmo selo interno.** Nenhuma segunda implementação
de selagem, logo nenhuma segunda fórmula de hash pra divergir.

### Duas coisas que o código impôs e que não estavam no plano

**1. O guard de reenvio subiu pra porta.** No interno ele já existe (é a
primeira coisa do corpo), e pro caminho online isso basta. Aqui não: a
fila reenvia; se no meio tempo a credencial tiver sido bloqueada por
outra pessoa errando o PIN, o reenvio de um retorno JÁ SELADO falha a
autenticação e cai em `registrar_conflito_retorno`.

**Eu escrevi primeiro que isso violaria a chave primária e travaria o
item da fila pra sempre. Está errado, e a correção é do próprio código:**
o insert de lá é `on conflict (id) do nothing`. O que acontece é pior de
ler e mais silencioso — a linha selada fica intacta, mas a função devolve
`ok:false, motivo:'conflito'` **com o número do romaneio selado**, e
grava um evento `conflito_retorno` contra um documento perfeitamente
selado. O item vira terminal "em conflito" e o Registro de Auditoria
passa a mostrar um conflito que nunca houve.

A conclusão não muda — o guard sobe —, mas o motivo é outro, e o motivo
certo é mais forte: não é uma trava de fila, é o sistema **relatando um
conflito falso** sobre um documento válido. Corrigido no cabeçalho da
migration depois de eu ir ler `registrar_conflito_retorno` inteiro em vez
de deduzir pelo `insert`.

Com o guard em cima, reenvio nem encosta na credencial. De quebra, deixa
de gastar um bcrypt por reenvio. O interno continua sendo a autoridade:
divergindo os dois, o pior caso é o atalho não disparar.

A porta da SAÍDA tem a mesma forma latente. Não mexi nela — é código em
produção, o caso é estreito, e a 2C não é lugar de reescrever a saída.
Fica anotado.

**2. A competência sobre a loja virou CONFLITO, não exceção.** Eu tinha
proposto como "uma linha" e a linha estava errada. O caso alcançável é
legítimo: um caixa registra o retorno offline e tem o perfil movido de
filial antes de a fila drenar. **O retorno aconteceu**; o que mudou foi o
cadastro de quem o fez. Levantar exceção deixaria as duas assinaturas só
no IndexedDB dele.

E ela vem ANTES da autenticação de propósito: quem não tem competência
sobre aquela filial não deve conseguir queimar o contador de tentativas
de um motoboy.

Detalhe que quase virou defeito: o literal é `v_papel <> 'admin'`, e é
o certo porque `is_admin()` é **estritamente** `papel = 'admin'` —
`superadmin` existe no CHECK de `profiles.papel` desde o schema inicial e
não entra em `is_admin()`, logo não atravessa filial em policy nenhuma.
Acrescentá-lo ali abriria um escopo que a RLS fecha.

### O achado que atinge o GATE A, e é melhor saber antes

**`romaneios_numero_seq` não volta atrás com rollback.** As conferências
que exercitam caminhos de conflito inserem em `romaneios`; o `raise` do
fim desfaz as LINHAS, mas os números gastos ficam gastos.

Consequência direta na checagem de fechamento do gate A: 
`selados + conflitos = maior R- emitido` **só fecha enquanto nada tiver
sido selado DEPOIS de números queimados.** Ela fechou em 20/08 (14 = 14)
porque as conferências da 2B queimaram números e nenhum romaneio real
nasceu depois. **No primeiro selo real seguinte ela vai acusar
`selados + conflitos < maior`** — e isso não é documento perdido, é
rollback de conferência.

É o mesmo defeito de enunciado que o §64 já registrou uma vez ("o gate
nunca foi 'o número é 10'"), noutra roupa. A forma robusta da mesma
pergunta, que não depende de sequência contígua:

```sql
select count(*) = count(*) filter (where status in ('selado','conflito'))
  from public.romaneios;
```

Toda linha existente é ou selada ou conflito, nenhuma some. Os buracos na
sequência passam a ser explicáveis por rollback em vez de terem que ser
zero.

### Aplicada e conferida em 2026-08-20

Bloco 1 da conferência, sem escrever nada:

```
(a) instalada=t  anon=f  authenticated=f  service_role=t
(b) reenvio          ja_existia=true  ok=true
(c) responsavel      42501 | Responsável inexistente ou inativo.
(d) saida            P0002 | Romaneio de saída … não existe.
```

A **(b)** é a que prova o desenho: token lixo junto de um romaneio que já
existe, e mesmo assim responde. Se o guard de reenvio estivesse depois da
autenticação — como está na porta da saída —, ela teria morrido na
credencial.

**E a (d) corrigiu uma expectativa minha: veio `P0002`, não `02000`.**
`no_data_found` é nome de condição do PL/pgSQL, mapeado para `P0002`;
`02000` é o `no_data` do padrão SQL, outra coisa. O código está certo e
consistente com a 2B, que levanta a mesma exceção com o mesmo `errcode`.

Isso importa pra frente e não é detalhe: **a 2C.6 vai classificar erro
por SQLSTATE** pra decidir o que é terminal na fila, e um handler
esperando `02000` não casaria nunca — o item ficaria retentando uma
recusa definitiva, que é o modo de falha que a fila já pagou uma vez.
Os três de agora: `P0001` raise_exception, `P0002` no_data_found,
`42501` insufficient_privilege.

### O que não foi feito, e é decisão do usuário

Nada de Dexie, fila ou envelope neste commit. A porta nasce e é provada
isoladamente; a 2C.2 (o trigger) vem depois dela.

E o caminho feliz continua sem como ser testado daqui: exige cartão
físico e PIN. A conferência 1 do rodapé prova o perímetro — grants, o
guard de reenvio disparando com token lixo, e as duas exceções — sem
escrever nada.

## 69. Etapa 2C.2 — o gate de segurança da regra 7

`20260820180000_fechamento_legado_obsoleto.sql`, **escrita e ainda não
aplicada**. Trigger `BEFORE UPDATE` em `entregas` que impede o
`fechamento_corrida` legado de reescrever desfecho depois de um DCRR1
selado — venha ele da fila deste computador, de outra sessão, de um
navegador dias offline ou de um cliente antigo.

### O discriminador, e por que ele dispensa mexer no interno

A armadilha era o item 34 de volta: `selar_romaneio_retorno_interno`
insere o romaneio `'selado'` **antes** de gravar os desfechos, então um
trigger que perguntasse "existe retorno selado pra esta corrida?"
bloquearia o próprio selo — *toda saída falharia, com o erro apontando
pro lugar errado*.

Fui ler a ordem exata dos statements dentro do interno, e ela resolve:

```
insert romaneios (tipo=retorno, status=selado)   linha 423
insert romaneio_entregas
update entregas  (desfecho, motivo, observações) linhas 449 e 522
update corridas  status = 'fechada'              linha 598   ← só no fim
```

O par **"existe retorno selado E a corrida está fechada"** só é verdade
depois do selo inteiro. Durante ele a corrida ainda está aberta, então o
trigger não vê nada e o selo passa.

E isso não é truque: é a definição de *o documento está pronto*. Vale
mais que um `set local` ou um flag de sessão porque **não exige reabrir
`selar_romaneio_retorno_interno`**, que já tem duas definições no
repositório e é a função mais delicada desta frente.

Fica um acoplamento, e está escrito nos dois lugares: mover o
`update public.corridas` do fim do interno pra antes do laço faz o
trigger bloquear o próprio selo. É o mesmo tipo de amarração que a saída
carrega desde o item 34.

### A auditoria não pode ser gravada pelo trigger

O desenho dizia "o handler legado marca terminal e grava auditoria
`fechamento_legado_obsoleto`". Escrevendo, ficou claro por que a segunda
metade **tem** que ser do cliente: um `insert into eventos` antes do
`raise` seria desfeito pelo rollback que o próprio `raise` provoca. O
evento nunca existiria, e quem lesse o código concluiria que existe.

### Dois defeitos no meu próprio instrumento, achados antes de mandar

O trigger sai na primeira linha quando nenhuma das três colunas do DCRR1
muda — é o que o torna barato. E foi isso que quase invalidou a
conferência inteira:

1. `(c)` e `(d)` atualizavam `status_entrega` para **o mesmo valor**.
   Os dois passariam por curto-circuito, sem o guard ser exercitado uma
   única vez, e eu leria `(d) PASSOU <-- ERRADO` como se o trigger
   estivesse quebrado.
2. Corrigido o primeiro, sobrou o segundo: `(c)` deixa a coluna no valor
   novo, então `(d)` mandando o mesmo valor novo voltaria a ser no-op.
   `(d)` passou a **reverter** pro original — a mudança tem que ser real
   nas duas tentativas, não só na primeira.

É a décima segunda vez que o instrumento concordaria com o defeito. A
diferença é que desta vez os dois foram pegos antes de rodar, lendo o
que eu tinha acabado de escrever — o mesmo método do item 34.

### O que a conferência não alcança

**Não existe retorno selado real** (o placar diz `retorno 0 · 0 · 0`),
então o caminho positivo só existe sintético até a 2D: o bloco 2 monta um
romaneio de retorno `'selado'` sobre uma corrida aberta de verdade, mede
as três coisas e desfaz. Ele **queima um número de romaneio**, porque a
sequência não volta atrás com rollback.

### Aplicada e conferida em 2026-08-20

```
(a) funcao instalada     t
(b) trigger              antes=t update=t por_linha=t
(c) antes do retorno     PASSOU
(d) depois do retorno    RECUSOU  SQLSTATE=DCRR1
    "Desfecho já selado no romaneio de retorno R-000018: …"
(e) status_financeiro    LIVRE
```

Os três do bloco 2 juntos são o que fecha: `(c)` sozinho não prova que o
guard morde, `(d)` sozinho esconderia um trigger que trava todo
fechamento, e `(e)` é o que prova que congelei três colunas e não a
tabela.

**`DCRR1` é agora MEDIDO, não previsto.** Postgres aceita SQLSTATE
customizado de cinco caracteres, e é este valor que o handler legado da
2C.8 tem que reconhecer pra marcar o item TERMINAL. Errá-lo faz o item
retentar uma recusa definitiva pra sempre. Depois do `P0002` da 2C.1 eu
não trato mais SQLSTATE escrito por mim como conhecido.

### E o `R-000018` provou a nota da sequência sem eu pedir

O romaneio sintético recebeu **R-000018**, enquanto o gate A mediu
`maior R- emitido = 14` horas antes. Ou seja: 15, 16 e 17 já estavam
gastos — são as três recusas que a conferência da 2B exercitou
(`vales_nao_conferem`, `outro_motoboy`, `saida_hash_nao_confere`), cada
uma um `registrar_conflito_retorno` desfeito por rollback.

Isso deixa de ser previsão e vira medição: a sequência está em 18 e o
maior número EXISTENTE é 14. A aritmética `selados + conflitos = maior
emitido` fecha hoje só porque nenhuma linha nasceu depois das queimas.
**A próxima saída real será R-000019, e aí `12 + 3 = 15 ≠ 19`** — sem
nenhum documento ter sumido. Use a forma robusta:

```sql
select count(*) = count(*) filter (where status in ('selado','conflito'))
  from public.romaneios;
```

## 70. Etapa 2C.3 — Dexie v5, e a armadilha desarmada

Duas mudanças, estritamente, como o usuário delimitou: o backfill de
`chave` nos `fechamento_corrida` que já estão no IndexedDB de alguém, e a
exclusão do próprio item no guard de dependência do scheduler.

**O risco saiu do banco e passou pra estado persistido no cliente** — é
por isso que esta etapa não tem migration e mesmo assim é delicada.

### Por que o backfill não podia ser "passar a setar daqui pra frente"

Nenhum código novo enfileira `fechamento_corrida`. Os itens que importam
são exatamente os que já estão gravados, esperando drenar. Daí ser
upgrade da Dexie, e não um argumento a mais no `enfileirarOperacao`.

Feito ele, `dependeDeChave: corridaId` no `romaneio_retorno` da 2C.4
cobre os dois de uma vez: espera a `romaneio_saida` (que já usa
`chave: corridaId`) **e** o fechamento legado.

**Malformado é preservado e denunciado, nunca consertado por
aproximação.** Um `fechamento_corrida` sem `payload.corridaId` não ganha
chave inventada nem é apagado: fica como está e o `console.warn` diz
quais são. Chave inventada faria outro item esperar por uma corrida que
não existe — trocaria um item preso por dois.

### O predicado saiu do laço, e não foi organização

`bloqueadoPorDependencia` virou `src/lib/dependenciaDaFila.ts`, que **não
importa nada**. Medir a regra de dentro de `processarFilaOperacoes`
exigiria deixar a fila rodar de verdade e observar qual operação foi
pulada — ou seja, mandar operações reais pro servidor pra testar um `if`.
Mesma disciplina de `canonico.ts` e `caminhosNoDrive.ts`.

### Os dois testes medem coisas diferentes, e a medição provou

`scripts/dependencia-da-fila.spec.mts`, 9 casos. Reintroduzi o predicado
antigo (sem o `outro.id !== item.id`) e medi:

```
3 FALHAS   as de self-dependency
6 ok       as de dependência entre itens DIFERENTES continuam passando
```

**É isso que justifica o usuário ter exigido os dois separados.** Uma
"correção" que desligasse o bloqueio inteiro (`return false` sempre)
passaria no A com louvor e a fila voltaria a deixar o fechamento
ultrapassar a criação da corrida — o bug de 16/08. O B é quem pega isso.

Uma borda que não estava no pedido e vale: `item sem chave não bloqueia
item sem dependência`. Sem o early return, `undefined === undefined` daria
`true` num `some` ingênuo, e todo item sem dependência ficaria preso por
qualquer item sem chave.

### O teste do upgrade roda contra IndexedDB de verdade

`scripts/conferir-dexie-v5-no-console.js`, 10 casos, **em banco
separado** (`tele-entregas-conferencia-2c3`, apagado no fim). Semear a
fila do app com `fechamento_corrida` falso seria pedir pra ele tentar
fechar uma corrida inexistente no próximo sync.

O que ele NÃO isola é a função de backfill: essa é a de produção,
importada de `/src/lib/db.ts`. Uma cópia aqui provaria a cópia — a lição
das três cópias do conversor (item 65) aplicada de véspera.

E o construtor da Dexie sai de `db.constructor`, não de
`import('/node_modules/.vite/deps/dexie.js')`: aquele caminho precisa do
`?v=<hash>` e carrega uma SEGUNDA instância quando o hash muda (§61).
Assim não há hash pra acertar.

### Conferido no navegador em 2026-08-20: 11 de 11

```
verno=5 · chave backfillada · payload intacto byte a byte
status/tentativas/erro/relógios intactos · malformado preservado sem chave
item que já tinha chave intocado · outro tipo não reinterpretado
nenhum item apagado (4 de 4) · banco de conferência apagado no fim
```

Os casos 8 e 9 juntos são os que mais valem: rodar o backfill de novo
**não corrige nada E continua denunciando o malformado**. Um upgrade que
esquecesse o item torto na segunda passada pareceria idempotente e teria
perdido a única evidência de estado antigo que existe.

### Uma armadilha do próprio processo, de novo

Ao medir a guarda contra o defeito, o `git checkout --` **não restaurou**
o arquivo: ele é novo, ainda não estava no git. Rodei o spec de novo e vi
`3 FALHA(S)` — desta vez porque o código continuava defeituoso, não
porque o teste discrimina. Restaurado à mão e reconferido em 9/9.

Fica a regra: **medir guarda contra defeito em arquivo não rastreado
exige desfazer à mão**, e o segundo `raise` verde é parte da medição, não
formalidade.

## 71. Etapa 2C.4 — o artefato offline do retorno

`romaneio_retorno` entrou na fila. Nada o enfileira ainda — quem vai é a
tela, na 2D —, então ele nasce e é medido isolado, como as anteriores.

O objetivo, na frase do usuário: **fazer nascer um artefato offline de
retorno imutável o bastante pra sobreviver a uma atualização do
aplicativo sem mudar o documento que já foi assinado.**

### O objeto de domínio NÃO vai junto, nem por conveniência

Depois de enfileirado o artefato é `retornoJsonb + documentHash + os
dois traços`, e mais nada. `EntradaRetorno` fica de fora **de
propósito**: com ele no payload, alguém em algum momento chamaria
`paraJsonbRetorno` de novo no sync, e uma atualização do app entre
enfileirar e sincronizar converteria diferente — servidor reconstrói
outro DCRR1, chega a outro hash, recusa `documento_alterado` com as duas
assinaturas colhidas e o motoboy no balcão.

É o defeito do item 65 impedido **por construção**: tirando do payload
aquilo de que a reconversão precisaria. O teste afirma a ausência
(`entradaRetorno === undefined && vales === undefined`), senão "não
guardamos o domínio" seria uma intenção, não uma propriedade.

`versaoDocumento: 'DCRR1'` entrou a pedido do usuário. Hoje é redundante
porque só existe um contrato; existe pelo dia do `DCRR2`, quando um item
parado na fila de alguém precisar dizer sob qual contrato foi assinado —
e essa resposta não pode depender da versão do app que drenar a fila.
**Não confundir com o `tipo` do envelope (2C.5)**: aquele é
`saida | retorno` e é criptograficamente amarrado; este é a versão do
canônico e é metadado.

### O buraco que o `switch` tinha, e que eu quase repeti

`executarOperacao` é um `switch` sobre `item.tipo` sem `default`.
`noFallthroughCasesInSwitch` está ligado no tsconfig — **e ele pega
fallthrough ENTRE cases, não case FALTANDO.**

Ou seja: acrescentar um tipo à `TipoOperacaoFila` e esquecer o `case`
fazia a função cair pro fim, resolver, e `processarFilaOperacoes`
**deletar o item como se tivesse sincronizado**. Um retorno com duas
assinaturas colhidas sumiria sem nunca ter subido — a perda silenciosa
que a chave própria da fila veio corrigir em 16/08, por outra porta.

Fechado com `const naoTratado: never = item` no `default`. Esquecer
passa a ser erro de compilação.

O `case 'romaneio_retorno'` existe e **levanta exceção de propósito**: o
transporte é da 2C.6, o ramo é inalcançável hoje, e falhar alto é melhor
que suceder em silêncio.

### O compilador cobrou o segundo lugar sozinho

Ao acrescentar o tipo, o `tsc` acusou `FilaOfflineIndicador.tsx`: o
rótulo por tipo também é um `Record<TipoOperacaoFila, string>`. Isso é a
prova de que a invariante "invalidações declaradas" **não precisa de
asserção em teste** — ela é exigida em tempo de compilação pelos Records
exaustivos, e esquecer não compila. É a melhor forma dessa garantia.

### Um achado de passagem, NÃO corrigido

`QUERY_KEYS_POR_TIPO.romaneio_saida` invalida `'romaneios'`, e **nenhuma
query usa essa chave** — as reais são `'romaneio'` e `'romaneios-do-dia'`.
O TanStack casa por elemento do array, não por prefixo de string, então
aquela invalidação não alcança nada hoje: depois de uma saída offline
sincronizar, a lista da sangria não é invalidada (na prática ela
revalida ao montar, então o efeito é pequeno).

Não corrigi junto porque é fora do escopo da 2C.4 e mexe no caminho da
saída, que está em uso. Fica anotado, com o comentário no próprio
arquivo.

### Conferido no navegador em 2026-08-20: 19 de 19

Payload congelado sobrevivendo ao IndexedDB, os dois traços intactos com
o vocabulário novo e sem `caixaStrokes`, `dependeDeChave` sem `chave`,
dono gravado na criação, item de teste apagado e rede devolvida.

O caso 5 é o que mais vale — **`o objeto de DOMÍNIO não foi junto`** é
uma asserção sobre uma AUSÊNCIA. Sem ela, "não guardamos o domínio"
continuaria sendo intenção escrita em comentário, e o dia em que alguém
acrescentasse `entradaRetorno` "só pra depurar" não teria quem acusasse.

### O teste força o navegador a ficar offline, e é temático

`enfileirarOperacao` dispara `processarFilaOperacoes` no fim, e o handler
de `romaneio_retorno` levanta exceção. Sem neutralizar, o item de teste
terminaria em `erro` na fila de verdade e o indicador acusaria "precisa
de atenção".

`scripts/conferir-fila-retorno-no-console.js` usa a técnica do §49
(sobrescrever `navigator.onLine` + `dispatchEvent`), devolve a rede num
`finally` aconteça o que acontecer, e apaga o item no fim. Uma operação
que só existe offline, criada offline.

## 72. Etapa 2C.5 — o contrato criptográfico do envelope, nos dois lados

A fronteira foi corrigida pelo usuário, e o argumento decide: **`tipo`
selado no cliente e não lido no servidor não é propriedade de segurança,
é um campo criptografado.** Eu tinha proposto deixar a Edge Function
inteira pra 2C.6, o que deixaria um meio-estado entre commits justamente
na parte de criptografia.

Ficou assim:

```
2C.5 = contrato criptográfico   cliente ↔ envelope ↔ servidor
2C.6 = comportamento do endpoint  body.tipo → despacho → RPC
```

### O que mudou

`SegredosDaSaida` → **`SegredosDoRomaneio`** (o retorno usa o mesmo
envelope; o nome tinha deixado de dizer a verdade), com `tipo?:
'saida' | 'retorno'` **dentro** dele. Fora seria um campo que alguém
troca no caminho; dentro, o servidor compara em vez de acreditar.

As amarrações que já existiam (`operationId`, `documentHash`) impedem
reaproveitar um envelope em outra operação CONCRETA — mas não impediriam
trocar de CAMINHO com o envelope certo. É esse buraco que o `tipo` fecha.

`RetornoOfflineInput` ganhou `envelope`. E a Edge Function ganhou
`resolverTipoDoRomaneio`, que **reconhece** `retorno` e recusa com 501 em
vez de tratá-lo como saída. Tratar como saída seria o pior desfecho:
`corpo.entregaIds` viria de outro documento e `selar_romaneio_sincronizado`
criaria corrida errada ou conflito a partir de um envelope que dizia
outra coisa.

**Valor desconhecido é recusado, não vira saída por omissão.** "Não
reconheço" e "é uma saída" são fatos diferentes, e tratá-los igual é como
uma versão futura passaria despercebida por esta.

### O rename ao lado de uma fórmula criptográfica, medido

`calcularOfflineEventHash` passou a receber `assinaturaInternaStrokes` /
`assinaturaMotoboyStrokes` nos DOIS gêmeos. No fio nada mudou: corpos já
gravados dizem `caixaStrokes`, e o retorno dirá `responsavelStrokes` —
os dois convergem no parâmetro.

A fórmula concatena VALORES, não chaves, então renomear não deveria mover
nada. **"Não deveria" é exatamente o que este projeto não aceita**, então
capturei três hashes com o código de ANTES do refactor e os congelei como
asserção:

```
com geolocalização   d91131af…
sem geolocalização   44d50904…
traços nulos         000223191…
```

Os três continuam idênticos, e `offline-hash.spec.mts` segue dizendo
"os dois lados concordam". Sem essa captura prévia, um deslize teria
aparecido como *"o conteúdo da saída mudou depois de assinado"* na
próxima saída offline de alguém — uma mensagem que aponta pra adulteração
quando a causa é um rename.

`tipo` **não** entrou na fórmula, de propósito: a amarração vem do
envelope cifrado mais a validação server-side, e metê-lo no digest seria
mudança criptográfica gratuita no protocolo histórico da saída.

### Duas coisas que o teste exigiu do código

**O cache da chave pública era global.** Bastava enquanto só existia a do
ambiente; com `selarSegredosCom` recebendo a chave, ele devolveria a
primeira importada pra qualquer spki seguinte — o teste selaria com uma
chave e acharia que selou com outra, e o sintoma seria "a privada não
abre" apontando pro lugar errado. Virou `Map` por spki.

**`selarSegredos` foi partido.** Ele lê `import.meta.env`, que não roda
em `npx tsx` (a armadilha do §57), e o formato do envelope é contrato com
a Edge Function — precisa ser testável sem navegador e sem build.
`selarSegredosCom(config, segredos)` recebe a chave; `selarSegredos`
continua sendo o caminho do app. Mesma separação de `caminhosNoDrive.ts`
e `googleDrive.ts`.

### O spec, e o que ele trava além do pedido

`scripts/envelope.spec.mts`, 18 casos. A resolução de tipo é **extraída**
de `sync-romaneio/index.ts`, nunca reescrita — mesma disciplina do
`offline-hash.spec.mts`, senão o spec vira uma segunda implementação da
regra que deveria conferir.

Além dos seis que o usuário travou, entraram: **`iv` trocado não abre**
(o par do ciphertext adulterado — sem ele, "AES-GCM é autenticado" ficaria
provado por um lado só) e **tipo desconhecido não vira saída**.

O caso que mais vale é o (4) do pedido: *a palavra "saida" não aparece
FORA do envelope*. Ele é quem prova que a amarração é real e não
decorativa — se o tipo vazasse pro envelope externo, todo o resto do
desenho seria teatro.

### Uma armadilha do meu próprio ferramental

Escrevi um comentário via `node -e` dentro de aspas duplas do bash, com
um nome de arquivo entre crases. **O bash executou as crases como
substituição de comando** e engoliu o trecho, nos dois arquivos ao mesmo
tempo — `// \`scripts/envelope.spec.mts\` congela…` virou
`//  congela…`. Passou por `tsc`, lint e build, porque é comentário.

Só apareceu porque fui reler o arquivo depois de escrever. Fica a regra:
**crase em string de shell é código**, e comentário mutilado não é pego
por nenhuma das três verificações.

## 73. Etapa 2C.6 — o despacho, e a matriz que cabe numa igualdade

`sync-romaneio` passou a discriminar tipo, conciliar corpo × envelope e
despachar pras duas portas. Do lado do cliente,
`sincronizarRetornoOffline` e o `case` da fila que antes levantava
exceção.

### A pergunta que precisava ser respondida contra a realidade

O usuário perguntou se `body = saida` com `envelope sem tipo` pode
existir, e mandou não inventar compatibilidade sem estado histórico que
precise dela. **Pode, e por construção:** o envelope é selado na CAPTURA
e guardado na fila; o corpo é montado na hora de DRENAR, pelo código do
dia. Um item capturado antes da 2C.5 carrega envelope sem tipo e vai ser
drenado por um cliente que já manda `tipo: 'saida'`. Recusar travaria
saídas reais, já assinadas.

### A matriz inteira é uma igualdade

Os dois lados resolvem ausência como `saida` (compatibilidade histórica)
e depois **têm que concordar**. Disso decorrem as nove linhas da tabela,
inclusive as quatro de recusa.

**"Retorno exige explícito nos dois lados" não é um `if` separado** — é
consequência da igualdade, porque ausência nunca resolve `retorno`. Quem
ler procurando a checagem explícita não vai achar, e não está faltando.
Por isso o spec tem um caso que afirma a propriedade diretamente:
*nenhuma combinação sem os dois explícitos produz retorno*, varrendo as
oito combinações — a tabela prova linha a linha, este prova a regra.

### A ordem é a invariante, e ela é testável no texto

O usuário exigiu que uma operação recusada por tipo divergente **não
chegue a nenhuma RPC de selagem** — a diferença entre condição de entrada
e diagnóstico posterior. Não dá pra rodar Deno aqui, então o spec faz
asserção de ORDEM sobre o texto do handler: dono, envelope aberto, tipo
conciliado, `operationId`, `documentHash` e `offlineEventHash` todos
antes do primeiro `.rpc(`, e exatamente duas RPCs.

Grosseiro de propósito. A invariante é sobre ONDE as coisas acontecem,
não sobre o que devolvem.

### Ignorar não é recusar

Eu tinha implementado a rigidez do vocabulário pela metade: lia
`responsavelStrokes` no retorno e simplesmente não olhava `caixaStrokes`.
O usuário escreveu `tipo=retorno + caixaStrokes → inválido`, e ignorar
não é isso.

Agora recusa nos DOIS sentidos — retorno com `caixaStrokes` e saída com
`responsavelStrokes`. Um campo do protocolo errado aceito em silêncio
vira a pista falsa de quem for depurar por que o hash não fechou.

### `retorno_nao_suportado` NÃO é terminal, e a ausência é deliberada

`tipo_divergente`, `tipo_desconhecido` e `vocabulario_invalido` entraram
em `MOTIVOS_TERMINAIS`: são defeitos de forma do que já foi assinado, e
retentar repete o resultado.

`retorno_nao_suportado` ficou de fora. Ele significa "a função publicada
é anterior à 2C.6", e isso se conserta com um deploy — marcá-lo terminal
descartaria um retorno legítimo, com duas assinaturas colhidas, por causa
de uma janela de rollout.

### Conferido contra a função NO AR em 2026-08-20: 13 de 13

```
(1) legado  body sem tipo + envelope sem tipo   → envelope_trocado
(2) ROLLOUT body saida    + envelope sem tipo   → envelope_trocado
(3)         body saida    + envelope saida      → envelope_trocado
(4)         body retorno  + envelope retorno    → envelope_trocado  ← o Deploy
(5-8)       as quatro divergências               → tipo_divergente
(9, 9b)     desconhecido nos dois lados          → tipo_desconhecido
(10-12)     vocabulário nos três sentidos        → vocabulario_invalido
```

**`envelope_trocado` no (1) a (4) é SUCESSO**, e a leitura importa: quer
dizer que o tipo foi aceito e a função seguiu pra amarração seguinte,
onde o `operationId` era divergente de propósito. É assim que se prova
que a conciliação passou sem selar nada.

**O (4) é a única prova possível de que o Deploy pegou.** Na versão
anterior ele devolveria `retorno_nao_suportado` (501). Nem o spec (que
roda contra o TEXTO) nem o `OPTIONS` (que responde `ok` desde a primeira
versão) conseguem responder essa pergunta.

E nada foi selado — não por promessa, por construção: a ordem do handler
foi conferida mecanicamente, e cada caso para numa etapa nomeada antes do
`.rpc(`, com ids sorteados que não existem no banco.

### O que só o teste integrado pode provar

`despacho-sync-romaneio.spec.mts` roda contra o TEXTO da função e prova a
lógica. **Ele não prova que a função publicada é esta** — só o teste real
prova, e é ele que fecha a 2C.6:

```
saída legado (envelope sem tipo) ainda sincroniza   ← o mais importante
saída nova sincroniza
retorno novo chega até selar_romaneio_retorno_sincronizado
body retorno + envelope saída → recusa
body saída + envelope retorno → recusa
retorno + envelope sem tipo   → recusa
```

E o retorno só roda de verdade na 2D, que é quem coleta cartão e PIN.
Até lá o que dá pra exercitar é a metade de validação.

## 74. Etapa 2C.7 — a tela não oferece o que ela já sabe que vai doer

Pequena de propósito, e o enquadramento é do usuário: **não é proteção de
integridade.** O trigger da 2C.2 impede o dano no banco, venha de onde
vier. Isto evita o CUSTO — sem a filtragem, o caixa escolhe a corrida,
colhe as DUAS assinaturas, e só descobre o problema se o fechamento
legado drenar primeiro.

```
2C.2  servidor impede o dano
2C.3  a fila respeita a dependência
2C.7  a tela evita a operação sabidamente ruim
```

`src/lib/corridasBloqueadas.ts`, pura e sem imports; a tela combina
`useCorridasAbertas()` com `useFilaOperacoesPendentes()`. Ela **só
observa**: não apaga item, não marca terminal, não mexe em `chave`, não
chama sync.

### Duas coisas que o código disse e mudaram a regra congelada

O usuário listou os estados bloqueantes como "pendente, processando,
erro/retryable" e mandou não bloquear por terminal. Lendo o laço de
`processarFilaOperacoes`, duas correções:

**1. `bloqueado` NÃO é fim de linha.** O laço o RESSUSCITA assim que o
dono entra:

```js
if (item.status === bloqueado) update({ status: pendente })
```

Uma lista de status "ativos" que o esquecesse ofereceria uma corrida que
vai ser fechada na rodada seguinte. Por isso a regra é literalmente
**"não terminal"** — que, por sorte, é como o usuário a tinha enunciado
em prosa antes de listar os status.

**2. `userId` vazio bloqueia.** Item herdado da v2 do banco local não tem
dono, e o laço deixa item sem dono sincronizar sob QUALQUER sessão. Ele
escreve, logo bloqueia. O predicado espelha o gate do laço:
`!item.userId || item.userId === userId`.

### E uma em que eu desviei do pedido, de propósito

O usuário pediu filtro por `userId + tenantId + lojaId`, pra não esconder
corrida por causa de lixo de outra filial. **Deixei tenant e loja de
fora**, e a razão é que incluí-los só poderia SUB-bloquear:

- eles nunca são comparados pelo laço da fila, então um item de perfil
  movido de filial rodaria e esta função não teria avisado;
- e não há o que sobre-bloquear, porque a lista de corridas já vem
  escopada por filial pela RLS — um item de outra filial não tem como
  apontar pra uma corrida oferecida aqui.

A pergunta certa não é "de quem é este item", é **"ele vai rodar e
escrever nesta corrida?"**. O caso (4) do contrato (outro dono não
bloqueia) continua passando, porque outro dono de fato não roda.

### Os testes

`scripts/corridas-bloqueadas.spec.mts`, 16 casos: os seis do contrato,
os quatro de pureza, os três que a leitura ingênua perderia
(`bloqueado`, `erro`, sem dono) e três bordas — inclusive *payload sem
corridaId não bloqueia ninguém*, porque malformado não pode virar
bloqueio por aproximação, do mesmo jeito que não vira chave inventada na
2C.3.

## 75. Etapa 2C.8 — regressão, compatibilidade e o placar

Sem arquitetura nova, como o usuário delimitou. Mas ela achou uma peça
**faltando**, e não é pequena.

### O protocolo de compatibilidade estava pela metade

O bloco 2 do roteiro pressupunha: trigger recusa → SQLSTATE → handler
reconhece → item vira terminal. Fui conferir o handler. **Ele não
existia.**

`processarFilaOperacoes` classifica com `error instanceof
ErroTerminalDeSaida`, e o que o trigger da 2C.2 devolve é um objeto cru
do PostgREST com `code: 'DCRR1'`. Ou seja: o fechamento legado recusado
iria para `erro` e **retentaria para sempre** — exatamente o sintoma que
o cabeçalho da própria 2C.2 diz que não pode acontecer, e o pior
conhecido do projeto (§50.4).

As duas metades, agora completas:

```
banco    trigger recusa a escrita        → o dano não acontece
cliente  reconhece DCRR1 → TERMINAL      → o item não retenta pra sempre
         + grava fechamento_legado_obsoleto
```

**Nenhuma funciona sozinha**, e é a lição da etapa. Um guard que só
recusa produz um item preso; um handler que só desiste não protegeria
nada.

A auditoria é gravada pelo CLIENTE, com chave de idempotência derivada
de um sha256 do tipo mais o `corridaId` — determinística, para duas abas
ou uma retentativa manual não duplicarem a ocorrência. E não podia ser
do trigger: um `insert into eventos` antes do `raise` é desfeito pelo
rollback que o próprio `raise` provoca.

### A regra de remoção, congelada no CLAUDE.md

O usuário foi explícito e está certo: **"veio vazio" não autoriza remover
o handler.** Vazio nesta máquina não prova vazio nos navegadores das
outras filiais — são 17, e cada uma tem a própria fila em IndexedDB.

O sinal que autoriza é a AUDITORIA, não a fila local: enquanto
`fechamento_legado_obsoleto` aparecer no Registro de Auditoria, existe
cliente antigo drenando por aí.

### O censo, e o que ele é

`scripts/conferir-2c8-no-console.js` só LÊ. Mostra a fila por tipo e
status, os `fechamento_corrida` em detalhe (com `backfillOk`, que é
`chave === payload.corridaId`), o que a 2C.7 está escondendo da tela, e
avisa se aparecer `romaneio_retorno` — que antes da 2D seria inesperado.

Ele responde uma pergunta operacional, não um gate: existe item legado
AQUI que valha exercitar a janela de ponta a ponta antes da 2D?

### O censo rodou em 2026-08-20: fila local vazia

```
fila local                        0 itens
fechamento_corrida legado         0
corridas escondidas pela 2C.7     0
romaneio_retorno                  0   ← esperado antes da 2D
```

Zero em tudo, e cada zero quer dizer uma coisa diferente:

- **`romaneio_retorno = 0` é confirmação.** Nada enfileira este tipo até
  a tela existir, e se aparecesse antes da 2D seria sinal de que alguém
  está criando retorno offline por um caminho que não deveria existir.
- **`fechamento_corrida = 0` não autoriza nada.** Vazio nesta máquina não
  prova vazio nos navegadores das outras 16 filiais. A regra de remoção
  continua sendo por janela de releases, com a auditoria como sinal.

### E ele corrige uma linha do placar que eu tinha escrito larga demais

Eu marquei `fechamento legado não sobrescreve DCRR1` como verde citando
"trigger medido, SQLSTATE DCRR1". **A metade do banco está provada; a do
cliente não.**

```
trigger recusa a escrita            ✓  medido na 2C.2, contra retorno sintético
DCRR1 → terminal + auditoria        ✗  CÓDIGO NUNCA EXECUTADO
```

O handler do cliente foi escrito na 2C.8 e nunca rodou, porque exercitá-lo
exige as duas coisas ao mesmo tempo: um `fechamento_corrida` legado vivo
na fila **e** um DCRR1 selado na mesma corrida. Não há nem um nem outro —
a fila está vazia e o placar de integridade diz `retorno 0 · 0 · 0`.

Isso não é uma falha da 2C.8: é a ordem natural das coisas. O primeiro
encontro real entre os dois só pode acontecer depois de a 2D selar um
retorno. **Vai pra lista de testes da 2D**, e o sinal de que funcionou é
`fechamento_legado_obsoleto` aparecendo no Registro de Auditoria.

Pelo mesmo motivo, o **backfill da 2C.3 nunca encontrou dado legado real**
— foi provado 11/11 contra um banco v4 sintético, e não contra a fila de
alguém. Nesta máquina não havia o que backfillar.

### O que a 2C entrega, e o que ela não promete

A infraestrutura offline do retorno está construída e medida em tudo que
podia ser medido sem uma tela: porta offline, trigger de obsolescência,
fila com dependência e sem self-lock, payload congelado, envelope com
tipo, despacho conciliado contra a função no ar, e a proteção local.

O que ela **não** promete, e não deve parecer prometer: que o caminho
feliz do retorno offline funciona. Ele nunca rodou. Roda na 2D.

### O placar da 2C

```
DCR1 (saída)
  online                                  ✓  sete romaneios reais
  offline novo                            ✓  R-000010
  offline LEGADO (envelope sem tipo)      ~  formato atravessa a
                                             conciliação (caso 1 da 2C.6);
                                             sincronização real NÃO exercitada

DCRR1 (retorno)
  payload congelado                       ✓  19/19, sem o domínio junto
  envelope com tipo                       ✓  18/18
  body × envelope                         ✓  13/13 contra a função NO AR
  despacho correto                        ✓  ordem provada no texto
  porta offline pronta                    ✓  2C.1 conferida no banco
  conflito preservado                     ✓  herdado da 2B
  fila ordenada                           ✓  dependeDeChave sem self-lock
  retorno não passa fechamento legado     ✓  16/16
  fechamento legado não sobrescreve       ~  trigger medido; o handler
                                             do cliente nunca executou
  DCRR1 offline REAL                      ✗  aguardando a 2D

FILA
  owner                                   ✓
  legado sem owner tratado                ✓  bloqueia, porque roda
  self-dependency corrigida               ✓  3 falham com o predicado antigo
  malformado preservado                   ✓  sem chave inventada
  backfill idempotente                    ✓  11/11 contra IndexedDB real

CRIPTO
  offlineEventHash não mudou              ✓  três hashes de antes congelados
  tipo fora da fórmula histórica          ✓  decisão do usuário
  chave errada falha                      ✓
  IV alterado falha                       ✓
  ciphertext alterado falha               ✓
```

**Os dois que não estão verdes são honestos, e não devem ser maquiados.**
O DCRR1 offline real depende de tela que colete cartão e PIN — é 2D por
construção. E a saída offline LEGADA teve o formato provado, não a
sincronização: isso exige uma Nova Corrida sem rede com um envelope
selado antes da 2C.5, e o valor dela é de regressão de dado, não de
protocolo.

## 76. O desenho da 2D.1, fechado antes de qualquer componente

Sessão de 2026-08-20, com a 2C fechada. Mesmo método do item 58: o
usuário trouxe a máquina de estados e a regra do congelamento, e mandou
fechar antes do JSX. O desenho completo está no CLAUDE.md, seção "A 2D".
Aqui fica o que a leitura do código **achou**.

### Um achado que economiza trabalho

`documentos_esperados_do_retorno(uuid)` **já existe e já tem grant para
`authenticated`**, com `security invoker` — logo a RLS se aplica. A 2B.5
deixou a porta do lado do cliente pronta sem ninguém registrar isso.

Ou seja: a tela consegue perguntar quais papéis a saída espera **sem
migration nenhuma**. Sem essa leitura, a 2D.2 começaria escrevendo uma
função SQL que já está no banco.

### Três coisas que a tela precisa e não existem

| precisa | estado |
|---|---|
| `saidaRomaneioId` e `saidaDocumentHash` da corrida | falta — `CorridaAberta` não sabe do romaneio |
| pagamento PREVISTO por vale | falta |
| cliente/endereço/valor do SNAPSHOT da saída | falta — só há o caminho por `entregas` |

As três viram UMA consulta, não três: a tela não pode montar o documento
a partir de fontes que podem discordar entre si.

E os fatos antigos têm que vir do SNAPSHOT, não de `entregas` — é a
regra 7 e a lição do PDF do romaneio. Mostrar o valor de hoje faria o
caixa conferir contra algo que o motoboy nunca recebeu.

### O que eu acrescentei à regra de invalidação

O usuário listou o que morre quando o caixa edita depois de congelar:
hash, autorização, assinaturas. **Falta o ENVELOPE**, e ele é o quarto:
sela `operationId` + `documentHash` + `tipo`, e os dois primeiros mudam.
Reaproveitá-lo faria a sincronização recusar `envelope_trocado` horas
depois, com as duas assinaturas já colhidas.

Somei também `romaneioId` e os `pagamentoId` — os últimos entram no
DCRR1, logo no hash.

E vale escrever por quê os traços são DESCARTADOS e não reaproveitados:
assinatura manuscrita é manifestação sobre um conteúdo específico.
Recolher a mesma imagem sobre um documento diferente é falsificar
consentimento — a família do §39, com o preço maior.

### Duas regras de tela que caem da transação

**O conjunto de vales é fixo** (vem da saída; `selar_romaneio_retorno`
exige igualdade de conjunto) e **as linhas de documento não são criadas
à mão** (a expectativa sai do canônico assinado da saída). Oferecer
qualquer das duas seria oferecer o impossível, e descobrir custa duas
assinaturas.

### O número que a 2D.5 move

O placar de integridade diz `retorno 0 · 0 · 0` desde que existe. A
2D.5 o leva a `retorno 1 · 1 · 0` — e é a primeira vez que as cinco
camadas do verificador do retorno rodam contra um retorno de verdade.
Elas são código não exercitado desde a 2B.4.

## 77. Etapa 2D.2 — o contexto do retorno, e o achado que o simplificou

`20260820190000_contexto_do_retorno.sql` (**não aplicada**),
`src/data/contextoRetorno.ts` e Dexie v6 com o cache. Nenhum componente
ainda.

### O payload da saída já tinha tudo

Fui montar a consulta esperando juntar três fontes — `entregas` pro
snapshot, `pagamentos` pro previsto, e a função de documentos esperados.
**`romaneios.payload` da saída já carrega as duas primeiras**, incluindo
`pagamentos_previstos` por vale, com `pagamento_id`, `forma`,
`valor_cents` e `troco_cents`.

Isso não é economia de join. É o que faz a consulta obedecer à trava que
o usuário pôs antes de eu escrever: **nenhum fato histórico lido de
estado operacional mutável.** Se a saída dizia "Rua X, 123" e alguém
corrigiu o cadastro pra "Rua Y" depois, a tela de conferência mostra
"Rua X, 123" — porque é isso que o motoboy recebeu sob custódia. A mesma
regra que governa o PDF do romaneio desde 18/08.

O único join que sobrou é decorativo: motoboy e agência, pra o cabeçalho.

### `ContextoRetorno` é tipo próprio, e a separação é o ponto

```
ContextoRetorno   fatos antigos, do documento assinado, SÓ LEITURA
EntradaRetorno    fatos novos, que VÃO ser assinados
```

Nada no `ContextoRetorno` tem forma parecida com o que
`paraJsonbRetorno` consome. Isso é deliberado: um
`{ ...contexto, ...entrada }` colocaria cliente, endereço e valor da
compra dentro do DCRR1 — e o contrato diz que o retorno **assina só o
que ACRESCENTA**, porque repetir o que a saída selou criaria uma segunda
fonte capaz de discordar da primeira.

O mesmo vale por dentro: `pagamentosPrevistos` mora no contexto,
`pagamentosRealizados` mora na entrada. A tela pode até pré-preencher um
com o outro pra agilizar, mas o DCRR1 recebe o confirmado, nunca uma
referência ao previsto.

### O cache não é otimização, é a condição do offline

A trava que o usuário acrescentou muda a natureza da consulta: a 2C
permite registrar retorno sem internet, então a tela **não pode depender
do servidor no instante em que o motoboy volta** — e esse instante é o
fim da tarde, no balcão.

O contexto é imutável por construção (sai de um romaneio selado), o que
o torna cacheável sem nenhuma das dúvidas de invalidação que um cache de
dado vivo teria: **ele não pode ficar velho, só pode não existir.**

```
online   → consulta → guarda em IndexedDB (Dexie v6)
offline  → lê do cache
offline sem cache → BLOQUEIA, com a razão dita
```

O bloqueio é explícito e não tenta remendar: nada de montar o documento
a partir do que houver em tabela local, porque seria inventar o que o
motoboy recebeu. É a decisão do §50.1 — a tela diz o que falta em vez de
deixar o caixa concluir que o sistema perdeu alguma coisa.

`aquecerContextosDeRetorno` é best-effort e engole falha por corrida:
uma a menos é uma corrida que não fecha offline; um `throw` ali seria
uma tela de erro por causa de uma preparação que ninguém pediu. Mesmo
espírito de `aquecerGeolocalizacao()`.

### Duas decisões de versão

`versao: 'CTXR1'` vem dentro do jsonb E ao lado dele no registro do
cache. A duplicação é de propósito: a leitura descarta um contexto de
formato antigo **sem desserializar e adivinhar**. Montar o DCRR1 a partir
de um formato que esta versão não entende é a definição de assinar uma
coisa e mandar outra.

E `ContextoRetornoEmCache.contexto` é `unknown`. Tipá-lo como
`ContextoRetorno` faria `db.ts` importar `data/` (ciclo) e, pior, faria o
TypeScript afirmar sobre bytes que outra versão do app escreveu. O cast
mora num lugar só — dentro de `lerContextoLocal`, imediatamente depois de
a versão ser conferida.

### A `origem` sai no resultado

`{ estado: 'pronto', contexto, origem: 'servidor' | 'cache' }`. A tela não
muda o que faz com ela — o contexto é imutável dos dois jeitos —, mas
quem estiver depurando "por que este vale não aparece" precisa saber se
está olhando o que o servidor respondeu agora ou o que ficou guardado.

### Conferida em 2026-08-20: cinco de cinco

```
(a) instalada=t  anon=f  authenticated=t
(b) versao=CTXR1  hash=64 chars  saida=R-000001
(c) vales no contexto=1  em romaneio_entregas=1
(d) vales sem previstos/esperados=0
(e) contexto e entregas iguais — ninguém corrigiu este vale
```

`documentos_esperados: []` num vale de dinheiro é o resultado CERTO: a
expectativa é derivada das linhas `p` do canônico assinado, e dinheiro
não gera papel. O caminho do convênio/crediário continua sem exercício
aqui — a saída escolhida não tinha nenhum.

### E o vale impresso achou a armadilha mais afiada da 2D

O `pagamento_id` do previsto veio **igual ao `entrega_id`**. Não é
defeito: é o desenho de `criarPagamentoPrevisto`, que usa o uuid da
entrega como id determinístico porque a relação é 1:1 e isso dá
idempotência ao reenvio da fila sem upsert.

Mas ele arma um problema para a 2D.3, e o gatilho é a conveniência que
o próprio usuário sugeriu — pré-preencher o realizado com o previsto.
Copiando o objeto inteiro, o `pagamentoId` vai junto, o DCRR1 carrega o
id do previsto na linha `pr`, e o insert do selo bate em
`on conflict (id) do nothing`: **não grava nada e não levanta erro.** O
romaneio sela afirmando um pagamento realizado que não existe.

Perda silenciosa com duas assinaturas em cima, e invisível — o
`on conflict` existe por um bom motivo (reenvio não pode duplicar) e não
vai sair.

A regra ficou no CLAUDE.md: pré-preencher copia forma, valor e troco,
**nunca o `pagamentoId`**. E o congelamento tem que RECUSAR a colisão,
não só evitá-la — custa um `Set` e torna o defeito impossível de
representar em vez de improvável.

Isto não apareceu em revisão de código nem em teste: apareceu porque a
conferência imprime o vale por extenso e alguém leu. É o mesmo padrão
do §42 e do canônico impresso da 2A.

### O que falta na 2D.2

A migration não foi aplicada, e o conferidor do rodapé é o que fecha a
etapa. O caso (e) dele é o mais interessante: imprime o cliente do
CONTEXTO ao lado do cliente que está em `entregas` hoje — se os dois
diferirem, o contexto está **certo**.

## 78. Etapa 2D.3 (pré-condição) — a invariante do pagamento realizado

O usuário barrou a minha proposta, e a formulação dele é melhor que a
regra que eu tinha escrito:

> Um Romaneio de Retorno só pode ser selado se cada linha `pr` assinada
> corresponder a exatamente uma linha de pagamento realizado persistida
> pela mesma transação.

"O id não pode colidir com o do previsto" é **consequência** disso, não a
regra. E o argumento que fecha: a proteção não pode existir só na tela,
porque um cliente antigo, com defeito ou manipulado manda um DCRR1
perfeitamente assinado e o banco selaria enquanto o
`on conflict do nothing` engole a gravação.

### As duas camadas

```
CLIENTE   no congelamento, ids novos e nenhuma colisão
          → evita chegar a cartão, PIN e duas assinaturas pra descobrir

BANCO     conta as linhas `pr` assinadas contra as gravadas
          → o documento inconsistente não chega a existir
```

Mesma divisão da 2C.2: o cliente evita o custo, o banco impede o dano.

### Por que exceção, e não conflito

A 2B decidiu que recusa vira `status = 'conflito'`, porque quando o
retorno chega ali as duas partes já assinaram e a prova não pode sumir
num rollback. **Esta é diferente:** o documento é internamente
inconsistente — afirma um pagamento que a própria transação não
conseguiu gravar. Preservá-lo como conflito criaria evidência de algo que
não pode ter acontecido, e que alguém poderia tentar reaproveitar.

### O método: patch por script, diff conferido antes

É a QUARTA definição de `selar_romaneio_retorno_interno`, e reescrevê-la
à mão seria a forma mais provável de reintroduzir um bug corrigido. Ela
foi obtida **patcheando a mais recente por script**, com o diff medido
antes de virar migration:

```
14 linhas de código acrescentadas
 0 linhas removidas
 4 linhas de `digest(...)` byte a byte IDÊNTICAS
```

Mesmo método do `papel_no_momento` (§59), e pelo mesmo motivo: "a fórmula
não mudou" tem que ser medição, não leitura.

O `on conflict (id) do nothing` **continua lá**. Ele é o que impede
reenvio de duplicar pagamento; tirá-lo trocaria um defeito silencioso por
outro. O que mudou é que agora ele é obrigado a se denunciar.

### A conferência consegue o que a 2B não conseguiu

O bloco 2 monta um DCRR1 **válido** cujo único defeito é o
`pagamento_id` já existir — usando o id do previsto, que é o uuid da
entrega. É literalmente o payload que um cliente produziria ao
pré-preencher o realizado copiando o previsto inteiro.

Pra chegar ao laço de pagamentos ele atravessa tudo: saída selada, hash
da saída, corrida aberta, conjunto de vales exato, motoboy da custódia e
o `document_hash` batendo com o DCRR1 reconstruído pelo gêmeo SQL. **A
autorização é cunhada à mão** — no SQL Editor dá, e é isso que permite
exercitar o trecho que a conferência da 2B parou antes de alcançar
(`42501` na autorização).

Ele queima um número de romaneio: o insert em `romaneios` acontece antes
do laço de pagamentos.

### Provada contra dado real em 2026-08-20, na quarta rodada

```
(e) selo: 23514 | Pagamento realizado em conflito: o DCRR1 afirma
                  1 linha(s) pr e só 0 foi(ram) gravada(s).
(f) retorno selado=0  conflito=0
(g) pagamentos realizados gravados=0
```

Os três juntos são a garantia: **(e)** a transação aborta em vez de
selar, **(f)** e **(g)** o rollback foi COMPLETO — nenhum romaneio, nem
selado nem como conflito, e nenhum pagamento parcial. O achado do vale
impresso virou garantia de banco.

**`23514` bateu com o previsto, e o contraste com o `P0002` da 2C.1 é
instrutivo.** `check_violation` é nome de condição do padrão SQL, com
SQLSTATE definido; `no_data_found` é nome do PL/pgSQL, mapeado para
`P0002`. Prever o primeiro é razoável, prever o segundo não era — e a
regra continua sendo medir.

### A metade de cliente: `src/lib/congelarRetorno.ts`

Pura, importando só outros módulos de `lib/`. Ela devolve o pacote
inteiro do congelamento de uma vez —

```
romaneioId  ·  retornoJsonb  ·  canonico  ·  documentHash
```

— e é isso que torna a invariante da 2D.1 mecânica em vez de disciplinar:
**não há como ficar com metade dele.** Editar depois significa chamar de
novo, e tudo que dependia do hash morre junto por construção.

`novoId` entra por PARÂMETRO em vez de `uuidv7()` ser chamado lá dentro.
Não é abstração gratuita: é o que permite o caso (7) do spec usar o
gerador como TESTEMUNHA — numa recusa, ele não pode ter sido chamado
nenhuma vez, porque um `romaneioId` cunhado para um documento que não
pode ser assinado é lixo que alguém vai encontrar depois.

**A ordem é contrato:** os ids são conferidos ANTES de qualquer
conversão. Congelar primeiro e validar depois deixaria um `documentHash`
existir por um instante para um documento impossível — e é esse tipo de
"por um instante" que vira defeito quando alguém acrescenta um `await` no
meio.

### Por que o guard duplica uma checagem que o canônico já faz

`validarRetorno` já recusa `pagamento_duplicado`. O guard checa de novo, e
a duplicação é deliberada:

```
canônico   PURO, não conhece o contexto
           → nunca poderia ver a colisão com o PREVISTO
           → e recusa o documento inteiro, sem dizer qual linha

guard      conhece os previstos
           → aponta o VALE
           → devolve LISTA, não booleano
```

Pegar as duas coisas no mesmo lugar é o que permite a tela mostrar os
dois problemas de uma vez, em vez de o caixa corrigir um e descobrir o
outro. E o `else if` entre os dois motivos é intencional: um id que
colide E se repete é UM problema por linha, não dois — as duas queixas
apontariam pro mesmo campo.

### Uma asserção minha que estava errada, e o que ela virou

O caso (4) afirmava que, sem o guard, o canônico pegaria a duplicata
`pagamento_duplicado` — e media isso chamando `congelarRetorno` com a
lista de previstos vazia. **Não funciona: o guard checa duplicata
também, então ele fala primeiro e o canônico nunca opina.**

Diagnosticado com um arquivo temporário em vez de suposição: `lançou
RetornoNaoCongelavel`, e `validarRetorno` chamado direto devolve
`pagamento_duplicado`. Cheguei a suspeitar de duas instâncias do módulo
(`@/lib/...` contra caminho relativo) — não era; o projeto já usa `@/`
dentro de `lib/` e o `tsx` resolve.

A asserção virou duas, e ficou melhor que a original: **o canônico também
recusaria** (medido chamando-o direto) **e quem fala primeiro é o
guard** (medido pelo nome do erro). As duas camadas ficam visíveis em vez
de uma esconder a outra.

### A máquina de custódia, como redutor puro

`src/lib/custodiaDoRetorno.ts`, sem React e sem imports. O visual vem por
cima; o gate desta etapa não é aparência, é **percorrer a máquina inteira
sem que exista uma transição capaz de reaproveitar evidência de um
documento anterior.**

### A staleness virou detectável em vez de confiada

Toda evidência é guardada CARIMBADA com o `documentHash` sob o qual foi
colhida:

```
{ paraDocumento: '<hash>', valor: … }
```

Com isso, "esta assinatura é deste documento?" vira uma comparação, e não
uma confiança em que todo caminho de invalidação lembrou de limpar.
`evidenciaDeOutroDocumento()` é a invariante, e o caso (10) do spec a
checa **depois de cada transição de cada estado alcançável**:

```
4403 transições · 258 estados distintos · 0 sujas
```

Não é sobre os caminhos que eu lembrei de escrever — é sobre a máquina.
E o mesmo caso força um estado com carimbo errado, porque `0 sujas`
também seria o resultado de um detector que não funciona.

É o truque do carimbo do §62, onde ler a fila inteira e procurar o item
concluía "sincronizada" por um instante. Carimbar torna "ainda não sei"
uma resposta possível.

### A decisão que o usuário deixou em aberto

**Autorização expirada recolhe as DUAS assinaturas.**

O conteúdo não mudou — o `documentHash` é o mesmo —, então em tese os
traços continuariam sendo manifestação sobre o mesmo documento. O que
muda é outra coisa: **a autorização é a prova de que aquela pessoa estava
ali NAQUELE momento.** Expirada, uma nova autenticação prova que ela está
aqui AGORA, e o documento passaria a juntar evidências de duas janelas de
presença sem dizer isso em lugar nenhum.

É o §39 de novo: o documento não afirma o que não sabe. Custa duas
assinaturas; afirmar uma simultaneidade que não houve custa a cadeia.

E o recolhimento é **explicado**, nunca silencioso — daí
`motivoDoRecolhimento`, que a tela mostra. Foi a ressalva do usuário, e
ela vale: recolher sem dizer por quê pareceria defeito.

### Duas decisões menores que o spec fixou

**PIN recusado NÃO recolhe o cartão.** Ainda não há assinatura nenhuma, e
o caixa vai tentar de novo; recolher só faria bipar à toa. Já
`TROCAR_MOTOBOY` e `CANCELAR` recolhem tudo.

**`recolher()` é um lugar só.** Todo caminho de invalidação passa por
ele, então acrescentar uma evidência ao estado obriga a acrescentá-la
lá — o esquecimento vira erro em vez de vazamento.

### `assinando_responsavel` é rótulo, não estado

Hoje a máquina vai de `custodia_autorizada` direto pro traço do
responsável, então aquele nome existe no tipo pra a tela nomear a etapa,
mas o redutor não o produz. O caso (11) **afirma isso explicitamente**,
em vez de deixá-lo passando por estado morto: se um dia virar um passo de
verdade, o teste cobra.

### Quatro rodadas, e nenhuma falha estava na migration

O bloco 1 provou na primeira tentativa que a função estava instalada, os
contadores no lugar e as 4 linhas de `digest` intactas. As três rodadas
seguintes foram defeitos do INSTRUMENTO, e vale listá-los porque são
todos da mesma família — o relatório escondendo o que aconteceu:

1. **bloco 2 comentado no arquivo.** Colar comentários dá "Success. No
   rows returned", e eu não tinha dito que isso significa "nada rodou".
   Na 2C.2 o bloco 2 estava vivo; aqui não. Formato inconsistente meu.
2. **dois `limit 1` sem `order by`** — um pro hash, outro pro argumento.
   Perfis diferentes → canônico divergente → `documento_alterado`. E o
   relatório somava selado com conflito, então o "1" parecia um selo.
3. **`coalesce` entre o motivo genérico e o específico.**
   `registrar_conflito_retorno` devolve os dois, o genérico é sempre
   `'conflito'`, e o `coalesce` parava nele. Três rodadas sem saber qual
   recusa era.
4. **`documentos: []` fixo.** A saída escolhida ESPERAVA papel — é a
   única das onze, segundo o censo da 2B.5, e por acaso é a que está
   aberta. `documentos_nao_conferem` recusava antes do laço de
   pagamentos.

O (4) era a causa; o (3) era o que impedia de vê-la.

**Custo: três números de romaneio queimados** sem exercitar a guarda. E a
lição, que já é a décima segunda deste projeto com outro nome: quando um
teste não conclui, o primeiro suspeito é o teste — mas um teste que não
DIZ onde parou faz cada rodada custar uma iteração inteira.

### Uma armadilha do meu conferidor, de novo

O checador de parênteses acusou saldo 2 no script. Falso positivo: ele
conta parênteses **dentro de literais**, e `'digest('` aparece duas
vezes. Já tinha mordido na 2A, onde a regra escrita foi "parênteses
balanceados fora dos literais" — e eu tinha reimplementado a versão
ingênua. Refeito apagando o conteúdo dos literais antes de contar: 0 nos
três arquivos.

## 79. A primeira integração da tela achou uma impossibilidade no contrato

2026-08-21. A sessão era pra ser só de leitura das notas; comecei a
montar o componente da 2D.3 antes de ser pedido. O usuário parou, e
depois manteve as mudanças — porque a integração tinha encontrado uma
coisa que nenhuma leitura de código teria encontrado.

### O envelope não pode nascer no passo do PIN

```
offlineEventHash = documentHash + responsavelStrokes + motoboyStrokes + …
```

O envelope carrega esse hash, e `sync-romaneio` o **recalcula do corpo**
pra decidir entre selar e recusar `payload_alterado`. No instante em que
o PIN é digitado os dois traços não existem, então o artefato que o
evento `PIN_SELADO` pedia só nasce duas transições depois.

Não era bug de código: a máquina da 2D.3, escrita e medida em 20/08 com
4403 transições, pedia algo impossível. **O gate anterior não podia ter
pego isso**, e vale dizer por quê — ele exercitava a máquina com dublês
(`{ k: '…' }` no lugar do envelope), e um dublê não tem como saber que o
objeto real depende de dados que ainda não existem. Só a integração com
quem produz o objeto de verdade responde essa pergunta.

### A minha primeira correção estava certa na ideia e errada no contrato

Eu tinha feito o evento carregar `{ pin, credentialToken }` e o estado
guardá-los carimbados, nos DOIS caminhos, com o envelope nascendo no
`CONCLUIR`. O usuário barrou três coisas, e as três melhoraram:

1. **`PIN_SELADO` virou nome falso** — se há PIN em claro e não há
   envelope, nada foi selado. Virou `SEGREDOS_CAPTURADOS`, com estado
   próprio `segredos_capturados` (nunca `custodia_autorizada`, porque
   offline ninguém autorizou nada). "Selado" fica reservado pra
   `selarSegredos()`. É o §33 e o §61 outra vez: vocabulário que afirma
   mais do que aconteceu já custou caro nesta cadeia.

2. **PIN e token não podem estar no estado serializável.** Objeto de
   estado acaba em log, snapshot de teste, telemetria e persistência
   acidental. Hoje a máquina guarda só um SINAL carimbado
   (`segredosCapturados`), e o material vive numa ref efêmera do
   componente. A permissão é DERIVADA — `podeGuardarSegredos(estado)` —,
   e não uma disciplina que cada caminho da tela precise lembrar.

3. **O adiamento é só do offline.** Online quem prova a presença é a
   autorização de uso único; segurar o PIN até o fim não compra nada.
   Então o PIN sai da memória assim que ela é emitida, e o caminho
   online **não produz envelope**. Isso RESTAUROU a asserção original do
   spec (`sem envelope no caminho online`), que eu tinha relaxado —
   sinal de que o desenho do usuário era o coerente e o meu é que tinha
   torto. `CONCLUIR` virou tipo discriminado, então "online com
   envelope" deixou de ser escrevível.

### E aí a varredura achou uma janela que eu não tinha visto

A asserção nova do caso (10) — *nenhum estado com autorização deixa o PIN
em memória* — **falhou na primeira rodada**. O caminho:

```
SEGREDOS_CAPTURADOS  →  segredos_capturados   PIN em memória: true
PIN_RECUSADO         →  pin_recusado          PIN em memória: true
PIN_AUTORIZADO       →  custodia_autorizada   PIN em memória: true  ←
```

Cenário real, não sintético: o caixa captura o PIN sem rede, a rede
volta, ele autentica online. Terminava com autorização emitida **e** o
material em claro ainda autorizado a viver.

Três transições consertadas: `PIN_AUTORIZADO` zera o sinal,
`SEGREDOS_CAPTURADOS` zera a autorização (os dois ramos passam a ser
exclusivos), e `PIN_RECUSADO` descarta o material — um PIN recusado é um
PIN errado, não tem por que sobreviver enquanto o certo é digitado por
cima.

O caso (9b) existe pra a regressão ter NOME: "5066 transições" não diz
qual quebrou, e uma varredura que acusa sem apontar custa uma iteração
inteira — a lição do §78, com outro instrumento.

### As outras três mudanças, todas peças que faltavam

- **`selarRomaneioRetorno`** (`src/data/romaneios.ts`) — a porta ONLINE
  não existia no cliente. A 2B construiu a RPC; nada a chamava. Recebe o
  artefato CONGELADO (`retornoJsonb` + `documentHash`), nunca o domínio
  editável: reconverter na porta reabriria a fresta de assinar uma coisa
  e mandar outra. **Não manda `corridaId` nem `lojaId`** — o servidor
  deriva os dois do romaneio de saída selado, e é isso que torna o
  retorno imune ao buraco de `p_loja_id` que a saída ainda tem.
- **`corridasComRetornoPendente`** (`src/lib/corridasBloqueadas.ts`) —
  offline a corrida continua `aberta` no servidor, então a tela a
  ofereceria de novo pra uma segunda coleta de duas assinaturas.
  **Bloqueia independentemente do dono**, ao contrário da regra do
  fechamento legado, e a diferença é o ponto: `fechamento_corrida` não é
  documento; `romaneio_retorno` já é um documento assinado pelas duas
  partes, e `UNIQUE (corrida_id, tipo)` garante que só um dos dois pode
  ser selado. O caso (11) do spec congela a diferença, senão ela some na
  primeira refatoração que "uniformizar" as duas.
- O rename pra `assinaturaInternaStrokes` **não é desta sessão** — veio
  da 2C.5, com os três hashes congelados provando que a fórmula não
  moveu. Só confirmando que continua de pé.

### A regra 4, congelada no mesmo dia

Eu tinha deixado um buraco anotado — "se o selo online falhar por rede
depois das duas assinaturas, não há envelope pra mandar pra fila" — e o
usuário mandou fechar antes do JSX, com razão: o componente ia
inevitavelmente ter que decidir o que fica na tela quando o selo falha.

O estado naquele instante:

```
documento congelado      ✓
duas assinaturas         ✓
autorização              provavelmente já inútil
PIN e token              ✗ apagados na autenticação (regra 3)
envelope                 ✗ nunca existiu neste ramo
servidor selou           ✗
```

A decisão de **não fabricar envelope depois** ficou de pé — faltam os
segredos, e "recuperar" assim incentivaria guardar o PIN além do
necessário, desfazendo a regra 3. O que ele acrescentou foi a política de
recuperação, e ela separa duas coisas que pareciam a mesma:

```
EDIÇÃO DO DOCUMENTO        FALHA DE REDE NO SELO
destrói tudo               preserva o documento
  romaneioId                 romaneioId     preserva
  pagamentoIds               pagamentoIds   preserva
  documentHash               retornoJsonb   preserva
  autorização                documentHash   preserva
  assinaturas              e destrói a custódia:
documento NOVO               autorização    descarta
                             assinaturas    descarta
```

O caixa não refaz a conferência: refaz cartão + PIN e as duas
assinaturas, sobre o mesmo documento. Bem menos doloroso que voltar ao
início.

**E as assinaturas caem de propósito, com o conteúdo intacto.** O
argumento é probatório, e é o do usuário: o que o sistema afirma é uma
SEQUÊNCIA — *autenticação → manifestação sobre o documento*. Conservar os
traços e autenticar por cima inverteria a ordem, associando uma
autenticação nova a uma manifestação anterior a ela. Tecnicamente
defensável; é exatamente a ambiguidade temporal que a frente vem
eliminando desde a 2A.

Estado PRÓPRIO (`falha_selo_online`), não `erro_rede` genérico, porque a
ação certa é específica. E **nunca um "tentar novamente"** que repita o
selo com a autorização e os traços antigos — o caso (9c) do spec afirma
que `CONCLUIR` dali é no-op, e que a única saída é bipar o cartão de
novo.

Duas bordas que o caso (9c) também fixa, e que existem pra o evento não
virar um jeito de zerar custódia à toa: `FALHA_DE_REDE_NO_SELO` **não
vale antes de tentar selar** e **não alcança o ramo offline** — lá a
operação vai pra fila com o envelope, e não há custódia a desfazer.

### E aí o componente foi escrito

Com a regra 4 congelada, o usuário liberou o JSX. `RetornoCorrida.tsx`
deixou de enfileirar `fechamento_corrida` e passou a ser o fluxo do
documento: contexto → conferência → congelamento → cartão → PIN → duas
assinaturas → selo online **ou** fila offline.

**`CampoAssinatura` saiu da `NovaCorrida` pra `src/components/`.** Duas
cópias de um canvas parecem inofensivas até uma ganhar o `ratio` de tela
retina e a outra não — e aí os traços dos dois documentos deixam de estar
na mesma escala, o que só aparece no PDF, meses depois.

Três coisas do componente que valem registro, porque nenhuma delas é
óbvia lendo o resultado:

- **O PIN não é estado do React.** O input é NÃO-CONTROLADO e o que o
  componente guarda é um booleano (`pinCompleto`), o suficiente pra
  habilitar o botão. Texto claro em `useState` acaba em devtools, em
  snapshot e em qualquer log que serialize o componente — a regra 2 valia
  pra máquina e vale igual aqui.
- **O canvas segue a máquina, pelo mesmo motivo que a ref do PIN.**
  Quando a custódia é recolhida, os traços saem do estado; se o desenho
  continuasse na tela, ela mostraria uma assinatura que o documento não
  tem mais. Derivado de `custodia.responsavelStrokes != null`, não
  lembrado em cada handler — assim um caminho de invalidação novo já
  nasce coberto. E o canvas TRAVA (`pad.off()`) depois de registrado,
  senão daria pra rabiscar por cima de uma assinatura já colhida.
- **O cartão errado é recusado antes das assinaturas.** O documento já
  nomeia o motoboy (veio da saída), então um cartão de outra pessoa não é
  "trocar de motoboy": é o cartão errado, e sem essa checagem a transação
  recusaria `outro_motoboy` depois de duas assinaturas colhidas.

#### Duas decisões de tela que merecem revisão do usuário

1. **A soma dos pagamentos que não bate com a compra AVISA, não
   bloqueia.** O `marcarDivergencia` bloqueia; aqui não. O DCRR1 não
   exige que a soma bata, o servidor deriva a divergência comparando
   previsto × realizado, e travar faria um vale ficar sem como ser
   fechado às 20h por causa de previsto antigo. O aviso é destacado.
   Se preferir bloquear, é uma linha.
2. **O documento físico não tem valor inicial; o desfecho tem.**
   `entregue` continua sendo o padrão (é o comportamento de hoje e a
   esmagadora maioria), mas `recebido` NÃO é: presença física de papel é
   afirmação que ninguém confere depois, e marcá-la por inércia faria o
   documento assinado dizer que o papel voltou porque o caixa não olhou.
   Como convênio/crediário são raros, o custo em cliques é baixo.

#### A pendência de contrato que sobrou, e é pequena

**Recusa do SERVIDOR depois das duas assinaturas não tem estado próprio.**
A 2D.1 previa `documento_alterado` ("reconstruir é a única saída") e ele
não existe na máquina. Hoje o componente **não despacha nada** nesse caso
— e deliberadamente não usa `ERRO_REDE`, que seria vocabulário mentiroso:
não houve falha de rede. A tela de resultado assume, o CTA já está
travado, e o caminho é sair e refazer.

Vale notar que a maior parte das recusas do retorno **não passa por
aqui**: `documento_alterado`, `vales_nao_conferem`, `outro_motoboy` e
`saida_hash_nao_confere` voltam como `ok: false, motivo: 'conflito'`,
porque a 2B decidiu preservar a prova. O que cai neste ramo são as
exceções de verdade — saída não selada, autorização inválida, e o `23514`
da invariante do pagamento.

### O que isto ainda NÃO é

**O caminho feliz nunca rodou.** O componente compila, o app sobe sem
erro de console e sem erro de servidor, mas exercitá-lo exige login, e
isso é clique do usuário. O verificador do retorno segue em
`retorno 0 · 0 · 0`, e é a 2D.5 que move esse número.

## 80. O primeiro uso real da tela, e a porta trancada por dentro

2026-08-25. O usuário abriu uma corrida nova, foi no retorno, e a tela
disse:

```
Não consegui carregar: [object Object]
```

Dois defeitos, e o segundo é o que custaria a sessão.

### `[object Object]` é o erro que apaga o erro

O padrão `e instanceof Error ? e.message : String(e)` está espalhado pelo
app (17 lugares) e funciona pra tudo — MENOS pra o que mais aparece aqui:
o erro do PostgREST é um **objeto simples** (`{ message, details, hint,
code }`), não uma instância de `Error`. Cai no `String(e)` e vira
literalmente `[object Object]`.

O que se perde não é o texto: é o `code`. É ele que distingue "a função
não existe no cache do schema" de "a RLS recusou" de um SQLSTATE do
Postgres — e sem ele os três se parecem.

`mensagemDeErro()` em `src/lib/supabase.ts` monta a mensagem dos campos
que o objeto tiver, com o `code` entre parênteses, e cai pro JSON antes
de aceitar `[object Object]`. Com ela a tela passou a dizer, na primeira
tentativa seguinte:

```
Não consegui carregar: permission denied for function
romaneio_documentos_esperados (42501)
```

**E o `aquecerContextosDeRetorno` engolia isso antes de todo mundo.** Ele
é best-effort de propósito (uma corrida que não cacheia é uma corrida que
não fecha offline; um `throw` ali seria tela de erro por causa de uma
preparação que ninguém pediu) — mas silencioso ele esconde defeito, e
esse erro passava por lá ANTES de o caixa clicar em qualquer coisa.
Ganhou `console.warn`. Best-effort é sobre não derrubar a tela, não sobre
não contar.

### O defeito de verdade: `SECURITY DEFINER` não dispensa o `EXECUTE`

```
obter_contexto_retorno              security INVOKER
  └─ romaneio_documentos_esperados  revoke ... from authenticated
```

O privilégio de CHAMAR é conferido contra **quem chama**; só depois a
função passa a rodar como dona. Com o `revoke`, todo caller
`authenticated` leva `42501`.

**E o mesmo vale pra `documentos_esperados_do_retorno`** — que o item 76
registrou como o achado que economizava trabalho: *"já existe e já tem
grant para `authenticated`, com `security invoker`, logo a RLS se
aplica"*. O grant DELA existia. O da função que ela chama, não. Ela nunca
tinha sido exercitada como `authenticated`.

**Por que cinco dias não pegaram isso:** as conferências da 2B.5 (65/65)
e da 2D.2 (5/5) rodaram no SQL Editor, como `postgres` — que ignora
grant. E o caso (a) da 2D.2 chegou a medir `authenticated=t`… **na função
de fora**. Grant conferido só por leitura, e no nível errado, não é grant
conferido. É a lição do §59 noutro instrumento: medir o "antes" não vale
se o instrumento não é o que vai ser usado.

### O conserto é no andar de cima, e o porquê importa

O `revoke` está CERTO e não sai: `romaneio_documentos_esperados` é
`SECURITY DEFINER` e lê `romaneios` por id ignorando a RLS — liberá-la
deixaria qualquer autenticado perguntar, sobre romaneio de outra filial,
quais vales esperam qual papel.

E o corpo dela também não pode ganhar filtro de tenant: é a MESMA função
que `selar_romaneio_retorno_interno` usa, **inclusive pelo caminho
offline**, onde quem chama é a `service_role` e não há JWT —
`current_tenant_id()` seria nulo, a expectativa viria vazia, e o selo
passaria a discordar do documento assinado. Silenciosamente, que é o pior
jeito.

Então `20260825120000` conserta onde há como conferir escopo sem tocar no
caminho da transação: `documentos_esperados_do_retorno` vira
`SECURITY DEFINER` (assim PODE chamar a de dentro) e ganha
`pode_ver_romaneio(r.id)` — que não é regra duplicada, é a função que
existe desde 16/08 declaradamente como espelho da policy
`romaneios_select`. E `obter_contexto_retorno` passa a entrar por ela.

A função de dentro não é tocada: nem corpo, nem grant, nem `secdef`.

**APLICADA e conferida na tela em 2026-08-25.** Depois dela:

```
contexto carrega          V-000046 · Saída R-000014 · previsto Dinheiro
aquecimento do cache      7 contextos em IndexedDB, versão CTXR1
recusas 42501             zero
```

O aquecimento é a parte que vale destacar: ele roda pra TODAS as corridas
abertas, então "0 recusas" ali é uma afirmação mais forte que "a tela que
eu abri funcionou".

### O que a tela provou de passagem, e não era o alvo

Congelei, cliquei em **Editar a conferência**, e congelei de novo **sem
mudar nada**:

```
1º congelamento   329a00567d51d25f…
editar            o hash some, a conferência volta a ser editável
2º congelamento   09c25229164777a5…   ← diferente
```

Nada do conteúdo mudou. A única coisa que pode ter movido o hash é o
`pagamentoId`, recunhado a cada congelamento — ou seja, a armadilha do
§77 fechada e VISÍVEL: se o id do realizado fosse derivado da entrega
(como é o do previsto), os dois hashes seriam iguais.

### E o teste de transporte finalmente rodou

Ele estava escrito desde o item 66 e nunca tinha rodado, porque exige
login. Com a sessão aberta:

```
romaneio R-000001 (o com mais vales dos 12 selados), 3 vale(s), 9 cenários
bloco `d`: 4 de 9 cenários, 14 linhas no total
TRANSPORTE PRESERVA — 9 cenários, quatro critérios cada
```

Exatamente os números que o item 66 previa. O canônico impresso no fim
mostra o `d` com `recebido` e `faltante` convivendo, e os `pagamento_id`
das linhas `pr` diferentes dos `entrega_id` — o mesmo ponto, por outro
caminho.

### Um defeito de tela que só apareceu com dado real

Os campos **Valor** e **Troco** estavam lado a lado, visualmente
idênticos e **sem rótulo nenhum** — o "R$" do `CampoMoeda` é o mesmo nos
dois. Num formulário que decide o que o documento assinado vai afirmar
que o cliente pagou, a única defesa contra trocar um pelo outro era a
memória de quem digita. Os três ganharam rótulo (Forma, Valor, Troco).

## 81. O caminho feliz do Romaneio de Retorno, em 2026-08-25

**O placar saiu de `retorno 0 · 0 · 0`.** Dois retornos reais selados,
`R-000023` e `R-000025`, e as CINCO camadas do verificador do retorno
rodaram contra documento de verdade pela primeira vez desde que foram
escritas na 2B.4:

```
saida_referenciada           OK    fecha a saída R-000024
documento                    OK
assinatura:responsavel_loja  OK
assinatura:motoboy           OK
final                        OK
```

Placar completo no mesmo instante:

```
saida    13 · 13 · 0    52 camadas
retorno   2 ·  2 · 0    10 camadas
TOTAL    15 · 15 · 0
```

E a corrida fechou **na mesma transação**, com `retorno_em` (servidor) e
`retorno_em_local` (dispositivo) preenchidos — a regra 8 valendo no
documento novo.

O que isso encerra, e não é pouco: da 2A até aqui o projeto vinha
GERANDO evidência criptográfica do retorno sem nunca ter tido um retorno
pra conferir. `verificar_romaneio` despachando por tipo, a fórmula DCRR1
com `to_char`, o `papel_no_momento` no hash da assinatura interna, o
`saida_referenciada` amarrando os dois documentos — tudo isso era código
não exercitado. Deixou de ser.

### E o OFFLINE fechou no mesmo dia — `R-000026`

```
saida    13 · 13 · 0    52 camadas
retorno   3 ·  3 · 0    15 camadas
                        R-000023  online
                        R-000025  online
                        R-000026  offline_sincronizada   ←
```

A cadeia do retorno está exercitada nos dois modos que ela pode assumir.
O que o `R-000026` prova, e nenhum dos outros dois provava:

```
auth_method do motoboy   physical_card_pin_offline_then_verified
```

Esse carimbo só existe por uma via: o PIN foi selado no envelope RSA no
balcão, sem rede, e **aberto e conferido pela Edge Function na
sincronização**. Envelope, `ROMANEIO_KEYS`, despacho por tipo da 2C.6,
fila com dono, JWT — tudo isso deixou de ser suposição de uma vez.

O resto do registro, e cada linha responde uma decisão de projeto:

| | |
|---|---|
| `tipo_signatario` = `responsavel_loja` | o slot NOVO da 2A, não `caixa` |
| `papel_no_momento` = `admin` | o cargo real de quem assinou, separado do slot |
| `auth_method` do responsável | `sessao_autenticada` — a identidade nunca vem do cliente |
| geolocalização | presente: o aquecimento pegou posição enquanto havia rede |
| `status_documental` | `nao_aplica` — dinheiro não gera papel, recomputado do zero |

**Os dois relógios, medidos:**

```
retorno_em_local   04:09:29.741   dispositivo, no balcão
retorno_em         04:09:47.227   servidor, na sincronização
                   ~18 segundos de diferença
```

Não é curiosidade: é a regra 8 aparecendo pela primeira vez com uma
distância visível entre os dois. Um sistema de relógio único teria
gravado 04:09:47 como se fosse a hora da devolução.

**E a armadilha do §77, fechada e MEDIDA NO BANCO:**

```
pagamento previsto    id == uuid da entrega    (por desenho)
pagamento realizado   id != uuid da entrega    ← e foi GRAVADO
```

O realizado existe em `pagamentos` com o valor certo. Se a tela tivesse
copiado o `pagamentoId` do previsto, o insert teria batido em
`on conflict (id) do nothing`, nada seria gravado, e o romaneio estaria
selado afirmando um pagamento inexistente — sem erro nenhum.

### A FALHA que sobrou é honesta: os dois PRIMEIROS são `online`

```
FALHA  modo offline_sincronizada — online
```

O caminho offline **não rodou**. E a causa não é do app:

**`Object.defineProperty(navigator, 'onLine', …)` morre no F5.** O
bloco 1 rodou, a página recarregou em algum momento, `navigator.onLine`
voltou a ser `true`, e a tela — que lê o valor NO INSTANTE DA AÇÃO, como
manda a convenção — escolheu o caminho online, corretamente. Ninguém
notou até o bloco 3 olhar o `modo`.

Os carimbos denunciam: os contextos foram recacheados às `03:51:4x`, e o
aquecimento só roda `if (navigator.onLine)`. Ou seja, às 03:51 a página
já estava online de novo.

**Isso é justamente o que o `modo` existe pra responder.** Uma saída — e
agora um retorno — online também "sela e fecha a corrida"; olhar a tela
não distinguiria. É o mesmo argumento do item 48, quando o `R-000010`
provou a saída offline.

O script foi corrigido: **DevTools → Network → Offline é o mecanismo
PRINCIPAL**, porque ele põe `navigator.onLine` em false nativamente e
sobrevive a recarregar. O override do bloco 1 virou o reforço, e ele
agora avisa, em `console.warn`, que morre no F5.

### O formato de "colar bloco no console" foi aposentado

Um dos blocos chegou pela metade e morreu em `db is not defined` — a
linha do `const { db } = await import(...)` não foi avaliada junto. Colar
80 linhas num console é frágil por natureza, e a mensagem não diz nada
sobre a causa.

Agora o script é um MÓDULO que registra `window.retornoOffline` com
`bloco1() · bloco2() · bloco3()`. Uma linha por chamada, repetível, sem
como quebrar no meio.

**O `import` tem que acontecer com rede** — ele busca do dev server. Os
`import()` de dentro dos blocos resolvem do registro de módulos já
carregado, então funcionam offline; mas só se o arquivo tiver entrado
antes.

### O que continua sem exercício

```
DCRR1 online real          ✓  R-000023 e R-000025, 5 camadas cada
DCRR1 offline real         ✓  R-000026, physical_card_pin_offline_then_verified
saída offline LEGADA       ~  formato provado (2C.6), sincronização não
fechamento legado × DCRR1  ~  trigger provado; o handler do cliente
                              NUNCA EXECUTOU — e agora JÁ EXISTEM três
                              DCRR1 reais pra exercitá-lo
```

**A 2D.5 fechou inteira.** E as duas últimas linhas **deixaram de ser
trabalho** em 2026-08-25 — ver o item 83.

O parágrafo que estava aqui explicava como fabricar um
`fechamento_corrida` legado no IndexedDB pra exercitar a drenagem. O
usuário barrou com uma pergunta que desmontou a etapa: *essa versão
antiga vai deixar de existir quando limpar todos os dados, qual o ponto
disso?*

Nenhum. As duas regressões testariam formatos que **não vão existir
depois do corte pré-V1**. Em vez de prová-los, foram removidos:

```
saída offline LEGADA        o fallback "sem tipo = saida" saiu
fechamento_corrida legado   o tipo e o handler saíram
o trigger no banco          FICOU — virou invariante de integridade
```

O que a 2D.6 pede agora é regressão da V1 limpa, e ela está listada no
CLAUDE.md, seção "A 2D.6 — CORTE LIMPO PRÉ-V1".

## 82. `R$ NaN` — o retorno vazando pelas telas da saída

2026-08-25, minutos depois de o `R-000026` selar. O usuário abriu o
romaneio de um vale e viu **`R$ NaN`** nos valores.

O `NaN` era o sintoma. O defeito é que **três consultas assumem
"romaneio = saída"**, e desde hoje existem romaneios de retorno.

### Por que dá `NaN`, e por que isso era inevitável

O payload do retorno **não tem** `valor_compra_cents` nem
`valor_entrega_cents` — de propósito, e está no contrato: *o retorno
assina só o que ACRESCENTA*, porque repetir o que a saída selou criaria
uma segunda fonte capaz de discordar da primeira.

A página soma `s + v.valor_compra_cents` sobre um payload que não tem o
campo → `undefined` → `NaN` → `formatBRL(NaN)` → `R$ NaN`. Ou seja: a
decisão de contrato estava CERTA, e a tela é que precisava saber que
existe mais de um tipo de documento.

### As três superfícies, em ordem de estrago

**1. A custódia do vale — e aqui o `NaN` escondia coisa pior.**

`buscarCustodias` junta `romaneio_entregas` → `romaneios` sem filtrar
tipo, e monta um `Map` chaveado por `entrega_id`. Com duas linhas por
vale, **a última ganha**:

```
V-000046  →  R-000014 (saida)  ← era esta que o chevron mostrava
             R-000026 (retorno) ← passou a ser esta, em silêncio
```

O chevron do vale responde *"quem tirou este vale da farmácia"*, e isso
é a saída. Ele tinha parado de responder isso — o `R$ NaN` foi só o que
tornou o sumiço visível.

**2. A SANGRIA, que é o pior dos três.** Ela gera PDF e **manda pro
Drive**. Sem o filtro, os retornos de hoje seriam desenhados com o
layout da saída e arquivados nas duas vias, na pasta de custódia, como
se fossem o documento da retirada. Medido:

```
sangria de 25/08, antes:  R-000022(s) R-000023(r) R-000024(s) R-000025(r) R-000026(r)
sangria de 25/08, agora:  R-000022(s) R-000024(s)
```

Errado na tela é feio; errado no Drive é documento de custódia falso, e
**ninguém revisa pasta de arquivo morto**. Nenhuma sangria foi rodada
entre o primeiro retorno e o conserto — por sorte, não por desenho.

**3. A página do romaneio**, que desenhava qualquer um com o layout da
saída. `SELECT_ROMANEIO` nem trazia `tipo`: ela não tinha COMO saber.

### O conserto, e o que ele deliberadamente não faz

```
buscarCustodias            romaneios!inner + eq('romaneios.tipo','saida')
buscarRomaneiosRecebidosEm eq('tipo','saida')
SELECT_ROMANEIO            passa a trazer `tipo`
Romaneio.tsx               recusa desenhar retorno, e DIZ por quê
```

A página recusar é a segunda barreira, não a primeira: as consultas já
não trazem retorno pra lá, mas ela recebe um **id**, e id vem de
qualquer lugar. Imprimir `NaN` é a tela afirmando um número que ninguém
calculou — recusar é a única resposta honesta enquanto o retorno não
tiver página própria.

**E o retorno volta a entrar nos três lugares quando tiver PDF e tela
próprios — etapa 9.** Filtrar não é a solução final; é a solução
enquanto a alternativa é desenhar errado.

### A lição, e ela não é sobre `NaN`

Um documento NOVO no mesmo lugar de armazenamento vaza por toda consulta
que não sabia que ele podia existir. `romaneios` ganhou `tipo` na
migration de 19/08, e as três consultas continuaram escritas como se
`tipo` não existisse — porque na época não existia mesmo.

O que teria pego isso mais cedo: procurar por `from('romaneios')` no dia
em que a coluna `tipo` foi criada, e não no dia em que a primeira linha
`retorno` nasceu. **Coluna discriminadora nova é um pedido de auditoria
em toda consulta da tabela.**

## 83. A 2D.6 mudou de natureza: de retrocompatibilidade para corte limpo

2026-08-25. Eu ia fabricar um `fechamento_corrida` antigo no IndexedDB pra
exercitar a drenagem. O usuário parou, e a pergunta dele desmontou a
etapa inteira:

> Mas essa versão antiga vai deixar de existir quando limpar todos os
> dados, qual o ponto disso?

Nenhum. A retrocompatibilidade que a 2C construiu protegia filas geradas
pelas versões intermediárias **do próprio desenvolvimento**. Se o
rollout é precedido de limpeza controlada — banco E estado local dos
terminais —, não existe passado operacional a preservar, e manter os
caminhos antigos é entrar em produção carregando dívida que nasceu
enquanto tomávamos cuidado pra não quebrar dado de teste.

### A decisão, registrada no CLAUDE.md

Está lá inteira, na seção "A 2D.6 — CORTE LIMPO PRÉ-V1", com as cinco
consequências. O resumo do que ela troca:

```
2D.6 ANTES                      2D.6 AGORA
provar saída offline legada     provar que nada novo sai sem tipo
provar fechamento legado        provar que nada novo cria fechamento
                                limpar o estado local pré-V1
                                remover a compatibilidade de dev
                                MANTER o trigger no banco
                                regressão da V1 limpa
```

### O que foi REMOVIDO, e o método

As duas provas passavam **por leitura** — que é a forma fraca, e
envelhece. Viraram estruturais primeiro, e foi isso que guiou a remoção:

```
TipoOperacaoFila     sem 'corrida' e 'fechamento_corrida'
SegredosDoRomaneio   tipo obrigatório (era opcional)
```

**O compilador então enumerou 17 pontos**, e a lista dele foi o roteiro —
não a minha memória de onde os caminhos legados moravam. Saíram:

```
corridas.ts        criarCorridaComAssinatura, fecharCorrida,
                   o handler do SQLSTATE DCRR1, chaveDoEventoLegado
                   −181 linhas
db.ts              os dois tipos, o backfill da v5
filaOffline.ts     2 casos, 2 listas de query key, 2 imports
corridasBloqueadas a metade do fechamento legado + o gate por dono
scripts            conferir-2c8, conferir-dexie-v5
```

**A versão 5 do Dexie continua declarada**, com o `upgrade` vazio.
Apagar uma versão do meio faz um navegador parado na v4 não achar
caminho até a v7 — a cadeia é o contrato.

### A v7, e por que ela só pode estar certa uma vez

Ela apaga `filaOperacoes`, `credenciaisCache` e `contextosRetorno`. Todo
o conteúdo das três referencia ids do Supabase, e o pior caso não é
falhar: é **sincronizar** contra um banco novo.

Apagar a fila descarta operação não sincronizada. Hoje é seguro por três
motivos que não se repetem — não existe deploy, a fila foi medida vazia,
e o banco de destino vai ser zerado. **Uma v8 fazendo o mesmo depois do
go-live perde trabalho de gente que estava no balcão**, e isso está
escrito no arquivo. O `clear()` conta e DIZ quantas descartou: silencioso
seria indistinguível de "já estava vazia".

### Uma escolha que o spec me fez melhorar

Ao tornar ausência de `tipo` uma recusa, os dois casos caíam no mesmo
motivo. Mas no dia da virada eles pedem coisas opostas: **aba com bundle
antigo** (um F5) contra **corpo corrompido** (investigar). Virou
`tipo_ausente`, separado de `tipo_desconhecido`.

E ele é TERMINAL, o que não é óbvio — parece caso de "recarrega e tenta
de novo". Não é: o `tipo` que falta está DENTRO do envelope, selado por
um bundle antigo, e nenhuma versão nova consegue reabri-lo pra
acrescentar o campo.

A matriz do despacho encolheu — quatro linhas que aceitavam ausência
viraram recusa —, e elas **ficaram na tabela do spec em vez de sumir**:
o que o teste congela agora é que ausência NÃO PASSA, e apagá-las
deixaria a regra nova sem quem a cobrasse.

### O baseline preservado

Medido no dia do corte, e registrado pra que a remoção do código legado
não pareça acidente daqui a alguns meses:

```
saida  selada      13
saida  conflito     3
retorno selado      3
                  ────
documentos relevantes no corte: 19
```

**Observação do ambiente atual:** todos os 3 conflitos históricos de
Romaneio de Saída foram produzidos por `offline_sincronizada`; nenhum
conflito de saída foi observado no caminho online.

Isso é **consistente** com a janela de concorrência maior do offline, mas
**o histórico observado não é, isoladamente, prova causal** — são três
casos, num ambiente de teste, com um operador só. Eu tinha escrito
"confirmação empírica" numa mensagem anterior; era forte demais para o
que três linhas sustentam.

### O roteiro do corte

`scripts/corte-pre-v1.sql` — censo, wipe, sequências, sementes e
conferência. **Nada dele foi executado.** Três coisas que ele registra e
que não são óbvias:

- **É o único lugar do projeto que viola a regra 4**, e diz isso na
  primeira linha. Só é defensável porque produção não existe; depois do
  go-live o mesmo comando é perda de dado real.
- **As sequências não voltam sozinhas.** `entregas_numero_vale_seq` e
  `romaneios_numero_seq` foram criadas soltas, sem `owned by`, então
  `truncate ... restart identity` não as alcança. Sem o `alter sequence`
  explícito, o primeiro vale real nasce `V-000047`.
- **Todo cartão impresso morre junto.** O v3 bipado no leitor em 17/08
  deixa de ser reconhecido; cartões novos precisam ser impressos ANTES
  de a operação começar.

A ordem tem duas amarrações: a Edge Function nova **recusa cliente
antigo**, então ela e o cliente vão antes de qualquer terminal abrir; e
a limpeza local só roda quando o terminal carrega o bundle novo — o que
exige **fechar todas as abas**, porque F5 não basta se houver outra viva.

### O que ficou parado, esperando resposta

O bloco 4 (sementes) tem o dado real de São Gabriel — oito lojas a
R$ 9,00 e a agência Gabrielense. Segura ele **uma coisa só**:

- **os convênios**, que ninguém listou ainda. O modelo está comentado,
  com o aviso sobre `farmacia_paga_entrega_integral` — é a flag que faz a
  farmácia bancar os dois vales do endereço distante, e ela nunca deve
  ser trocada por comparação de nome no código.

**A dúvida das 17 filiais foi RESPONDIDA:** as oito são as de São
Gabriel; as demais ficam em outras cidades e entram depois. O número do
CLAUDE.md é o total da rede, não o desta cidade — e isso explica a
sequência esburacada (02, 04, 09, 10, 12, 15, 18): os que faltam estão
nas outras cidades. **Ninguém deve renumerar pra fechar os buracos.**

> **CORRIGIDO EM 2026-09-03: são DEZOITO, não dezessete.** O usuário
> corrigiu o total da rede, e a filial a mais é de **cidade já mapeada**
> — ou seja, `cidades` não ganha linha nova. O que continua valendo
> inteiro é o parágrafo acima: o número é o total da REDE, a sequência é
> esburacada de propósito, e ninguém renumera. Os seis pontos que
> repetiam "17" foram atualizados (três no CLAUDE.md, três aqui); este
> ficou com a correção à vista porque é o que DEFINE o número, e um
> total trocado em silêncio é a classe de defeito que o §92 registra.

E cada cidade nova custa mais que lojas: pela regra de uma agência de
tele por cidade, é `cidades → lojas → agencias → mototaxistas →`
`credenciais`. Acrescentar só as lojas as deixaria sem agência que as
atenda — cadastradas e inoperantes, o mesmo modo de falha da agência sem
cidade.

## 84. E1 — normalização de texto livre, e os três achados que ela custou

Primeira etapa da frente de produto pré-V1. O pedido era "espaços
duplicados, capitalização quando fizer sentido, consistência visual" —
e parecia cosmético. Não era.

### Os três casos difíceis, medidos ANTES do código

```
1.  regex s pega NBSP (U+00A0)   -> true
    regex s pega ZWSP (U+200B)   -> FALSE
    "Jose" + ZWSP === "Jose"      -> false

2.  "José" pré-composto === "José" decomposto  -> false
    depois de NFC                              -> true

3.  title-case ingênuo: "rua xv de novembro" -> "Rua Xv De Novembro"
```

O (1) é o que justifica a etapa inteira: colar um nome do WhatsApp pode
trazer um caractere de largura zero e criar **dois clientes visualmente
idênticos** no banco — que nenhuma busca casa e que ninguém enxerga na
tela. Isso não é embelezar texto; é impedir que o banco acumule valores
iguais aos olhos e diferentes em bytes ANTES de eles entrarem em
snapshot, busca e relatório.

### A fronteira, que é a regra mais importante

```
DIGITAÇÃO → normalização → validação → persistência → snapshot
```

e **nunca** dado salvo/assinado → normalização posterior.

O canônico tem gêmeo em SQL e sanitiza só TAB/CR/LF; uma normalização
que só existe em TypeScript faria os dois lados divergirem em silêncio.
E renormalizar um snapshot mudaria os bytes que as duas partes
assinaram.

**Isso é afirmação sobre o CÓDIGO, não sobre execução** — por isso
`fiacao-texto.spec.mts` LÊ O FONTE, no mesmo método do
`despacho-sync-romaneio.spec.mts`. Onze arquivos afirmados como
proibidos, nove telas de entrada afirmadas como ligadas, e a lista de
entrada é EXPLÍCITA em vez de um glob: tela nova tem que aparecer ali
pra alguém decidir qual função ela usa.

### A decisão que o uso real INVERTEU

O E1 nasceu sem caixa no endereço, por causa do caso (3). O usuário
testou e reportou a inconsistência: com o nome sendo corrigido e o
endereço não, a tela fica visivelmente errada.

A saída não foi desistir da guarda — foi torná-la ESTRITA. Medido:

```
xv ix xxi iii vi xx   ->  romano       (o que queremos)
mil vil civil id      ->  não romano   (a regra frouxa erraria)
di li mi mix          ->  romano       <- falso positivo
```

Dos falsos positivos, `di` é o único que aparece de verdade em
endereço ("Rua Di Cavalcanti") — e já está em `PARTICULAS`, consultada
ANTES. Os outros exigiriam uma rua "Li", "Mi" ou "Mix" digitada inteira
em caixa única. E a timidez faz o resto: **a caixa só dispara em caixa
única**, então quem digita com as maiúsculas certas nunca é tocado.

### Dois defeitos que só a tela achou

- **Romano com pontuação colada.** `"rua dom pedro ii, 300"` — o token é
  `"ii,"`, e o teste de romano falhava. Saía "Rua Dom Pedro Ii": o
  MESMO erro que a guarda existe pra impedir, uma vírgula mais adiante.
- **Espaço antes de vírgula.** `"av. brasil , 90"` sobrevivia ao colapso —
  o espaço é UM só, e está no lugar errado.

### O que NÃO faz, e não vai fazer: inventar acento

O usuário reportou `"joao" -> "Joao"` como erro. Medi antes de responder,
porque acento sendo REMOVIDO seria grave:

```
"joão da silva"  ->  "João da Silva"   preservado
"CONCEIÇÃO"      ->  "Conceição"       preservado
"joao da silva"  ->  "Joao da Silva"   NÃO inventado
```

Nada remove acento. O que ele viu foi o terceiro caso — e é a regra que
ele mesmo pediu ("não corrigir conteúdo semanticamente"). `Joao`,
`Fatima` e `Luis` são grafias legalmente registradas; adivinhar
corromperia nome de documento e, no endereço, mandaria o motoboy pra
rua errada.

### O gate, e o que cada número prova

```
biblioteca            43 asserções, isoladas
fiação                26 asserções, lendo o fonte
cadeia de custódia    11 specs verdes (os dois canônicos inclusos)
custo medido          51,77 us por vale = 0,0002 % de 25 s
handlers de evento    nenhum tocado (diff de 3 linhas no cadastro)
REGRESSÃO OPERACIONAL 10,23 s
```

**O 10,23 s é UMA repetição, "correndo"** — ou seja, o MELHOR caso, não
a mediana de cinco que o protocolo pedia. Fica registrado assim de
propósito. O que sustenta o fechamento não é a amostra, é a margem:
2,4× o alvo, contra um baseline documentado de 15–18 s em uso normal
(§9). Para a mediana estourar 25 s, ela teria que ser 2,4× pior que o
melhor caso.

**E a comparação com os 15–18 s não é limpa**: não se sabe se o mesmo
nome e endereço foram digitados. Ela serve pra dizer "não regrediu",
não pra dizer "ficou mais rápido".

Os três sinais de UX conferidos na mesma passada: Enter volta ao
primeiro campo, a tela libera na hora, e nenhum campo muda
visualmente durante a digitação — esperado, porque a normalização
acontece no SUBMIT, não em `onChange` nem em `blur`.

**E1 FECHADO.**

## 85. E1.1 — busca sem acento, o contrato oposto ao do E1

Extensão do E1, decidida quando o usuário apontou o caso que a
biblioteca de entrada deliberadamente não resolve:

```
BANCO       "João da Silva"
EXIBIÇÃO    "João da Silva"
BUSCA       "joao"  ->  acha as quatro grafias
```

A regra que separa os dois: **persistência preserva o que foi
digitado; busca é tolerante.** O E1 não inventa acento porque isso
alteraria o dado; o filtro pode ignorá-lo porque não altera nada — só
decide quais registros correspondem.

### O achado que mudou o escopo

A parte de front era o pedido. Auditando, achei que **o defeito já
estava no app**: o Histórico filtra `cliente_nome` com `ilike`, que
ignora CAIXA e não ignora ACENTO. Procurar "joao" ali não achava "João
da Silva" — e resultado vazio é indistinguível de "não existe
cadastro", a pior forma de errar numa busca.

Como a lista é paginada no servidor, **nenhuma função de front alcança
aquele resultado**. Daí a migration.

### Três decisões da migration que não são óbvias

**1. A mentira controlada do `immutable`.** `unaccent()` é STABLE — depende
de um dicionário — e coluna gerada exige IMMUTABLE. O invólucro
declara `immutable` chamando a forma de DOIS argumentos, com o
dicionário EXPLÍCITO. É o dicionário explícito que torna a declaração
honesta: sem ele o resultado dependeria do `search_path` de quem chama,
e aí `immutable` seria falso de verdade.

**2. Coluna gerada, não trigger.** Ela não pode ser escrita, então não
tem como divergir da origem. E não é porta dos fundos pra regra 7:
mudá-la exigiria mudar `cliente_nome`, que a trigger já congela.

**3. NENHUM índice, de propósito.** A tentação era
`create index on entregas (cliente_nome_busca)`. Seria **cargo cult**:
a busca é `like '%termo%'`, com curinga à esquerda, e btree não serve —
o planejador o ignora e faz seq scan igual, só que agora com um índice
pra manter a cada INSERT. O que serviria é `pg_trgm` + GIN, e o SQL
ficou COMENTADO esperando o volume justificar. A hora de saber é
medindo o `explain analyze` da consulta real.

### A verificação que importava

Antes de escrever, conferi no fonte que `romaneio_canonico` e
`romaneio_payload` leem COLUNAS EXPLÍCITAS, nunca `to_jsonb(e)`. Depois
de aplicar, o usuário mediu:

```
sem_acento('João da Silva') === sem_acento('Joao da Silva')   ok
51 entregas · 0 divergentes                                    ok
verificar_romaneios_selados()   16 · 16 · 0                    ok
```

**O terceiro é o que prova a decisão inteira:** duas colunas novas em
`entregas` e nenhum documento assinado se moveu. Se algum dia alguém
trocar aquele `select` explícito por `to_jsonb(e)`, as colunas de busca
entram no hash sozinhas — o aviso ficou na migration, que é onde
alguém procuraria.

### A trava contra o erro futuro previsível

O caso (12) do `texto.spec.mts` afirma que, sobre a MESMA entrada, as
duas funções discordam de propósito:

```
normalizarNome('Joao')       -> 'Joao'   não inventa
normalizarParaBusca('Joao')  -> 'joao'   achata

gravar a saída da busca DESTRUIRIA o nome
```

Ele existe porque daqui a alguns meses alguém vai pensar "já temos uma
função que tira acento" e usá-la pra salvar. E `Luis` ≠ `Luiz` tem caso
próprio: busca fonética inventa equivalência, e um cadastro que aparece
porque "soa parecido" é pior que um que não aparece.

No front, `casaComBusca` normaliza OS DOIS LADOS e existe pra nenhuma
tela escrever `.includes()` esquecendo um deles — normalizar só a
pesquisa faz "joao" não achar "João", com o mesmo sintoma de sempre.

E o spec da fiação ganhou uma trava nova: **a chave derivada nunca
entra num `select`**. Sem ela, alguém acabaria exibindo, e a tela
mostraria "joao da silva" no lugar do nome da pessoa.

**E1.1 FECHADO.** 62 asserções na biblioteca, 30 na fiação.

## 86. E2 — estados visuais de consulta, e o `isLoading` que mente

O pedido era "estados visuais de consulta", e parecia padronização de
markup. O levantamento achou um defeito de comportamento com nove telas
mentindo, e a migração achou outros quatro — três deles meus.

### O DEFEITO, medido no fonte antes de qualquer código

```js
// @tanstack/query-core, queryObserver.js:307-310
const isFetching = newState.fetchStatus === "fetching"
const isPending  = status === "pending"
const isLoading  = isPending && isFetching

// retryer.js:11 — networkMode default
return (networkMode ?? "online") === "online" ? onlineManager.isOnline() : true
```

Offline e sem cache, a query **pausa**: `fetchStatus: 'paused'`, logo
`isFetching: false`, logo **`isLoading: false`**. `isError` também é
`false`, e `data` é `undefined`. Então toda cadeia escrita como

```
if (isLoading) …; if (isError) …; if (!data) → "nenhum registro"
```

cai no último ramo e AFIRMA vazio sobre uma consulta que nunca
respondeu. O app tinha 55 usos de `isLoading` em 18 arquivos e **zero**
de `isPending`/`fetchStatus`.

### O inventário, arquivo por arquivo

Não foi glob: cada um foi lido e classificado pela frase que ele põe no
ar com a query pausada.

| categoria | quantos | o que faziam |
|---|---|---|
| `defeituoso` | 9 | afirmavam vazio sem saber |
| `mudo` | 5 | não mentiam, e também não explicavam — tela em branco |
| `acidental` | 2 | corretos só porque `data?.length === 0` dá `undefined === 0` → `false` |
| `deliberado` | 2 | já tratavam à mão, com comentário (§50.2) |

**Meu primeiro número estava errado**, e vale registrar: reportei "6
defeituosos" tendo inspecionado 9 dos 18 arquivos. Os três que faltavam
eram os piores:

```
Romaneio.tsx          "Romaneio não encontrado."   sobre um documento SELADO
ListaEntregas.tsx     "Nenhum vale encontrado."    tela pós-login do caixa
HistoricoEntregas.tsx "Nenhum vale encontrado."    reabrindo o defeito do E1.1
```

O terceiro é o mais irônico: o E1.1 existe porque "resultado vazio é
indistinguível de *não existe cadastro*, a pior forma de errar numa
busca" — e offline a mesma tela voltava a dizer isso, agora por falta de
resposta em vez de por acento.

E os `acidental` mostram por que "está funcionando" não basta: eles
escapavam por um acidente de sintaxe que ninguém decidiu, e bastaria
alguém trocar por `(data ?? []).length === 0`, achando que é a mesma
coisa, pra a tela passar a mentir.

### AS DUAS PERGUNTAS, que estavam misturadas

```
1. TRANSPORTE   a consulta conseguiu responder?
                inactive · loading · ready · unavailable · error

2. DOMÍNIO      se respondeu, qual foi o veredito?
                aceito · recusado(motivo)
```

`nao_encontrado` **não é falha de consulta**. É uma consulta
bem-sucedida cujo resultado de domínio foi negativo — e por isso ele só
existe DENTRO de `ready`, nunca ao lado dele:

```ts
EstadoDeConsulta<Veredito<Credencial, MotivoDoCartao>>
```

Assim "cartão não existe" fica inalcançável sem ter havido resposta
confiável. É o §59 de novo: tornar o erro impossível de representar vale
mais que rejeitá-lo.

**A mistura de idiomas é deliberada**, e diz de que camada cada palavra
fala: `loading`/`ready`/`unavailable` são o estado técnico da OBTENÇÃO
do dado; `aceito`/`recusado` são o significado da resposta PARA A
FARMÁCIA.

**E chama-se `inactive`, não `idle`**, porque o TanStack já usa
`fetchStatus: 'idle'` no mesmo ecossistema com outro sentido — lá quer
dizer "não está buscando agora", o que inclui uma consulta que já
terminou e tem dado. Dois `'idle'` a duas linhas um do outro produziriam
leitura errada num arquivo que ninguém abre há meses. A tradução
`TanStack: idle → nosso: inactive` é visível justamente porque as
palavras diferem.

### O CONTRATO DE APRESENTAÇÃO, congelado com o usuário

```
inactive                sem mensagem, sem CTA
loading                 indicador; CTA que depende da resposta travado
ready                   renderiza o dado — e SÓ aqui pode afirmar vazio
ready · cache_sem_rede   dado VISÍVEL + "podem estar desatualizados", sem retry
ready · cache_apos_falha dado VISÍVEL + "não foi possível atualizar" + [Atualizar]
unavailable             informa, tom de AVISO, SEM botão
error                   acusa a falha, tom de FALHA, + [Tentar novamente]
```

**A ausência de botão no `unavailable` é a decisão central.** Não há a
quem perguntar, então um botão só produziria o mesmo resultado — e
ensinaria o operador a martelar uma consulta que o próprio sistema sabe
que não pode executar, que é o comportamento que o E2 veio matar. A
recuperação é automática, e isso foi MEDIDO: religando a rede, as telas
voltaram sozinhas sem nenhum clique.

E `ready` com cache é o que impede trocar um defeito por outro: com dado
utilizável a tela CONTINUA mostrando, e o aviso vai ao lado. Sem essa
regra, "offline parece vazio" viraria "offline esconde o que já temos".

### A polaridade, que é o defeito numa frase

```
desconhecido  ≠  vazio
```

E ela é estrutural, não disciplina: o `children` do `<Consulta>` é
função e só roda com dado; o `vazio` só é consultado dentro do ramo
`ready`. Não há como uma tela afirmar vazio sem ter havido resposta —
não porque alguém lembrou de checar, mas porque o galho onde a frase
mora fica pendurado no `ready`.

### Três specs, e cada um fecha um buraco que os outros deixam

```
estado-de-consulta         a decisão está certa          (apresentar puro)
fiacao-estado-de-consulta  o componente é CASCA          (lê o fonte)
consulta-render            a casca RENDERIZA o que a decisão diz
```

O terceiro não é redundante: os dois primeiros juntos ainda deixariam
passar uma casca que chama `apresentar()` e ignora o resultado. Ele roda
o componente de verdade por `react-dom/server`, sem navegador — e
**precisa de `--tsconfig tsconfig.app.json`**, senão o esbuild do `tsx`
compila JSX no runtime clássico e quebra com `React is not defined`.

A asserção que mais importa passa `aoRecarregar` de propósito:

```
ok   NÃO tem botão, mesmo com aoRecarregar passado
```

Uma casca descuidada desenharia o botão só por ter callback em mãos.

### O gate é lista EXPLÍCITA e FECHADA

A lista nomeia os 18 alvos; a varredura exige que TODO arquivo que use
`isLoading` esteja nela. Glob aceitaria tela nova em silêncio; lista
sozinha não a veria. Com as duas, tela nova quebra o gate e alguém tem
que decidir o que ela afirma quando não sabe.

### AS TRÊS VEZES EM QUE O GATE PEGOU O PRÓPRIO AUTOR

Isso é mais importante do que parece: prova que eles não são decorativos.

1. **A biblioteca caiu na própria regra.** `estadoDeConsulta.ts` cita
   `isLoading` no cabeçalho pra explicar por que não o usa, e a checagem
   lia o fonte cru. A regra passou a ignorar comentários — contar prosa
   acusa justamente quem documentou o conserto. O mesmo falso positivo
   voltou em `ListaEntregas` uma etapa depois, porque um dos checks
   ainda lia o cru; uniformizei.

2. **O `CampoDependente` violou a regra da casca.** Ele montava o título
   "Filiais indisponíveis" dentro do componente, e o gate reprovou:
   escolher texto é decidir. O rótulo virou variante (`{ campo: string }`)
   e `apresentar()` voltou a ser o único que escreve frase.

3. **Marquei dois arquivos como migrados sem migrar.** `NovaCorrida` e
   `RetornoCorrida` ainda tinham a consulta de LISTA à mão, e o gate
   acusou "não lê mais `isLoading`" nos dois.

### Consultas independentes, verdades independentes

`MototaxistasCadastro` era o único defeito que falhava **até online**:

```js
{!isLoading && !isError && (!agencias || agencias.length === 0) && (
  <p>Cadastra uma agência primeiro…</p>
)}
```

As flags são da query de MOTOBOYS; o `data` é da de AGÊNCIAS. Bastava a
de motoboys responder primeiro — requisições independentes, isso
acontece sempre — pra a tela mandar o admin cadastrar uma agência que já
existe. Offline era permanente.

Medido no app, com as duas pausadas:

```
["agencias-cadastro"]      pending · paused · sem dado
["mototaxistas-cadastro"]  pending · paused · sem dado
→ "Dados indisponíveis no momento."   botão Novo motoboy travado COM explicação
→ nenhum "Cadastra uma agência primeiro"
```

E o mesmo defeito apareceu numa CÉLULA, três vezes: `nomeAgencia` e
`rotuloCidade` devolviam `'—'` tanto para "não tem" quanto para "não
sei" — a ignorância de uma consulta virando afirmação de ausência sobre
o dado de outra. Hoje `'—'` só sai quando o id é nulo; sem a lista sai
`'…'`.

### Campo dependente: o formulário fica, só a dependência trava

Sete sítios têm select alimentado por consulta. Numa lista o
`<Consulta>` domina a área de conteúdo; num formulário ele NÃO pode,
porque o operador está no meio de um lançamento.

Duas regras, congeladas com o usuário:

1. **não limpar o resto do formulário** — o que ficou indisponível foi a
   filial, não o que o caixa já digitou;
2. **não apagar uma seleção que já existia** — transformar
   indisponibilidade em perda de trabalho é pior que o problema. Quem
   revalida é o submit.

Medido nos dois cenários:

```
formulário aberto do ZERO, offline, sem cache
  "Filiais indisponíveis no momento."   select DESABILITADO, form montado

a rede CAINDO com o formulário aberto   ← o caso que acontece no balcão
  query: success · paused · temDado=true
  select HABILITADO, 8 opções, seleção PRESERVADA ("Filial 02")
  "Exibindo dados disponíveis offline; podem estar desatualizados."
```

O segundo é `ready + cache_sem_rede`, não `unavailable` — as filiais
ainda são conhecidas, então o campo continua utilizável. É a distinção
funcionando onde ela importa.

E o submit passou a separar duas frases que pediam coisas opostas: "não
sei quais são as filiais" e "você não escolheu uma" davam a mesma.

### NovaCorrida: as duas CONSULTAS, e só elas

O alvo não era "sumir com `ocupado`". `bipar cartão` e `conferir PIN`
perguntam e recebem resposta; `criar PIN` e `confirmar saída` ESCREVEM,
e ficaram com a mecânica delas — esticar `EstadoDeConsulta` para
qualquer async só pra zerar ocorrências apagaria a distinção que ele
existe pra marcar. **O gate afirma as duas metades**, porque sem a
segunda alguém "terminaria o trabalho" removendo o que foi mantido de
propósito.

O conserto de comportamento estava no PIN: `r.ok === false` e o `catch`
terminavam os dois em `setPinConferido(null)` + string vermelha. A tela
voltava ao início e reoferecia "Confirmar identidade" nos dois casos, e
o caixa relia o PIN no papel do motoboy procurando um erro que podia não
existir.

Medido no app:

```
formato inválido      "Isso não parece um cartão do sistema."     recusa
não reconhecida       "Credencial não reconhecida."               recusa
erro de rede          "Não foi possível carregar os dados."       falha + retry
offline sem cache     "Não foi possível verificar agora."         AVISO, sem botão
                      + "isso não quer dizer que o cartão seja inválido"
offline com cache     badge "Credencial informada"
PIN offline           "PIN guardado, mas não conferido"           custódia liberada
PIN recusado          motivo do servidor                          custódia NÃO liberada
erro de rede no PIN   "Não foi possível concluir a verificação."  custódia NÃO liberada
                      + "O PIN não foi recusado — não deu pra conferir.
                         Tentar de novo não conta como erro pro motoboy."
```

**O ramo offline do PIN ficou FORA do vocabulário de consulta.** Sem
rede ninguém RESPONDE nada sobre aquele PIN: ele é capturado e validado
na sincronização. Chamar isso de `ready` seria inventar uma resposta; de
`unavailable`, seria dizer que o fluxo não pode seguir — e ele pode, é o
caminho que o projeto passou dias provando. Virou
`pinCapturadoOffline`, e a custódia libera por dois caminhos que a tela
nomeia separadamente.

E `credencial` deixou de ser estado próprio: é o que a consulta devolveu
quando ACEITOU. Não há mais como existir credencial sem ter havido
resposta — antes isso dependia de dois `setState` andarem sempre juntos.

### RetornoCorrida: a máquina dizia uma coisa, a string dizia outra

Aqui `custodiaDoRetorno.ts` já separava `cartao_recusado`,
`pin_recusado`, `erro_rede` e `conflito` corretamente. O que faltava era
o MOTIVO viajar com ela: ele vivia num `erro: string | null` paralelo, e
**o `catch` dos handlers escrevia a string SEM despachar nada** — a
máquina ficava em `aguardando_cartao`, como se nada tivesse sido
tentado, com um texto de erro no ar. Duas fontes descrevendo momentos
diferentes, e nenhuma delas a autoridade.

Hoje a mensagem é campo do estado, e carrega texto E natureza juntos:

```ts
mensagem: { texto: string; tipo: 'recusa' | 'falha' } | null
```

O `erro` paralelo sobreviveu servindo só **validação local** — formato
do PIN, assinatura faltando, chave de ambiente ausente. Nada disso é
resposta de ninguém: são conferências anteriores a qualquer transição, e
a máquina nem chega a ser tocada.

#### O BECO SEM SAÍDA que eu criei, e que só a medição achou

Rotear o `catch` do cartão para `ERRO_REDE` parecia óbvio. Mas:

```
CARTAO_LIDO é aceito de:  aguardando_cartao · cartao_recusado · falha_selo_online
erro_rede                 NÃO está na lista
```

Depois de uma falha de rede ao bipar, **o caixa não conseguia bipar de
novo**. Antes o `catch` não despachava nada, então a máquina ficava em
`aguardando_cartao` e rebipar funcionava — troquei "canal errado" por
"travou", que é pior.

A raiz: `ERRO_REDE` foi desenhado pro passo de CONCLUIR. **Uma consulta
que falha não descobriu nada e não move custódia.** Daí
`FALHA_NA_CONSULTA`, que muda só a mensagem e deixa o `nome` intacto — o
próximo passo continua sendo o mesmo de antes.

Isso só apareceu porque o roteiro de verificação tinha DUAS perguntas
por cenário: *o texto/cor/CTA estão certos?* e *a máquina permite
exatamente os próximos passos esperados?*. A primeira sozinha teria
passado — o texto e a cor estavam corretos.

Consequência de desenho: **a cor sai do TIPO DA MENSAGEM, não do nome do
estado**. Pelo nome, uma consulta falha (que não move a máquina) seria
pintada como se nada tivesse acontecido.

#### `useContextoRetorno` já era o vocabulário, com outros nomes

```
carregando            →  loading
pronto + servidor     →  ready + procedencia 'servidor'
pronto + cache        →  ready + cache_sem_rede / cache_apos_falha
nao_encontrado        →  ready + recusado('nao_encontrado')
indisponivel_offline  →  unavailable
erro                  →  error
```

Inventado independentemente, incluindo um `origem: 'servidor' | 'cache'`
que é o `Procedencia`. Migrar **ganhou precisão** em dois pontos:
`nao_encontrado` era irmão de `erro` quando na verdade é o oposto deles
— uma RESPOSTA, e das boas —, e o `origem: 'cache'` colapsava dois casos
que a própria função já distinguia (offline × depois de falhar). Hoje a
tela diz qual foi.

### Dois defeitos de UX que só a medição no app achou

**`[object Object]`** — o §80 de novo, reintroduzido por mim. O erro do
PostgREST não é um `Error`, então `String(e)` o apagava. Trocado por
`mensagemDeErro` em seis pontos, `NovaCorrida` inclusa.

**Stack trace no balcão** — e este é o par do anterior:
`mensagemDeErro` junta `message` + `details`, e num erro de rede do
supabase o `details` É A STACK. O caixa via isso na tela. Agora o
técnico vai pro `console.error` e o balcão recebe uma frase; perder o
detalhe seria o §80 outra vez, então ele continua existindo — só que
onde se depura.

**E a mensagem da falha ficava no ar** depois de o cartão ser lido com
sucesso. Um passo bem-sucedido agora apaga o que o anterior disse.

### Uma asserção minha que era teatro

Escrevi um bloco varrendo os quatro estados de motoboys pra provar que a
afirmação sobre agências não depende deles. Passava verde e não provava
nada: o predicado NÃO RECEBE o estado de motoboys, então varrê-los não
podia falhar nem se ele estivesse errado por outro motivo. Trocado pela
afirmação honesta — a independência é estrutural, e o que se prova é a
assinatura.

### O placar

```
família B — consultas          18 arquivos
  defeituoso   0     (eram 9)
  mudo         0     (eram 5)
  acidental    0     (eram 2)
  deliberado   0     (eram 2)
  migrado     18

família A — ações               4 operações
  migradas     2     as duas CONSULTAS; as duas escritas ficam com `ocupado`

regressão   cadeia de custódia 11 · E1 2 · E2 3   todos verdes
            tsc -b ok · oxlint 9 avisos, os pré-existentes
```

**E2 FECHADO.** O que ele mudou não foi a aparência: foi o app parar de
afirmar sobre o mundo o que só sabe sobre a própria consulta.

## 87. E3 — identidade do pagamento previsto, e a segunda suposição 1:1

O achado nº 1 da auditoria das nove frentes dizia que o E4 estava
bloqueado: `criarPagamentoPrevisto` usa `id: entregaId` ("relação é
1:1"), então duas formas previstas colidiriam na PK e a segunda não
entraria. Parecia um ajuste de uma linha.

O levantamento — feito ANTES da migration, a pedido do usuário — achou
que o perigo era outro.

### O levantamento, e a notícia boa que ele deu primeiro

`romaneio_canonico` **lê ao vivo** de `public.pagamentos` e põe `pg.id`
na linha `p` do DCR1:

```sql
'p' || e'\t' || v_registro.entrega_id::text
    || e'\t' || v_registro.id::text        -- ← o id do previsto
```

Ou seja: **todo romaneio de saída selado tem o id do previsto dentro do
`document_hash`**. Se o verificador recomputasse o canônico, trocar essa
identidade acusaria divergência em documentos que ninguém tocou.

Não recompõe:

```sql
-- verificador_de_hash.sql:135
-- Note que NÃO se recalcula o canônico a partir de `entregas`.
v_recalc := encode(digest(r.canonico, 'sha256'), 'hex')
```

Ele prova que **os bytes assinados produzem o hash assinado**, usando
`romaneios.canonico` gravado. Isso já estava certo por outro motivo (a
regra 7 — o vale pode ter sido corrigido depois), e nos salvou aqui de
graça. O `romaneios.payload` também congela o `pagamento_id`.

### A SEGUNDA SUPOSIÇÃO 1:1, escondida, e que grava auditoria

Em `selar_romaneio_retorno_interno`, o evento `pagamento_alterado`:

```sql
'de', (select pg.forma from public.pagamentos pg
        where pg.entrega_id = v_entrega_id and pg.momento = 'previsto'
        order by pg.id::text collate "C" limit 1),
```

**`limit 1`.** Com dois previstos — que é exatamente o que o E4 vai criar
— o evento afirma que a divergência foi de UMA das formas e descarta a
outra em silêncio. Não é registro incompleto: é registro **errado**, num
evento de auditoria.

E o que torna isso traiçoeiro é o contraste: a checagem da invariante do
§78, **vinte linhas acima**, já é multi-consciente (`array_agg` de
`forma|valor`). Quem lesse aquele bloco concluiria que a função inteira
lida com N.

O usuário tinha previsto exatamente esta classe: *"o perigo do E3 não é
só duas formas colidirem. É existir uma segunda suposição 1:1 escondida
em outro ponto e descobrir só depois de selar um documento."*

### O inventário completo, e o que ele desarmou

| ponto | assumia | desfecho |
|---|---|---|
| `criarPagamentoPrevisto` | `id?` default = `entregaId` | a premissa, removida no E3.C |
| `entregas.ts` · `pagamentos.ts` | passam `id: entregaId` | os dois chamadores |
| `selar_romaneio_retorno_interno` | `limit 1` no evento | **corrigido no E3.B** |
| `entregas.ts:310` · `fechamento.ts:100` | `.find(previsto)?.forma` | **dívida BLOQUEANTE do E4** |
| guard do §78 · `congelarRetorno` | "realizado ≠ id do previsto" | ficam integralmente |
| `romaneio_canonico` · `payload` | leem `pg.id` ao vivo | seguros |
| `documentos_esperados_do_retorno` | faz parse da linha `p` | seguro: lê texto gravado |
| tabela `pagamentos` | — | **nunca impôs 1:1** |

O último achado é o que encolheu a frente: **não existe unique em
`(entrega_id, momento)`**. O banco sempre aceitou N; o 1:1 vivia só no
default do cliente. Não houve constraint a derrubar, nem backfill.

### A ordem READER-FIRST, e por que ela não é burocracia

O usuário corrigiu o contrato aqui, e a correção é conceitual: o banco
aceitar as duas formas (o `payload` é `jsonb`, sem constraint) torna a
migration **estruturalmente** compatível, não **comportamentalmente**.
Um leitor que só saiba interpretar `"pix"` quebra ao receber
`[{forma,valor_cents}]`.

```
E3.A  os leitores aceitam string E lista
E3.B  o SQL passa a ESCREVER lista
E3.C  o cliente cunha id próprio
```

É protocolo distribuído: todo mundo aprende a LER o formato novo antes
de alguém começar a escrevê-lo. Inverter faria o sintoma aparecer no
Registro de Auditoria, que é onde menos se pode errar.

### E3.A — e o helper que estava no lugar errado

O `para` do evento JÁ era bicompatível nos dois leitores, com comentário
explicando ("eventos antigos gravaram `para` como string única"). Fazer o
`de` do mesmo jeito daria QUATRO cópias da mesma normalização.

Extraído para um lugar só — e a primeira tentativa **falhou na primeira
execução do spec**:

```
TypeError: Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')
```

Eu tinha posto o helper em `data/pagamentos.ts`, que importa o cliente
Supabase, que lê `import.meta.env` — inexistente sob `tsx`. É a
disciplina que o projeto já tem e eu furei: **regra que decide o que a
tela AFIRMA mora em `lib/` e não importa nada.** Movido para
`src/lib/formasDePagamento.ts`, com `data/pagamentos.ts` reexportando —
nenhum importador mudou, e agora existe teste onde antes só havia a
esperança de que as duas cópias concordassem.

**A decisão de leitura que vale guardar:** a string legada NÃO carrega
valor, e o helper marca isso em vez de inventar.

```
'pix'                             →  "Pix"
[{forma:'pix',valor_cents:1000}]  →  "Pix (R$ 10,00)"
```

Fabricar um `valor_cents` faria o Registro de Auditoria afirmar um
número que ninguém gravou. E forma fora do enum (`'vale'`, que saiu do
banco no §64) sai **crua** em vez de sumir.

**O NBSP de novo.** Quatro casos falharam mostrando strings visualmente
idênticas. `formatBRL` usa `toLocaleString('pt-BR')`, que põe U+00A0
depois do `R$` — medido: `82,36,160,49,48,44,48,48`. As expectativas
passaram a ser construídas com o próprio `formatBRL`, porque digitar o
espaço à mão é o erro que qualquer um repete. É o §84 outra vez, noutro
arquivo.

### E3.B — a quinta definição, por patch da quarta

Mesmo método da quarta (§78), e ele existe porque reescrever à mão a
função mais crítica do projeto é a forma mais provável de mover sem
querer uma linha de `digest(...)` — e fórmula de hash alterada por
acidente não dá erro, dá romaneio que deixa de verificar meses depois.

`scripts/patch-selar-retorno-e3b.mts`: extrai a 4ª, aplica um patch
mínimo, imprime o diff, e **prova as invariantes antes de o arquivo da
migration existir**.

```
2 linhas removidas, 23 acrescentadas (19 delas comentário)

ok  há 4 expressões digest()
ok  e elas continuam byte a byte idênticas
ok  nenhum insert em assinaturas alterado
ok  nenhum trecho do DCRR1 alterado
ok  o guard do §78 intacto
ok  nenhum ON CONFLICT alterado
ok  o número de queries de pagamentos não mudou   2 → 2
ok  e EXATAMENTE UMA delas mudou
ok  e a que mudou é a do evento `pagamento_alterado`
```

**A ordem é TOTAL, e isso é do usuário:**

```sql
order by pg.forma, pg.id::text collate "C"
```

`order by pg.forma` sozinho deixa empate entre dois previstos da MESMA
forma, e o Postgres não promete ordem útil aí. Mesmo não entrando em
hash nenhum, é evento de auditoria: mesmos fatos têm que produzir a
mesma representação.

**E NULL, não `[]`:** sem previsto o `jsonb_agg` devolve NULL, e o
escalar de antes também acabava em NULL. Um `coalesce(..., '[]')` diria
"havia previsto, e ele estava vazio", que é outro fato.

#### Um check meu que estava errado

A primeira versão de "nenhuma OUTRA query de pagamentos alterada" falhou
por defeito meu: a janela de 160 caracteres começa DEPOIS do `from`,
então o `valor_cents` da query nova cai fora dela e meu filtro por
conteúdo não a excluía — o script acusava a própria query patcheada.

Trocado por uma afirmação mais simples e que prova mais: **"exatamente
uma mudou, e é a do evento"**, comparando posicionalmente.

### E3.C — e o `?` que não enumerou nada

`criarPagamentoPrevisto` passou a EXIGIR o `id`. A intenção era o método
da 2D.6 — deixar o compilador enumerar quem dependia do default. **Não
enumerou nada**: os dois chamadores já passavam `id` explicitamente, só
que com o valor errado. Quem os achou foi o levantamento.

Fica registrado porque a lição não é "funcionou": o que a
obrigatoriedade compra aqui é o FUTURO — um chamador novo não consegue
mais omitir o id e herdar a premissa 1:1 sem perceber.

**A janela da fila**, igual à do `tipo` no envelope (2C.5):

```
NovaEntrega ganha  pagamentoPrevistoId: string      ← o que nasce agora
handler aceita     pagamentoPrevistoId ?? id        ← o que já está guardado
```

O tipo governa o que se escreve; o `??` tolera o item que já está no
IndexedDB de alguém. Sem ele, esse item gravaria `undefined`, o banco
cunharia um id aleatório A CADA REENVIO, e o previsto duplicaria — a
fila reenvia sempre que a rede oscila. Morre no corte pré-V1.

**O id é cunhado antes de enfileirar, nunca dentro da função.**
`criarPagamentoPrevisto` insere e trata `23505` como sucesso, e isso só
é idempotente se o id for O MESMO a cada tentativa.

E na divergência ele é cunhado **sempre**, mesmo quando `criarPrevisto`
é falso: forma de payload não deve depender de booleano, e um reenvio
que reavaliasse a condição cunharia outro id.

### A dívida BLOQUEANTE do E4, registrada aqui de propósito

```
E4 NÃO fecha enquanto:
  src/data/entregas.ts:310    .find(p => p.momento === 'previsto')?.forma
  src/data/fechamento.ts:100  idem
ainda exibirem APENAS um previsto.
```

Elas ficaram fora do E3 por decisão conjunta: só passam a mentir quando
existirem dois previstos, e **quem cria o segundo é o E4**. Mexer agora
seria alterar coluna de lista sem ter o caso que a justifica — e no E4
dá pra testar a UI contra um caso real.

A condição que torna isso seguro: **o E3 não habilita nenhum caminho
operacional capaz de criar dois previstos.** Ele torna o modelo capaz de
1:N; o E4 passa a usar.

### O que foi medido

```
baseline ANTES da migration, como admin     16 · 16 · 0   (13 saídas + 3 retornos)
migration aplicada pelo usuário em 2026-08-26
verificador DEPOIS                          16 · 16 · 0   ← IDÊNTICO

specs   custódia 11 · E1 2 · E2 3 · E3 1 (30 asserções) · patch 11
        tsc -b ok · oxlint 9 avisos, os pré-existentes
```

**O GATE ERA `antes == depois`, e não "tem que dar 16".** A distinção
importa porque o baseline SOBE a cada saída nova (§64: era 9, virou 10,
virou 11) — um número maior não seria regressão. O que se prova aqui é
que as mesmas 16 que verificavam continuam verificando, e que nenhuma
sumiu.

E era o esperado por construção: a migration troca um `select` dentro de
um `jsonb_build_object` de evento, e não encosta em nenhuma das quatro
expressões `digest(...)` — isso foi provado por diff antes de o arquivo
existir. A medição não é redundante com a prova: ela é o mesmo método do
§22 e do §49, onde medir o "antes" e o "depois" no MESMO instrumento foi
o que impediu concluir certo por sorte.

Os cinco casos da escrita nova (0 previstos → NULL; 1 legado; 2; ordem
de inserção invertida → JSON idêntico; mesma forma duas vezes →
desempate por uuid) estão como SQL rodável no rodapé da migration,
dentro de `begin; … rollback;` — o rollback é obrigatório, porque
`pagamentos` não tem policy de DELETE e a regra 4 proíbe apagar.

**E3 FECHADO** — A, B e C, com a conferência pós-migration medida.

O que continua sem exercício, e é honesto dizer: **nenhum retorno foi
selado depois da migration**, então a escrita nova do evento
(`de` como lista) ainda não aconteceu com dado real. Os cinco casos do
rodapé cobrem a QUERY isolada; o evento inteiro só sai quando houver um
retorno novo pra fechar. O primeiro que acontecer serve de conferência —
a consulta está no item (4) do rodapé da migration.

## 88. E4 — duas formas de pagamento no cadastro, e as duas que faltavam

O E3 tirou a premissa 1:1 do modelo. O E4 é quem passa a usar: o cadastro
de entrega aceita até três formas previstas.

O levantamento foi feito antes da primeira linha, como nos itens 58, 67,
76 e 87 — e deu duas notícias, uma boa e uma que não estava no plano.

### A notícia boa: o servidor inteiro já era N-consciente

Eu esperava migration. Não houve nenhuma.

| ponto | estado medido |
|---|---|
| `pagamentos` — unique em `(entrega_id, momento)` | não existe (o E3 já tinha provado) |
| `romaneio_canonico` — linha `p` do DCR1 | `for … loop`, uma por previsto, ordem `(entrega_id, pagamento_id)` |
| **`canonico.ts` — o gêmeo TypeScript** | mesmo loop sobre lista plana |
| `romaneio_payload` | `jsonb_agg` dos previstos |
| `romaneio_documentos_esperados` | `select distinct (entrega_id, tipo_documento)` |
| `obter_contexto_retorno` → `pagamentosPrevistos` | lista |
| `RetornoCorrida` — pré-preenchimento | `vale.pagamentosPrevistos.map(...)` |
| guard do §78 · derivação da divergência | `array_agg` de `forma\|valor`, comparação de conjunto |
| `pagamento_alterado` no retorno | corrigido no E3.B |

**O gêmeo é o que mais importa.** Os dois lados do canônico já emitiam N
linhas `p` com a mesma ordenação, então o E4 não encostou no risco nº 1
do projeto — o par `montarCanonico`/`romaneio_canonico` divergindo em um
byte, cujo sintoma é "a saída offline nunca sincroniza", meses depois e
sem pista.

E o `distinct` resolveu de graça o caso que eu esperava ser problema:
dois previstos com um convênio → **uma** linha `d` esperada; dois
convênios → ainda uma.

Vale registrar o que isso diz do trabalho de 16 a 25/08: a cadeia de
custódia foi construída sobre a cardinalidade REAL da tabela, não sobre a
que a UI usava. Uma feature de produto inteira caiu dentro dela sem
migration.

### A notícia que não estava no plano: eram QUATRO dívidas, não duas

O E3 registrou duas, e as duas eram exibição:

```
src/data/entregas.ts     .find(p => p.momento === 'previsto')?.forma
src/data/fechamento.ts   idem
```

O levantamento achou mais duas, **no mesmo arquivo** — e a primeira delas
não é exibição, é **escrita de auditoria**:

**3. `marcarDivergencia` gravava `de` como escalar.**
`pagamento_alterado` tem DOIS escritores. O E3.B corrigiu o do servidor
(`limit 1` → agrega todos) e eu não perguntei quem mais escrevia aquele
tipo de evento. Com dois previstos, este afirmaria que a divergência foi
de UMA das formas e descartaria a outra em silêncio, numa tabela
append-only que nunca vai ser reescrita.

**4. `ehDivergente` decidia por CONTAGEM.**

```
servidor   array_agg(forma || '|' || valor_cents)     conjunto
cliente    linhas.length > 1 || linhas[0].forma !== esperada
```

Enquanto existia um previsto só, os dois concordavam **por acidente**.
Com dois, um vale previsto `pix + dinheiro` e pago exatamente
`pix + dinheiro` é fiel para o servidor e divergente para a tela: dois
escritores do mesmo fato afirmando coisas diferentes.

O usuário decidiu que as duas entram no E4, pelo mesmo argumento que
manteve as outras fora do E3: **só passam a mentir quando existe um
segundo previsto, e quem o cria é o E4.**

### As três decisões do usuário, tomadas antes do código

**1. O gatilho da segunda forma fica FORA da cadeia de Enter.** Um botão
"+ outra forma" ao lado do rótulo. As alternativas recusadas dizem mais
que a escolhida: opção no próprio select cobraria uma linha a mais do
dropdown em TODA entrega (e misturaria "como pagou" com "em quantas
formas"); atalho de teclado seria invisível, e a farmácia tem
rotatividade de caixa.

**2. Convênio DIVIDE, e o integral vale mesmo parcial.** Metade convênio,
metade dinheiro: se o convênio tem `farmacia_paga_entrega_integral`, a
farmácia banca a entrega inteira. Quem banca a entrega é o convênio, e
isso não depende de quanto da COMPRA ele cobriu.

**3. Os achados 3 e 4 entram no E4.**

### O desenho, e o que ele protege

**O caminho de UMA forma não mudou um passo.** Com uma linha, o valor
previsto **é** o da compra e o campo de valor nem existe. Foi medido no
navegador, e é a asserção que mais vale desta etapa:

```
antes do clique    1 campo de dinheiro (a compra)  ·  2 selects
                   rótulo "Forma de pagamento"
```

Mesmo número de teclas, mesma cadeia de Enter, mesmo orçamento de 25s.
O teste da regra, que fica: **"o que muda pra quem NÃO usa a feature?"**
Se a resposta não for "nada", o desenho ainda não está pronto.

**O cronômetro não foi rodado de novo, e não precisou** — não há passo
novo no caminho que foi medido em 10/08. Se algum dia entrar, aí sim.

Duas regras puras foram pra `src/lib/formasDePagamento.ts`, que não
importa nada além de `money.ts`:

- `validarFormasPrevistas` — soma bate, forma não repete, teto de 3;
- `divergiuDoPrevisto` — o gêmeo do SQL.

**Forma repetida é recusada, e o caso real é banal:** o caixa clica
"+ outra forma", não troca o select, e "Dinheiro" fica valendo duas
vezes. Sem a regra, o DCR1 sairia com duas linhas `p` dizendo a mesma
coisa com ids diferentes, dentro de um documento assinado. E convênio
duas vezes seriam dois acordos disputando `entregas.convenio_id`, que é
uma coluna só.

**O teto do cadastro é 3, o do dialog é 4, e a diferença é deliberada.**
Aqui se PREVÊ, lá se REGISTRA. Ser mais permissivo no registro é o lado
seguro de errar: recusar um fato consumado empurra a correção pra fora do
sistema, que é o que a regra 7 existe pra impedir. Recusar uma previsão
custa um clique.

**A ordenação dos gêmeos não precisa casar, e isso parece que precisa.**
Cada lado ordena os DOIS conjuntos dele com o MESMO comparador e compara
um com o outro — nunca o array ordenado de um lado com o do outro.
Igualdade de multiconjunto independe da ordem total escolhida, então
collation nenhuma muda o resultado. O que precisa casar é a CHAVE
(`forma|valor_cents`) e o fato de **duplicata contar** — implementar o
lado TS com `Set` daria a resposta errada, e só num vale onde a mesma
forma aparece duas vezes, que o cadastro recusa mas o realizado não.

**`status_documental` passou a olhar TODAS as formas** (`.some()`): basta
uma prever convênio ou crediário. É a mesma regra que
`romaneio_documentos_esperados` aplica varrendo todas as linhas `p` —
divergirem faria o retorno recusar `documentos_nao_conferem` **depois**
de colhidas as duas assinaturas.

**A validação acontece na TELA, antes de enfileirar.** Nunca em
`criarEntrega`: revalidar na sincronização recusaria uma operação já
aceita no balcão, e o item iria pra `erro` e pro backoff pra sempre
(§50.4). Coberto por asserção de fiação nos dois sentidos — a tela valida,
`criarEntrega` não.

E os inserts do previsto são **sequenciais**, não `Promise.all`. Não é
medo de concorrência: é que falha no meio de um lote paralelo deixa um
subconjunto arbitrário gravado, e em série o estado parcial é sempre um
PREFIXO — reenviar completa de onde parou. São 1 a 3 linhas.

### A ordem: leitores antes do escritor, de novo

```
E4.A  as duas regras puras em lib/, com spec
E4.C  os leitores (as quatro dívidas)
E4.B  o escritor (NovaEntrega, criarEntrega)
E4.D  a tela
```

Diferente do E3, aqui não havia split real — é tudo um bundle só. Mas
ordenar assim custou nada e evitou o instante em que dois previstos
existem e os leitores mostram um.

### As DUAS armadilhas de spec que esta etapa achou, e a segunda é pior

**A primeira:** a asserção "o dialog não decide mais por contagem"
falhou — casando com o **comentário** que eu tinha acabado de escrever
explicando a regra removida.

**A segunda, e essa é a que assusta:** a asserção do E3.C
```
checa('`NovaEntrega` carrega `pagamentoPrevistoId`',
  /pagamentoPrevistoId: string/.test(entregas))
```
**PASSOU depois de o campo ter sido removido** — casando com o comentário
do E4 que cita o nome antigo pra explicar a troca.

Falso negativo faz barulho. **Falso positivo é um teste afirmando que uma
proteção existe depois de ela ter saído.** Não houve dano porque o
compilador cobriu o caso, mas nem toda asserção de fiação tem compilador
atrás.

A regra, e ela vale pra toda a família de spec de fiação deste projeto:
**asserção de fiação lê o CÓDIGO, nunca a prosa.**

```ts
const semComentarios = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
```

E o incentivo estava do lado errado: **quanto melhor documentada a
remoção, mais provável o falso positivo.** Um projeto que comenta tanto
quanto este não podia ficar com isso armado.

O helper entrou nos dois specs (`formas-previstas` e `pagamento-alterado`).

#### A varredura, feita em seguida — e ela achou um TERCEIRO

Sete specs leem fonte. Três só extraem funções pra EXECUTAR de verdade
(`envelope`, `offline-hash` e metade do `despacho`), e ali comentário é
inofensivo. Os outros afirmam sobre texto, e foram os varridos:

| spec | o que era | o que virou |
|---|---|---|
| `fiacao-texto` | `ler` cru | `ler` = `semComentarios(lerBruto)` |
| `fiacao-estado-de-consulta` | tinha `codigo()`, aplicado **no call site** | `ler` já devolve código |
| `despacho-sync-romaneio` | `fonte` cru nas duas derivações do handler | `fonteCodigo` |

**A `fiacao-estado-de-consulta` já tinha o stripper** — o E2 aprendeu
essa lição na primeira rodada dele, e escreveu isso no comentário. O que
faltava era o PADRÃO: com `codigo()` no call site, o seguro exige
lembrar; um call site esquecido não dá erro, dá asserção lendo prosa sem
ninguém notar. Era o caso do bloco (1), que lia cru e afirmava
`/export type LeituraDeConsulta/`.

**O `despacho` é o mais exposto dos três**, e não era óbvio: ele afirma
ORDEM por posição —

```ts
const primeiraRpc = pos('.rpc(')
checa(..., p > 0 && p < primeiraRpc)
```

— então um `.rpc(` citado num comentário puxaria a fronteira pra trás e
faria checagens corretas falharem, e `split('.rpc(')` contaria três
portas onde há duas. Numa Edge Function que é dos arquivos mais
comentados do projeto.

**As TRÊS saídas ficaram byte a byte idênticas** — medidas com `diff`
contra o baseline de antes. Ou seja: nenhuma asserção existente dependia
de comentário hoje. A mudança é profilática, e o valor dela está no
incentivo, não no bug de hoje.

**E saída idêntica não prova que a proteção morde** — é o §22 de novo. Por
isso a `fiacao-texto` ganhou um bloco (0) que é **controle negativo do
próprio instrumento**: prova que o fonte cru acusaria uma chamada citada
em comentário de linha e em bloco JSX, que o limpo não acusa, que o
código em volta sobrevive, e que a chamada de VERDADE continua sendo
vista. Sem ele, um `semComentarios` que devolvesse o fonte intacto
passaria despercebido pra sempre — com um comentário tranquilizador por
cima.

### O `?` que não enumerou nada, e o que enumerou

No E3.C, tornar `id` obrigatório em `criarPagamentoPrevisto` não enumerou
chamador nenhum: os dois já passavam o id, com o valor errado.

Aqui foi diferente. Remover `formaPagamento` de `NovaEntrega` **enumerou
exatamente um** — `CadastroEntrega.tsx:137` —, que era o que faltava. É o
método da 2D.6 funcionando como anunciado: o compilador achando o
trabalho em vez da memória.

### O que foi medido

```
tsc -b            limpo
oxlint            9 avisos, os pré-existentes
build             ok, 22,5s

specs   formas-previstas  40 asserções (E4)
        pagamento-alterado  atualizado, TUDO OK
        custódia 11 · E1 2 · E2 3 · Drive/geo/token/code128 4
        TODOS VERDES
```

**A tela foi exercitada no navegador**, montada isolada com a técnica do
§86 (o app cai no Login e eu não digito senha). Quatro casos:

```
(a) 123,90 + 50,00      total vermelho "R$ 173,90 de R$ 123,90"
(b) soma bate, 2x Dinheiro   "Dinheiro aparece duas vezes"
(c) Dinheiro + Pix, soma ok  passa a validação do E4 e chega
                             no guard da tarifa (sem sessão)
(d) remove a 2a linha        campo de valor some, rótulo volta
                             ao singular, total some
```

O (c) é o que prova mais: a mensagem que aparece é a da **tarifa**, um
guard pré-existente — ou seja, a validação nova passou e o fluxo seguiu.

E o (d) prova a reversibilidade: voltar pra uma forma restaura o caminho
rápido inteiro, não deixa resíduo.

**A captura de tela falhou** ("Browser pane is not displayed"), como o
próprio NOTAS já registrava. Leitura de DOM é o instrumento aqui.

**Duas coisas do ferramental que voltam a morder quem repetir:** o estado
do componente **não sobrevive entre chamadas** do `javascript_tool` (o HMR
espúrio do OneDrive remonta a árvore no meio) — faça tudo num script só;
e os deps que o Vite serve exportam via `default` (interop CJS), então é
`Rm.default ?? Rm`, não `import * as React`.

### O que o E4 NÃO fez, e é honesto dizer

**Nenhum vale com duas formas previstas foi gravado no banco.** A
verificação foi de componente isolado, sem sessão — o insert, o DCR1 com
duas linhas `p`, e o Romaneio de Retorno pré-preenchendo duas linhas
nunca aconteceram com dado real.

O primeiro cadastro dividido que o usuário fizer é a conferência, e ela
tem uma consulta natural:

```sql
select e.numero_vale, p.forma, p.valor_cents, p.id
  from public.entregas e
  join public.pagamentos p on p.entrega_id = e.id and p.momento = 'previsto'
 where e.id = '<o vale>'
 order by p.id::text collate "C";
```

Duas linhas, ids distintos, soma igual a `valor_compra_cents`. E se esse
vale sair numa corrida, o `document_hash` do romaneio passa a carregar as
duas linhas `p` — o verificador continua sendo o gate.

**E o E3 continua com a mesma pendência**: nenhum retorno foi selado
depois da migration de 26/08, então a escrita nova do `de` (lista) ainda
não aconteceu com dado real por nenhum dos dois escritores.

**E4 FECHADO** — A, B, C e D.

## 89. E5 — login por usuário: FECHADO

**FECHADO em 2026-09-01.** A separação abaixo é deliberada, e vale ler
mesmo com tudo verde: o código já era verdadeiro antes do teste ao vivo,
porque decorre da restrição congelada — não porque alguém logou.

_(texto original de quando o item foi aberto:)_ **Este item não está fechado, e a separação é deliberada.** O código já
rendeu decisões arquiteturais que são verdadeiras independentemente do
teste ao vivo — elas valem porque decorrem da restrição congelada, não
porque alguém logou. Registrá-las agora é o que as tira da branch.

O que depende de acesso que eu não tenho fica na segunda lista, e ela é
o que falta pra dizer "E5 fechado".

```
E5 — IMPLEMENTAÇÃO
✓ username → <username>@drogariacidade.invalid
✓ nenhuma RPC pública de resolução
✓ nenhuma enumeração pré-auth
✓ unicidade global via Supabase Auth
✓ normalizarUsername cliente ↔ Edge byte a byte
✓ login distingue recusado / indisponível / erro
✓ E2 aplicado também à mutation de login
✓ senha/PIN/token continuam fora de lib/texto
✓ specs + tsc + build verdes

E5 — ACEITE OPERACIONAL           (2026-09-01)
✓ Edge Function publicada
✓ usuário NOVO criado pelo painel — `camiloadmin`, papel admin
✓ primeiro login real usando SOMENTE o username
✓ senha errada comprovada como recusado
✓ offline comprovado como indisponível, sem acusar senha
✓ `profiles.email` consistente com o Auth — os dois lados idênticos
~ contas antigas NÃO convertidas — por decisão, ver abaixo
~ erro técnico (5xx) separado de recusa — só no spec, não em produção
```

Branch: `feat/e5-login-username`, rebaseada sobre `fd263fa` depois do
merge do E4. Diff contra a `main`: só E5 — os oito arquivos de E3/E4
foram conferidos um a um e estão limpos.

### O gêmeo se provou no LOGIN, não no dashboard

Vale registrar porque muda o que o gate significa: **entrar digitando só
`camiloadmin` É a prova.** O cliente compôs
`camiloadmin@drogariacidade.invalid` e o servidor aceitou — se a Edge
Function tivesse gravado qualquer outro endereço, o login teria falhado
com "senha inválida" e sem pista, que é exatamente o modo de falha que o
`username.spec.mts` existe pra impedir.

As duas cópias concordaram contra dado real, fora dos specs. Olhar o
dashboard depois é confirmação, não prova.

### A distinção offline × recusa, medida no app rodando

Mesmas credenciais falsas, mesmo 400 do servidor, só o estado de rede
mudando:

```
online    "Usuário ou senha inválidos."
offline   "Sem conexão — não deu pra verificar o usuário."
```

E a segunda **não fala em senha**. Antes do E5 as duas eram a mesma
frase, e offline o app mandava a pessoa trocar uma senha que estava
certa — o defeito do E2 na décima tela, a que ele não cobriu por ser
escrita e não consulta.

O ramo exercitado foi o do `navigator.onLine`. O do `TypeError` do
`fetch` (rede morta com `onLine` ainda `true`) continua coberto só por
spec — é caminho secundário para a mesma resposta, e existe justamente
porque `onLine` mente nesse caso.

### As contas antigas NÃO foram convertidas, e não serão

O plano original era converter `adminteste` e `caixateste` uma por vez.
**Não deu**: o painel do Supabase não expõe edição de e-mail, e mexer
direto em `auth.users` foi recusado — o GoTrue também guarda o endereço
em `auth.identities`, e não havia como verificar daqui se atualizar só um
dos dois deixa a conta meio-quebrada. Arriscar isso na conta que É o
acesso não vale.

A saída foi melhor que o plano: **criar conta nova em vez de converter.**
A sessão do Supabase vive no `localStorage` e sobrevive à troca de
branch, então bastou entrar com a conta antiga e criar a nova já pelo
fluxo novo.

Consequência aceita: `adminteste` e `caixateste` continuam no domínio
antigo e **param de conseguir entrar**, porque o login compõe
`<username>@drogariacidade.invalid` e mais nada. Isso é o desejado — o
usuário pediu explicitamente que não coexistissem os dois modos — e elas
somem no corte pré-V1 de qualquer jeito.

**A saída de emergência, enquanto o corte não vem:** a `main` ainda tem o
login por e-mail. Servindo a `main`, entra-se com as contas antigas.

### A restrição congelada escreveu o desenho

A decisão de 25/08 diz: *sem RPC pública que enumere usernames, sem
autenticação caseira.* Isso não é preferência — é o que elimina as duas
alternativas óbvias:

| alternativa | por que cai |
|---|---|
| RPC `resolver_username(text) → email` | **é** um oráculo de enumeração: sonda quais usuários existem sem credencial nenhuma |
| abrir `profiles` para o anônimo | idem, e ainda expõe nome, papel e filial |

Sobra uma forma, e ela não tem consulta nenhuma antes de autenticar:

```
digita     camilo
compõe     camilo@drogariacidade.invalid
chama      signInWithPassword
```

Sem lookup, não há o que enumerar. E a unicidade global vem de graça —
e-mail é único no Auth —, o que é o certo aqui: **antes de autenticar não
existe tenant pra desempatar**, então username por tenant seria uma
pergunta sem resposta.

**Nenhuma migration, nenhuma tabela, nenhuma RPC.** É o segundo item
seguido da frente que não toca no banco.

### `.invalid`, e por que a escolha é permanente

O usuário confirmou em 2026-08-30 que a farmácia não tem domínio próprio
e deixou a escolha comigo. `.invalid` é reservado pela **RFC 2606**
exatamente para isto: garantidamente não resolve, não pode ser
registrado por ninguém, e nunca roteia correio de verdade. De quebra se
autodocumenta — quem abre o painel do Supabase vê
`camilo@drogariacidade.invalid` e entende na hora que não é endereço de
e-mail de ninguém.

`DOMINIO_TECNICO` é uma constante única. **Trocá-la significa atualizar o
e-mail de toda conta existente**, porque o login passa a compor um
endereço diferente do gravado — é uma linha aqui e uma migração de contas
lá. Não é decisão de estilo.

Havia uma incoerência que o levantamento achou e que vale ficar
registrada: o CLAUDE.md documentava `drogariacidade.local`, mas as contas
reais usam `drogcidade.sg`. `.local` é TLD reservado para mDNS e é
recusado por parte dos validadores — a hipótese (não confirmada) é que
alguém tenha tentado e o Supabase tenha recusado.

### O gêmeo, que é a parte frágil

```
src/lib/username.ts                 monta o e-mail no LOGIN
supabase/functions/criar-usuario    monta o e-mail na CRIAÇÃO
```

A Edge Function roda em Deno, fora do bundle, então carrega uma **cópia**
de `normalizarUsername` — mesmo arranjo de `calcularOfflineEventHash`,
que também tem cópia na `sync-romaneio`.

**Divergindo em um byte, a conta nasce com um endereço e o login tenta
outro.** O sintoma é *"senha inválida"*, e o diagnóstico é pior que o dos
canônicos: não há verificador, não há canônico impresso, não há nada além
de um usuário jurando que a senha está certa.

Por isso `scripts/username.spec.mts` **lê os dois arquivos e compara o
corpo das duas funções** (comentário e indentação removidos, o resto
byte a byte) mais o valor do domínio. Não é confiança no copiar-colar: é
medido.

E a Edge Function **deixou de ler `corpo.email`**, com asserção que o
cobra. O endereço virou DERIVAÇÃO do username, então aceitá-lo do corpo
do request permitiria criar uma conta cujo endereço o login jamais
comporia — **uma conta que nasce inacessível**. É a mesma regra que já
valia ali para `tenant_id` e `papel`: nada que vem no corpo decide
identidade.

### O E2 ganhou a décima tela

O E2 caçou, em nove telas, a cadeia que AFIRMA vazio sobre uma consulta
que nunca respondeu. O login escapou **por ser escrita, não consulta** —
e carregava a mesma família de defeito na forma mais crua possível:

```tsx
{mutation.isError && <p>E-mail ou senha inválidos.</p>}
```

Qualquer erro virava credencial inválida, inclusive não ter rede. Offline
o app afirmava que a senha estava errada sem ter tido a quem perguntar —
e mandava a pessoa **trocar uma senha que estava certa**.

`classificarFalhaDeLogin` devolve `recusado | indisponivel | erro`, e a
ordem das checagens é parte da regra: `online: false` vem **primeiro**,
porque sem rede não existe resposta autoritativa e um status residual não
pode virar veredito.

Duas coisas que o spec cobra e que são o ponto todo:

- **a mensagem de `indisponivel` não fala em senha** — nem a palavra, nem
  "inválido". A tela não sabe se ela está certa e não deve chutar;
- **o ramo do `TypeError`**, porque `navigator.onLine === true` com rede
  morta é caso real (portal cativo, DNS caído, servidor fora), e esse
  erro vem como exceção do `fetch`, não pelo `error` do supabase-js. Sem
  ele, ficar offline com a tela aberta voltava a virar "senha inválida".

`navigator.onLine` é lido **no instante da ação**, não no do último
render — a regra que a Nova Corrida já seguia.

### O identificador interno não aparece na UI — com UMA exceção, deliberada

A lista de usuários e o dialog de edição mostram `camilo`, nunca
`camilo@drogariacidade.invalid`: quem faz isso é `usernameDoEmail`. O
formulário de criação mostra "Vai entrar como **camilo**", que é o
username normalizado, não o endereço.

**A exceção:** conta de OUTRO domínio sai crua. Durante a conversão
existe um instante em que as duas formas convivem no banco, e mostrar
`adminteste` para uma conta que ainda é `adminteste@drogcidade.sg`
afirmaria uma conversão que não aconteceu. **O desalinho tem que ficar
visível**, e tem caso no spec — alguém vai querer "consertar" isso e
esconder o endereço; não conserte.

### Os DOIS achados de ferramental

O código final não explica nenhum dos dois sozinho.

#### 1. O range Unicode sem escape comia dígitos

`normalizarUsername` tira acento com NFD + corte das marcas
combinantes. Ao trocar os caracteres literais pela forma escapada, um
`sed` comeu as barras invertidas:

```
pretendido   .replace(/[̀-ͯ]/g, '')
gravado      .replace(/[0300-036f]/g, '')
```

O segundo **não é um range de combinantes: é uma classe de dígitos**
(`0`, `3`, `0`–`0`, `3`, `6`, `f`). `joao2` perdia o `2`, e
`caixa1` viraria `caixa`.

E o que torna isso perigoso é a superfície: um username silenciosamente
encurtado gera um e-mail técnico diferente do que a Edge Function gravou
— exatamente o modo de falha "senha inválida sem pista" que o gêmeo
existe pra impedir, chegando pelo caminho de dentro.

Pegou porque o spec tem caso de dígito. Ficaram três: `joao2`, `123` e
`a0123456789`, com o comentário dizendo qual defeito eles guardam.

**A lição de ferramental:** `sed` e heredoc do bash comem barra
invertida e crase. Neste arquivo houve três acidentes do mesmo tipo —
esse, um comentário JSX que perdeu as palavras entre crases porque o
bash as tratou como substituição de comando, e uma chave órfã deixada
por um `slice`. Para linha com escape, `awk` com o texto vindo de
arquivo funcionou; para bloco com crase, o `Write`/`Edit` direto.

#### 2. `fiacao-texto` acusou o normalizador legítimo

O spec falhou em `normalizarUsername(username)`:

```
FALHA  nenhum segredo/identificador normalizado
       — src/components/UsuariosCadastro.tsx: username
```

**Verdadeiro pela letra, falso pela intenção.** O regex era
`normalizar\w*\(\s*${proibido}`, e a regra que ele deveria cobrar é
*"isto nunca passa por `lib/texto.ts`"* — não *"isto nunca é normalizado
por nada"*. `normalizarUsername` é o normalizador PRÓPRIO do username,
com regra **oposta** à de `normalizarNome`:

```
normalizarNome      PRESERVA acento — mudar um nome corrompe documento
normalizarUsername  TIRA acento — local part de e-mail não os aceita
```

É o par de contratos opostos do E1.1 outra vez.

Deixar o regex largo cobraria um preço crescente: todo campo que
ganhasse normalização própria — PIN formatado, token exibido — seria
acusado, e a saída seria enfraquecer a regra ou enchê-la de exceção.
Estreitado para a lista fechada das funções de `texto.ts`
(`Linha|Paragrafo|Nome|Endereco|ParaBusca`).

**Com controle negativo**, pela lição do E4: estreitar corre o risco de
DESLIGAR a regra em vez de afiná-la, e o sintoma seria o bloco passando
para sempre sem nunca mais acusar nada. Quatro asserções sobre fonte
sintético provam as duas metades — ainda pega `normalizarNome(senha)`,
`normalizarLinha(token)` e `normalizarParaBusca(email)`, e não pega mais
o normalizador próprio.

### A data, e o aviso deste arquivo funcionando

Eu datei o E5 como 2026-08-27 em dois lugares, por me basear no contexto
da conversa. **A sessão atravessou a pausa do limite de uso**, e o
relógio diz outra coisa:

```
E4  1997041   2026-08-27
E5  adbe1f7   2026-08-30
```

Corrigido conferindo `git log --date=iso`, que é o que a seção "Cuidado
com datas ao escrever aqui" manda fazer. É a segunda vez que esse aviso
paga o próprio custo.

### O que foi medido

```
tsc -b     limpo
oxlint     9 avisos — os pré-existentes
build      ok

username 46 · falha-de-login 24 · texto 62 · fiacao-texto 39
estado-de-consulta 114 · fiacao-estado-de-consulta 90
zero falhas
```

O oxlint chegou a **10** no meio do caminho, e o aviso novo apontou o
conserto certo: `FalhaDeLoginError` estava em `data/auth.tsx`, que
exporta componente React. Ela é pura, não precisa do cliente Supabase, e
foi pra `lib/falhaDeLogin.ts` — onde também virou testável.

### A ORDEM DO ACEITE, e por que uma conta por vez

Combinada com o usuário em 2026-08-30. **O ambiente de autenticação
continua conhecido até o passo 4**, e é isso que a ordem protege:

```
1. E4 E2E completo
2. verifier admin
3. decidir merge do PR #1
   ────────────────────────────  só depois disto se mexe em conta
4. publicar criar-usuario
5. converter UMA conta:  adminteste → adminteste@drogariacidade.invalid
6. testar login:
     username adminteste + senha certa  → entra
     senha errada                       → recusado
     offline                            → indisponível, SEM falar em senha
7. só então converter caixateste
8. repetir o login como caixa
```

**Uma conta por vez, não as duas.** Se houver qualquer diferença entre a
normalização publicada na Edge e a do cliente, ou alguma peculiaridade na
alteração do usuário no Auth, a segunda conta continua sendo acesso
conhecido enquanto se diagnostica. Converter as duas de uma vez é
trancar-se do lado de fora — e o modo de falha deste desenho é
silencioso.

**E o gate que fecha o E5**, definido pelo usuário: depois de criar um
usuário NOVO pelo fluxo administrativo, conferir no Supabase Auth que o
identificador nasceu como

```
username_normalizado@drogariacidade.invalid
```

e então fazer logout/login usando **somente o username**, sem o
identificador interno nunca ter aparecido na UI.

Esse gate é o único que exercita os dois gêmeos contra o mesmo dado real:
a Edge Function COMPÔS o endereço, e o cliente o RECOMPÔS para entrar. É
a única prova de que as duas cópias concordam fora do spec.

## 90. E4 — aceite E2E e merge

> **A numeração é cronológica, e as duas frentes correm empilhadas:** o
> item 89 (E5) foi escrito ANTES de o E4 ser aceito. Na `main`, entre o
> merge do E4 e o do E5, a sequência pula de 88 direto para 90 — não é
> item perdido, é o 89 esperando em `feat/e5-login-username`.

O primeiro E2E do E4 rodou em 2026-08-31/09-01, com o `V-000053`:
`R$ 123,90` divididos em `dinheiro 60,00 + pix 63,90`.

```
✓ primeiro vale dividido gravado no banco
✓ 2 previstos com IDs independentes
✓ soma dos previstos = valor da compra
✓ DCR1 com 2 linhas p
✓ retorno fiel com 2 formas
✓ cliente e servidor concordaram: sem divergência
✓ pagamento_alterado manual preservou as 2 formas em de[]
✓ referencia_informada permaneceu null quando havia previsto real
✓ correção ce84756 eliminou o segundo escritor retroativo
✓ V-000006 e dados sujos de desenvolvimento permanecem intocados
  até o corte pré-V1
✓ verifier sem novas divergências de integridade
```

### O placar

```
antes do E2E     16 · 16 · 0
pós-saída        19 · 19 · 0
pós-retorno      20 · 20 · 0
```

O critério nunca foi "continuar em 16": é *documentos antigos válidos
continuam válidos, cada romaneio novo aumenta o universo esperado, e
nenhuma divergência de integridade nova.* Quatro documentos entraram —
dois de uma rodada anterior, dois desta — e os vinte verificam.

### O que ficou provado, e como

**Os dois previstos, com identidade própria.**

```
dinheiro  6000  01a05aa0-9ea3-71ba-…
pix       6390  01a05aa1-867b-71b8-…
                soma 12390 = valor_compra_cents
```

`id_derivado_da_entrega = false` nos dois. Era essa derivação que o E3
removeu, e que fazia a segunda forma bater no `23505`, ser tratada como
sucesso, e sumir em silêncio.

**O DCR1 com duas linhas `p`**, em `R-000029` (`selado`, `online`):

```
p  01a05aa0-…-7fb4-…  01a05aa0-…-71ba-…  dinheiro  6000  0
p  01a05aa0-…-7fb4-…  01a05aa1-…-71b8-…  pix       6390  0
```

Lido do canônico ASSINADO, não de `pagamentos` — é a diferença entre "o
banco tem duas formas" e "as duas formas entraram no documento que as
duas partes assinaram".

**O retorno FIEL não virou divergência** — e a prova é POR AUSÊNCIA, o
que merece ser explicado porque é o tipo de prova que se lê errado:

Se o servidor tivesse julgado divergente, `selar_romaneio_retorno_interno`
teria gravado o SEU PRÓPRIO `pagamento_alterado`. A consulta do CHECK 5
busca todos os eventos daquele tipo para aquela entrega, **sem filtro de
data e sem limite**, ordenados por `ocorrido_em desc`. Ela trouxe UM: o
manual, com a justificativa do teste. Logo o automático não existe, logo
o servidor considerou fiel.

Era exatamente isto que o PR existia pra provar. Antes do E4 a tela teria
dito "divergiu" (ela contava linhas) e o servidor não (ele compara
conjuntos de `forma|valor`) — os dois escritores do mesmo fato afirmando
coisas diferentes.

**E o `de` do escritor manual saiu como lista:**

```json
"de": [{"forma":"dinheiro","valor_cents":6000},
       {"forma":"pix","valor_cents":6390}],
"tipo_do_de": "array",
"referencia_informada": null
```

`pagamento_alterado` tem DOIS escritores, e o E3.B corrigiu só o do
servidor. Antes do E4 este teria gravado a string `"dinheiro"`, e o
`pix 6390` sumiria da auditoria — num evento append-only, que ninguém
reescreve depois.

E `referencia_informada: null` é o E4.1 se comportando: o vale TEM
previsto, então não há nada a declarar. O campo só se preenche em vale
antigo sem previsto.

### O pré-preenchimento, com a precisão que ele merece

O retorno persistiu exatamente as duas formas e valores previstos, e foi
considerado fiel pelo servidor. **O pré-preenchimento VISUAL das duas
linhas não é medição deste registro** — os realizados saindo idênticos
aos previstos é consequência dele, não prova dele.

*(Marcar aqui `observado` se o operador confirmar que viu as duas linhas
já preenchidas na tela; até lá, fica INFERIDO pelo resultado
persistido.)*

Não se transforma inferência em medição. É a mesma disciplina do §49 e do
placar: o que foi medido tem um nome, o que foi deduzido tem outro.

### O que o E2E achou que os gates estáticos não achavam

E é a razão de a fronteira dos commits ficar como ficou:

```
1997041   implementação E3/E4, com todos os gates estáticos verdes
ce84756   correção que só o primeiro E2E revelou
item 90   prova operacional
merge
```

O `V-000006` no banco — dois previstos `pix 5000` num vale de R$ 50,00,
com uma ocorrência de 03:26 afirmando "vale antigo sem pagamento
registrado" sobre um vale que tinha previsto desde 03:23 — expôs uma
corrida que **nenhum spec conseguia demonstrar**, porque ela depende de
interleaving entre a ocorrência e o replay da fila.

E ela tinha sido ABERTA pelo E3.C: antes dele o retroativo usava
`id: entregaId`, então um duplicado batia no `23505` e era engolido. O
E3.C tirou o id derivado — corretamente — e levou junto uma guarda que
ninguém sabia que existia.

A correção foi por ELIMINAÇÃO, não por coordenação, e o motivo está no
item que o usuário isolou: com a ocorrência entrando ANTES do replay, o
replay é o escritor legítimo — se insere são duas linhas, se pula
perde-se a verdade, e `pagamentos` não tem DELETE nem UPDATE (regra 4).
Lock, RPC ou `select`-antes-de-inserir só escolheriam qual dano.

### Duas armadilhas do MEU ferramental, e a segunda é a que ensina

**1. O roteiro tinha três erros de SQL**, todos da mesma causa: escrevi de
memória o que não podia executar. `eventos.registrado_em` (é
`ocorrido_em`), `max(uuid)` (não existe), e `jsonb_array_length` sobre o
`de` escalar legado (estoura). O terceiro teria quebrado na execução
seguinte. Passei a conferir cada coluna contra o schema antes de mandar.

**2. O SELETOR NÃO SABIA DIZER "NÃO ACHEI NADA NOVO".**

A CTE `alvo` era *"o vale mais recente com dois ou mais previstos"*. Sem
o vale novo, ela caía silenciosamente no `V-000006` e respondia sobre ele
**com a mesma cara de resposta legítima**. Uma rodada inteira foi
interpretada como falha do E4 quando media dado de 08/08.

É o defeito do E2 — a ferramenta afirmando sem distinguir "não há
resposta" de "esta é a resposta" — construído por mim, no instrumento
que existia pra conferir o conserto dele. Resolvido excluindo o resíduo
por id, para que "sem vale novo" devolva ZERO LINHAS, que é honesto.

### Os dados sujos, por decisão explícita

```
V-000006  (e qualquer irmão fora de documento selado)
→ dado de desenvolvimento inconsistente
→ NÃO corrigir
→ NÃO apagar individualmente
→ NÃO tentar regularizar
→ nunca entrou em romaneio
→ eliminado no corte limpo pré-V1
```

Mexer nele só pra deixar o banco bonito violaria justamente a disciplina
de não reescrever fato histórico. E ele é inerte: o CHECK 3 confirmou que
não está em romaneio nenhum.

**E4 FECHADO** — implementação, correção e aceite operacional.

## 91. E10 — admin operando por filial: CONTRATO FECHADO, código não começado

Pedido em 2026-09-01, com os dois lados: o admin precisa **enxergar e
filtrar** cada filial (suporte) e **operar** em nome de qualquer uma.

Levantado contra o código antes de qualquer linha, e fechado com o
usuário. Quem for construir: leia inteiro, porque metade das decisões
existe pra evitar um problema de autorização, não de tela.

### METADE JÁ EXISTE

**Enxergar/filtrar está pronto em cinco telas:** Fechamento, Relatórios,
Histórico, Registro de Auditoria e a Sangria já dão seletor de filial pro
admin. Nada a construir nessa metade.

**E a RLS já faz exatamente o que o E10 quer:**

```sql
entregas_insert  with check (
  tenant_id = current_tenant_id()
  and (is_admin() or loja_id = current_loja_id())
  and criado_por = auth.uid())
```

Admin grava em qualquer filial do tenant; caixa e gerente só na própria.
**Cadastro e transferência não precisam de migration nenhuma** — quem
trava é o cliente, que fixa `profile.lojaId` e bloqueia a tela quando ele
é nulo.

### O ÚNICO PONTO DE SERVIDOR, E OS DOIS GATES QUE O CONFIRMARAM

| ponto | como obtém a loja | competência? |
|---|---|---|
| RLS `entregas_*` | `is_admin() or loja_id = current_loja_id()` | **sim** |
| `selar_romaneio` → `_interno` | `p_loja_id` do cliente | **NÃO** |
| `selar_romaneio_sincronizado` | `p_loja_id` do corpo, via Edge | **NÃO** |
| `selar_romaneio_retorno(_sincronizado)` | `v_saida.loja_id` | **imune** |
| `registrar_conflito_romaneio` | recebe `p_loja_id` | herda |

**O retorno nasceu imune, e foi acerto da 2B**: ele não tem `p_loja_id` —
a loja sai do romaneio de saída selado, e payload nenhum opina.
`RetornoCorrida` não menciona `lojaId` em lugar nenhum.

**GATE 1 — `registrar_conflito_romaneio` é alcançável direto?** Não:
`revoke all from public, anon, authenticated` e **nenhum `grant`**. É
interna, só chamada de dentro do `_interno`. Herdar basta.

De quebra, as duas portas sincronizadas são `to service_role` —
alcançáveis só pela Edge Function. Então a guarda entra no **`_interno`**,
que as quatro portas atravessam. Um lugar, não quatro.

**GATE 2 — o tenant de `p_loja_id` é provado?** **Não**, só
transitivamente: os vales precisam pertencer a ele *e* ao tenant, então
uma loja de outro tenant não casa com vale nenhum e cai em conflito.

Só que o caminho de conflito **grava**: `registrar_conflito_romaneio`
insere em `romaneios` com `p_tenant` do ator e `p_loja_id` alheio — uma
linha cujo tenant e loja discordam. Pequeno, mas é exatamente a classe de
coisa que este projeto não deixa passar. **A prova de tenant vira
explícita.**

### A CORREÇÃO QUE O LEVANTAMENTO OBRIGOU, e ela é a mais importante

A primeira versão da guarda usava `is_admin()` e `current_loja_id()`.
**Ela quebraria toda a selagem offline.**

`selar_romaneio_interno` deriva o tenant do **perfil de `p_caixa_id`**, e
não de `auth.uid()`. O motivo estava escondido nos grants: a porta
sincronizada é chamada pela Edge Function como `service_role`, onde
**`auth.uid()` é NULL**. `is_admin()` e `current_loja_id()` leem
`auth.uid()`, logo retornariam nulo, e toda saída offline passaria a ser
recusada — meses depois, sem ninguém ligar a coisa à guarda.

A guarda tem que ler do mesmo perfil que a função já lê:

```sql
select p.tenant_id, p.papel, p.loja_id
  into v_tenant, v_papel, v_loja_do_ator
  from public.profiles p where p.id = p_caixa_id and p.ativo;

-- 1. a loja existe e é do tenant do ator?
if not exists (select 1 from public.lojas l
                where l.id = p_loja_id and l.tenant_id = v_tenant) then
  raise exception 'Filial inválida para este tenant.'
    using errcode = 'insufficient_privilege';
end if;

-- 2. o ator tem competência sobre ela?
if v_papel <> 'admin' and p_loja_id is distinct from v_loja_do_ator then
  raise exception 'Sem competência sobre esta filial.'
    using errcode = 'insufficient_privilege';
end if;
```

**`v_papel <> 'admin'`, nunca `is_admin()`.** Mesma razão, e vale como
regra pra qualquer coisa nova dentro dessas funções: **o ator é o
parâmetro, não a sessão.**

E ela **não afrouxa nada hoje** — só torna explícito o que a RLS já
garantia por acidente. É a diferença entre *"o caixa não consegue montar
o payload"* e *"a função recusa"*.

### O CONTRATO

```
E10 — ADMIN OPERANDO POR FILIAL

VISIBILIDADE
admin → todo o tenant
demais → regras atuais

CONTEXTO
admin → escolhe loja operacional
caixa/gerente → profile.loja_id

SELEÇÃO ADMIN
→ cabeçalho sempre visível
→ sessionStorage por auth.uid
→ limpa em logout/nova sessão
→ sem seleção não é erro de perfil

OPERAÇÃO
→ captura lojaOperacionalId ao iniciar
→ contexto fica congelado
→ mudança posterior no header não altera operação existente

FILA OFFLINE
→ owner e loja operacional são campos distintos
→ lojaOperacionalId congelada no enqueue
→ sync nunca relê seleção atual do admin

AUTORIZAÇÃO
→ frontend escolhe contexto, nunca concede competência
→ servidor valida loja/tenant/ator
→ admin: qualquer loja do próprio tenant
→ caixa/gerente: somente current_loja_id()

SAÍDA
→ selar_romaneio e sincronizado recebem loja da operação
→ competência validada ANTES do canônico/digest
→ quatro digest() permanecem byte a byte idênticos

RETORNO
→ permanece como está
→ loja derivada da saída selada
→ payload não escolhe filial

AUDITORIA
→ ator continua sendo ator
→ romaneio/entrega continua carregando loja
→ não criar evento artificial de "admin entrou na Filial 02"
```

### As três decisões, e o porquê de cada uma

**1. `sessionStorage`, não `localStorage`.** Decisão do usuário, e a razão
é o custo do erro: uma entrega lançada na filial errada é fato que não se
reescreve (regra 4). Um admin que abre o sistema dois dias depois e herda
silenciosamente *"Operando como: Filial 02"* da semana passada lança na
filial errada sem nunca ter decidido isso. `sessionStorage` dá
persistência suficiente pra não irritar em cada F5, e some no logout ou
em aba nova.

E o cabeçalho mostra algo **impossível de ignorar**, não um select
discreto:

```
OPERANDO EM
Filial 02 ▾
```

**2. "Por operação" significa SNAPSHOT, não leitura dinâmica.** O ponto
mais importante do lado do cliente. Se o admin abre o Cadastro de Entrega
na Filial 02 e troca o cabeçalho pra Filial 09 com o formulário aberto,
**o vale não pode trocar de filial junto**.

```
contexto global      escolhe onde INICIAR novas operações
operação iniciada    captura lojaOperacionalId
depois disso         aquela operação segue vinculada à mesma loja
```

O formulário aberto continua sendo Filial 02, e mostra isso dentro dele.
O que não pode acontecer nunca é o destino mudar em silêncio.

É a mesma disciplina da **tarifa**, que é capturada no cadastro e vai no
payload em vez de ser lida na hora do sync — e pelo mesmo motivo.

**3. `donoDaFila` NÃO é sobrecarregado.** São eixos diferentes:

```
ownerUserId / tenantId    quem é dono daquele item local
lojaOperacionalId         a filial CONGELADA da operação
```

Hoje `donoDaFila(profile)` grava `lojaId: profile.lojaId`, e o NOTAS já
registrava que `tenantId`/`lojaId` da fila nunca são comparados. Com o
E10 o segundo passa a ter significado próprio, e misturá-lo com o dono
faria a sincronização relêr a seleção atual do admin — exatamente o que
o snapshot existe pra impedir.

**Caixa e gerente não mudam:** `lojaOperacional = profile.lojaId`, sem
seletor, sem override, e o servidor recusa outra loja.

### Admin sem contexto não é erro de perfil

Hoje as três telas de escrita mostram *"Sua conta não tem uma loja
associada — fale com o administrador"*. Pra um admin isso é falso: ele
não tem problema de cadastro, ele tem estado operacional `sem_contexto`.

```
"Escolha a filial em que você está operando"   + o seletor ali mesmo
```

As ações que precisam de loja ficam indisponíveis até a escolha; telas
globais e administrativas seguem acessíveis normalmente.

**O `camiloadmin` fica com `loja_id` nulo de propósito**, como caso de
prova: o E10 tem que funcionar sem enfiar uma filial artificial no
perfil.

### A ordem, e o método

```
1. migration da porta de saída   patch MÍNIMO no `_interno`
   → prova de que os 4 digest() não mudaram um byte
   → verificador admin antes/depois, com o gate `antes == depois`
2. o snapshot no cliente e a fila
3. o seletor no cabeçalho
4. as três telas
```

**Servidor primeiro**, decidido com o usuário: é o único ponto onde errar
vira problema de autorização e integridade, e a tela é a parte fácil.

O patch usa o método do E3.B — script que extrai a função, aplica a
mudança mínima, imprime o diff e **prova as invariantes antes de o
arquivo da migration existir**. `selar_romaneio_interno` é a função mais
crítica do projeto, e reescrevê-la à mão é a forma mais provável de mover
sem querer uma linha de `digest(...)`.

## 92. E10.1 — a porta de saída: aplicada e medida

Primeiro passo do contrato acima concluído em 2026-09-02. O cliente, o
snapshot da fila, o seletor do cabeçalho e as três telas **ainda não
começaram** — esta etapa é só a fronteira de autorização do servidor.

Arquivos:

```
scripts/patch-selar-saida-e10.mts
supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql
```

O script extrai a terceira definição de `selar_romaneio_interno` da
migration `20260819160000`, faz três substituições locais e só grava a
proposta se todas as invariantes passarem. A primeira rodada recusou a
própria ferramenta: duas asserções liam comentários/delimitadores como
código. O instrumento foi corrigido antes de a proposta existir; a
segunda rodada passou inteira.

O diff de produção é um só:

```
perfil de p_caixa_id  →  tenant_id + papel + loja_id
p_loja_id             →  precisa existir no tenant do ator
papel admin           →  qualquer loja daquele tenant
papel caixa/gerente   →  somente a loja do perfil
```

O que foi provado localmente:

```
4 digest()                         byte a byte idênticos
assinatura/atributos da função     idênticos
reenvio, conflito e canônico       literais
autorização, escritas e evento     literais
decisão por auth.uid()             nenhuma
guarda de competência              antes do canônico e do 1º digest
migration                          contém exatamente a proposta provada
build                              ok
canônico DCR1                      15 de 15
lint                               0 erros; 9 avisos pré-existentes
```

A própria migration captura **todas** as linhas de
`verificar_romaneios_selados()` antes do `create or replace`, recalcula
depois e levanta exceção se qualquer linha mudou ou sumiu. Não existe
baseline numérico codificado: o gate é `antes == depois`.

### APLICADA E MEDIDA em 2026-09-02

```
antes    saida 15 · retorno 5 · TOTAL 20 · 20 · 0 · conflito 3
depois   saida 15 · retorno 5 · TOTAL 20 · 20 · 0 · conflito 3
```

O gate `antes == depois` fechou **por construção, antes mesmo da leitura
humana**: o bloco de conferência roda na MESMA transação do
`create or replace`, então a guarda estar viva já prova que nenhuma linha
do verificador mudou ou sumiu — se tivesse mudado, a transação inteira
teria desfeito, incluindo a troca da função.

E o gate não compara número: compara o CONJUNTO de linhas por documento.
Pega "um documento mudou" mesmo com o total igual, que `20 == 20` não
pegaria.

### Os cinco cenários de competência

```
(1) admin sem filial → loja válida     Romaneio sem vale nenhum.       l.72
(2) admin → uuid que não é loja        Filial inválida para o tenant   l.58
(3) caixa → outra filial               Sem competência sobre a filial  l.67
(4) caixa → a própria filial           Romaneio sem vale nenhum.       l.72
(5) ator inexistente                   Caixa inexistente ou inativo.   l.46
```

**Os números de linha provam a ORDEM**, que nenhum dos cinco pedia
explicitamente: 46 → 58 → 67 → 72. A guarda nova entrou ENTRE as duas
checagens que já existiam, sem passar na frente da verificação de ator.
O caso (5) é o que mostra isso — se ela tivesse subido demais, um ator
inexistente teria dado erro de filial em vez de erro de ator.

Os `errcode` são coerentes: `42501` (insufficient_privilege) nos três de
autorização, `23514` no de vale.

**O (1) é o que o E10 existe pra provar:** admin com `loja_id` NULO opera
numa filial válida do seu tenant. Foi por isso que o `camiloadmin` ficou
sem filial de propósito — o contrato tinha que funcionar sem enfiar
filial artificial no perfil.

**O (4) é o controle negativo do (3).** Sem ele, uma guarda que recusasse
TUDO passaria no (3) e ninguém notaria. Mesma disciplina dos specs de
fiação.

Nenhum documento foi criado: a contagem antes e depois é a mesma, e as
duas checagens disparam antes de qualquer escrita.

#### A verificação independente, antes de aplicar

O script de prova que acompanhava a migration tem o MESMO AUTOR que ela,
e este projeto já sabe que dois gêmeos concordando não provam estar
certos — podem ter copiado o mesmo engano. Foi feito um diff cru das duas
definições, por outro método:

```
+ v_loja_do_ator uuid;
~ a MESMA leitura de perfil, com uma coluna a mais
+ as duas checagens
```

Nada além disso. Nenhum `digest()`, canônico, insert ou `ON CONFLICT`
tocado. Balanço `if`/`end if` de 9 para 11, casado nos dois lados.

### O QUE AINDA NÃO FOI PROVADO

```
◷ offline via Edge/service_role  →  CONTINUA SELANDO
◷ online ponta a ponta pela tela
```

**O primeiro é o mais importante do conjunto, e nenhum SQL o alcança.** A
prova estática mostra que o código não lê `auth.uid()`; só uma saída
offline REAL, sincronizando pela Edge Function como `service_role`,
mostra que ela continua conseguindo selar. Era exatamente aí que a
primeira versão da guarda — com `is_admin()` — teria quebrado tudo em
silêncio, meses depois, sem ninguém ligar o sintoma à guarda.

**E10.1 FECHADO no servidor.** Falta a parte cliente: o snapshot da loja
operacional, a fila, o seletor do cabeçalho e as três telas.

## 93. A linha que o caixa não digitou absorve o resto

Pedido em 2026-09-03, **fora da frente do E10** e antes de ela continuar.
O relato do usuário foi operacional, não de tela: dividindo o pagamento,
ele digitava o valor de uma forma e **calculava a outra de cabeça** — e é
justamente no número quebrado, que é quando a divisão costuma acontecer,
que a subtração custa mais tempo com fila no balcão.

O pedido literal era *mostrar* quanto falta. A justificativa era tempo.
As duas leituras dão trabalhos diferentes, então foram levadas ao
usuário, que escolheu **preencher sozinha** — e nas **duas** telas.

### O que existia, e por que o rodapé não resolvia

```
Total: R$ 100,00 de R$ 137,43 da compra
```

Ele dizia que a soma **não bate**, nunca **quanto** falta. E o
`addForma` piorava o gesto: a primeira linha herdava o valor cheio da
compra pra o caixa TIRAR dela o que a segunda cobrisse — o que obriga a
apagar um campo já preenchido antes de digitar, porque a máscara de
centavos continua da direita (digitar "5" sobre "137,43" dá "1.374,35",
não "0,05").

### A regra, e por que ela não é uma conveniência nova

**A única linha vazia absorve o resto.** Isso **generaliza o que o E4 já
fazia com uma forma só**: lá o valor previsto É o da compra e o campo nem
aparece, porque com uma linha ela está determinada. Com N linhas, as N-1
preenchidas determinam a última do mesmo jeito — e a soma bater com a
compra é regra dura (`validarFormasPrevistas`), não preferência, então o
resto não é palpite da tela.

```
Pix       R$ 100,00   ← digitado
Dinheiro  R$  37,43   ← daqui
```

**Vazio é o sinal, sem estado paralelo.** `digitos` já distingue "ainda
não preenchi" de "é zero" — é o contrato que o `CampoMoeda` sustenta ao
mostrar campo vazio em vez de "0,00". Apagar o campo devolve a linha à
derivação, que é o gesto certo pra "recalcule pra mim".

**É SIMÉTRICO, e isso não é enfeite.** O caixa pode digitar a segunda e
deixar a primeira derivar ("o cliente vai pagar R$ 37,43 em dinheiro").
Se só a última derivasse, ele teria que lembrar qual campo é o livre — o
tipo de regra que não cabe na cabeça de quem está com fila.

**Três exclusões, cada uma por um motivo:**

| caso | comportamento | por quê |
|---|---|---|
| duas ou mais vazias | ninguém deriva | repartir o resto seria a tela inventando uma divisão que ninguém pediu, num campo de dinheiro |
| nenhuma vazia | ninguém deriva | o caixa determinou tudo; ajustar em silêncio um valor digitado é pior que recusar |
| resto ≤ 0 | não deriva, campo fica vazio | R$ 0,00 seria uma linha que a validação recusa em seguida, e negativo é irrepresentável num campo de dígitos |

### O aviso passou a dizer o NÚMERO

E ele cobre inclusive o caso em que a derivação não pode agir — três
linhas com duas vazias —, que era o buraco original:

```
todas vazias    Informe o valor de uma das formas — a outra recebe o restante.
derivando       Total: R$ 137,43 de R$ 137,43 da compra. Dinheiro recebe o restante.
faltando        Total: R$ 30,00 de R$ 137,43 da compra — faltam R$ 107,43
excedendo       Total: R$ 200,00 de R$ 137,43 da compra — R$ 62,57 a mais que a compra
```

O primeiro é o estado logo depois do "+ outra forma", e ele é **neutro,
não vermelho**: nada foi decidido ainda, então cobrar a soma acusaria o
caixa de um erro que ele não cometeu. Ele ensina a regra no instante em
que ela passa a valer.

### As três armadilhas que o desenho teve que desarmar

**1. A tela não pode exibir um número e gravar outro.** `valoresCents` é
a MESMA expressão que monta o campo, o total, o aviso e o payload. A
linha derivada **não tem dígitos** — quem voltasse a ler `linha.digitos`
ali gravaria **zero** justamente na forma que a tela mostrava
preenchida. Duas asserções de fiação existem só pra isso, uma por tela.

**2. O campo derivado seleciona ao focar.** Sem isso a máscara continua a
partir do que já está lá, e digitar por cima de um valor que o caixa não
escolheu empurraria o número em vez de trocá-lo. `selecionaAoFocar` é
prop nova do `CampoMoeda`, usada só onde o valor foi calculado.

**3. Voltar a UMA linha tem que limpar os dígitos.** É o único ponto onde
o invariante poderia se perder: com uma forma só o campo não é
renderizado, então um resto de dígitos seria um valor que o caixa **não
vê e não consegue corrigir** — a soma passaria a não bater e o erro
apareceria no submit apontando pra um campo invisível. Limpar em
`removeForma` é o que sustenta "linha única ⇒ vale a compra inteira" sem
um segundo caso especial dentro da derivação, que é onde ele viraria uma
regra duplicada capaz de discordar da que grava.

**A linha inicial do dialog nasce VAZIA**, e isso é a mesma armadilha
pelo avesso. Ela exibe o valor cheio pela derivação — visualmente
idêntico ao de antes. Se voltasse a nascer com `valor: String(valorCents)`
ela contaria como digitada, e ao adicionar a segunda forma o resto seria
zero: **a derivação existiria e nunca dispararia**, que é a pior forma de
uma regra falhar, porque não produz erro nenhum.

### O que foi medido

```
formas-previstas.spec.mts   TUDO OK   seção (8) nova, 15 casos
                                      seção (9) com 8 asserções de fiação
pagamento-alterado                    TUDO OK
previsto-escritor-unico               TUDO OK
canonico (DCR1)                       TODOS PASSARAM
congelar-retorno                      ok
typecheck / build                     limpos
lint                                  0 erros; 7 avisos, todos em ui/ e auth.tsx
```

**E no navegador, com o banco conferido nos dois caminhos** — porque
dialog fechado não é prova de escrita (a nota de 10/08 vale aqui):

```
V-000061  compra R$ 137,43
  previsto   pix        10000   ← digitado no cadastro
  previsto   dinheiro    3743   ← DERIVADO
  realizado  dinheiro    8000   ← digitado no dialog
  realizado  dinheiro    5743   ← DERIVADO
  status_financeiro = divergente
  evento `pagamento_alterado` com `de` trazendo os DOIS previstos
```

Os cinco estados de tela foram exercitados um a um: derivação normal, o
caso **simétrico** (digitar na segunda e ver a primeira virar R$ 100,00,
com o aviso dizendo "Pix recebe o restante"), três formas com duas vazias
(não deriva, e o aviso entrega os R$ 107,43 que faltam), excedente
(derivada esvazia, aviso em vermelho com os R$ 62,57), e a volta a uma
linha só (campo some, dígitos limpos, rodapé some).

### O que NÃO mudou, e é o que mais importa

**O caminho de uma forma só não tem um passo novo.** Nenhum campo,
nenhuma tecla, a mesma cadeia de Enter, o mesmo orçamento de 25
segundos — o bloco inteiro da divisão continua fora da tela em 29 de
cada 30 entregas. O teste da regra do §90 continua valendo: *"o que muda
pra quem NÃO usa a feature?"* — nada. **O cronômetro não foi rodado de
novo, e pela mesma razão não precisou**: não há passo novo no caminho
medido.

## 94. E12 — Continuidade operacional offline: CONTRATO FECHADO, código não começado

Decidido em 2026-09-03, e **deliberadamente não implementado**: a decisão
do usuário foi registrar agora e **não interromper o E10** por ela. *"É
uma mudança boa demais e central demais para ser feita no meio de outra
frente."*

Nasceu de uma pergunta simples — *"hoje, se cair a net, eu consigo fazer
o fluxo todo?"* — e a resposta levantada contra o código foi **a espinha
dorsal sim, o fluxo inteiro não**.

### O objetivo, na frase do usuário

> Se a filial começou o expediente **preparada**, e a internet cair, ela
> continua atendendo, despachando e recebendo entregas até a conexão
> voltar.

E o argumento operacional que descarta o "deixar como está": se a
internet cair por duas horas numa filial movimentada, **ninguém vai
segurar as entregas**. As pessoas criam um processo paralelo em papel e
WhatsApp e depois tentam reconstruir o sistema — *"é exatamente aí que a
digitalização perde valor"*. É a mesma regra que a regra 7 já enuncia
noutro contexto: proibir tudo não protege, só empurra o registro pra
fora do sistema.

### O que o levantamento achou — três classes, não uma

```
A  só não foi feito    cancelar, documentos, conferência do dia
                       → escrita direta por decisão; vão pra fila com
                         `dependeDeChave`, mecanismo que já existe

B  falta cache         lista de vales, lista de corridas abertas
                       → mesmo padrão do `credenciaisCache` e do
                         `contextosRetorno`, que já vivem no Dexie

C  `numero_vale`       decisão de ARQUITETURA, sem caminho óbvio
```

Só a C impede o fluxo inteiro, e ela **não é resolvível com cache**: o
número vem da sequência do banco e entra no canônico que as duas partes
assinam. Vale que não subiu não tem número, logo não pode constar de um
documento assinado.

### A saída: o TALONÃO — reserva antecipada de numeração

**O vale offline não recebe número provisório. Ele recebe um número REAL,
já consumido do servidor antes da queda.** É essa frase que faz o resto
do desenho desaparecer:

```
não existe DCR1 alternativo
não existe assinatura provisória
não existe trocar o número depois
```

```
Terminal Caixa 02 — Filial 09     reserva V-001840 … V-001869
                                  (já indisponíveis para o banco)
        ↓ a internet cai
cria localmente  V-001840  V-001841  V-001842
        ↓
o motoboy leva o V-001840 — ele JÁ TEM numero_vale definitivo
o DCR1 contém V-001840 e é assinado normalmente
        ↓ a rede volta
o servidor CONFIRMA:  pertence à reserva X
                    + reserva é do tenant/filial/terminal certos
                    + número ainda não foi utilizado
                    → aceita
```

Nada muda no documento depois. A cadeia de custódia atravessa a queda
**sem exceção nova** — que é o motivo de esta opção ter vencido.

**NÚMERO RESERVADO NUNCA VOLTA PARA O POOL.** Reservou 1840–1869 e usou
até 1857? Os demais ficam `não utilizado / reserva encerrada`, e jamais
são redistribuídos. Isso cria buracos — e **buraco explicável e auditável
é muito melhor que reutilização de número.** É literalmente a lógica do
talonário numerado, que é o que a farmácia já usa quando o Trier cai.

### A regra de completude, que é o ganho inesperado

O modelo de auditoria da numeração deixa de ser por contagem e passa a
ser por explicação:

```
número emitido → usado por uma entrega
              OU
número emitido → pertence a reserva → não utilizado / abandonado

qualquer número sem uma dessas duas explicações  →  ANOMALIA
```

**E isto ACRESCENTA auditoria onde não havia nenhuma — não adapta uma
existente.** Levantado contra o código em 2026-09-03, contra uma
afirmação minha imprecisa feita na mesma conversa:

- `verificar_romaneios_selados()` varre `public.romaneios`, **não
  `entregas`**. O método `11 + 3 = 14 = maior emitido` do §57 sempre foi
  sobre a sequência de ROMANEIOS, e foi conferido à mão no NOTAS;
- `entregas_numero_vale_seq` aparece em **dois** lugares no repositório
  inteiro: a migration que a cria e o `corte-pre-v1.sql`. Não há
  conferência de completude de vale em lugar nenhum.

Logo o E12 **não tem verificador de vales a quebrar** — ele constrói o
primeiro. Eu havia dito o contrário antes de ler; fica registrado porque
é a mesma classe de defeito do §92: afirmar estado sem medir.

### Reservar o número não basta — as travas de ENCADEAMENTO

Este é o ponto que o desenho do usuário acrescentou, e sem ele a reserva
resolveria só o primeiro passo:

```
ENTREGA LOCAL   V-001840        uuidv7 A
      ↓ depende de
SAÍDA LOCAL     romaneio/snapshot/hash   uuidv7 B
      ↓ depende de
RETORNO LOCAL                   uuidv7 C

a rede volta →  sincroniza A → B → C
```

Hoje o servidor é o ponto que **confirma cada etapa antes de a seguinte
existir**. Para o expediente continuar, o Dexie precisa representar a
cadeia inteira localmente. `dependeDeChave` já é a base conceitual certa
disso — e foi construído no 2C.3 exatamente para ordenar dependências.

**E o retorno não pode mais depender só de "buscar corridas abertas no
servidor".** Saída local já selada e ainda pendente de sincronização
precisa aparecer **localmente** como corrida passível de retorno.

### O CONTRATO

```
E12 — CONTINUIDADE OPERACIONAL OFFLINE

NUMERAÇÃO
→ reserva antecipada de numero_vale, por terminal
→ pool local no Dexie
→ número reservado NUNCA é reutilizado
→ entrega offline nasce com número DEFINITIVO
→ sobra vira "não utilizado / reserva encerrada"

CADEIA LOCAL
→ vales locais aparecem em Nova Corrida
→ saída local selada aparece como corrida aberta LOCAL
→ retorno pode ser feito contra essa saída
→ dependências entrega → saída → retorno
→ cancelamento/documentos/conferência entram na cadeia quando aplicável

SINCRONIZAÇÃO
→ respeita dependências
→ falha numa etapa SEGURA as dependentes
→ reconciliação depois da rede
→ servidor confirma reserva: tenant/filial/terminal + não utilizado

AUDITORIA
→ verificador passa a compreender reservas e buracos justificados
→ número sem explicação = anomalia

FORA — provisionamento de segurança
→ criar usuário, emitir credencial/cartão, configurar PIN novo
→ continuam exigindo servidor, e isso NÃO é omissão:
  é administração/provisionamento, não continuidade de expediente
→ além disso é impossível por construção: HMAC e bcrypt são do servidor
```

### O E12 REVOGA UMA PREMISSA DO E11 — achado do levantamento

O desenho do E11, conversado em 01/09 e registrado no backlog, diz:

> o vale da fila aparece na lista "Hoje", **marcado e sem número**
> (a sequência é do banco; por isso ele também não pode sair offline)

**Com o talonão, as duas metades dessa frase deixam de ser verdade.** O
vale offline TEM número e PODE sair. Quem construir o E11 antes do E12
precisa marcar o vale por *"aguardando sincronização"*, nunca por
*"sem número"* — senão a marca vira mentira no dia em que o E12 entrar,
e ela estará espalhada por uma lista que o caixa lê o dia inteiro.

A outra metade do E11 sobrevive intacta, e por razão própria: o
Fechamento **se declara incompleto** em vez de somar a fila local, porque
merge criaria duas versões dos números do dia.

### A ordem, e por que o E12 não entra no meio do E10

```
E10  admin operando por filial   ← EM CURSO, não interromper
E11  visibilidade do offline     ← já sabendo do E12 (ver acima)
E12  continuidade operacional offline
```

O usuário foi explícito nas duas coisas: **não** enfiar isso dentro do
E10, e **não** tratá-lo como uma melhoria pequena do E11. São frentes de
tamanhos diferentes — o E11 torna visível o offline que já existe; o E12
elimina as travas de encadeamento.

E fica anotado o enquadramento comercial que o usuário levantou, porque
ele descreve melhor o que o sistema passa a ter: não é *"possui modo
offline"*, é **continuidade operacional durante indisponibilidade de
internet, preservando número do vale, assinatura, cadeia de custódia e
sincronização posterior.**

## 95. Sessão 1 da limpeza — a geolocalização saiu

Primeira das três sessões de remoção decididas em 2026-09-03/04. O
usuário revisou o escopo do sistema e cortou cinco coisas; esta é a mais
isolada, e foi feita primeiro **de propósito: para provar o processo de
remoção sem mover baseline nenhum**.

### O argumento que a encerrou

> O que a coordenada prova? Que a selagem aconteceu na farmácia — que é
> onde ela sempre acontece, por desenho. Não rastreia entrega, não prova
> nada sobre a rua.

Custava permissão de navegador, timeout de 8s, lógica de cache, cinco
modos de falha e um spec inteiro, para valor operacional próximo de zero.

### O ACHADO QUE MUDOU A PREMISSA DA SESSÃO

Eu havia afirmado, no levantamento, que a geolocalização **não entrava em
hash nenhum**. Estava errado, e o erro tem endereço: verifiquei
`canonico.ts` e `canonicoRetorno.ts` — onde de fato ela não entra — e
generalizei para "hash nenhum".

Ela entra em `calcularOfflineEventHash` (`src/lib/envelope.ts`), que é
**um dos gêmeos**: TypeScript aqui, TypeScript na Edge Function
`sync-romaneio`. Mexer nela de um lado só é o modo de falha mais caro do
projeto — a saída offline deixa de sincronizar, sem erro legível.

**A fórmula deu a saída de graça:**

```
cliente        entrada.geolocalizacao === null ? - : JSON.stringify(...)
Edge Function  corpo.geolocalizacao ?? null   →  também -
```

Passando `null` do lado do cliente e omitindo o campo do corpo, **os dois
lados continuam produzindo os mesmos bytes** — sem tocar na fórmula, sem
deploy da Edge Function, sem invalidar os três hashes que
`envelope.spec.mts` congela.

Por isso o campo ficou, com um comentário de doze linhas explicando que é
**vestigial de propósito**. Ele sai junto com o envelope inteiro, na
sessão 3, quando os dois lados caem juntos.

### O escopo real, medido antes de começar

O usuário pediu a medição antes da sessão, com um gate explícito: *"se
precisar mexer em mais de dez arquivos, pare e reveja"*.

```
geolocalização    10 arquivos
assinaturas       23
envelope RSA      22
                  ──
únicos            36   → acima do gate, dividido em 3 sessões
```

E o número assustava mais do que devia, por três razões que só a medição
mostra: as 10 migrations que citam `p_geolocalizacao` **não se editam**
(migration aplicada é histórico — a limpeza do schema é migration nova);
vários specs **morrem inteiros** em vez de serem ajustados; e
`congelar-retorno.spec.mts` e `canonico-retorno.spec.mts` não são tocados
— **o DCRR1 não carrega geolocalização nem assinatura**, só uuid.

### O que foi tocado

```
APAGADOS   src/lib/geolocalizacao.ts        (4 exports)
           scripts/geolocalizacao.spec.mts  (145 linhas)

TELAS      NovaCorrida, RetornoCorrida — aquecimento e captura
COMPONENTE Custodia — a linha "Geolocalização"
PDF        romaneioPdf — rodapé e bloco da assinatura
DADOS      romaneios.ts — 4 tipos de input, 3 de leitura,
                          2 selects, 2 mapeamentos
SCRIPTS    romaneio-de-exemplo + 3 conferidores de console
SPEC       romaneio-pdf — bloco "geolocalização rotulada" e 3 fixtures

INTOCADOS  envelope.ts (o campo vestigial), sync-romaneio,
           todas as migrations, romaneios.geolocalizacao no banco
```

### Medido

```
typecheck            limpo
27 specs             todos verdes
offline-hash         "os dois lados concordam"   ← o gate do gêmeo
envelope             3 hashes congelados idênticos
build                ok
lint                 0 erros
```

**Nenhum hash mudou, e nenhum documento selado foi afetado** — que era a
condição para esta ser a sessão de aquecimento.

Uma armadilha de ferramenta que custou duas tentativas: **os arquivos
estão em CRLF**, então padrões com `
` não casam. Quem for fazer as
sessões 2 e 3 com substituição em massa: use `
?
` em regex, ou
compare pelo texto sem a quebra.

### VERIFICADO NO NAVEGADOR, com o banco por trás

Feito depois do commit, quando o usuário logou. As quatro superfícies,
contra dado real:

```
Nova Corrida        abre, lista os vales, console limpo
Retorno de Corrida  abre, lista as corridas abertas, console limpo
Custódia (V-000036) rótulos: Hash final · Autenticação · IP · Hash
                    · Credencial       — SEM Geolocalização
PDF do R-000005     Hash final ✓  IP da selagem ✓  "renderização" ✓
                    Local da selagem ✗   coordenadas ✗   17 kB
```

**O `R-000005` é o caso que prova, e foi escolhido por isso:** ele tem
`{lat: -30.335…, lon: -54.312…, precisao_m: 198}` GRAVADO na coluna
`romaneios.geolocalizacao`. O dado continua no banco e não vaza mais
para tela nenhuma — que é exatamente o resultado desejado, já que o SQL
não foi tocado.

**E o aquecimento foi MEDIDO, não inspecionado.** `getCurrentPosition` e
`permissions.query` foram instrumentados no navegador, e as duas telas
montadas em seguida:

```
getCurrentPosition   0 chamadas
permissions.query    0 chamadas
```

Antes da remoção, o `useEffect` de cada uma chamava
`aquecerGeolocalizacao()` ao montar. Zero é a medição de que ele sumiu —
não a leitura de que o import saiu.

Uma armadilha de ferramenta, para quem repetir isto: extrair texto de PDF
do jsPDF no navegador exige **cortar o EOL de padding antes do
`endstream`**. Sem isso o `DecompressionStream` recusa todos os streams
e o resultado é um falso "não achei nada" — que, numa asserção de
AUSÊNCIA, passaria por sucesso. O equivalente no spec é o `inflateSync`
de `romaneio-pdf.spec.mts`.

## Commits desta sessão



1. `503dbf9` — fix do bug do Dialog (item 2 acima)
2. `7c08653` — fila offline completa + cadastros + receita/documentos/
   notificações (itens 1, 3, 4 acima)
3. `06e36a0` — seta de vales por motoboy nos relatórios (início do item 5)
4. `2169e7f` — hierarquia agência→motoboy nos relatórios + Registro de
   Auditoria (fim do item 5 + item 6)
5. `6ab8dd8` — dois relógios em corridas/pagamentos/eventos + RLS de
   eventos restrita (itens 7 e 8 acima)
6. `5a6e1d7` — NOTAS.md com a continuação de 2026-08-10
7. `01eb28b` — gaps da auditoria: RLS por loja, paginação do relatório,
   observacoes, custódia (item 9 acima)
8. `69e3c06` — histórico paginado + filtro de filial (item 10 acima)
9. `d72231f` — NOTAS.md com auditoria e paginação
10. `ca07dfd` — aba "Hoje" paginada + `Paginacao` extraído (item 11)
11. `f09fda4` — máscara de moeda + remoção do `toCents` (item 12)
12. `71a3a8a` — alinhamento do campo de moeda à esquerda
13. `87f66ed` — max-rows e `saida_em` (item 13)
14. `354ca8e` — painel de usuários (item 14)
15. `fd98f64` — CLAUDE.md e NOTAS.md com o painel de usuários
16. `6c37428` — medição do teste dos 25 segundos (item 15)
17. `3630fcc` — correção do baseline do papel + tarifa fixa
18. `ac2fd9f` — tarifa, quantidade de vales e quem paga (item 16)
19. `9752912` — cancelamento de vale (item 17)
20. `353498f` — "Vales cancelados" como bloco próprio
21. `516b6a7` — eixo financeiro no caso da divergência (item 18)
22. `5686be2` — aba Fechamento + fluxo da conferência (item 19)
23. `77efa59` — NOTAS.md com o eixo financeiro e o Fechamento
24. repositório remoto + notas de segredo (item 20) — último commit
    desta sessão, hash pelo `git log`

Do 24 em diante os commits estão em `origin/main` — antes disso, tudo
existia só nesta máquina.

Sessão de 2026-08-11:

25. guarda do cancelamento nos três acumuladores do relatório (item 21)
26. transferência com valor de entrega + lista sem rolagem horizontal
    (item 22)

Sessão de 2026-08-12:

27. visibilidade por filial: gerente preso à própria loja (item 23)
28. layout dos vales: selo, data em duas linhas, "Registrado por" (item 24)
29. polimento de gestão: conferência, documentos, termos, pop-ups (item 25)

Sessões de 2026-08-12 e 2026-08-13 (itens 26 a 30) e de 2026-08-16
(item 29 na parte de PDF/Drive, itens 31 e 32):

30. `e550cfe` — centraliza as colunas da lista
31. `82388e2` — Cliente à esquerda, resto centralizado
32. `1c27a7b` — alinhamento pelo topo + coluna "Usuário"
33. `f2312a1` — largura fixa da coluna Cliente
34. `b8ca7a8` — reordena os botões do painel
35. `7f13586` — selo de transferência na coluna Cliente
36. `7cba864` — corrige a direção da transferência
37. `a0b9a4d` — aba própria das transferências
38. `f5e3117` — Filtrar/Limpar junto do período no histórico
39. `e20cbb4` — notificar documento/receita que não voltou
40. `c29fb21` — exportação do acerto em .xlsx
41. `63d988c` — planilha adaptativa ao número de agências, com cor
42. `8bd4efe` — cidade amarrando filial e agência
Os de 43 em diante são de 16/08:

43. `e51e190` — PDF do acerto + envio ao Google Drive
44. `4eda537` — fecha o registro dos itens 26 a 31 no NOTAS e CLAUDE
45. `e642e96` — autorização do Drive antes de gerar os arquivos (item 32)
46. `cd024c9` — registra o item 32 no NOTAS e CLAUDE

Do 30 em diante os commits foram feitos pelo usuário no terminal: o
classificador do modo automático bloqueou `git commit`/`push` a partir de
certo ponto da sessão.

### Sessão de 2026-08-19 e 20 — Drive, desenho do retorno e a etapa 2A

Vinte e quatro commits, todos já em `origin/main`. Em ordem:

    6b66079  logo de documento nos PDFs + a faixa da marca (item 57)
    931e645  romaneio no Drive, com sangria no Fechamento (item 57)
    eceb770  .gitignore do AGENTS.md

    3ac4e11  fecha o DESENHO do Romaneio de Retorno, antes do código (58)
    ad4d109  etapa 1 — schema do retorno, aplicado e conferido
    2fb42ff  etapa 2A vira GATE: verificar antes de mudar

    2378b45  verificador de hash + baseline 9 · 9 · 0        (2A, 1 e 2)
    2338d6a  congela o DCRR1
    e755224  golden vectors, escritos à mão antes de tudo    (2A, 3)
    da1b2af  vetores de rejeição, e o defeito que acharam no V007
    234d938  canônico do retorno em TypeScript, 60/60        (2A, 4)
    7de63d7  canônico do retorno em SQL                      (2A, 5)
    eaffd62  conferência do gêmeo SQL numa consulta só
    907f6da  corrige o gerador: só o 1º ramo do union é select
    88d44c1  gêmeo SQL conferido no banco: 36 de 36
    4fe2473  teste de transporte: mesmo objeto gera canônico e payload
    86972b4  cobertura deixa de depender do tamanho do romaneio
    d2bd3eb  escolhe o romaneio com mais vales
    079153e  documento multi-vale atravessa o fio; script re-colável
    89f2e69  transporte provado: 5 cenários, 3 vales          (2A, 6)
    92b584c  papel_no_momento no INSERT da saída              (2A, 7)
    f5b458f  baseline intacto: 9 · 9 · 0                      (2A, 8 e 9)
    6eb7f5e  etapa 2A FECHADA: R-000013, verificador 10·10·0  (2A, 10)
    c057def  quatro defeitos de tela que o R-000013 expôs     (item 60)

Repare na densidade de commits de correção do próprio ferramental
(`eaffd62`, `907f6da`, `86972b4`, `d2bd3eb`, `079153e`): cinco dos vinte
e quatro são consertos em SCRIPT DE TESTE, não em código de produção.
Cada um apareceu porque o usuário mandou o resultado COMPLETO em vez de
"passou" — e três deles eram cobertura que eu tinha declarado sem ter.

## Migrations aplicadas nesta sessão

**Última aplicada: `20260826120000_pagamento_alterado_todos_previstos.sql`**
(E3.B, 2026-08-26). Quinta definição de
`selar_romaneio_retorno_interno`, obtida por patch da quarta — o evento
`pagamento_alterado` deixou de escolher UM previsto com `limit 1` e
passou a agregar todos, com ordem total.

**Verificador: `16 · 16 · 0` antes e `16 · 16 · 0` depois.** O gate era
`antes == depois`, e ele fechou.

7. `20260809190000_eventos_idempotency_key.sql`
8. `20260809210000_receita_custodia.sql` (`tem_receita`,
   `receita_recebida_em`, `receita_recebida_por` em `entregas`)
9. `20260809220000_eventos_user_fk.sql` (FK `eventos.user_id` →
   `profiles.id`)
10. `20260809230000_corrida_retorno_dois_relogios.sql`
    (`retorno_em_local` + trigger)
11. `20260809230100_eventos_select_restrita.sql` (RLS de `eventos`)
12. `20260810120000_pagamentos_dois_relogios.sql`
    (`registrado_em_local`)
13. `20260810120100_eventos_dois_relogios.sql` (`ocorrido_em_local` +
    backfill em `fn_log_entrega`)
14. `20260810140000_rls_pagamentos_assinaturas_por_loja.sql` (helpers
    `pode_ver_entrega`/`pode_ver_corrida` + 4 policies reescritas)
15. `20260810150000_custodia_dois_relogios.sql`
    (`documento_recebido_em_local`, `receita_recebida_em_local` +
    trigger `fn_entrega_registrar_custodia`)
16. `20260810160000_corrida_saida_dois_relogios.sql` (trigger
    `fn_corrida_registrar_saida`)
17. `20260810170000_gestao_de_usuarios.sql` (`is_admin()`,
    `profiles.email`, policies de UPDATE separadas + trigger
    `fn_profiles_protege_campos`)
18. `20260810180000_tarifa_e_vales_de_entrega.sql`
    (`lojas.tarifa_entrega_cents`,
    `convenios.farmacia_paga_entrega_integral`,
    `entregas.quantidade_vales`, `entregas.entrega_paga_cliente_cents`)
19. `20260810190000_cancelamento_de_vale.sql` (`cancelado_em_local` +
    trigger `fn_entrega_registrar_cancelamento`)
20. `20260810200000_backfill_status_financeiro.sql` (só dado: marca
    `divergente` quem já tinha `pagamentos.realizado`)
21. `20260810210000_conferencia_so_gerente.sql` (trigger
    `fn_entrega_protege_conferencia`)

Sessão de 2026-08-12 (item 23):

22. `20260812120000_visibilidade_por_filial.sql` (`is_admin()` no escopo
    de `entregas`/`corridas`/helpers/`eventos`, e `with check` espelhando
    o `using` nos UPDATEs)
23. `20260812120100_cadastros_so_admin.sql` (escrita em agências,
    mototaxistas e convênios restrita ao admin, `is_admin()` nos dois
    lados da policy)

As duas foram rodadas **duas vezes** pelo usuário: a primeira versão
deixava o INSERT aberto (ver item 23). Como são `drop policy` +
`create policy`, reaplicar substitui sem resíduo.

Sessões de 2026-08-12 e 2026-08-13:

24. `20260812130000_transferencia_direcao.sql` (renomeia
    `loja_destino_id` → `loja_origem_id`, renomeia o CHECK, e corrige a
    rota dos vales de transferência que ainda não foram assinados — os
    assinados ficam de fora pela trigger de imutabilidade)
25. `20260813120000_cidades.sql` (tabela `cidades` + RLS, `cidade_id` em
    `lojas` e `agencias`, seed de São Gabriel/RS associando o que já
    existia)

Fora migration, um `DELETE` manual no SQL Editor apagando a corrida sem
agência e seus dois vales — exceção consciente à regra 4, ver item 31.

Fora migration: a Edge Function `criar-usuario` foi publicada pelo
usuário via dashboard (Edge Functions → Via Editor). **Não há CLI do
Supabase configurada neste projeto** — mandei o comando `supabase
functions deploy` sem checar isso antes e o usuário acabou colando o
`index.ts` no SQL Editor, que obviamente falhou. Da próxima vez que
aparecer algo pra publicar, o caminho é o dashboard.

Sessão de 2026-08-16 — cadeia de custódia (itens 33 a 38):

26. `20260816120000_autoria_no_servidor.sql` — triggers conferindo
    `auth.uid()` em `saida_por`, `retorno_por`, `cancelado_por`,
    `documento_recebido_por`, `receita_recebida_por`,
    `pagamentos.registrado_por` e `eventos.user_id`, mais `criado_por`
    imutável depois do INSERT
27. `20260816130000_motoboy_credenciais.sql` — tabela da credencial,
    HMAC do token via Vault, bcrypt do PIN, bloqueio progressivo, e as
    funções de emitir/identificar/autenticar/definir/revogar/redefinir
28. `20260816140000_romaneio_de_saida.sql` — `romaneios`,
    `romaneio_entregas`, `motoboy_autorizacoes`, canônico + hash,
    `selar_romaneio` transacional, imutabilidade alargada
29. `20260816150000_selo_sincronizado.sql` — a porta de sincronização
    (`selar_romaneio_sincronizado`, só `service_role`) e a quebra de
    `autenticar_credencial` em duas
30. `20260816160000_credencial_leitura_para_saida.sql` — leitura das
    credenciais liberada pro tenant, pro cache offline poder existir
31. `20260816170000_pin_custo_bcrypt.sql` — custo 10 → 12
32. `20260816180000_corrige_ordem_da_autorizacao.sql` — a FK que fazia
    nenhum selo funcionar (item 40)
33. `20260817120000_token_numerico_v2.sql` — token v2 numérico, e o
    parser que reconhece os dois formatos (item 43)
34. `20260817130000_token_v3.sql` — token v3 de 22 dígitos, parser com os
    TRÊS formatos (item 47). Aplicada em 2026-08-17 e **conferida no
    banco**: os 7 casos do parser passaram no SQL Editor (v1, v2 e v3
    válidos reconhecidos; token curto, longo, de versão desconhecida e
    com letra no meio recusados), e `pg_proc` confirmou que a nova
    `emitir_credencial` é a que está instalada. (Aqueles casos rodavam em
    `scripts/cartao-pdf.spec.mts`; com o cartão antigo apagado, moraram
    pra `scripts/tokenCartao.spec.mts` — ver item 53.)
35. `20260818120000_token_so_v3.sql` — remove v1 e v2 do parser (item
    53). Aplicada em 2026-08-18 e **conferida nos quatro casos**: o v3
    devolveu `777777`, e v2, v1 e token curto voltaram nulos. A checagem
    de segurança do cabeçalho rodou ANTES e voltou zero linhas — nenhuma
    credencial ativa fora do formato v3, que é o que tornava seguro
    descontinuar os antigos. Credencial nova emitida depois e o token
    funcionou.

**Fora de migration, e obrigatórios:**

- O segredo `credencial_hmac` no Vault (SQL Editor, uma vez só). Sem ele,
  emitir credencial falha — ver item 38 e a seção do CLAUDE.md.
- A Edge Function `sync-romaneio`, publicada pelo dashboard.
- O secret `ROMANEIO_KEYS` da Edge Function, gerado por
  `node scripts/gerar-chaves-offline.mjs`.
- `VITE_ROMANEIO_KEY_ID` e `VITE_ROMANEIO_PUBKEY` no `.env` local — feito,
  é o que faz a saída funcionar aqui. As mesmas variáveis no Cloudflare
  Pages ficam pra quando houver deploy, que **ainda não existe** (ver as
  pendências).

Todas confirmadas rodando pelo usuário. Nenhuma migration pendente ao fim
daquela sessão — a 35 foi a última, aplicada e conferida em 2026-08-18.

### Sessão de 2026-08-19 e 20 — o Romaneio de Retorno

Todas **aplicadas e conferidas no banco** pelo usuário, na ordem:

36. `20260819120000_romaneio_de_retorno_schema.sql` — `romaneios.tipo`,
    `romaneio_saida_id` com CHECK nos dois sentidos,
    `UNIQUE (corrida_id, tipo)`, `tipo_signatario` ampliado com
    `responsavel_loja`, `papel_no_momento`, e a unicidade das assinaturas
    passando de corrida pra DOCUMENTO com dois índices parciais.
    Conferido: o CHECK devolveu UMA linha citando `responsavel_loja` (o
    caminho de falha silenciosa que o `do $$` do arquivo fecha), e os
    dois índices trocaram.
37. `20260819130000_verificador_de_hash.sql` — `verificar_romaneio` e
    `verificar_romaneios_selados`, read-only e `security invoker`.
    Baseline: **9 · 9 · 0**.
38. `20260819140000_canonico_retorno.sql` — `romaneio_retorno_validar` e
    `romaneio_retorno_canonico`, gêmeos de `src/lib/canonicoRetorno.ts`.
    Conferido: **36 de 36** contra os golden vectors.
39. `20260819150000_conferir_canonico_retorno.sql` — diagnóstico
    read-only que devolve canônico, bytes e sha256. Não sela nada.
40. `20260819160000_papel_no_momento_na_saida.sql` — reescreve
    `selar_romaneio_interno` só pra acrescentar a coluna ao INSERT da
    assinatura interna. **A fórmula do hash não muda um byte**, conferido
    por diff antes e por recomputação depois: baseline seguiu 9 · 9 · 0,
    e foi a **10 · 10 · 0** depois do `R-000013`.

Sessão de 2026-08-20 — a 2B e o bloco `d`. Todas **aplicadas e
conferidas no banco** pelo usuário, na ordem:

41. `20260820120000_dcrr1_formas_de_pagamento.sql` — o domínio de `forma`
    do DCRR1 era o do SCHEMA INICIAL, substituído doze dias antes do
    congelamento. Sai `vale`, entram `convcard` e `crediario`. Só
    `romaneio_retorno_validar` muda; o canônico não é tocado. Conferido:
    **43 de 43** contra os golden vectors.
42. `20260820130000_selar_romaneio_retorno.sql` — a etapa 2B. Quatro
    funções: snapshot, conflito, a transação interna e a porta online.
    Recusa é CONFLITO e não exceção, porque quando o retorno chega ali as
    duas partes já assinaram. Conferido pelas recusas contra o
    `R-000014`, e o `42501` na autorização é o resultado mais forte.
43. `20260820140000_verificador_do_retorno.sql` — a 2B.4. Despacho por
    protocolo com fórmulas internas SEPARADAS, coluna `resultado` com
    cinco valores, camada `saida_referenciada` e resumo decomposto por
    tipo. Drop+create em transação, sem cascade, com os atributos
    conferidos por abort. Baseline: **11 · 11 · 0**.
44. `20260820150000_dcrr1_bloco_documentos.sql` — o gêmeo SQL do bloco
    `d`. Conferido: **65 de 65**.
45. `20260820160000_retorno_documentos_esperados.sql` — a metade
    contextual: `documentos_esperados = documentos_declarados` derivado
    das linhas `p` do canônico ASSINADO da saída, mais o
    `status_documental` por recomputação absoluta. Conferido: **8 de 8**.
    **Sem backfill de propósito** — a consulta de levantamento voltou
    zero linhas, porque nenhum vale de crediário foi lançado ainda.

**Atenção pra quem for reescrever `selar_romaneio_retorno_interno`:** ela
já tem **CINCO** definições no repositório — `20260820130000`,
`20260820160000`, `20260820200000` e `20260826120000`. Parta da mais
recente, mesma regra da `selar_romaneio_interno`.

E não reescreva à mão: as duas últimas foram feitas por PATCH via script
(`scripts/patch-selar-retorno-e3b.mts` é o do E3), com o diff conferido
e as invariantes provadas antes de a migration existir. O risco que esse
método evita é específico — mover sem querer uma das quatro expressões
`digest(...)`, que não dá erro nenhum e só aparece meses depois como
romaneio que deixou de verificar.

**Atenção pra quem for reescrever `selar_romaneio_interno` de novo:** há
TRÊS definições dela no repositório agora — a original de
`20260816140000`, a de `20260816180000` (que corrigiu a FK do item 40) e
a de `20260819160000`. Parta SEMPRE da mais recente. Copiar de uma antiga
reintroduz bug corrigido, em silêncio.

Nada fora de migration nesta sessão. Nenhuma migration pendente.

## 96. O escopo pré-V1 revisado, e a auditoria que o antecedeu

Em 2026-09-08 o usuário fechou um escopo revisado
(`docs/escopo-pre-v1-revisado.md`) e mandou **verificar antes se o E10 ainda
era necessário**. As duas coisas se cruzaram, e o cruzamento é o registro.

### A auditoria, e o que ela mediu

A pergunta veio com uma hipótese embutida — se os dados da loja em
documentos históricos vêm de snapshot ou de consulta viva. **Esse não é o
eixo do E10**: "snapshot da loja operacional" no item 91 quer dizer
congelar *qual filial a operação atinge*, não copiar nome e endereço para
dentro do documento. Auditei os dois.

**O que o hash carrega:** o canônico traz `loja<TAB><uuid>` e mais nada da
loja (`canonico.ts:77`). `romaneio_payload` também guarda só `loja_id`
(`20260816140000:340-345`). **Nome, endereço e tarifa não entram em hash
nenhum.**

**O achado que ninguém tinha visto:** `lojaNome` sai de **join vivo**
(`data/romaneios.ts:943`, `r.lojas?.nome`) e alimenta o cabeçalho do PDF
(`romaneioPdf.ts:155`), o campo "Filial" da página (`Romaneio.tsx:305`) e
**o caminho da pasta no Drive** (`Romaneio.tsx:174`,
`SangriaRomaneios.tsx:107`). Renomear uma filial amanhã **muda a
apresentação de documento histórico** e manda um reenvio para outra pasta.
Integridade criptográfica intacta; apresentação não. Virou o passo 3.

**A exceção que já estava certa:** na transferência os nomes das filiais
são snapshot desde a criação (`entregas.ts:243-244`, em `cliente_nome` e
`cliente_endereco`) e entram no canônico — congelados pela trigger da
regra 7. Ali o problema não existe, e não por acaso.

**A reafirmação que baixa o risco do passo 1:** mexer na fórmula do DCR1
**não** quebra os documentos já selados. `verificar_romaneio` faz
`digest(r.canonico)` sobre os bytes **gravados**, e o comentário diz que é
de propósito — recalcular do `entregas` acusaria divergência legítima
quando um vale tivesse sido corrigido (`20260819130000:136-142`).

### A conclusão da auditoria, e por que ela foi revertida no mesmo dia

Classifiquei o E10 como **recomendado, adiável para pós-V1**: nada fica
incorreto sem ele, o piloto é em uma filial, e quem lança no balcão é o
caixa, que tem filial no cadastro.

**A seção 6 do escopo revisado derruba isso**, com um fato que a auditoria
não tinha: a filial **sai do cadastro do administrador**. Com ela
escondida, as três guardas `if (!profile.lojaId)` deixam de ser
inconveniência e impedem o admin de operar. **E10.2+ virou obrigatório.**

Fica registrado porque é um bom exemplo de uma conclusão certa sobre o
código e errada sobre o produto: eu media o repositório, e o que decidia
era uma decisão de interface que ainda não estava nele.

### O passo 0, e por que ele veio antes de qualquer código

O `CLAUDE.md` contradizia o escopo em quatro pontos, e um deles **bloqueava
trabalho**: *portal da agência* estava na lista "Fora — não construir", que
manda parar e perguntar. Uma sessão futura recusaria o passo 6 citando a
própria fonte de verdade.

Alinhado em 08/09, com uma regra de edição: **toda nota nova separa
DECIDIDO de CONSTRUÍDO**, no vocabulário que o arquivo já usava
("desenho fechado, código não começado"). Sem isso, "um vale só" seria lido
como descrição do código — que ainda multiplica tarifa por
`quantidade_vales`.

Corrigido de passagem um erro que já estava lá: o item 11 da "Ordem de
construção" dizia que o Romaneio de Retorno não tinha começado, enquanto a
seção acima dele descreve a 2D feita e três documentos selados.

**Custo a lembrar:** o `CLAUDE.md` está indexado pelo Graphify. Um
`graphify --update` reprocessa ~169 mil tokens — ~~rodar uma vez, depois
que o passo 1 assentar~~ **regra revista em 2026-09-10, ver item 98.**

### A auditoria de limpeza entrou junto, e ela corrige duas premissas

`docs/analise-limpeza-pre-v1.md` é a auditoria do commit `bc7062a` que
antecedeu o escopo revisado (o escopo a chama de "auditoria anterior", e
ela própria abre dizendo que as decisões posteriores a substituem onde
divergirem). Estava fora do repositório; entrou em 08/09.

Ela não é só inventário. **Duas correções que valem antes dos próximos
passos:**

**1. "Os 19 documentos" não são 19 hashes selados.** O baseline versionado
discrimina **13 saídas seladas + 3 saídas em conflito + 3 retornos
selados**. Romaneio em conflito **não tem `final_hash`** — é justamente o
caso que o verificador declara fora do placar. Então a sessão 2 de
assinaturas/hashes lida com **16 documentos com hash**, não 19. E o número
é registro histórico, não censo atual do Supabase.

**2. A v7 do Dexie não limpa duas vezes.** `db.version(7).upgrade(...)`
roda **quando o banco local atravessa aquela atualização**. Um terminal que
já está em v7 **não é limpo de novo** por reabrir o app depois do reset do
Supabase — e aí ele volta com fila e caches apontando para ids que não
existem mais, que é exatamente o cenário que a v7 existe pra impedir. O
corte precisa **fechar as abas e conferir/limpar o estado local de cada
origem e perfil** que participou dos testes. Não presumir que a versão
sozinha migrou os navegadores.

O resto dela — R1–R8, S1–S11, o que não se toca — é material do lote
mecânico, e vale ler antes de qualquer sessão de remoção. Duas coisas dela
já foram absorvidas: o snapshot da filial virou o passo 3, e o adiamento do
E10.2+ que ela recomendava foi revertido pela seção 6 do escopo.

## 97. Passo 1 — um vale sem adicional, e o convênio sem empresa

Construído em 2026-09-10, na branch `feat/e10-admin-filial`. É o passo 1
do escopo revisado **sem a forma "Outro"**, que o usuário separou em passo
próprio: mexer no domínio de `forma` toca as quatro cópias, o CHECK e o
validador SQL, e isso não se mistura com a simplificação da tarifa.

### O que mudou

```
CadastroEntrega.tsx     sai o seletor de 1/2 vales e o select de convênio;
                        valorEntregaCents = tarifa; payload manda 1 / 0 / null
Cadastros.tsx           sai a aba Convênios
ConveniosCadastro.tsx   apagado
data/cadastros.ts       sai o bloco de convênios (~105 linhas)
data/fechamento.ts      sai `pagoEmMaosCents` — total do adicional, e já
                        sem consumidor desde 2026-08-12
formasDePagamento.ts    a razão do `convenio_id` caducou; a regra de forma
                        repetida continua, sustentada pelas outras duas
corte-pre-v1.sql        sai o modelo de semente de convênio e a nota do
                        Minerva
```

A cadeia de Enter ficou `nome → endereço → valor → forma`: **um passo mais
curta** que a cronometrada em 2026-08-10. A linha "Entrega R$ 9,00"
continua na tela, estática — sem ela o vale sairia com a tarifa anexada
sem o caixa ver, e a falha de carregar a tarifa só apareceria no submit.

### O que deliberadamente NÃO mudou

**A subtração `valor_entrega_cents - entrega_paga_cliente_cents`**, nos
três acumuladores de `relatorios.ts` e no `fechamento.ts`. Com a parcela
nova sempre zerada ela parece simplificável, e não é: vale histórico tem
`entrega_paga_cliente_cents` maior que zero, e trocar a conta reescreveria
o acerto do passado.

**O contrato.** `quantidade_vales`, `entrega_paga_cliente_cents` e
`convenio_id` continuam na linha `v` do DCR1 e são mandados
explicitamente no payload com 1, 0 e null. Encurtar a linha só no cliente
é o que a transição proíbe.

### A verificação

- build ok; lint 0 erros e 10 avisos pré-existentes, nenhum novo.
- ~~**26 de 27 specs.** A falha, `consulta-render.spec.mts`, foi provada
  pré-existente~~ — **CONCLUSÃO ERRADA, corrigida no item 98.** O
  `git stash` provou só que o MEU comando falhava igual no HEAD; a spec
  declara `--tsconfig tsconfig.app.json` na linha 1, e eu a rodei sem.
  Com o comando declarado ela passa. O placar certo do passo 1 é **26
  specs passando e 1 geradora de SQL** (`dcrr1-sql`), zero falhas. A
  mensagem do commit `81edc24` repete o engano e fica como está —
  histórico não se reescreve; a correção mora aqui.
- **Três specs precisaram de ajuste, e duas acharam ponta solta real.**
  `fiacao-texto` e `fiacao-estado-de-consulta` listavam
  `ConveniosCadastro.tsx` nominalmente — sem elas a remoção passaria como
  se nada dependesse do arquivo. Na segunda, o inventário cravado foi de
  **18 para 17**, e ficou cravado de propósito: trocá-lo por `.length`
  desligaria a asserção. Na `formas-previstas` saiu a asserção do
  `temConvenio`, porque o que ela protegia deixou de existir — a
  invariante que importa (`status_documental: formas.some(...)`
  concordando com `romaneio_documentos_esperados`) continua asseverada
  duas linhas acima.
- **E2E, com autorização do usuário para gravar**: vale de teste
  **`V-000062`**, lançado com forma Convênio e lido de volta do banco —
  `quantidade_vales = 1`, `entrega_paga_cliente_cents = 0`,
  `convenio_id = null`, `valor_entrega_cents = 900`,
  `status_documental = pendente` (vindo da forma, não do convênio), e o
  previsto `convenio` de R$ 50,00. A fila local zerou, o formulário limpou
  e o foco voltou ao nome. **O vale fica no banco até o corte** (regra 4).

### Três observações de passagem

- **A conta de admin desta máquina tem filial**: aparece como
  `Camilo · Administrador · Matriz`, ao contrário do `camiloadmin` com
  `loja_id` nulo que o item 91 usa como caso de prova. Conferir qual conta
  é o caso de prova antes do passo 2.
- **Com a janela estreita (590px) o cabeçalho se sobrepõe** e o conteúdo
  corta à esquerda. É anterior ao passo 1 e o público é PC de balcão, mas
  ficou visto.
- **Os cliques da ferramenta de navegador falharam duas vezes** no botão
  certo, com a coordenada certa, logo depois de a janela mudar de
  largura. O terceiro chegou como evento confiável e abriu a tela. Foi
  temporização da ferramenta, não defeito do app — anotado para ninguém
  perder tempo procurando bug nisso.

## 98. A falha do `consulta-render` era o executor, e as contas de prova do E10

Registrado em 2026-09-10, antes do passo "Outro" e **sem commit de
código**: nada aqui precisou de correção fora da documentação.

### O diagnóstico

O item 97 afirmou que `consulta-render.spec.mts` falhava "pré-existente,
sem relação". **A conclusão estava errada.** O usuário apontou a
discrepância que a desmontou: na auditoria dele, sobre o `bc7062a`, a
spec **passava**. E o `7950843`, onde eu medi a falha, só mexia em
documentação por cima do `bc7062a` — o código era o mesmo.

A linha 1 da spec declara o comando, e o cabeçalho diz que a flag não é
opcional:

```
npx tsx --tsconfig tsconfig.app.json scripts/consulta-render.spec.mts
```

Sem `--tsconfig`, o esbuild do `tsx` pega o `tsconfig.json` da raiz — que
só tem `references` e nenhum `jsx` — e compila JSX no runtime clássico. O
componente quebra com `React is not defined`. **Eu rodei sem a flag.**

Provado dos dois lados, no código já com o passo 1:

```
com a flag declarada    TUDO OK                saída 0
sem a flag              React is not defined   saída 1
```

Os arquivos envolvidos (`consulta-render.spec.mts`, `Consulta.tsx`,
`estadoDeConsulta.ts`, os três `tsconfig`, `package.json`) são idênticos
entre `bc7062a` e `HEAD`. Descartados, com prova: mudança anterior e
ambiente. **Era o executor.** Nenhuma asserção foi tocada.

**Por que o `git stash` enganou:** ele provou que o MEU comando falhava
igual no HEAD. Isso é uma afirmação sobre o comando, não sobre a spec —
e eu a li como a segunda.

**O placar certo do passo 1:** das 27 specs, só esta declara comando
especial, e uma (`dcrr1-sql`) é **geradora de SQL**, não teste — ela
"passou" no meu laço só porque saiu com código 0. Com os comandos
declarados: **26 specs passando, 1 geradora, zero falhas.**

**O que deixaria isto acontecer de novo:** rodar as specs num laço que
ignora o comando declarado em cada uma. `package.json` não tem script de
teste, e a auditoria do `bc7062a` já recomendava formalizar um executor.
**Não entrou aqui**, por ser mudança própria — fica proposto.

### O Graphify: regra revista pelo usuário

**Não atualizar agora.** Uma atualização só, depois de o "Outro" **e** o
E10 estabilizarem, com os dois arquivos do E10.2
(`src/lib/lojaOperacional.ts`, `src/data/lojaOperacional.tsx`)
incorporados ou descartados e a documentação consolidada. Gastar a
extração agora seria invalidá-la na mudança seguinte.

**Até lá o grafo é referência do `bc7062a`.** Ele ainda contém, por
exemplo, `ConveniosCadastro.tsx` e o seletor de vales. Consumidores se
conferem direto no código.

### As contas de prova do E10, medidas no banco

Só leitura, em 2026-09-10, pelo cliente Supabase da própria página. **O
nome não identifica a conta**: há três "Camilo", e uma conta chamada
"Caixa Editado Pelo Painel" é gerente.

| papel da conta no teste | e-mail | papel | filial | ativo |
|---|---|---|---|---|
| **principal** | `camiloadmin@drogariacidade.invalid` | admin | **nula** | sim |
| **controle** | `camiloadmin0@drogariacidade.invalid` | admin | Matriz | sim |
| — | "Admin Teste", e-mail nulo | admin | Matriz | sim |
| restrição? | `gerentepainel@drogcidade.sg` | gerente | Matriz | sim |
| restrição? | `caixanovo@drogcidade.sg` | gerente | Filial 02 | sim |
| restrição? | "Camilo", e-mail nulo | caixa | Filial 02 | sim |
| — | `debug@drogcidade.sg` | caixa | Matriz | **não** |

- **O principal existe exatamente como o item 91 supõe.** Nada a preparar.
- **O controle é a conta desta máquina** — a que aparece como
  `Camilo · Administrador · Matriz`. **Não mudar a filial dela** para
  montar teste.

**PONTO ABERTO, a decidir antes do passo 2: o caso de restrição não é
testável pela tela atual.** Nenhuma conta de caixa ou gerente está no
domínio do E5. `emailTecnico` **sempre** compõe
`<usuário>@drogariacidade.invalid`, e as contas antigas **não foram
convertidas**, por decisão (item 89, "As contas antigas NÃO foram
convertidas"), com `profiles.email` consistente com o Auth. Digitar o
endereço antigo inteiro compõe `…@drogcidade.sg@drogariacidade.invalid`.
Nada foi criado nem alterado: preparar o cenário é decisão do usuário.

### O aceite do E10, nas palavras do usuário

- **principal** (sem filial): escolhe uma filial e opera nela;
- **controle** (admin com Matriz): escolhe **outra** filial sem perder a
  visão administrativa;
- **restrição** (caixa ou gerente com filial): continua limitado à
  própria loja;
- **o teste essencial da seleção operacional:** uma operação
  **enfileirada na filial A**, seguida da seleção da **filial B** — a
  operação já registrada **continua pertencendo à A**.

## Pendências (nada disso está esquecido, só não teve sessão própria ainda)

A checklist "Dentro" do MVP no CLAUDE.md está 100% marcada agora. Só resta
o que já era classificado como "fora do MVP atual, mas anotado":

- ~~Painel do admin criar/gerenciar usuários~~ — feito no item 14.

Não sobrou nada na lista. O que existe daqui pra frente é escolha, não
dívida.

O teste dos 25 segundos foi cronometrado e passou (item 15). Resta uma
decisão operacional antes de uso real: o que fazer com os dados de teste
acumulados (lista no fim deste arquivo) — o app não deleta, então limpar
é SQL manual, e é decisão de tomar antes de virar a chave, não depois.

### PRÓXIMA SESSÃO: depois do passo 1

> **Esta é a seção atual.** As de baixo são históricas: descrevem como
> "próximo" coisas que já foram feitas.
>
> **Atualizada em 2026-09-10.** Passo 0 **feito** (item 96) e passo 1
> **feito** (item 97): um vale sem adicional e convênio genérico,
> provados de ponta a ponta com o vale de teste `V-000062`.
>
> **ESCOLHIDO em 2026-09-10: "Outro" agora, depois o passo 2**, cada um
> com escopo e commit próprios. O contrato do "Outro", nas palavras do
> usuário:
>
> - sai das opções de **cadastro, divergência e retorno**;
> - validação do **cliente e do servidor** recusa em operações NOVAS;
> - leitura e verificação dos **documentos históricos** preservadas até
>   o corte;
> - **nenhuma** mudança no formato canônico, **nenhuma** conversão de
>   pagamento antigo;
> - `outro` **continua** sendo motivo de insucesso.
>
> Antes dele, o item 98 registrou o diagnóstico do `consulta-render` e as
> contas de prova do E10.
>
> **O E10.2 não foi cancelado — virou o passo 2**, e passou de adiável a
> obrigatório. O detalhe técnico dele continua válido e está logo abaixo;
> só mudou a posição na fila. Dois arquivos dele chegaram a ser escritos
> em 08/09 (`src/lib/lojaOperacional.ts`, `src/data/lojaOperacional.tsx`),
> **não referenciados por nada** — conferir se ainda fazem sentido antes
> de reaproveitar.

#### Estado exato — LIDO DO `git log`, não de memória

```
main                    29e93e1   E5 mergeado
feat/e10-admin-filial   5012e31   E10.1 aplicado e medido
PR #1  MERGED  fd263fa  E3 + E4
PR #2  MERGED  29e93e1  E5
```

A branch tem sete commits e toca cinco arquivos — **nenhum deles de
cliente**:

```
NOTAS.md
.gitignore
scripts/patch-selar-saida-e10.mts
scripts/e10-cenarios-competencia.sql
supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql
```

#### O E10.1 FECHOU. O que falta é cliente.

```
E10.1  servidor    ✓ aplicado · gate antes==depois · 5 cenários medidos
E10.2  cliente     ← AQUI: snapshot da loja operacional + fila
E10.3  seletor no cabeçalho (sessionStorage por auth.uid)
E10.4  as três telas de escrita
```

Detalhe no item 92. O essencial para retomar: a guarda está viva em
`selar_romaneio_interno`, provada por diff independente e medida com
cinco cenários; `admin` com `loja_id` NULO **opera** numa filial válida
do tenant, que é o caso que o `camiloadmin` existe para provar.

**Um item do servidor continua sem prova, e nenhum SQL o alcança:** a
saída offline via `service_role`. Ele fica coberto naturalmente quando o
cliente existir e alguém fizer uma saída offline de verdade — não vale
forçar antes.

**O contrato do cliente está no item 91** e não se rediscute:
`sessionStorage` por `auth.uid` (não `localStorage`); a operação
**congela** a loja ao iniciar e trocar o cabeçalho depois não retargeta
formulário, fila nem corrida; `donoDaFila` **não** é sobrecarregado —
dono e loja operacional são eixos distintos; caixa e gerente não mudam.

#### A LIÇÃO QUE ESTA SEÇÃO CUSTOU — leia antes de escrever estado aqui

**A primeira versão desta seção estava errada.** Ela dizia "o E10 ainda
não alterou código nenhum" e apontava o E10.1 como próximo a escrever.
Ele já estava escrito, no commit `c8afdc5` — feito por outro agente
(ChatGPT), por engano, e por isso invisível para quem só olhasse a
conversa.

Eu compus o handoff a partir do meu modelo do repositório em vez do
repositório, e o modelo estava velho. Fica registrado porque é
exatamente a classe de defeito que esta sessão inteira perseguiu: afirmar
o que não se verificou. **Antes de escrever estado no NOTAS, leia o
`git log`.**

Aconteceu **três vezes na mesma sessão**, sempre igual: afirmei estado do
repositório sem ler o repositório. Disse que o E10 não tinha código
(tinha), que a prova não existia (existia, em
`scripts/patch-selar-saida-e10.mts`), e deixei placeholders num SQL que
mandei rodar dizendo "comece pelo passo 0" — instrução em comentário não
substitui o arquivo se comportar direito.

**Duas regras que saíram disso:**

```
antes de afirmar estado    → git log / ls / grep
antes de mandar SQL        → conferir cada coluna contra o schema
```

A segunda também custou três bugs: `eventos.registrado_em` (é
`ocorrido_em`), `max(uuid)` (não existe) e `jsonb_array_length` sobre o
`de` escalar legado (estoura).

*(o resto deste bloco descreve o estado de antes da aplicação, mantido
como registro:)* a migration foi conferida contra a armadilha do
contrato e passa — lê o perfil de `p_caixa_id`, usa `v_papel`, e os
únicos `auth.uid()`/`is_admin()` no
arquivo estão em comentários explicando por que não podem ser usados.
Nenhum dos gates abaixo foi rodado ainda.

#### O que está fechado, e não se rediscute

```
E1    normalização de texto na entrada        itens 84, 85
E1.1  busca sem acento                        migration aplicada
E2    estados de consulta                     item 86
E3    id próprio do pagamento previsto        item 87
E4    duas formas de pagamento                itens 88 e 90 — E2E aceito
E4.1  o previsto retroativo deixou de existir ce84756
E5    login por usuário                       item 89 — aceite medido
```

**As decisões que continuam valendo, em uma linha cada:**

- **`pagamentos` é 1:N nos DOIS momentos.** Previsto até 3 formas no
  cadastro; realizado até 4 no dialog. A assimetria é deliberada: prever
  e registrar não são a mesma afirmação.
- **`criarEntrega` (e o replay dela) é o ÚNICO escritor de pagamento
  previsto.** O fallback retroativo foi eliminado no E4.1 — ele abria
  corrida com o replay, e `pagamentos` não tem DELETE nem UPDATE, então
  a linha era irremovível. O que o operador informa vai em
  `referencia_informada` no evento, nunca em `de`, que é estado
  persistido.
- **`divergiuDoPrevisto` é gêmeo do SQL** — compara conjuntos de
  `forma|valor`, nunca conta linhas.
- **Login compõe `<username>@drogariacidade.invalid`.** Sem lookup, sem
  RPC que enumere. `normalizarUsername` tem cópia na Edge Function e o
  spec compara os dois corpos.
- **Asserção de fiação lê CÓDIGO, nunca prosa.** Cinco specs usam
  `semComentarios`; uma asserção já passou falsamente por casar com o
  comentário que explicava a remoção.

#### Baseline de integridade — MEDIR DE NOVO

```
última medição   20 verificados · 20 íntegros · 0 divergências
                 (2026-09-01, antes do merge do E5, como ADMIN)
```

**Este número NÃO é o gate.** Ele sobe a cada saída/retorno novo. O gate
é sempre `antes == depois` na mesma medição, e a contagem explicada
contra a sequência (selados + conflitos + buracos de rollback).

**Buracos na sequência são esperados**: `nextval` não faz rollback, então
toda selagem desfeita deixa número sem documento. O §64 apresentava
`selados + conflitos = maior número` como identidade — **não é**, e só
valia naquele dia. O que protege contra documento perdido é o conjunto
não encolher entre duas medições.

Rode SEMPRE como admin: `verificar_integridade_resumo` é
`security invoker` e devolve baseline parcial sem avisar.

#### E10 — o contrato está no item 91. O essencial:

**Metade já existe.** Enxergar/filtrar por filial está pronto em cinco
telas, e a RLS já tem `is_admin() or loja_id = current_loja_id()` no
`with check` do `entregas_insert` — cadastro e transferência **não
precisam de migration**.

**Um único ponto de servidor**, confirmado por dois gates:
`registrar_conflito_romaneio` não é alcançável (revoke, sem grant), e as
portas sincronizadas são `to service_role`. A guarda entra no
**`selar_romaneio_interno`**, que as quatro atravessam.

**A REGRA QUE NÃO PODE SER ESQUECIDA, e que quase quebrou tudo:**

```
o ator é o PARÂMETRO, não a sessão

  p_caixa_id        NUNCA auth.uid()
  v_papel <> 'admin'  NUNCA is_admin()
  v_loja_do_ator      NUNCA current_loja_id()
```

Porque a porta sincronizada é chamada pela Edge Function como
`service_role`, onde **`auth.uid()` é NULL**. `is_admin()` e
`current_loja_id()` leem `auth.uid()` — retornariam nulo e **toda saída
offline passaria a ser recusada**, meses depois, sem ninguém ligar o
sintoma à guarda. É por isso que a função já derivava o tenant do perfil
de `p_caixa_id`.

A guarda aprovada:

```sql
select p.tenant_id, p.papel, p.loja_id
  into v_tenant, v_papel, v_loja_do_ator
  from public.profiles p where p.id = p_caixa_id and p.ativo;

if not exists (select 1 from public.lojas l
                where l.id = p_loja_id and l.tenant_id = v_tenant) then
  raise exception 'Filial inválida para este tenant.'
    using errcode = 'insufficient_privilege';
end if;

if v_papel <> 'admin' and p_loja_id is distinct from v_loja_do_ator then
  raise exception 'Sem competência sobre esta filial.'
    using errcode = 'insufficient_privilege';
end if;
```

Ela **não afrouxa nada hoje** — torna explícito o que a RLS garantia por
acidente. E a prova de tenant é necessária: no caminho de conflito,
`registrar_conflito_romaneio` gravaria uma linha com o tenant do ator e
uma loja alheia.

**Contrato de cliente (item 91):** `sessionStorage` por `auth.uid` (não
`localStorage` — herdar a filial da semana passada lança na errada, e
isso não se reescreve); a operação **congela** a loja ao iniciar e trocar
o cabeçalho depois não retargeta nada; `donoDaFila` não é sobrecarregado
— dono e loja operacional são eixos distintos. Caixa/gerente não mudam.

#### Os gates do E10.1

```
CENÁRIOS DE COMPETÊNCIA
  online, usuário normal              passa/rejeita corretamente
  offline via Edge/service_role       CONTINUA SELANDO
  admin com loja_id NULL              sela para loja válida do tenant
  admin → loja de outro tenant        rejeita
  caixa/gerente → outra filial        rejeita
  caixa/gerente → própria filial      continua funcionando

GATES DE SEMPRE
  os 4 digest() byte a byte idênticos
  canônico antes == canônico depois
  verificador antes == depois, como admin
```

Método: **patch por script**, como no E3.B — extrai a função, aplica a
mudança mínima, imprime o diff e **prova as invariantes antes de o
arquivo da migration existir**. `selar_romaneio_interno` é a função mais
crítica do projeto; reescrevê-la à mão é a forma mais provável de mover
sem querer uma linha de `digest(...)`.

#### A ORDEM ATÉ A PRODUÇÃO — congelada em 2026-09-02

```
E10  admin operando por filial
E11  visibilidade do offline
E12  continuidade operacional offline   ← acrescentado em 03/09, item 94
E6   React Router / páginas dedicadas
E9   endereço estruturado
E7   divergência / regularização
E8   portal da agência + RLS
     ─────────────────────────────
STAGING
teste real em 2+ computadores
corte pré-V1 / Dexie v7 / limpeza
produção
piloto em 1 filial
```

**O staging vem DEPOIS de todas as funções, e isso reverte a decisão do
dia anterior.** Eu tinha sugerido trazê-lo para logo depois do E10, com o
argumento de que o deploy é o único item cujo prazo não depende de mim e
que nada jamais rodou fora do localhost.

O usuário desfez, com um argumento melhor: **o objetivo do staging não é
ver se builda fora do localhost — é provar o produto como multiusuário e
multiperfil.** Subindo antes do E8, dá pra exercitar admin, caixa e
gerente, mas **não a agência** — que é justamente a parte mais delicada,
com RLS própria, visão limitada e interação com operações criadas por
outro papel. Seria um segundo ciclo de staging quase completo depois.

```
código funcional  →  staging como PROVA DO PRODUTO  →  corte  →  produção
```

e não staging como ambiente de desenvolvimento intermediário.

**O que o staging vira, então, é um gate de aceitação real:**

```
PC 1 — admin      escolhe filial · cadastra · acompanha · audita
PC 2 — agência    login próprio · vê só o que a RLS permite
PC 3 — caixa      filial fixa, operação normal

a rede cai num deles  →  opera offline  →  volta  →  sincroniza
                      →  o outro dispositivo recebe o estado
```

O que isso exercita junto, e que **localhost numa máquina só mascara**:
autenticação real em domínio, `service_role` nas Edge Functions, RLS
entre papéis, admin sem `loja_id`, agência, Realtime e cache, IndexedDB
separada por máquina, fila offline, concorrência entre dispositivos.

**A ressalva que sobrevive da decisão antiga:** não deixar a
infraestrutura esquecida até aquele dia. Não precisa subir agora, mas
**mantenha uma checklist de deploy** e **não arquitete nada que dependa
implicitamente de `localhost`**. Os pontos já conhecidos: `VITE_*` são
embutidos no build (exigem rebuild), as origens JavaScript autorizadas
do cliente OAuth do Google precisam da URL do Pages, e `.invalid` no
domínio técnico do login precisa ser aceito pelo Auth do ambiente.

#### Backlog sem contrato

**E11 · visibilidade do que está offline.** Conversado em 01/09, **não
escrito**. O vale registrado sem internet não aparece na lista "Hoje" —
só um badge com a contagem — e o Fechamento não avisa quando há
pendências. O desenho conversado:

- o vale da fila aparece na lista "Hoje", **marcado e sem número**
  (a sequência é do banco; por isso ele também não pode sair offline);
  — ⚠️ **ESTE BULLET FOI REVOGADO PELO E12 em 03/09** (item 94). Com a
  reserva antecipada de numeração, o vale offline TEM número e PODE
  sair. Marque-o por *"aguardando sincronização"*, **nunca** por *"sem
  número"*: a segunda vira mentira no dia do E12, e estará espalhada
  por uma lista que o caixa lê o dia inteiro;
- o Fechamento **se declara incompleto** quando há pendências, em vez de
  somar a fila local — merge criaria duas versões dos números do dia;
- **não** fazer aba separada: o vale mudaria de lugar ao sincronizar.

Restante do roadmap: **E6** React Router · **E7** divergência/
regularização (tabela nova, SQL aprovado antes) · **E8** portal da
agência (a maior — RLS em ~8 tabelas, zero policies hoje) · **E9**
endereço estruturado (não pode obrigar DCR2).

Depois de tudo: corte pré-V1 (`scripts/corte-pre-v1.sql`, nada
executado), Dexie v7, regressão pós-corte.

#### Ambiente

- Node em `C:\Program Files\nodejs`, **fora do PATH**. Prefixe
  `export PATH="/c/Program Files/nodejs:$PATH"`.
- `gh` em `C:\Program Files\GitHub CLI\gh.exe`, **também fora do PATH**.
  Autenticado como `ocamll`.
- **Não rodo SQL nem entro no app** — conferência no banco e login são
  clique do usuário. A tela dá pra exercitar montando o componente
  isolado (§86), e o estado **não sobrevive entre chamadas** do
  `javascript_tool`: faça tudo num script só.
- Specs desta frente: `formas-previstas`, `previsto-escritor-unico`,
  `pagamento-alterado` (E3/E4); `username`, `falha-de-login` (E5);
  `texto`, `fiacao-texto`, `estado-de-consulta`,
  `fiacao-estado-de-consulta` (E1/E2). Gate de custódia: `canonico`,
  `canonico-retorno`, `dcrr1-vetores`, `congelar-retorno`,
  `custodia-do-retorno`, `envelope`, `offline-hash`,
  `despacho-sync-romaneio`, `dependencia-da-fila`, `corridas-bloqueadas`,
  `romaneio-pdf`.
- `consulta-render` é o único que precisa de
  `--tsconfig tsconfig.app.json`.
- **Escrever SQL de memória custou três bugs nesta sessão**
  (`eventos.registrado_em` é `ocorrido_em`; não existe `max(uuid)`;
  `jsonb_array_length` estoura sobre o `de` escalar legado). Confira cada
  coluna contra o schema antes de mandar.
- Bash come crase e barra invertida: para bloco com template literal, use
  `Write`/`Edit`, não heredoc.

### (histórico) A retomada de antes da 2C

> **Esta é a seção atual. A de baixo ("etapa 2B") é histórica** — ficou
> como registro de onde a frente estava antes, e o que ela descreve como
> "próximo" já foi feito.

Fechado em 2026-08-20: **2B, 2B.4 e 2B.5**, todas aplicadas no banco e
medidas. O que resta antes da 2C são duas coisas pequenas e uma
formalidade:

```
2B.5  bloco `d`                              ✓  65/65 e 8/8 no banco
      └─ teste de TRANSPORTE com documentos  ✓ rodou 9/9 — RERODAR (*)

(*) o cenário multi-vale foi reforçado DEPOIS do run verde (uma linha
    `d` não discriminava ordenação — item 66). Espere `d: 2` na última
    linha e `14 linhas no total` no rodapé.

2B.6  repetir os gates                       ← formalidade: já verdes
2C    desenho FECHADO (item 67) — código não começado
2D    tela + caminho feliz real
```

**Os dois gates FECHARAM em 2026-08-20**, rodados pelo usuário no
instrumento certo, depois das migrations do bloco `d`:

```
GATE A   verificar_integridade_resumo(), como ADMIN
         saida     11 · 11 · 0
         retorno    0 ·  0 · 0
         TOTAL     11 · 11 · 0
         conflito   3 · NULL · NULL   (não se aplica, não é zero)
         sequência  11 + 3 = 14 = maior R- emitido   → FECHA

GATE B   transporte, recolado depois do reforço do cenário 8
         9 cenários · 4 critérios · bytesLocal == bytesServidor 9/9
         cenário 8 com d: 2 · rodapé "4 de 9 cenários, 14 linhas"
         692 → 749 = +57 bytes, explicados campo a campo
```

**2B.6 fechada. 2C liberada** — declarado explicitamente pelo usuário.

**A 2C começa por MIGRATION, não por fila** — `selar_romaneio_retorno_sincronizado`,
a porta offline que a 2B deixou anotada num comentário e não construiu.
E a **2C.2 é gate de segurança, não ordenação de fila**: um trigger que
impede o `fechamento_corrida` legado de reescrever desfecho depois de um
DCRR1 selado, venha ele de onde vier. Ler a seção "A 2C" do CLAUDE.md
inteira antes da primeira linha — ela tem três armadilhas medidas, e uma
delas é o item 34 de volta.

**2C.1 APLICADA E CONFERIDA em 2026-08-20** —
`20260820170000_selar_romaneio_retorno_sincronizado.sql` (item 68).
Bloco 1 de `scripts/conferir-2c1-no-sql-editor.sql` passou nas quatro
linhas, sem escrever nada. O bloco 2 continua opcional e **queima número
de romaneio** — não foi rodado.

**2C.2 APLICADA E CONFERIDA em 2026-08-20** —
`20260820180000_fechamento_legado_obsoleto.sql` (item 69), com
`scripts/conferir-2c2-no-sql-editor.sql`. Os dois blocos passaram. O SQLSTATE medido é **`DCRR1`** — é ele que
o handler legado da 2C.8 tem que reconhecer.

**2C.3 FEITA E CONFERIDA (item 70)** — Dexie
v5 com backfill de `chave` e a self-dependency desarmada. Os testes A e
B rodaram aqui (`npx tsx scripts/dependencia-da-fila.spec.mts`, 9/9, e a
guarda medida contra o predicado antigo: 3 falham, 6 continuam
passando). E o C rodou no navegador: **11 de 11**.

**2C.4 FEITA E CONFERIDA (item 71)** — 19 de 19 no navegador. —
`romaneio_retorno` na fila, com payload congelado e sem o objeto de
domínio junto. `tsc`, lint e build limpos.

**2C.5 FEITA E CONFERIDA (item 72)** — o contrato criptográfico do
envelope, nos dois lados. `envelope.spec.mts` 18/18, `offline-hash.spec`
continua com os gêmeos concordando, e os TRÊS hashes de antes do
refactor intactos. tsc, lint e build limpos.

**A Edge Function precisa ser REPUBLICADA** (dashboard → Edge Functions
→ sync-romaneio → Deploy) pra o `resolverTipoDoRomaneio` valer no ar.
Sem isso o servidor segue na versão anterior, que trataria um envelope
de retorno como saída.

**2C.6 FEITA E CONFERIDA (item 73)** — 13 de 13 contra a função no ar,
com o Deploy confirmado pelo caso (4).

~~pendente do teste integrado~~ — despacho por
tipo, conciliação corpo × envelope, e o cliente mandando retorno.
`despacho-sync-romaneio.spec.mts` 33/33, envelope 18/18, offline-hash
com os gêmeos concordando. tsc, lint e build limpos.

**A Edge Function precisa ser republicada DE NOVO** — a versão no ar é a
da 2C.5, que recusa retorno com 501. E o teste que fecha a etapa é o
integrado, porque o spec roda contra o TEXTO da função e não prova qual
versão está publicada.

**2C.7 FEITA (item 74)** — 16/16 no spec, tsc/lint/build limpos.

**2C.8 FEITA (item 75), pendente das regressões de execução** — o handler
legado do SQLSTATE (que FALTAVA), a regra de remoção no CLAUDE.md e o
censo da fila. tsc/lint/build limpos.

Censo rodado: fila local VAZIA. O que falta é execução, e está no placar
do item 75: a
saída offline LEGADA sincronizando de verdade, e o DCRR1 offline real,
que é 2D por construção.

**(RODOU em 2026-08-25 — ver o item 80. `TRANSPORTE PRESERVA — 9
cenários, quatro critérios cada`, com `d: 4 de 9 cenários, 14 linhas`,
sobre o `R-000001` de 3 vales. O parágrafo abaixo é de quando ainda não
tinha rodado.)**

**O teste de transporte está escrito e não foi rodado** — ele exige
login, então é clique seu. Item 66: nove cenários, quatro com bloco `d`,
mais um quarto critério (`payload`) e as contagens `v`/`pr`/`d` na
tabela, pra "rodei e passou" não poder mais esconder "não exercitou".

**Como rodar:** app aberto e logado, F12 → Console, colar
`scripts/conferir-canonico-retorno-no-console.js` inteiro. Não sela nada
(`conferir_canonico_retorno` é read-only), pode rodar sobre produção, e
pode ser colado quantas vezes quiser — está tudo dentro de um bloco.

O que esperar: `TRANSPORTE PRESERVA — 9 cenários, quatro critérios cada`
e a linha `bloco \`d\`: 4 de 9 cenários, 14 linhas no total`. Se a
segunda linha disser `SEM COBERTURA`, alguém perdeu os documentos no
caminho e os quatro critérios não afirmam nada sobre eles. Se `payload`
vier `false` em alguma linha, comece por ela: quer dizer que o canônico
assinado e o payload enviado têm contagens diferentes, e o resto é
consequência.

**E leia o canônico impresso no fim, não só a tabela.** Foi ele que
achou o defeito do próprio cenário 8 no primeiro run — a tabela estava
inteira verde.

Já provado daqui, sem rede: os nove cenários são válidos, saem na ordem
`v → pr → d`, o `d` sai ordenado por (entrega_id, tipo), dois deles
discriminam ordenação (um por eixo), e a guarda foi medida contra o
defeito do item 65 (4 acusam, 5 ficam verdes).

**Dois ramos continuam sem exercício, e não bloqueiam:**

- `documentos_nao_conferem` — exercitável contra dado real, porque
  **1 das 11 saídas seladas espera um convênio**. É a única.
- o caminho do **crediário inteiro** — nenhum vale foi lançado ainda. O
  primeiro que for vendido será o primeiro teste da cadeia toda.
- o `(a) vale faltando` do placar da 2B, que precisa de uma corrida com
  dois vales ou mais.

**Antes de escrever a 2C, releia no CLAUDE.md:** a seção do DCRR1 (o
bloco `d` está congelado lá, com o porquê de cada valor do domínio) e o
item 4 da lista de etapas, que traz a arquitetura do verificador —
orquestrador comum, fórmulas internas SEPARADAS, e nunca "melhorar" a
fórmula da saída dentro dele.

E a armadilha do item 65 vale pra 2C inteira: **`paraJsonbRetorno` é a
única tradução domínio → jsonb do projeto.** Campo novo no vale entra ali
na mesma edição, e o caso `paraJsonbRetorno leva tudo que o canônico
assina` do `canonico-retorno.spec.mts` existe pra pegar quem esquecer.

---

### (histórico) A retomada de antes da 2B

**A etapa 2A FECHOU em 2026-08-20**, os dez itens. O gate está cumprido,
e o que vem agora é a **2B — `selar_romaneio_retorno` transacional**,
destravada. O canônico do retorno já está provado em três camadas:
golden vectors escritos à mão, os dois gêmeos contra eles (TS 60/60, SQL
36/36), e o transporte real (5 cenários). O desenho completo está no
CLAUDE.md, seção "O Romaneio de Retorno". **Comece por lá, não por aqui.**

O que a 2A deixou pronto e a 2B usa:

| | |
|---|---|
| `romaneio_retorno_canonico` / `_validar` | os bytes e as recusas, gêmeos do `canonicoRetorno.ts` |
| `conferir_canonico_retorno` | read-only, pra perguntar "o que o servidor entendeu?" sem selar |
| `verificar_romaneio` / `verificar_romaneios_selados` | o baseline, hoje **10 · 10 · 0** |
| `papel_no_momento` | preenchido na saída desde o `R-000013` |
| `paraJsonbRetorno` | o builder que a TELA tem que usar — canônico e payload do mesmo objeto |
| schema do retorno | `romaneios.tipo`, os dois índices parciais, a FK pra saída |

**O que a 2B tem que fazer**, e está detalhado no CLAUDE.md: uma
transação que valida a saída e o `saida_hash`, confere que cada
`entrega_id` pertence àquele romaneio (não falta nem sobra vale), confere
o motoboy da custódia e o responsável server-side, sela o romaneio de
retorno com as duas assinaturas, grava desfechos e pagamentos, **deriva a
divergência** da comparação previsto × realizado, gera os eventos e fecha
a corrida. Tudo atômico, e `fecharCorrida` sobrevive DENTRO dela, nunca
como ação de usuário.

Duas coisas que a 2A descobriu e que a 2B precisa respeitar:

- **a fórmula da assinatura do retorno NÃO pode ter cast de
  `timestamptz`.** `timestamptz::text` depende do `TimeZone` da sessão, e
  a da saída tem esse problema latente — o verificador só funciona porque
  fixa UTC e porque todas as selagens vieram por PostgREST. Use
  `to_char` com máscara explícita, ou epoch.
- **o lado SQL do canônico já existe e espelha o aninhamento.** A 2B
  chama `romaneio_retorno_canonico`, não reimplementa.

**Pendência de clique do usuário, herdada:** o envio ao Drive do ACERTO
nunca rodou contra o Google depois da correção do item 32. O do romaneio
rodou e funciona; é o mesmo transporte, mas outro fluxo.

O item que talvez surpreenda quem retomar: **a 2A começou por construir
um verificador de hash dos romaneios de SAÍDA**, que não tem nada de retorno
nele. Ele existe porque a 2A também acrescenta `papel_no_momento` ao
INSERT da saída, e sem verificador "não mudou nada" seria leitura de
código, não medição. De quebra fecha um buraco antigo: até aqui o projeto
**gerava** evidência criptográfica sem conseguir **verificá-la**.

O resumo do que ficou decidido, pra dar contexto ao que está lá:

- unicidade das assinaturas passa a ser por **documento**
  (`romaneio_id`), com índice parcial preservando as legadas;
- `romaneios.tipo` (`saida`|`retorno`) + `UNIQUE (corrida_id, tipo)`;
- o retorno **substitui** o fechamento manual — não existirão dois
  caminhos pra encerrar uma corrida;
- cartão + PIN do motoboy **de novo** no retorno, porque são duas
  transferências de custódia em sentidos opostos;
- fluxo excepcional autorizado por `is_gerente()`, **só online**;
- `fechamento_corrida` na fila é **drenado por handler legado**, nunca
  convertido nem descartado.

E o que a conversa descobriu no código, que é o que mais vale:
**o literal do papel do signatário entra no `signature_hash`**
(`v_hash || '|caixa|' || …`). Renomear `caixa` → `responsavel_loja` nas
linhas existentes quebraria a verificação de todo romaneio já selado. Por
isso o CHECK é ampliado, nunca renomeado. Detalhe completo no CLAUDE.md.

**Armadilhas do Drive que continuam valendo** (tudo em
`src/lib/googleDrive.ts` e na seção "Google Drive" do CLAUDE.md), porque o
romaneio de retorno provavelmente vai subir também:

- **Pedir o token é a PRIMEIRA coisa depois do clique**, antes de gerar
  o PDF. Gerar leva centenas de ms e o pop-up deixa de contar como
  resposta ao gesto do usuário — o navegador bloqueia. Isso já quebrou
  uma vez (item 32).
- O script do Google é pré-carregado quando a tela monta (`prepararDrive`).
- Escopo `drive.file`, token só na memória, sem refresh token.
- **Nada disso foi testado no ar**, porque não há deploy. O envio ao
  Drive em produção exige `VITE_GOOGLE_CLIENT_ID` nas variáveis do
  Cloudflare **e** a URL do Pages nas origens autorizadas do cliente
  OAuth — e o deploy inteiro ainda não existe (ver pendências).

### Estado em 2026-08-20

**Onde a frente do Romaneio de Retorno está:**

```
etapa 1  schema                          APLICADO e conferido
etapa 2A gate de integridade e canônico  FECHADA — os dez itens
etapa 2B selar_romaneio_retorno          próxima, destravada
etapa 2C fila offline                    depende da 2B
etapa 2D tela                            depende da 2C
```

O que a 2A deixou pronto e a 2B usa direto:

| | |
|---|---|
| `romaneio_retorno_canonico` / `_validar` | os bytes e as recusas, gêmeos de `src/lib/canonicoRetorno.ts` |
| `conferir_canonico_retorno` | read-only, pra perguntar "o que o servidor entendeu?" sem selar |
| `verificar_romaneio` / `_selados()` | o baseline, hoje **10 · 10 · 0** |
| `paraJsonbRetorno` | o builder que a TELA tem que usar, pra canônico e payload saírem do mesmo objeto |
| `papel_no_momento` | preenchido na saída desde o `R-000013` |

**As três camadas de prova do canônico do retorno**, e cada uma responde
o que a outra não alcança:

    golden vectors escritos à mão   →  o contrato está certo?
    TS 60/60 · SQL 36/36            →  as implementações obedecem?
    transporte real 5/5             →  o fio preserva o que elas concordam?

**Nada disso tem tela ainda.** O retorno continua sendo o
`fecharCorrida` de sempre; nada mudou pra quem opera.

---

A cadeia de custódia da SAÍDA (itens 33 a 57) está construída e
**funcionando online**: saídas reais foram seladas de ponta a ponta —
cartão bipado, PIN conferido pelo servidor, duas assinaturas, tudo
visível pelo chevron do vale. Sete romaneios estão gravados com
`modo = 'online'` (`R-000003`, `05`, `07`, `08`, `11`, `12`, `13`).

*(Até 19/08 esta seção citava o `R-000001` como a prova do online. O
verificador de hash mostrou que ele está gravado como
`offline_sincronizada` — ver a correção no item 42.)*

**E TODOS os romaneios selados verificam criptograficamente.** Baseline
de 2026-08-19: 9 · 9 · 0. Depois do `papel_no_momento` e do `R-000013`:
**10 verificados, 10 válidos, 0 divergências**, 4 camadas cada
(documento, as duas assinaturas, envelope). É a primeira vez na vida do
projeto que esses hashes são recomputados — até aqui ele gerava evidência
sem conseguir conferi-la.

**Como rodar de novo** (como ADMIN, senão a RLS devolve baseline parcial
sem avisar):

    select count(*) as verificados,
           count(*) filter (where divergencias = 0) as validos,
           coalesce(sum(divergencias), 0) as divergencias
      from public.verificar_romaneios_selados();

O número sobe um a cada saída nova. **Qualquer divergência precisa ser
explicada antes de seguir com o que estiver sendo feito** — a coluna
`onde` de `verificar_romaneios_selados()` diz qual camada caiu, e
`verificar_romaneio('<uuid>')` abre o detalhe.

**E o elo físico fechou em 17/08**: cartão v3 impresso em laser sobre
papel comum, bipado no leitor da farmácia, token de 22 dígitos
transcrito exato. Do formato do token à leitura no balcão, nada nessa
corrente é mais suposição. Ver o fecho do item 47 pro que o teste **não**
prova.

**E a saída OFFLINE fechou em 18/08**: `R-000010` selado com
`modo = 'offline_sincronizada'`, vale indo pra `em_rota`. A cadeia está
exercitada nos quatro estados que ela pode assumir — online
(`R-000003`), conflito (`R-000004`), offline bem-sucedida (`R-000010`) —
mais o cartão lido no leitor físico. Ver os itens 48 e 50.

**E o canônico também**, no mesmo dia:
`conferir-canonico-no-console.js` rodou contra dado real e voltou
`iguais: true`, `primeiraDiferenca: -1`, 873 bytes sobre 3 vales. Era o
item de maior risco em aberto — `montarCanonico` (TypeScript) e
`romaneio_canonico` (SQL) produzindo os MESMOS bytes deixou de ser
suposição. Leia a ressalva de cobertura logo abaixo antes de considerar
o assunto encerrado.

**O merge foi feito.** Esta seção dizia até 19/08 que "o trabalho vive na
branch `cadeia-de-custodia`" e que "a `main` continua em `313a3e2`" — não
é mais verdade. A `main` contém toda a `cadeia-de-custodia` (que ficou
parada em `1541c21`) mais o que veio depois: geolocalização, PDF do
romaneio, logo nova, e o envio ao Drive. `origin/main` está igual, ou
seja, tudo empurrado. **Trabalhe na `main`.**

**Tudo que precisava de passo manual no Supabase já foi aplicado:** as
migrations (nove da cadeia de custódia + as cinco de 19 e 20/08, listadas
acima), o segredo `credencial_hmac` no Vault, a Edge Function
`sync-romaneio` (nome dela no dashboard, não `sincronizar-romaneio`) e o
secret `ROMANEIO_KEYS`.

**O Drive funciona de verdade**, testado contra o Google em 19/08: o
romaneio sobe nas duas vias, em
`Romaneios › Filial › AAAA-MM › AAAA-MM-DD › Via da …`, pelo botão da
página ou pela **sangria** no fim do dia (aba Fechamento). O envio do
ACERTO, esse, continua sem ter passado por consentimento OAuth desde a
correção do item 32 — é o mesmo transporte, mas outro fluxo.

#### O que falta, em ordem de risco

- [x] ~~**Rodar `scripts/conferir-canonico-no-console.js`.**~~ **PASSOU**,
      em 2026-08-17: `iguais: true`, `primeiraDiferenca: -1`, 873 bytes
      sobre 3 vales (V-000013, V-000015, V-000016). `montarCanonico` e
      `romaneio_canonico` produzem os mesmos bytes contra dado real — o
      caminho offline deixou de estar apoiado numa suposição.

- [ ] **Repetir o teste do canônico com vale acentuado e com uma
      transferência.** Não é zelo: o script pega os 3 primeiros vales
      pendentes sem corrida, e os que ele pegou eram todos `cliente`, com
      nome em ASCII puro ("Teste Convenio E2E") e `loja_origem_id` nulo.
      Ficaram **sem cobertura cruzada** justamente as duas formas mais
      prováveis de divergir:

      - **acento** — o canônico é texto por linha, e a escolha do formato
        foi feita pra fugir de escape de Unicode; em produção "José" e
        "Conceição" são certeza, e ASCII puro não exercita isso;
      - **transferência** — `tipo = 'transferencia'` com `loja_origem_id`
        preenchido, campo que nos 3 vales saiu `-` nas três linhas.

      O risco é baixo (os dois lados leem a mesma coluna UTF-8, e o lado
      TS recebe a string por JSON, que preserva), mas é exatamente o tipo
      de "baixo risco" que este teste existe pra não ter que assumir.
      Custa lançar um vale de cliente com acento no nome e uma
      transferência, e rodar o script de novo — os dois viram vale
      pendente sem corrida na hora. O que ESTÁ coberto: ordenação, bloco
      separado de pagamentos, e `convenio_id` nos dois estados (V-000013
      tinha, os outros dois não).
- [x] ~~**Saída OFFLINE ponta a ponta.**~~ **FECHADO em 2026-08-18.**
      `R-000010` selado com **`modo = 'offline_sincronizada'`**, 1 vale, e
      `V-000042` indo de `Pendente` → `Em rota`. Confirmado pelo Registro
      de Auditoria, que mostra "sincronizado depois" justamente porque
      `payload.modo` **não** é `'online'`.

      A prova veio em duas rodadas, e as duas eram necessárias: a
      primeira (item 48) provou todo o transporte — envelope RSA,
      `ROMANEIO_KEYS`, par de chaves, gêmeos do `offline_event_hash`,
      fila, JWT — e terminou em conflito por PIN divergente; a segunda
      provou o desfecho, com `selar_romaneio_interno` criando corrida e
      movendo vale por essa via.

      **Só o `modo` distingue**, e é por isso que valia insistir nele:
      uma saída online também "sela e fica em rota", então olhar a tela
      não responderia.

      Com isso a cadeia de custódia está exercitada por inteiro: online
      (`R-000003`), conflito (`R-000004`), offline bem-sucedida
      (`R-000010`), cartão físico lido no leitor da farmácia, e o
      canônico conferido byte a byte contra o SQL.
- [x] ~~**Aplicar a migration `20260817130000_token_v3.sql`.**~~ Aplicada
      e conferida em 2026-08-17: os 7 casos do parser passaram direto no
      banco e `pg_proc` confirmou a `emitir_credencial` nova instalada.
      O app já emite v3 (22 dígitos), e cartão v1/v2 continua válido.
- [x] ~~**Imprimir o cartão e bipar no leitor do balcão.**~~ **PASSOU**,
      em 2026-08-17. Cartão v3 impresso em **laser, papel comum**, e o
      **leitor da farmácia** transcreveu o token exato — não "leu", que
      seria fraco: devolveu os 22 dígitos certos.

      Isso fecha o último elo físico da cadeia de custódia. A partir
      daqui o cartão deixa de ser hipótese: formato do token → largura do
      módulo → impressão → leitura, tudo provado ponta a ponta com
      hardware real.

      **Papel comum era o caso mais DIFÍCIL, não o mais fácil** — ele
      espalha mais tinta que PVC, então a borda da barra fica pior. O
      cartão da gráfica em PVC tende a ler melhor que isto, não pior.

      **O que este teste NÃO prova, e convém não confundir:** que o v3
      era necessário. O v2 talvez passasse igual — ninguém testou. O que
      o v3 comprou foi **margem** (2,24x o piso do leitor contra 1,38x),
      e margem é o que absorve impressora pior, cartão sujo e leitor
      velho lá na frente. A decisão continua defensável mesmo que o v2
      também funcionasse.

      **Continua valendo pra tiragem definitiva:** pedir prova à gráfica
      e bipar a prova antes da tiragem inteira; e se for laminar, testar
      antes e usar **fosco** — brilho reflete e derruba leitor laser.
- [x] ~~Apagar a pasta `.chaves-offline/`~~ — feito em 2026-08-17. A
      chave privada não existe mais nesta máquina; ela vive só no secret
      `ROMANEIO_KEYS` da Edge Function. **Consequência prática:** não há
      mais como recuperá-la daqui. Rotacionar passa a ser gerar um par
      NOVO com `scripts/gerar-chaves-offline.mjs` e acrescentar ao
      secret — mantendo a antiga lá enquanto houver saída offline
      pendente, senão o que foi selado antes da troca não abre mais.
- [ ] **Dispensar o romaneio `R-000002`** na fila offline (botão "Já
      anotei, dispensar"). É um conflito de teste, nascido do bug da FK
      do item 40 — os mesmos vales tentando sair duas vezes.

#### E o que já era pendência antes desta frente

- [ ] **Dados reais das filiais.** Hoje o banco tem Matriz e Filial 02
      fictícias; a farmácia tem 17. Falta a lista com as cidades pra
      montar o SQL (loja e cidade são inserção manual, decisão antiga).
- [ ] **Agência real.** O dado de teste é "Ágil Motos"; em São Gabriel a
      agência é a Gabrielense.
- [ ] **Limpeza dos dados de teste** (lista no fim deste arquivo).
      **Decidido em 2026-08-18 que é o ÚLTIMO passo antes de apresentar** —
      limpar antes significaria recriar massa de teste a cada frente nova.
      Não é esquecimento; é ordem escolhida.
- [ ] **Trocar as senhas de teste no Supabase** — `adminteste@` e
      `caixateste@` com senha `2026`, num Supabase de produção, com o
      histórico do repositório registrando. **Adiado por decisão do
      usuário em 2026-08-18: ficam até o sistema estar finalizado.**
      Continua sendo exposição real; o que mudou é que virou prazo
      escolhido, não pendência esquecida — não precisa ser levantado a
      cada sessão, precisa acontecer antes de virar a chave.
- [ ] **O deploy INTEIRO, que nunca foi feito.** Descoberto em
      2026-08-18, checando se o merge na `main` dispararia build: **não
      existe conta na Cloudflare, nem projeto, nem site no ar.** O
      sistema só rodou em localhost até aqui.

      Isso reordena o que parecia pendência de configuração. Não é "pôr
      três variáveis": é criar conta, criar o projeto do Pages, conectar
      ao repositório e escolher a branch de produção. Só depois vêm as
      cinco variáveis — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
      `VITE_GOOGLE_CLIENT_ID`, `VITE_ROMANEIO_KEY_ID` e
      `VITE_ROMANEIO_PUBKEY` — **com rebuild depois** (o Vite embute no
      build, então adicionar sem rebuildar não muda o site), mais a URL
      do Pages nas origens autorizadas do cliente OAuth do Google.

      Consequência boa: **merge na `main` não dispara nada**, porque não
      há nada conectado. Consequência a lembrar: nada do que foi testado
      aqui foi testado NO AR, e a diferença entre os dois ambientes é
      justamente o que essas variáveis governam.
- [ ] **Testar o envio ao Drive contra o Google de verdade** — o do
      acerto, depois da correção do item 32, e agora também o do romaneio
      (item 57). Nenhum dos dois passou por consentimento OAuth real; o
      que foi provado com dublê é tudo, menos a chamada que sai da
      máquina. É clique de usuário, não dá pra fazer daqui.

Ideia pequena anotada e não feita: **atalho de quinzena** no relatório
(1ª/2ª quinzena ao lado de Hoje/Este mês), já que o pagamento das teles
segue esse ciclo.

**Os 3 buracos que levantei quando o usuário perguntou que ideias
existiam além das obrigatórias estão resolvidos**: cancelamento no item
17, eixo financeiro nos itens 18-19, e o terceiro abaixo.

- [x] ~~**Correção de entrega já assinada.**~~ **Resolvido — vale a regra
      7 do CLAUDE.md como está escrita hoje.** Este item ficou dois dias
      desatualizado e chegou a afirmar que documentação e decisão
      divergiam; não divergem mais.

      Histórico: em 2026-08-11 a decisão foi "vale assinado não recebe
      alteração nenhuma, nem por evento novo"; em 2026-08-16 (item 33) o
      usuário a reviu; em 2026-08-17 ele deu a razão que faltava —
      **vale assinado pelo motoboy não é alterado, ele é selado, como já
      acontece hoje.**

      É essa frase que dissolve a aparente contradição. "Não alterar" e
      "selar" são a mesma coisa dita de dois jeitos: o que a decisão de
      11/08 proibia era **o documento mudar**, não a operação ter onde
      registrar o que mudou depois. Por isso a separação entre *dado
      assinado* e *dado operacional atual* não é brecha na regra — o
      romaneio selado permanece intocado (é o que a trigger de
      imutabilidade garante) e o PDF jamais é regenerado; a correção
      vive ao lado, como evento, apontando pro original.

      As três categorias de correção (cadastral / divergência
      operacional / custódia e financeiro) estão na regra 7. A segunda é
      o que o sistema já faz; a primeira e a terceira continuam **não
      construídas**, e continuam precisando de sessão própria.

## Gaps conhecidos, não resolvidos

- ~~`corridas.retorno_em` não tem par "dois relógios"~~ — resolvido no
  item 7 (2026-08-10).
- ~~RLS de `eventos` tenant-wide~~ — resolvido no item 7 (2026-08-10).
- `eventos.status_alterado` não tem `ocorrido_em_local` — introduzido
  de propósito no item 8 (2026-08-10): a transição pode vir de um
  UPDATE em lote (fechamento de corrida) sem relógio de dispositivo
  confiável por linha. Não dá pra preencher sem inventar valor.
- ~~Aba "Hoje" sem paginação~~ — resolvido no item 11 (2026-08-10).
- ~~`max-rows` deste projeto desconhecido~~ — deixou de importar (item
  11). O número em si continua não conferido (fica no dashboard em
  Settings → API → Max rows) mas nenhuma query depende mais dele.
- ~~Regra 1 vs. `toCents('1.234')`~~ — resolvido no item 12
  (2026-08-10), pela raiz: `toCents` deixou de existir.
- ~~**Relatório por agência não checa cancelamento**~~ — resolvido no item
  21 (2026-08-11). A regra virou o predicado `entraNoDinheiro` em
  `src/data/relatorios.ts`, usado pelos três acumuladores. Liberar
  cancelar vale em rota deixou de ser uma mudança que quebra o acerto da
  agência em silêncio.
- **A aba "Fechamento" não calcula sobra nem falta** — não é bug, é
  limite: o sistema só conhece tele, e venda de balcão (a maior parte do
  caixa) vive no Trier. Está documentado no CLAUDE.md e escrito na
  própria tela. Se um dia entrar o total do Trier, aí dá pra fazer a
  conta; sem esse dado, **não inventar o número**.
- **`status_documental = 'extraviado'` continua sem quem escreva** —
  agora por decisão explícita (item 28): notificar que o papel não voltou
  não encerra a pendência, porque convênio e receita aparecem dias
  depois. O valor segue no schema pro dia em que a decisão mudar.
- **`eventos.status_alterado` não tem `ocorrido_em_local`** — de
  propósito desde o item 8; pode vir de UPDATE em lote sem relógio de
  dispositivo confiável por linha.
- **5 transferências antigas com a rota invertida** (item 27) — já
  assinadas, congeladas pela regra 7. São de teste e somem na limpeza.
- **`npm audit` acusa 2 moderadas em `uuid`** via ExcelJS. Avaliado no
  item 29: não se aplica ao caminho usado (só `v4()`), e o `--force`
  quebraria a API. Não "consertar" sem reler aquilo.

## Nota pra próxima sessão sobre testes de UI no navegador

O clique baseado em coordenada (`computer` tool) ficou pouco confiável
nesta sessão — o screenshot às vezes demorou a ficar disponível ("Browser
pane not displayed") e cliques por `ref` às vezes caíam em cima do overlay
do próprio Dialog aberto ou não registravam em abas Radix. O que funcionou
de forma consistente foi `javascript_tool` disparando `.click()` (funciona
pra a maioria dos botões) ou, quando isso falhava (especialmente Radix
`Tabs`), a sequência completa de eventos de ponteiro
(`pointerdown`+`mousedown`+`pointerup`+`mouseup`+`click`) direto no
elemento. Console de erros também acumula histórico entre reloads na
mesma aba — abrir uma aba nova antes de checar `read_console_messages` dá
sinal mais limpo. Considerar essas abordagens primeiro da próxima vez.

**Atualização 2026-08-10:** nesta máquina o projeto vive dentro do
OneDrive, e o Vite reagiu com rajadas de HMR espúrio (dezenas de
`hot updated` em arquivos não relacionados, provavelmente o OneDrive
tocando timestamps da pasta inteira depois de uma edição) bem no meio
de um teste — o dialog fechou como se tivesse sucesso, mas nada foi
gravado no banco. Fila offline vazia / dialog fechado **não** é prova
de sucesso por si só; depois de qualquer escrita testada, confirmar
direto no banco (dá pra usar o client já autenticado da própria página:
`await (await import('/src/lib/supabase.ts')).supabase.from(...).select(...)`
no `javascript_tool`).

## Coisas úteis pra retomar o trabalho

**Credenciais de teste** — ⚠️ **estas senhas estão num repositório, mesmo
que privado.** Se ainda não foram trocadas no Supabase, trocar (ver item
20 e a seção "Segredo nenhum no repositório" do CLAUDE.md). Depois de
trocar, atualize aqui só o e-mail e guarde a senha nova **fora** do repo.

Admin `adminteste@drogcidade.sg` / senha `2026`.
Caixa `caixateste@drogcidade.sg` / senha `2026` (perfil "Camilo", papel
`caixa`, **Filial 02**) — indispensável pra testar RLS, porque com admin
todo teste de restrição passa por engano (ele enxerga tudo do tenant de
qualquer jeito). Lojas "Matriz" e "Filial 02" (mais 16 filiais reais que
ainda não têm registro no banco — ver seção 6 acima). Agência "Ágil
Motos", motoboys João Silva e Pedro Souza.

**`AGENTS.md` na raiz, sem rastreamento no git.** É uma **cópia do
CLAUDE.md** (910 linhas contra as ~960 atuais), com data de 13/08 às
23:55 — fora de qualquer sessão de trabalho minha naquele dia, cuja
última alteração foi às 10:46. O conteúdo corresponde ao CLAUDE.md como
ele estava no fim daquele dia.

Não fui eu que criei; nunca escrevi nesse arquivo. `AGENTS.md` é a
convenção que **outras ferramentas de IA** usam pra ler instruções de
projeto (o Codex, da OpenAI, entre elas), então o mais provável é que
alguma outra ferramenta rodando nesta pasta tenha gerado a cópia. Não
existe nenhum outro rastro de ferramenta no diretório (só `.claude/`).

Decisão pendente do usuário: colocar no `.gitignore` (se for de uma
ferramenta que ele usa), apagar (é cópia, não tem nada exclusivo), ou
transformar num arquivo curto apontando pro CLAUDE.md. **Como está, é uma
segunda fonte de verdade que já nasceu desatualizada.**

**Cuidado com datas ao escrever aqui:** em 16/08 eu registrei o trabalho
do dia como sendo de 13/08, porque me baseei no contexto da conversa em
vez do relógio. Corrigido depois conferindo `git log --date` e o
`mtime` dos arquivos. Se for datar alguma coisa, conferir na fonte.

**Node.js nesta máquina:** instalado em `C:\Program Files\nodejs`, **não
está no PATH** desta sessão/terminal. `npm`/`node` só funcionam com
caminho completo, ou prefixando `$env:PATH = "C:\Program Files\nodejs;$env:PATH"`
no PowerShell (ou `export PATH="/c/Program Files/nodejs:$PATH"` no Git
Bash). `.claude/launch.json` já usa o caminho completo pro preview
funcionar sem precisar disso.

## Dados de teste que ficaram no banco

O app nunca deleta (regra 4) — todo teste desta sessão está permanentemente
no banco:

- `V-000008` (Transferência Matriz → Filial 02), `V-000009` (Teste
  Regressao Dexie v2) — testes de fila offline.
- `V-000005` ganhou uma corrida real (motoboy João Silva) e foi fechado
  como "Entregue".
- `V-000007` recebeu uma divergência de pagamento de teste (Dinheiro →
  Pix).
- Uma linha em `eventos` com `tipo = 'teste_dedupe_fila_offline'` —
  inserida manualmente (fora do app) só pra validar o índice único de
  `idempotency_key` direto no banco. Inofensiva, aparece no Registro de
  Auditoria com um resumo genérico (tipo desconhecido).
- Agência "Rápido Motos" (desativada de propósito) e motoboy "Carlos
  Teste" associado a ela — testes de Cadastros.
- Convênio "Convênio Teste" (desativado, `exige_assinatura = false`).
- `V-000013` (Teste Convenio E2E) — convênio Prefeitura + receita
  marcados, ambos já marcados como recebidos, com um evento
  `falta_receita` de teste registrado mesmo assim (log de ocorrência não
  trava com o status atual — não é contraditório).
- `V-000014` (Teste Fluxo Rapido) — insucesso motivo "outro" com detalhe
  de teste, gerou evento `insucesso_detalhado`.
- `V-000010`/`V-000011` (Carlos Cliente, Diego Mello) apareceram durante
  os testes sem eu ter criado — provavelmente uso real concorrente (app
  com Realtime ligado). Não investigado, só registrado pra não confundir.
- `V-000015` (Teste Dois Relogios) — testou pagamento previsto +
  divergência (Dinheiro → Pix) com `registrado_em_local`/
  `ocorrido_em_local` preenchidos, confirmado direto no banco.
- `V-000016` (Teste Falta Receita) — testou "Precisa de receita" +
  "Falta de receita" pelo seletor, mesmo tipo de verificação. Depois
  serviu de teste da trigger de custódia: receita marcada como devolvida,
  com `receita_recebida_em_local` (dispositivo) e `receita_recebida_em`
  (servidor) gravados 275ms um do outro.
- `V-000017` (Teste RLS Caixa) — **criado pela conta de caixa**, único
  vale de cliente da Filial 02. É ele que prova o lado permissivo da RLS
  nova (o caixa lê o próprio pagamento); se for apagado algum dia, o
  teste de RLS perde o caso positivo.
- `V-000018` (Teste Realtime Paginado) — criado pelo console durante o
  teste do item 11, pra disparar um evento de Realtime com a lista
  paginada aberta. Entrega comum da Matriz, R$ 15,00.
- `V-000019` (Teste Mascara Moeda) — R$ 1.234,56 de compra e R$ 8,50 de
  entrega, digitados pela máscara nova (item 12). O valor foi escolhido
  de propósito: é exatamente o que o parser antigo erraria se digitado
  como "1.234".
- `V-000020` (Transferência Matriz → Filial 02) — teste de regressão do
  fluxo de transferência depois da máscara (item 12).
- `V-000024` (Transferência Matriz → Filial 02) — teste do item 22, o
  **primeiro vale de transferência com valor** (900, 1 vale). Os outros
  quatro continuam em 0 de propósito, sem backfill: se algum dia alguém
  conferir por que as transferências antigas não somam no acerto, é isso.
- Uma corrida com o relógio 40 min atrasado de propósito (item 13) e um
  vale criado pelo console pra disparar Realtime.

**Usuários de teste criados no item 14** (esses vivem no Auth, não só em
`profiles` — o app não deleta, e desativar só bloqueia):

- `caixanovo@drogcidade.sg` — criado pelo painel como caixa/Matriz,
  depois editado pra "Caixa Editado Pelo Painel", gerente/Filial 02.
  Senha `senha2026`.
- `gerentepainel@drogcidade.sg` — "Gerente Teste Painel", criado pelo
  clique real que validou a chamada única. Senha `senha2026`.
**Dados dos itens 18-19:** os vales do dia 10/08 da Matriz foram
**marcados como conferidos** no teste do fechamento (V-000016, 17, 19,
21, 22, 23). O `V-000015` ficou `divergente` de propósito — é o caso que
prova que conferir não sobrescreve a marca. Se precisar de vale
`na_ordem` pra testar conferência de novo, use um dia diferente ou crie
um novo.

**Dados do item 17:** `V-000018` e `V-000007` foram **cancelados** nos
testes, com motivo gravado. São os dois únicos vales cancelados do banco
— se precisar de um pendente pra testar outra coisa, não use esses.

**Dados do item 16:** `V-000021` (1 vale), `V-000022` (2 vales, cliente
paga metade), `V-000023` (2 vales com Minerva, farmácia paga tudo) — os
três casos da tabela de tarifa. E o **convênio "Minerva"**, criado pela
UI com `farmacia_paga_entrega_integral = true`; é ele que faz o caso 3
existir, então não desative sem saber disso.

- `debug@drogcidade.sg` — **criado por mim depurando** o 403 do
  `functions.invoke`, antes de achar o bug. Deixado **bloqueado**
  (`ativo = false`), então não enxerga nada. Pra sumir de vez tem que
  apagar no dashboard do Supabase (Authentication → Users), porque o app
  não tem e não deveria ter esse botão.

Se quiser começar "limpo" pra operação real, isso teria que ser removido
manualmente via SQL Editor — o app não tem (e não deveria ter) um jeito de
apagar isso pela interface.

**Acrescentado em 12 e 13 de agosto:**

- `V-000024`, `V-000026`, `V-000032`, `V-000033` — transferências de
  teste, as primeiras **com valor** (900) e depois as primeiras com a
  **direção corrigida**.
- `V-000034` — transferência criada no teste da direção nova
  (Matriz pedindo à Filial 02).
- `V-000036` (Teste Notificar Documento) — criado com convênio + receita
  pra testar o "Não voltou"; tem dois eventos de ocorrência associados.
- Alguns vales de cliente criados nos testes de filtro e paginação.
- **Cidade "Alegrete/RS" e agência "Alegretense Tele"** — criadas por mim
  pra provar que uma tele de outra cidade não aparece pra São Gabriel.
  Sem uma segunda cidade essa regra não era testável. **Vale manter até
  você validar o comportamento multi-cidade**; depois disso, some junto.
- Cidade **São Gabriel/RS** e as associações de `cidade_id` vieram do
  seed da migration — essas são dado real e ficam.
- **V-1001 e V-1002 foram APAGADOS** (item 31), junto com a corrida sem
  agência. São os únicos registros que deixaram de existir no projeto.

**Acrescentado em 19 e 20 de agosto:**

- **`R-000011`, `R-000012` e `R-000013`** — saídas seladas nos testes da
  cadeia e da etapa 2A. O `R-000013` é o **único com
  `papel_no_momento` preenchido** (`admin`), e por isso é ele que prova a
  coluna funcionando. Se for apagado algum dia, essa prova some.
- Os romaneios do Drive subiram para a conta Google do usuário, em
  `Drogaria Cidade Entregas - Romaneios`. Os arquivos do PRIMEIRO envio
  ficaram soltos na pasta do dia, antes de existir a subpasta por via —
  o usuário limpou à mão. **O app não apaga nada no Drive**, e não
  deveria: limpeza lá é sempre manual.
- Nenhum dado de teste novo foi criado pela etapa 2A. O canônico do
  retorno e o verificador são funções **puras ou read-only**, e
  `conferir_canonico_retorno` não grava nada — dá pra rodar em cima de
  produção sem consequência.

**Acrescentado em 3 de setembro:**

- **`V-000061` (Teste Divisao)** — o vale do item 93, compra de R$ 137,43
  dividida em Pix R$ 100,00 (digitado) + Dinheiro R$ 37,43 (**derivado
  pela tela**), e depois marcado como divergente com Dinheiro R$ 80,00 +
  R$ 57,43 (o segundo também derivado). É o único vale do banco em que
  **os dois lados do pagamento têm uma linha calculada**, então ele é a
  prova de que o valor derivado chega ao banco nos dois caminhos. Tem um
  evento `pagamento_alterado` cujo `de` traz os dois previstos.

**Pra quando a limpeza acontecer** (é o último passo antes de
apresentar): apagar romaneio selado agora custa mais do que custava. Eles
são o que o `verificar_romaneios_selados()` conta, e o baseline
documentado nesta sessão — `10 · 10 · 0` — deixa de bater. Não é motivo
pra não limpar; é motivo pra **anotar o número novo** depois de limpar,
senão a próxima sessão vai achar que perdeu documento.
