# Notas de trabalho — 2026-08-09 a 2026-08-17

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
exportação em .xlsx e PDF, e envio ao Google Drive. Em 16 e 17/08 entrou a
frente maior de todas — a cadeia de custódia da saída (itens 33 a 47),
que já selou uma saída real de ponta a ponta.

**Se você está retomando, comece por "Estado em 2026-08-17", no fim deste
arquivo.** É lá que está o que falta, em ordem de risco, e o que já foi
aplicado no Supabase.

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
  farmácia real tem 17 filiais (hoje só 2 nos dados de teste). Não criei
  as outras 15 — só confirmei que `useLojas()` já escala sem mudança de
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
admin/gerente enxergam as 17 filiais juntas e num dia movimentado o
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

## Migrations aplicadas nesta sessão

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
    `emitir_credencial` é a que está instalada. São os mesmos casos que
    `scripts/cartao-pdf.spec.mts` roda do lado do TypeScript — é assim
    que se prova que os dois gêmeos concordam, e não pela leitura dos
    dois arquivos.

**Fora de migration, e obrigatórios:**

- O segredo `credencial_hmac` no Vault (SQL Editor, uma vez só). Sem ele,
  emitir credencial falha — ver item 38 e a seção do CLAUDE.md.
- A Edge Function `sync-romaneio`, publicada pelo dashboard.
- O secret `ROMANEIO_KEYS` da Edge Function, gerado por
  `node scripts/gerar-chaves-offline.mjs`.
- `VITE_ROMANEIO_KEY_ID` e `VITE_ROMANEIO_PUBKEY` no `.env` local **e**
  nas variáveis do Cloudflare Pages, com rebuild depois.

Todas confirmadas rodando pelo usuário. Nenhuma migration pendente ao fim
desta sessão.

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

### Estado em 2026-08-17 — leia isto primeiro

A cadeia de custódia (itens 33 a 47) está construída e **funcionando
online**: uma saída real foi selada de ponta a ponta — cartão bipado, PIN
conferido pelo servidor, duas assinaturas, romaneio `R-000001` com as
assinaturas visíveis pelo chevron do vale.

**E o elo físico fechou em 17/08**: cartão v3 impresso em laser sobre
papel comum, bipado no leitor da farmácia, token de 22 dígitos
transcrito exato. Do formato do token à leitura no balcão, nada nessa
corrente é mais suposição. Ver o fecho do item 47 pro que o teste **não**
prova.

**E a saída OFFLINE fechou em 18/08**: `R-000010` selado com
`modo = 'offline_sincronizada'`, vale indo pra `em_rota`. A cadeia está
exercitada nos quatro estados que ela pode assumir — online
(`R-000001`), conflito (`R-000004`), offline bem-sucedida (`R-000010`) —
mais o cartão lido no leitor físico. Ver os itens 48 e 50.

**E o canônico também**, no mesmo dia:
`conferir-canonico-no-console.js` rodou contra dado real e voltou
`iguais: true`, `primeiraDiferenca: -1`, 873 bytes sobre 3 vales. Era o
item de maior risco em aberto — `montarCanonico` (TypeScript) e
`romaneio_canonico` (SQL) produzindo os MESMOS bytes deixou de ser
suposição. Leia a ressalva de cobertura logo abaixo antes de considerar
o assunto encerrado.

O trabalho vive na branch **`cadeia-de-custodia`**, já no GitHub. A
`main` continua em `313a3e2` — o merge é decisão do usuário e ainda não
foi feito.

**Tudo que precisava de passo manual no Supabase já foi aplicado:** as
nove migrations, o segredo `credencial_hmac` no Vault, a Edge Function
`sync-romaneio` (nome dela no dashboard, não `sincronizar-romaneio`) e o
secret `ROMANEIO_KEYS`.

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
      (`R-000001`), conflito (`R-000004`), offline bem-sucedida
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
- [ ] **Trocar as senhas de teste no Supabase** — pendente desde
      2026-08-10 e o único item com risco real esperando. `adminteste@` e
      `caixateste@` com senha `2026`, num Supabase de produção, e o
      histórico do repositório registra isso.
- [ ] **Passos de produção do Drive e do romaneio no Cloudflare Pages**:
      `VITE_GOOGLE_CLIENT_ID`, `VITE_ROMANEIO_KEY_ID` e
      `VITE_ROMANEIO_PUBKEY` nas variáveis, **com rebuild depois** (o
      Vite embute no build), e a URL do Pages nas origens autorizadas do
      Google. Faltando qualquer um, funciona no localhost e falha no ar.
- [ ] **Testar o envio ao Drive depois da correção do item 32.**

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
qualquer jeito). Lojas "Matriz" e "Filial 02" (mais 15 filiais reais que
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
