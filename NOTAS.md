# Notas da sessão — 2026-08-09 e 2026-08-10

Registro de trabalho, não é documentação permanente do projeto (isso é o
CLAUDE.md). Decisões duráveis desta sessão já foram incorporadas lá; aqui
fica o que é mais "estado da sessão" — útil pra retomar, mas não é regra.

Sessão longa, várias frentes seguidas. Ordem cronológica abaixo.

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
11. máscara de moeda + remoção do `toCents` (item 12) — último commit
    desta sessão, hash pelo `git log`

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

Todas confirmadas rodando pelo usuário antes dos testes. Nenhuma migration
pendente no momento em que esta sessão terminou.

## Pendências (nada disso está esquecido, só não teve sessão própria ainda)

A checklist "Dentro" do MVP no CLAUDE.md está 100% marcada agora. Só resta
o que já era classificado como "fora do MVP atual, mas anotado":

- [ ] Painel do admin criar/gerenciar usuários — trava é precisar da
      primeira Edge Function do projeto (`service_role` nunca pode rodar
      no navegador). Ver "Ideias futuras" no CLAUDE.md.

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

**Credenciais de teste:** Admin `adminteste@drogcidade.sg` / senha `2026`.
Caixa `caixateste@drogcidade.sg` / senha `2026` (perfil "Camilo", papel
`caixa`, **Filial 02**) — indispensável pra testar RLS, porque com admin
todo teste de restrição passa por engano (ele enxerga tudo do tenant de
qualquer jeito). Lojas "Matriz" e "Filial 02" (mais 15 filiais reais que
ainda não têm registro no banco — ver seção 6 acima). Agência "Ágil
Motos", motoboys João Silva e Pedro Souza.

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

Se quiser começar "limpo" pra operação real, isso teria que ser removido
manualmente via SQL Editor — o app não tem (e não deveria ter) um jeito de
apagar isso pela interface.
