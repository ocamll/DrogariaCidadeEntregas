# Sistema de Tele-entrega — Farmácia

## O que é

Sistema complementar ao ERP **Trier** para registro de tele-entregas de farmácia.
Substitui dois formulários manuscritos que o caixa preenche hoje a cada entrega.

**Não** substitui o Trier. **Não** emite documento fiscal. **Não** toca no banco do Trier.

Usuário principal: operador de caixa, PC Windows com Chrome, com fila de cliente
esperando no balcão. Velocidade de digitação é o requisito número um.

Usuário secundário: mototaxista, que só encosta num tablet para assinar.

A farmácia real tem **17 filiais** (hoje só 2 existem como dado de teste:
Matriz e Filial 02) — o sistema já suporta múltiplas lojas de ponta a
ponta (entregas escopadas por `loja_id`, transferência entre filiais,
relatórios e Registro de Auditoria filtráveis por filial). Só a
**criação** de loja nova continua manual via SQL, decisão consciente
(filial é rara; usuário, que tem rotatividade, já se cria pelo app — ver
"Gestão de usuários" abaixo) — não confundir isso com "não suporta
multi-loja".

---

## Stack

Lista fechada. Não instalar dependência nova sem perguntar.

- Vite + React + TypeScript
- Tailwind + shadcn/ui
- TanStack Query (server state) + Dexie (fila offline em IndexedDB, +
  `dexie-react-hooks` pro `useLiveQuery` — pacote oficial da Dexie, não é lib nova)
- `signature_pad` (captura de assinatura)
- `exceljs` (exportação do acerto em .xlsx — aprovado em 2026-08-13).
  Escolhido no lugar do SheetJS porque o pacote `xlsx` está descontinuado
  no npm e a versão que o npm ainda serve (0.18.5) carrega o
  CVE-2023-30533. O `npm audit` acusa um aviso moderado em `uuid`,
  dependência transitiva: **não se aplica aqui** — é sobre `v3/v5/v6`
  recebendo buffer, e o ExcelJS só chama `v4()`. `audit fix --force`
  rebaixaria pra 3.4.0, quebrando a API. **Importado dinamicamente**: são
  ~930 kB que só descem quando alguém clica em exportar (confirmado no
  build, chunk separado).
- `jspdf` + `jspdf-autotable` (PDF do acerto — aprovados em 2026-08-16).
  Também **importados dinamicamente**, em chunk próprio. A instalação
  trouxe uma vulnerabilidade **alta** em `nanoid`, resolvida com
  `npm audit fix` (não-quebrante) — não confundir com o aviso do `uuid`
  acima, que é outro e não se aplica.
- `bwip-js` (código de barras Code 128 do cartão do motoboy — aprovado em
  2026-08-16). **Zero dependências transitivas** e **importado
  dinamicamente**: são ~930 kB que só descem quando um admin abre a tela
  de emitir credencial, mesma disciplina do exceljs e do jspdf. Só a
  **impressão** precisa dele — ler o cartão não precisa de nada, porque o
  leitor age como teclado.
- Supabase: Postgres + Auth + Storage + Realtime + RLS + **duas** Edge
  Functions (`criar-usuario` e `sync-romaneio`) e um conjunto de RPCs
  `SECURITY DEFINER` — ver "Onde roda código no servidor" abaixo
- Deploy: Cloudflare Pages — **planejado, nunca feito**. Confirmado em
  2026-08-18: não existe conta, projeto nem site no ar. O sistema só
  rodou em localhost até hoje. Isso muda o significado de "produção" em
  todo o resto deste arquivo: onde se lê "em produção", entenda "quando
  houver produção".
- Repositório: `github.com/ocamll/DrogariaCidadeEntregas` — **privado**, branch
  `main`. Até 2026-08-10 o projeto só existia nesta máquina (dentro do
  OneDrive), sem remote nenhum.

---

## Regras invioláveis

Não são preferências. Violar qualquer uma é bug.

1. **Dinheiro em centavos, inteiro.** Nunca float, nunca `numeric`, nunca `Number`
   com decimal. Todo campo monetário termina em `_cents` e é `integer`. Conversão
   para real acontece só na camada de exibição. Fechamento com R$ 0,03 de diferença
   destrói a confiança no sistema inteiro.

2. **`tenant_id` em toda tabela.** Mesmo com uma farmácia só. Sem exceção.

3. **RLS habilitada em toda tabela nova.** Nenhuma tabela sai sem política.
   Frontend esconde botão; RLS impede query. Nunca confiar em filtro no cliente.

4. **Nunca deletar entrega.** Cancelamento é `status_entrega = 'cancelada'` com
   motivo, autor e horário. `DELETE` em `entregas`, `corridas`, `pagamentos`,
   `assinaturas` ou `eventos` é proibido.

5. **UUID gerado no cliente, versão 7.** A chave primária vem do frontend antes do
   envio. É isso que dá idempotência à fila offline: reenvio vira upsert sem efeito,
   não duplicata. Nunca deixar o banco gerar o id de entrega ou corrida.

6. **`eventos` é append-only.** Só `INSERT`. Nunca `UPDATE`, nunca `DELETE`.

7. **Vale em romaneio selado é imutável** em tudo que entrou no documento
   assinado: número do vale, cliente, endereço, valor de compra, valor de
   entrega, quantidade de vales, valor pago em mãos, tipo, filial, filial
   de origem, convênio e corrida. Trigger no banco garante — não tente
   contorná-la. Continua mutável o que descreve o que aconteceu *depois*:
   os três eixos de status, observações, motivo de insucesso e a custódia
   de papel.

   **Dado assinado e dado operacional atual são coisas separadas**
   (definido em 2026-08-16, revendo a decisão de 11/08). O documento nunca
   muda; a tela mostra o valor vigente com aviso "corrigido após a saída",
   e o chevron abre o que foi assinado. O PDF do romaneio jamais é
   regenerado com o valor novo.

   **Vale assinado pelo motoboy não é alterado — ele é selado.** Essa é a
   frase que resolve a confusão de quem lê a regra pela primeira vez e
   acha que "imutável" e "aceita correção depois" se contradizem. Não se
   contradizem: o selo é sobre o documento, não sobre a realidade. O que
   está proibido é o documento mudar; o que continua permitido é a
   operação ter onde registrar o que mudou **depois** dele. Proibir as
   duas coisas juntas não protege nada — só empurra a correção pra fora
   do sistema, pro WhatsApp e pra memória de quem estava no balcão.

   O risco que essa separação evita: tratar "o último evento de correção"
   como se o original nunca tivesse existido faria um relatório afirmar
   que o motoboy recebeu um endereço que ele nunca recebeu — e aí a
   auditoria perde o sentido.

   **Correção posterior tem três categorias, com tratamentos diferentes.**
   Antes de construir qualquer uma, pergunte em qual delas o campo cai;
   misturá-las é o erro:

   | categoria | campos | mecanismo |
   |---|---|---|
   | correção cadastral | endereço, complemento, referência, telefone, nome do cliente, observações | evento de correção com motivo e autor |
   | divergência operacional | Pix previsto → Dinheiro realizado, cliente ausente, documento faltante, insucesso | **já existe e funciona** — e não se chama "correção" |
   | custódia e financeiro | motoboy, agência, valor, quantidade de vales, valor da tele, filial, número do vale | **não** vira correção: motoboy errado é cadeia de custódia errada, e a saída é reverter/cancelar a saída ou abrir ocorrência. Valor exige aprovação de gestor |

   A terceira categoria é subsistema próprio, com workflow de aprovação, e
   **ainda não está construída**. A primeira também não. A segunda é o que
   o sistema já faz hoje.

8. **Dois relógios.** Gravar `ocorrido_em_local` (relógio do dispositivo, enviado
   pelo cliente) e `registrado_em` (`now()` do servidor). Nunca usar só um. O PC do
   caixa pode estar 40 minutos errado e a fila offline sincroniza depois.

9. **Não armazenar nome de medicamento, princípio ativo ou qualquer item da compra.**
   Isso é dado sensível de saúde (LGPD art. 11) e está fora do escopo por decisão de
   arquitetura. Se aparecer requisito nesse sentido, **pare e pergunte.**

---

## Modelagem que já está certa — não simplificar

Estas estruturas parecem exageradas para o MVP. São intencionais. A UI da v1 usa uma
fração delas. **Não colapse a tabela porque a tela é simples.**

- **`pagamentos` é tabela separada, não coluna.** O cliente pode pagar em até 3 formas
  na porta, e a forma realizada diverge da prevista em ~1 a 2 de cada 30 entregas.
  A v1 grava um único registro `previsto` e libera um ou mais `realizado` quando
  o caixa marca "divergiu" — inclusive dividido em várias formas (ex: metade pix,
  metade dinheiro), uma linha de `pagamentos` por forma. A cardinalidade é 1:N de
  verdade, não só previsto/realizado.

- **`corridas` existe acima de `entregas`.** O motoboy leva 3 pedidos numa saída e
  assina uma vez. Assinatura pendura na corrida, não na entrega. Corrida com um
  pedido só é caso particular — o contrário não funciona.

- **Status são três eixos independentes** (`status_entrega`, `status_financeiro`,
  `status_documental`), não um enum linear. Uma entrega pode estar concluída, com
  dinheiro conferido, e com o papel do convênio ainda na rua.

Regra geral: **tabela nova depois custa refactor; coluna nullable depois custa nada.**
Por isso as três tabelas acima nascem completas e colunas de detalhe ficam para v2.

---

## Escopo do MVP

Alvo: 8 a 10 sessões de trabalho. Uma farmácia. Sem cobrança. Sem multi-tenant na UI.

### Dentro

- [x] Login e-mail/senha (3 a 5 usuários)
- [x] Cadastro de entrega: nome, endereço, valor da compra, valor da entrega, forma
      de pagamento — foco automático, Enter navega, **zero mouse**. Número do vale é
      gerado pelo banco (sequência `V-000001...`), o caixa nunca digita nem inventa
      esse número.
- [x] Lista do dia com Realtime (PC ↔ tablet) — assina `postgres_changes` em
      `entregas` e invalida a query; testado com duas abas, entrega criada numa
      aparece na outra sem reload. Ainda só cobre `entregas` — mudança de
      pagamento (divergência) não é Realtime, só atualiza ao reabrir/revalidar.
- [x] Vale de transferência entre filiais — mesmo vale/sequência da entrega de
      cliente (mesma tabela `entregas`, coluna `tipo`: `'cliente'` ou
      `'transferencia'`), mesmo ciclo de status/corrida/assinatura na retirada,
      mas sem cliente real e sem venda (`valor_compra_cents` default 0, nenhum
      `pagamentos` criado). **Tem valor de entrega**, sim — ver "Tarifa de
      entrega e vales". Único campo digitado: a filial que **tem o produto**
      (select); quem opera a tela é a filial que está sem ele — ver "Direção
      da transferência" —, e o resto é automático igual ao vale normal.
- [x] Captura de assinatura no tablet → status `em_rota` — fluxo único (não
      duas telas): escolhe agência de tele → motoboy (filtrado pela agência
      escolhida, via `mototaxistas.agencia_id`) → marca os vales pendentes
      da saída → assina no canvas → confirma. Cria `corridas` (com
      `agencia_id` gravado, pra relatório futuro por agência) +
      `assinaturas` + atualiza as entregas selecionadas de uma vez. Testado
      com assinatura real: trigger de imutabilidade bloqueou corretamente
      uma tentativa de alterar cliente_nome numa entrega já assinada.
- [x] Botão "Finalizar entrega" / fechar corrida — tela "Retorno de
      corrida": lista corridas abertas, entra numa, marca cada vale como
      Entregue ou Insucesso (com motivo obrigatório), confirma → fecha a
      corrida (`status='fechada'`, `retorno_em`, `retorno_por`) e atualiza
      todas as entregas de uma vez. Testado ponta a ponta com um vale
      entregue e outro com insucesso na mesma corrida.
- [x] Marcar divergência de pagamento — menu "⋮" em todo vale de cliente
      (não só nos já divergentes), item "Notificar ocorrência" (nome
      genérico desde que passou a cobrir mais de um tipo — ver bullet de
      receita/notificações abaixo). Aceita **mais de uma forma na
      divergência** (ex: metade pix, metade dinheiro — até 4 linhas, soma
      tem que bater com o valor da compra), grava um `pagamentos.realizado`
      por forma + evento `pagamento_alterado` com justificativa.
      Admin/gerente vê contador no cabeçalho — botão "Notificações" (só o
      aviso do dia, some do ar quando o dia vira) — e aba "Ocorrências"
      (registro permanente — vale, cliente, resumo, justificativa e autor
      de toda ocorrência já marcada, sem limite de data). Sem a aba, a
      justificativa só existia no banco; ninguém em gestão conseguia
      consultar o "porquê" depois do dia acabar.
- [x] Relatórios em tela: dia, período, por agência → por mototaxista →
      vales — aba "Relatórios" (admin/gerente), filtro De/Até (atalhos
      "Hoje"/"Este mês"), resumo geral (vales, cliente vs. transferência,
      valor de compra/entrega, contagem por status) + tabela "Por agência"
      hierárquica em 3 níveis, cada um com sua seta (`ChevronRight`/
      `ChevronDown`): agência (vales, entregues, insucessos, valor de
      entrega) → expande e mostra os motoboys daquela agência com as
      mesmas colunas → cada motoboy expande e mostra a lista de vales
      (vale, cliente, status, valor de entrega, data). Motoboy que rodou
      pra mais de uma agência no período aparece uma vez em cada uma, só
      com os vales daquela agência (chave composta `agência::motoboy` no
      estado de expansão, pra abrir uma instância não abrir a outra por
      engano). Corrida sem agência (caso antigo, de antes do formulário
      exigir escolher a agência primeiro) ganha um grupo próprio
      "(sem agência)" em vez de sumir da soma — assim o total "por
      agência" sempre bate com a soma dos motoboys, motivo original de ter
      criado essa hierarquia (usuário notou a diferença entre os dois
      totais numa sessão anterior). Agregação client-side em duas camadas
      de `Map` (agência → motoboy → vales[]), sem view/RPC nova — volume
      do MVP não justifica ainda. Sem gráfico e sem PDF (ambos na lista
      "Fora"). Testado com "Este mês": expandi os 3 níveis simultaneamente
      em várias combinações (duas agências, o mesmo motoboy em duas
      agências diferentes), cada seta abre/fecha independente das outras,
      números batem em cada nível.
- [x] **Cadastro de agências, mototaxistas, convênios** — aba "Cadastros"
      (admin/gerente), sub-abas pra cada entidade. Tabelas já existiam desde
      o schema inicial (com RLS pronta, escrita restrita a `is_gerente()`) —
      sessão foi só UI + `src/data/cadastros.ts` em cima do que já existia,
      sem migration. Não entra na fila offline (tela de admin, uso
      ocasional, não compete com o teste dos 25 segundos do caixa) — usa
      `useMutation` direto, mesmo padrão que `entregas`/`corridas` usavam
      antes da fila existir. "Remover" é toggle de `ativo` (clicável direto
      na lista, sem abrir o formulário) — nunca `DELETE`, mesmo princípio da
      regra 4. Motoboy sem agência nunca aparece no dropdown filtrado de
      "Nova corrida", por isso agência é obrigatória no formulário de
      motoboy mesmo o schema permitindo null; o formulário busca todas as
      agências (não só ativas) pra um motoboy já associado a uma agência
      desativada continuar editável sem "sumir". Testado de verdade: criei
      agência nova (apareceu no dropdown de Nova corrida), criei motoboy
      associado a ela (apareceu filtrado certo), editei o motoboy, desativei
      a agência (sumiu do dropdown, continuou listada em Cadastros como
      inativa, motoboy associado continuou editável mostrando "(inativa)"),
      criei convênio com o toggle de `exige_assinatura`.
- [x] **Fila offline** (IndexedDB + sync em background + indicador visual) —
      cobre as 5 escritas: cadastro de entrega, transferência entre filiais,
      corrida com assinatura, marcar divergência de pagamento e fechamento
      de corrida. Um único store genérico (`filaOperacoes`, Dexie versão 2,
      com upgrade automático a partir do store antigo `filaEntregas`) com
      `tipo` discriminando o payload; `enfileirarOperacao`/
      `processarFilaOperacoes` em `src/data/filaOffline.ts` despacham pra
      cada função de escrita e invalidam as query keys certas por tipo.
      Cada escrita reenviável pela fila carrega os ids que precisa
      determinísticos (gerados no componente, antes de enfileirar, nunca
      dentro da função de escrita) — é isso que torna reenvio depois de
      falha parcial um no-op, nunca duplicata. `entregas`/`corridas` têm
      policy de UPDATE no RLS, então usam `upsert`; `pagamentos`/
      `assinaturas` não têm (de propósito, pra não permitir alterar
      registro já gravado), então usam `insert` + trata erro `23505`
      (chave duplicada) como sucesso — ver `isDuplicateKeyError` em
      `src/lib/supabase.ts`. `eventos.id` é gerado pelo banco (não dá pra
      usar id determinístico nem upsert sem abrir uma policy de UPDATE, que
      quebraria o append-only da regra 6) — migration
      `20260809190000_eventos_idempotency_key.sql` adiciona
      `idempotency_key uuid` + índice único parcial, e o insert do evento
      de divergência faz um `select` por essa chave antes de inserir.
      Testado de verdade: os 4 fluxos novos, um de cada vez, com
      `navigator.onLine` bloqueado (ficou só no IndexedDB, nada foi pro
      Supabase), religado (sincronizou sozinho, sem duplicata) — e o
      mecanismo de dedupe de `eventos` confirmado direto no banco (segunda
      inserção com a mesma chave voltou `23505`, só uma linha ficou
      gravada). Cadastro de entrega (fluxo já existente) testado de novo
      depois da migração do Dexie pra v2, sem regressão.
- [x] **Receita, documentos pendentes e notificações unificadas** —
      encadeando o cadastro de convênio com a custódia de papel. Cadastro
      de entrega ganhou dois campos fora do fluxo rápido de Enter: select
      de convênio (só aparece se forma de pagamento = "Convênio", grava
      `convenio_id` + `status_documental='pendente'`) e checkbox "Precisa
      de receita" (`tem_receita boolean` — **só existência/custódia do
      papel, nenhum dado de medicamento ou princípio ativo, confirmado com
      o usuário por causa da regra 9**). Enter na forma de pagamento
      continua salvando direto quando não é convênio e o checkbox não foi
      tocado — o teste dos 25s não regrediu. Aba "Documentos" (visível pra
      qualquer usuário, não só gerência — quem recebe o papel de volta é o
      caixa do balcão) lista pendências de convênio e de receita com botão
      de marcar recebido/devolvida **e de "Não voltou"** (ver "Papel que
      não volta"), mutation direta sem fila offline
      (`src/data/documentos.ts`). Retorno de corrida: motivo "outro" do
      insucesso ganhou textarea obrigatória, grava em `entregas.observacoes`
      (coluna que já existia, nunca usada antes) e evento
      `insucesso_detalhado`. "Notificar ocorrência" (menu do vale) virou um
      seletor de duas opções — Divergência de pagamento / Falta de receita
      (a segunda só aparece se o vale tem receita marcada) — a de receita
      entra na fila offline igual a de pagamento (`falta_receita` em
      `TipoOperacaoFila`). Botão do cabeçalho e aba de histórico
      generalizados pra cobrir os 3 tipos de evento
      (`src/data/notificacoes.ts` agrega tudo). Idempotência de eventos
      reaproveita o mesmo padrão de `idempotency_key` + `select`-antes-de-
      inserir, agora extraído pra `src/data/eventos.ts` (usado por
      divergência, falta de receita e insucesso detalhado). Migration
      `20260809210000_receita_custodia.sql` (só 3 colunas nullable/default
      em `entregas`, nada em RLS). Testado de ponta a ponta: entrega criada
      com convênio + receita marcada, apareceu nas duas listas de
      pendência, marquei as duas como recebidas, motivo "outro" com texto
      apareceu em Notificações e na aba Ocorrências, "Falta de receita"
      testada pelo seletor do menu.
- [x] **Log de eventos como Registro de Auditoria** — botão de cabeçalho
      "Registro de auditoria" (`src/components/RegistroAuditoria.tsx`), à
      esquerda de "Notificações", mesmo gate admin/gerente, mas dialog bem
      mais largo (`sm:max-w-4xl`) por causa da tabela com filtros. Mostra
      **os 5 tipos** já gravados em `eventos` — não só os 3 que já tinham
      superfície em "Notificações"/"Ocorrências" (`pagamento_alterado`,
      `falta_receita`, `insucesso_detalhado`), mas também os 2 que o
      trigger `fn_log_entrega` grava sozinho desde o schema inicial e
      nunca tiveram tela nenhuma (`entrega_criada`, `status_alterado`) —
      esse último calcula qual dos 3 eixos de status mudou (entrega/
      financeiro/documental) e mostra "de → para" só do(s) que mudou(ram).
      Tipo desconhecido (ex.: linha de teste manual) cai num fallback
      genérico em vez de quebrar a tela. `src/data/auditoria.ts` é
      propositalmente separado de `notificacoes.ts` (esse é curadoria de 3
      tipos "que precisam de atenção"; auditoria é o cru, os 5) — duplica
      ~15 linhas de texto-por-tipo em vez de compartilhar, pra não mexer
      num arquivo já testado em produção. "Quem realizou" vem sempre de
      `profiles` via join (não do `payload`), o que exigiu migration
      `20260809220000_eventos_user_fk.sql` — `eventos.user_id` nunca teve
      FK antes (por isso o padrão anterior salvava `autor_nome` como
      snapshot no payload); conferido antes de aplicar que nenhum
      `user_id` gravado ficaria órfão (49 eventos, 2 usuários distintos,
      zero órfãos). Filtro De/Até (mesmo padrão de Relatórios) + select de
      filial via `useLojas()` (já escala pra quantas filiais existirem —
      hoje só Matriz/Filial 02 nos dados de teste, mas o combo real da
      farmácia tem 17; não precisou criar as outras agora) — filial
      filtra client-side sobre o período já carregado, sem round-trip
      extra. Query com bug real encontrado e corrigido durante o teste:
      `entregas` tem duas FKs pra `lojas` (`loja_id`, a filial dona do
      vale, e `loja_origem_id`, a que fornece na transferência), então o
      embed `entregas(lojas(nome))` sem hint dá erro de ambiguidade do
      PostgREST (`PGRST201`) — resolvido com
      `lojas!entregas_loja_id_fkey(nome)`. Testado de ponta a ponta: os 5
      tipos aparecendo com resumo correto, autor resolvido nos 2 tipos
      novos (que antes só tinham `user_id` cru), filtro de filial isolando
      corretamente Matriz de Filial 02 (inclusive o vale de transferência
      aparecendo na filial que o criou).
- [x] **Cadeia de custódia da saída (Romaneio)** — entrou em 2026-08-16,
      muito depois da checklist original fechar, por pedido explícito e
      detalhado. Substitui o "escolhe motoboy num dropdown e assina" por:
      cartão físico com código de barras + PIN pessoal do motoboy +
      assinatura do caixa **e** do motoboy + snapshot canônico do que saiu
      + três hashes encadeados (documento → assinaturas → envelope) +
      transação atômica com lock dos vales — **funcionando online e
      offline**, com a saída offline sendo validada e selada só quando a
      rede volta. Seção própria abaixo, porque quase nada disso dá pra
      descobrir lendo o código.
- [x] **Painel de admin criar/gerenciar usuários** — entrou **depois** de a
      checklist original fechar (era "Ideias futuras"), por pedido explícito.
      Sub-aba "Usuários" em Cadastros, só pra `admin`. Cria, edita
      nome/papel/filial e bloqueia/libera acesso. Trouxe a primeira (e
      única) peça de backend do projeto — ver "Gestão de usuários" abaixo,
      que é onde estão as regras que não dá pra descobrir lendo só o código.

### Fora — não construir, não sugerir, não "já que estou aqui"

Onboarding de tenant, tela de cadastro de farmácia, cobrança, subdomínio, portal da
agência, integração com Trier, leitura de QR de NF-e, app nativo,
notificação WhatsApp, tarifário por bairro, dashboard com gráfico, conciliação
de cartão por NSU, encadeamento de hash entre eventos, tela de fechamento
mensal, tela de cadastro de loja/filial/cidade nova
pela UI (continua manual via SQL, filial é rara e cidade mais ainda —
**não confundir com suporte a múltiplas lojas, que já existe** de ponta a
ponta; a farmácia real tem 17 filiais).

**PIN de mototaxista e GPS saíram desta lista em 2026-08-16**, por decisão
explícita do usuário: os dois são peça da cadeia de custódia e estão
construídos (ver "Cadeia de custódia" abaixo). O rodapé do
`schema_inicial.sql` ainda os lista como v2 junto com `assinaturas.cadeia`
e a policy de `'agencia'` — aquele comentário está desatualizado nesses
dois pontos, e os outros dois continuam fora.

**Encadeamento de hash continua fora**, e isso é do próprio texto do
pedido: primeiro o documento se prova sozinho (document → assinaturas →
envelope), e só depois os eventos ganham `prev_hash`. Se um dia entrar,
tem que ser cadeia por escopo (tenant/filial/documento), nunca uma cadeia
global — cadeia global cria concorrência entre filiais sem necessidade.

Se algum destes parecer necessário, **pare e pergunte antes de implementar.**

**Exportação em .xlsx saiu desta lista em 2026-08-13, e PDF e Google
Drive em 2026-08-16**, por decisão explícita do usuário: o acerto com a
agência é pago fora do sistema, e ter que redigitar os números numa
planilha é onde o erro aparece. Os três estão construídos — ver
"Exportação do acerto" abaixo.

### Ideias futuras — fora do MVP atual, mas anotadas pra não esquecer

- **Atalho de quinzena no relatório** (1ª/2ª quinzena ao lado de "Hoje" e
  "Este mês"). O pagamento das teles é quinzenal e hoje as datas são
  digitadas à mão. Anotado em 2026-08-16, não construído.

**Loja e cidade continuam manuais** (SQL), porque filial é rara e cidade
mais ainda — não vale a complexidade de uma tela pra isso. O painel de
usuários, que já esteve nesta lista, foi construído (ver "Gestão de
usuários").

---

## Quem vê o quê — papel e filial

Confirmado com o usuário em 2026-08-12. São **duas perguntas diferentes**,
e confundi-las foi o bug original:

| papel | enxerga | Cadastros |
|---|---|---|
| caixa | só a própria filial | não |
| gerente | só a própria filial | **não** |
| admin | todas as filiais | sim |

- **`is_admin()` governa escopo de filial. `is_gerente()` governa
  capacidade de gestão.** Até 2026-08-12 quem liberava ver outra loja era
  `is_gerente()` — que apesar do nome quer dizer "gerente OU admin" —, e
  por isso gerente e admin enxergavam exatamente a mesma coisa. Hoje
  `is_gerente()` tem **dois** usos, e os dois são "capacidade de gestão no
  turno", nunca "enxergar outra filial":

  | onde | por quê |
  |---|---|
  | trigger `fn_entrega_protege_conferencia` | *poder conferir* não é *enxergar outra filial*. O gerente confere, e alcança só a filial dele porque o UPDATE cai na policy de `entregas` |
  | autorizar **retorno excepcional** (decidido em 2026-08-19, ainda não construído) | destravar um fechamento é operação de turno, e o admin é o dono — não está no balcão de cada filial às 20h |

  **O segundo uso é ampliação deliberada, não deriva.** Está escrito aqui
  para que não pareça descuido quando alguém reler. E ele não se confunde
  com **`redefinir_pin`, que continua exigindo `is_admin()`**: destravar
  um retorno é operação de turno; zerar credencial é ato administrativo.
- **`eventos` é o único que não sai de uma troca de função** — a tabela não
  tem `loja_id`, só `entrega_id`/`corrida_id` (nullable). O escopo do
  gerente passa pela entrega/corrida dona, via `pode_ver_entrega`/
  `pode_ver_corrida`. Caixa continua vendo só os próprios eventos, e o
  `user_id = auth.uid()` vem antes do resto porque é ele que sustenta o
  `select`-antes-de-inserir da idempotência.
- **Numa policy `for all`, `using` governa SELECT/UPDATE/DELETE e
  `with check` governa INSERT** (e a linha nova do UPDATE). Restringir só
  o `using` fecha a edição e **deixa a criação aberta** — foi exatamente
  o que aconteceu na primeira versão desta mudança, herdado da forma da
  policy original. Por isso `is_admin()` aparece nos dois lados em
  Cadastros, e por isso o `with check` de `entregas_update`/
  `corridas_update` repete a regra do `using`: sem isso dá pra pegar um
  vale da própria loja e gravar `loja_id` de outra filial.
- **A leitura de agências, mototaxistas e convênios continua ampla no
  tenant.** Só a escrita é do admin. Fechar a leitura quebraria "Nova
  corrida" e o select de convênio no balcão sem proteger nada: o dado
  sensível (vale, pagamento, assinatura) já está preso por filial.
- **`profiles` continua legível no tenant inteiro** — é o que resolve
  "quem realizou" no Registro de Auditoria e "Registrado por" na lista de
  vales. São nome, papel e filial, não dado operacional.

---

## Fechamento de caixa e o eixo financeiro

`status_financeiro` existiu morto desde o schema inicial — nada no app
escrevia nele. Ganhou uso em 2026-08-10, e os três valores significam:

| valor | quer dizer |
|---|---|
| `na_ordem` | ainda não conferido |
| `divergente` | tem problema, precisa de solução na administração |
| `conferido` | gestor bateu e está ok |

**O fluxo real da farmácia** (não dá pra descobrir lendo código): o
operador marca as divergências que percebeu → o **gestor** confere os
vales → **o dia inteiro sobe pra administração**, conferidos e
divergentes. A diferença é que o gestor *não resolve divergência
sozinho*: a marca `divergente` é o que sinaliza, lá em cima, quais
precisam de ação. Por isso:

- **Conferir NUNCA sobrescreve `divergente`.** Só mexe em `na_ordem`.
  Apagar a marca no fechamento faria o problema chegar na administração
  sem sinalização nenhuma.
- **Cancelado fica de fora da conferência** — não virou venda, não há o
  que conferir.
- **Só gerente/admin marca `conferido`**, garantido pelo trigger
  `fn_entrega_protege_conferencia` e não só pela tela. Não dá pra fazer
  com policy: `entregas` precisa de UPDATE liberado pro caixa (cadastro,
  corrida, retorno, cancelamento) e RLS não restringe coluna — mesma
  limitação de `profiles`. O caixa continua podendo marcar `divergente`,
  que é o papel dele no fluxo.

**A aba "Fechamento" não calcula sobra nem falta, e isso é deliberado.**
O sistema só conhece tele-entrega; venda de balcão é a maior parte do
caixa e vive no Trier. Somar os vales e chamar de "esperado na gaveta"
daria número errado. O que a tela faz é responder *o que, do lado da
tele, explica uma diferença* — que era o que dependia da memória do caixa
na hora de justificar ao financeiro. A seção chama-se **"Ocorrências"** e
hoje mostra três causas: divergência de pagamento, vale cancelado (com
**quem cancelou e por quê** — gestão precisa dos dois) e insucesso. O
vale extra pago em mãos ao motoboy saiu a pedido do usuário em
2026-08-12; o dado continua no banco e em `entrega_paga_cliente_cents`,
só não tem mais superfície aqui.

**Conferir é olhar vale a vale.** A aba lista os vales a conferir com
número, cliente, valor e forma prevista, usando a mesma regra do botão
(nem cancelado, nem divergente) pra que a lista mostre exatamente o que
"Marcar dia como conferido" vai alcançar. Antes existia só a contagem e o
botão — dava pra marcar o dia inteiro sem ter conferido nada, que é o
oposto do que conferência significa.

Se um dia entrar o total do Trier aqui, aí sim dá pra falar em sobra e
falta. Sem esse dado, **não inventar o número.**

---

## Cancelamento de vale

O schema previa isso desde o início (`cancelado_em`, `cancelado_por`,
`motivo_cancelamento`, o CHECK `entrega_cancelada_tem_motivo`) e a regra 4
descreve o fluxo — mas nada no app nunca escreveu o status, então a regra
descrevia um caminho impossível. Implementado em 2026-08-10.

- **Só vale `pendente` cancela.** Depois que entra numa corrida o papel está
  fisicamente com o motoboy, e o desfecho passa a ser insucesso no retorno.
  O `UPDATE` filtra por `status_entrega = 'pendente'` **e confere as linhas
  afetadas**: zero linhas não é erro no PostgREST, então sem essa checagem o
  cancelamento falharia calado quando o vale saísse de pendente entre abrir
  o dialog e confirmar, ou quando ele ainda estivesse na fila offline.
- **Motivo é obrigatório**, na tela e no banco.
- **Não passa pela fila offline** (mutation direta): enfileirar criaria uma
  ordem delicada com a entrega que talvez ainda esteja na própria fila. Na
  prática, sem internet não dá pra cancelar. Se isso incomodar, é revisível.
- **Vale cancelado não soma dinheiro nos relatórios**, mas continua contado
  em "por status" — a soma dos status tem que fechar com o total de vales.
  Se somasse, cancelar inflaria os totais em vez de limpá-los.
- **"Vales cancelados" tem bloco próprio no topo do relatório**, em vermelho
  quando maior que zero: é número que a gerência acompanha (cancelamento
  demais pode ser sinal de treinamento ou de cliente desistindo por demora),
  e no meio da lista "por status" ficava escondido.
- **Cancelado não soma dinheiro em nível nenhum do relatório** — nem no
  total geral, nem no acerto por agência, nem por motoboy. É uma regra só,
  escrita num lugar só: o predicado `entraNoDinheiro` em
  `src/data/relatorios.ts`, usado pelos três acumuladores. Ele **continua
  contado** em todos eles (a soma dos status tem que fechar com o total de
  vales, e no 3º nível o vale aparece marcado "Cancelada"), só não move
  valor. Hoje isso não muda número nenhum, porque só dá pra cancelar vale
  pendente e pendente nunca teve corrida — a guarda existe justamente pro
  dia em que essa premissa cair: sem ela, liberar cancelar vale em rota
  faria o dinheiro entrar no acerto da agência em silêncio, já que o total
  geral continuaria certo e ninguém compara os dois níveis.

---

## Tarifa de entrega e vales — a regra do dinheiro da tele

Descoberto em 2026-08-10, depois de o MVP inteiro estar pronto. O sistema
tratava `valor_entrega_cents` como número livre digitado pelo caixa. A regra
real é outra:

- **A tarifa é fixa por filial** (R$ 9,00 hoje), em `lojas.tarifa_entrega_cents`.
  O caixa nunca digita valor de entrega — escolhe **quantos vales**.
- **Endereço distante cobra 2 vales.** É a única variação.
- **O vale base a farmácia sempre deve à agência.** Ela recupera do cliente
  quando a compra é abaixo de R$ 100 (a taxa entra no valor da compra, que
  **já vem somada do Trier** — o sistema não soma nada, e não deve passar a
  somar: viraria cobrança dobrada) e absorve quando é acima. Nos dois casos
  ela deve os R$ 9 à agência, então isso não muda o acerto e não virou coluna.
- **O vale extra o cliente paga em mãos ao motoboy** — nunca passa pela
  farmácia. Exceção: convênio com `farmacia_paga_entrega_integral` (caso do
  Minerva), onde ela banca os dois.

| caso | total | farmácia deve | cliente em mãos |
|---|---|---|---|
| 1 vale | 900 | 900 | 0 |
| 2 vales | 1800 | 900 | 900 |
| 2 vales + convênio integral | 1800 | 1800 | 0 |

**O que a farmácia deve = `valor_entrega_cents - entrega_paga_cliente_cents`.**
Na tela isso se chama **"A pagar à agência"** (ou só "A pagar" nas colunas
do relatório) — "Farmácia deve" foi trocado a pedido do usuário em
2026-08-12. O campo em código continua `valorFarmaciaDeveCents`.
Antes disso o relatório somava o total como se ela devesse tudo — o acerto com
a agência vinha inflado em toda entrega distante.

Duas colunas guardadas em vez de derivadas, de propósito:
`quantidade_vales` (dividir valor pela tarifa daria contagem errada se a
tarifa mudar) e `entrega_paga_cliente_cents` (a regra do convênio quebra a
derivação, e desmarcar o convênio depois reescreveria o passado).

Nunca comparar nome de convênio com `'Minerva'` no código — a regra é a flag.

**Transferência entre filiais paga a mesma tarifa, sempre 1 vale.**
Confirmado na farmácia em 2026-08-11: quem leva o produto de uma filial
pra outra é o motoboy da agência, e ela cobra por essa corrida como por
qualquer outra. Então o vale de transferência nasce com
`valor_entrega_cents` = tarifa da filial que **pediu** (é ela que paga) e
`quantidade_vales = 1` — a variação de 2 vales é endereço distante do
*cliente*, que não existe aqui. `entrega_paga_cliente_cents` fica 0: não
há cliente pra pagar em mãos, a farmácia deve o valor inteiro. O que
continua zero é a **venda** (`valor_compra_cents`, nenhum `pagamentos`) —
transferência não é compra. Antes disso a transferência entrava no
relatório valendo nada, e o acerto com a agência vinha **menor** que o
real, o espelho do bug do endereço distante.

A tarifa é capturada no cadastro e vai no payload da fila offline, não
lida na hora do sync: se ela mudar enquanto o vale espera pra
sincronizar, o certo é gravar a de quando o vale foi criado.

---

## Cidade, filial e agência

Confirmado com o usuário em 2026-08-13. Em cada cidade **uma** agência de
tele atende **todas** as filiais dali: São Gabriel/RS tem Matriz, Filial
02, 04 e 10, e uma única agência faz as corridas de todas. Uma agência de
Alegrete não pode aparecer para uma filial de São Gabriel.

- **`cidades` é tabela, não texto em `lojas`/`agencias`.** Com string, a
  associação dependeria de dois textos baterem exatamente ("São Gabriel" ≠
  "Sao Gabriel"), e um acento errado desassociaria a agência em silêncio —
  no que decide dinheiro. Com FK, ou está associado ou não está.
- **Não existe constraint de "uma agência por cidade".** A regra é a
  operação de hoje, não uma invariante; travá-la no banco criaria uma
  migration de desfazer no dia em que uma cidade tiver duas. Quem se
  adapta é a tela.
- **A tela some com o nível, nunca com a informação.** Uma agência no
  resultado → o nome dela aparece com os totais e os motoboys logo abaixo,
  **sem chevron** (o clique não separaria nada). Mais de uma → volta a
  tabela "Por agência" com chevron. O mesmo predicado governa a planilha
  exportada: uma agência → uma aba; mais de uma → duas.
- **`corridas.agencia_id` continua sendo a verdade** de quem fez cada
  corrida. Cidade serve pra filtrar e organizar, nunca pra reescrever o
  passado — se uma agência mudar de cidade, os acertos antigos continuam
  certos.
- **Cidade é obrigatória no cadastro de agência** mesmo o schema aceitando
  null: agência sem cidade não entra no dropdown de "Nova corrida" de
  filial nenhuma, ou seja, seria cadastrada e invisível. A lista de
  Cadastros marca em vermelho quem estiver assim.
- **Criar cidade é manual via SQL**, como loja — é ainda mais raro que
  abrir filial.

---

## Exportação do acerto — planilha, PDF e Drive

O acerto é pago fora do sistema, **de 15 em 15 dias**. A aba Relatórios
tem três botões: "Exportar .xlsx", "Exportar PDF" e "Enviar ao Drive".

**Os três saem do que ESTÁ NA TELA**, nunca de uma segunda consulta. Isso
é regra, não detalhe: duas consultas podem divergir (dado entrou no meio,
filtro diferente) e aí existem duas versões do acerto, sem ninguém pra
desempatar. Pelo mesmo motivo, quem baixa e quem manda pro Drive chamam a
mesma função geradora — o que vai pra nuvem é byte a byte o que o usuário
baixaria.

- **A planilha é UMA página, sempre.** Já foi duas abas (resumo e vales) e
  o usuário achou desconexo: quem confere o pagamento pula do subtotal pro
  vale que o compõe o tempo todo, e trocar de aba quebra esse vaivém. O
  que muda entre uma agência e várias é só a existência da coluna
  "Agência" nas duas tabelas.
- **O PDF é o documento que acompanha o pagamento** — feito pra imprimir,
  assinar e arquivar. Por isso carrega o que um papel solto precisa pra se
  explicar sozinho meses depois: logo, período, **data e hora de emissão,
  quem emitiu, e quais filtros valiam**. Esse último evita a pergunta
  "esse acerto é de qual filial?" na frente da agência.
- **O quinzenal não muda o formato.** O período vem do filtro De/Até, então
  uma quinzena é só um intervalo como outro qualquer; o que muda entre uma
  cidade e várias é só quantas agências caem no mesmo arquivo.
- **Imagem no PDF precisa de `'FAST'` no `addImage`.** Sem isso o jsPDF
  grava o bitmap cru e a logo de 8 kB vira ~165 kB dentro do arquivo, que
  ainda sobem pro Drive a cada envio.
- **Dinheiro vai como NÚMERO, com `numFmt` de moeda** — nunca como texto
  "R$ 9,00". Célula de texto transforma o arquivo numa imagem de tabela:
  não soma, não filtra, não serve pra conferir. A divisão por 100 acontece
  só aqui, na fronteira de exibição; a aritmética continua em centavos
  inteiros (regra 1).
- **`montarWorkbook`/`montarPdf` são separados de quem baixa**, de
  propósito: dá pra gerar o arquivo e ler de volta pra conferir o
  conteúdo, sem depender do efeito colateral de download do navegador.
  Foi assim que as exportações foram testadas — a planilha lendo o zip
  (`xl/worksheets/sheetN.xml`) e o PDF pelos bytes.
- Só entram vales **com corrida atribuída** — é o que compõe o acerto com
  a agência. Vale pendente sem corrida aparece no resumo da tela, não no
  arquivo.

### Google Drive — a única integração externa

Dois documentos sobem, cada um da sua tela:

| de onde | o quê | para onde |
|---|---|---|
| Relatórios | planilha + PDF do acerto | `…- Acertos › Acertos dd-mm-aaaa a dd-mm-aaaa` |
| página do romaneio | as duas vias de UM romaneio | `…- Romaneios › <Filial> › AAAA-MM › AAAA-MM-DD › <Via>` |
| Fechamento ("sangria") | as duas vias de TODOS do dia | idem |

**Uma pasta por via** dentro do dia ("Via da farmácia" / "Via da agência"),
a pedido do usuário em 2026-08-19, depois do primeiro envio real. O nome
do arquivo **continua trazendo a via** (`romaneio-R-000010-agencia.pdf`):
PDF baixado e mandado por e-mail sai da pasta, e fora dela o nome é a
única coisa que diz qual via é. "Agência" e não "Tele" porque o sistema
inteiro chama de agência — o Drive não é lugar pra um segundo vocabulário.

**A sangria é o que faz o arquivo existir.** O botão da página do romaneio
é "compartilhar este romaneio agora": pra subir tudo por ele seria preciso,
a cada saída, achar um vale daquela corrida, expandir o chevron, abrir o
documento e clicar — várias vezes por dia, dependendo de alguém lembrar. Um
arquivo que depende de ninguém esquecer não é um arquivo. A sangria mora na
aba **Fechamento** porque ela já É a tela do fim do dia e já tem os dois
controles necessários (data com atalho "Hoje", e filial pro admin); não
precisou de tela nem de controle novo.

**Varre por `recebido_em_servidor`, arquiva por `ocorrido_em_local`.** A
assimetria é o ponto:

- varrer pelo recebimento garante que **nada é perdido** — cada romaneio
  chega ao servidor uma vez, num dia só, e a sangria daquele dia o alcança.
  Varrer pelo `ocorrido_em_local` abriria buraco permanente: uma saída
  offline de segunda que sincroniza terça não entraria na sangria de terça
  (a data dela é segunda) e a de segunda já rodou — ninguém a pegaria mais.
- arquivar pelo `ocorrido_em_local` põe o documento no dia em que a
  retirada aconteceu no balcão, que é o dia que alguém procura.

O efeito é que a sangria de hoje pode subir um romaneio pra pasta de
ontem. Isso é o certo, e a tela **diz** quando acontece, senão pareceria
erro.

**Repetir é de graça, e é isso que torna a falha parcial inofensiva.** O
envio é um romaneio por vez (não gera tudo antes): falhar no décimo não
desperdiça os nove que já subiram, e clicar de novo atualiza o que está lá
e cria o que faltou.

**QUAIS pastas é decidido em `src/lib/caminhosNoDrive.ts`, que não importa
nada** — nem o cliente do Drive, nem `import.meta.env`. Mesma disciplina
de `canonico.ts` e `tokenCartao.ts`: regra que decide onde um documento é
arquivado tem que caber num teste sem rede e sem consentimento OAuth
(`npx tsx scripts/caminhosNoDrive.spec.mts`, 25 casos). `googleDrive.ts`
ficou só com o transporte e reexporta a nomeação, então quem envia
continua com um import só.

**Um destino por documento.** O romaneio chegou a ir também pra uma pasta
`Geral` com todas as filiais juntas; o usuário desfez isso no mesmo dia, e
a razão dele é a que vale guardar: **pasta que acumula tudo não ajuda a
achar nada** — só troca um problema de busca por outro. Quem procura um
romaneio sabe de que filial ele é. Com a Geral saiu também a capacidade de
`enviarAoDrive` aceitar vários destinos, em vez de ficar esperando um
segundo chamador que não existe.

- **A data da pasta é a do FUSO LOCAL, e é aqui que estava a armadilha.**
  Fatiar a string ISO daria o dia em UTC, e uma saída às 21h em São
  Gabriel (UTC-3) é o dia seguinte lá — toda saída do fim da tarde seria
  arquivada no dia errado, e a sangria daquela noite não a acharia na
  pasta que acabou de criar. Com pasta por MÊS isso errava uma vez por
  mês; com pasta por DIA, erraria toda noite. Quem resolve é
  `src/lib/datas.ts`, que também é a definição de "o dia" usada pela aba
  Fechamento — as duas discordarem faria a sangria arquivar num dia e a
  tela mostrar outro.
- **`AAAA-MM` e `AAAA-MM-DD`, nunca `08/2026` e `18/08`.** Dois motivos,
  os dois de fora do navegador: o Google Drive para Desktop **renomeia
  pasta com `/`** ao sincronizar pro disco, e `01/2027` cairia entre
  `01/2026` e `02/2026` na ordenação por nome. A pasta do dia repete ano e
  mês de propósito — ela é linkada e citada solta.
- **Filial nula ou em branco cai em "Sem filial"** — pasta com nome vazio
  seria pior que uma pasta feia.
- **Reenviar SUBSTITUI, não acumula.** O envio procura o arquivo pelo nome
  exato dentro da pasta e, achando, faz `PATCH` com `uploadType=media`:
  troca só o conteúdo, preservando id, nome e link, então quem tiver o
  link de antes continua chegando no arquivo certo. Sem isso o Drive
  aceita alegremente cinco arquivos homônimos na mesma pasta, e num
  documento de custódia isso é pior que inútil — quem abrisse teria que
  adivinhar qual dos cinco vale. Vale para o acerto também, que antes só
  reaproveitava a PASTA.
- **Envios que compartilham o cache de pastas têm que ser SEQUENCIAIS.**
  As duas vias de um romaneio dividem os quatro níveis de cima; duas
  chamadas simultâneas errariam o cache juntas e criariam a mesma pasta
  duas vezes. Por isso quem envia usa `for … await`, nunca `Promise.all`.
  O cache é do CHAMADOR (`novoCachePastas()`), não do módulo: id de pasta
  memorizado indefinidamente vira id de pasta que o usuário apagou, e o
  envio pousaria na lixeira sem reclamar. Medido: 6 buscas de pasta contra
  30 pros mesmos 3 romaneios em duas vias.
- **O envio de verdade não tem teste automatizado, e não vai ter**: ele
  depende de consentimento OAuth. `scripts/conferir-envio-drive-no-console.js`
  cobre tudo menos a chamada que sai da máquina, com um Drive falso em
  memória — rodar sempre que alguém mexer em `enviarAoDrive`,
  `garantirCaminho` ou `acharArquivo`. **O envio real foi exercitado uma
  vez, em 2026-08-19**, e funcionou; o que ele NÃO cobriu foi a pasta por
  via, que entrou logo depois.

O desenho é deliberadamente mínimo, e cada peça tem motivo:

- **Escopo `drive.file`, nunca `drive`.** O app enxerga só os arquivos que
  ele mesmo criou — não consegue ler o resto do Drive de ninguém. É também
  o que torna seguro procurar a pasta pelo nome: a busca não alcança uma
  pasta homônima do usuário, então não há como "adotar" a pasta errada.
- **Token só na memória, sem refresh token.** Vale ~1h e morre no reload.
  Guardar refresh token no navegador seria expor credencial de longa
  duração no cliente — pior que pedir autorização de novo.
- **Pedir o token é a PRIMEIRA coisa depois do clique**, antes de gerar
  planilha e PDF. Gerar os dois leva centenas de milissegundos, e um
  pop-up aberto depois disso já não conta como resposta ao gesto do
  usuário: o navegador bloqueia. Foi assim que o envio quebrou quando o
  token da sessão anterior venceu. Pelo mesmo motivo o script do Google é
  pré-carregado quando a aba Relatórios monta (`prepararDrive`) — o
  clique não pode gastar o gesto esperando rede.
- **O Client ID é público** e mora em `VITE_GOOGLE_CLIENT_ID` (vai no
  bundle de qualquer jeito). **O "client secret" não é usado neste fluxo e
  não deve existir neste projeto** — vale a mesma regra da `service_role`.
- **Quando houver produção serão dois passos**, e faltar qualquer um faz
  funcionar no localhost e falhar no ar: a variável nas env vars do
  Cloudflare Pages **com rebuild depois** (o Vite embute no build), e a
  URL do Pages nas origens JavaScript autorizadas do cliente OAuth.
  Hoje **não há deploy nenhum** — ver a nota na Stack.
- **"O app não concluiu o processo de verificação" quase nunca é sobre
  verificação.** Com o app em modo de teste, o Google recusa qualquer
  conta fora de *Usuários de teste*. `drive.file` é escopo não sensível e
  não exige verificação.

---

## Papel que não volta — convênio e receita

Confirmado com o usuário em 2026-08-13. Até então a aba "Documentos" só
tinha o caminho feliz ("Marcar recebido"/"Marcar devolvida"): quem
conferia a fila e descobria que o convênio voltou sem assinatura, ou que
a receita não veio, não tinha o que fazer ali. Para receita existia meia
saída — o evento `falta_receita`, mas escondido no menu "⋮" do vale, na
outra aba. Para convênio não existia nada.

- **Cada linha da fila tem "Não voltou"**, com justificativa obrigatória
  (mesmo princípio do cancelamento e da divergência: sem o porquê, a
  gestão recebe "sumiu" e não tem o que fazer com isso). Grava
  `falta_receita` ou `falta_documento_convenio`, que entram em
  Notificações, na aba Ocorrências e no Registro de Auditoria junto com os
  outros.
- **Notificar NÃO tira o item da fila.** Decisão do usuário: convênio e
  receita costumam aparecer dias depois, e a pendência só se encerra com o
  papel na mão. A notificação é registro, não encerramento — quem some da
  fila é quem foi marcado como recebido.
- **Por isso `status_documental = 'extraviado'` continua sem quem
  escreva.** O valor existe no schema desde o início; encerrar a pendência
  ao notificar seria o caso dele, e foi justamente o que se decidiu não
  fazer. Se um dia mudar, ele está lá.
- A chave de idempotência do evento nasce ao **abrir** o dialog, não ao
  confirmar: se o insert falhar e a pessoa tentar de novo com o dialog
  aberto, é a mesma ocorrência e não pode virar dois eventos.

---

## Direção da transferência — quem pede, quem fornece

Confirmado com o usuário em 2026-08-12, e o sistema gravava **ao
contrário** antes disso.

O fluxo real: a filial que está **sem** o produto é quem pede. O motoboy
vai primeiro na filial que **tem**, pega o produto, entrega na filial que
pediu, e é lá que ele assina e recolhe o vale — a corrida já aconteceu
quando a assinatura é capturada.

Disso saem três coisas que não dá pra deduzir do código:

- **Quem opera a tela é a filial que recebe.** O select mostra a filial
  que fornece ("Filial que tem o produto"), não um destino. Rotular como
  destino foi o erro original, e ele se propagava pro texto da rota.
- **`loja_id` é a filial que pediu** — dona do vale, quem recebe, quem
  assina e **quem paga a tele**. Por isso a tarifa sai dela, e por isso
  RLS, relatório e Registro de Auditoria escopam o vale nela. Isso já
  estava certo antes; o que estava errado era só o nome do outro lado.
- **`loja_origem_id`** (antes `loja_destino_id`, renomeada na migration
  `20260812130000`) é a filial que fornece. `cliente_nome` guarda a filial
  que recebe, mantendo "cliente = quem recebe a entrega" igual ao vale
  normal, e `cliente_endereco` é a rota: `"fornecedora para solicitante"`.

Vale de transferência **já assinado ficou com a rota antiga** — a trigger
de imutabilidade (regra 7) congela cliente e valor, e contorná-la é
proibido. São vales de teste; a migration corrige só os que ainda não
foram assinados.

---

---

## Cadeia de custódia — o Romaneio de Saída

Construído em 2026-08-16, em seis etapas. A saída da tele deixou de ser
"salvar uma assinatura do motoboy" e virou um documento selado.

```
CARTÃO  → quem é?        identifica a credencial física
PIN     → é ele mesmo?   autentica a pessoa
sessão  → quem é o caixa  nunca vem do frontend
ROMANEIO → o que exatamente saiu naquele instante
hash    → amarra as assinaturas àquele conteúdo
```

Depois de selado, o documento é imutável. Tudo que acontece depois é
evento, nunca reescrita do passado (regra 7).

### As duas implementações gêmeas — a parte frágil

**`montarCanonico` (`src/lib/canonico.ts`) e `romaneio_canonico`
(migration `20260816140000`) precisam produzir os MESMOS BYTES.** Online o
servidor calcula; offline o navegador calcula; na sincronização o servidor
recalcula e compara. Se divergirem em um byte, o sintoma não é erro claro
— é "a saída offline nunca sincroniza", meses depois, sem pista.

Por isso o canônico é **texto por linha com TAB**, e não JSON canônico:
some ordem de chave, escape de Unicode e notação de número, que é onde a
divergência mora. É chato de propósito — chato é o que dá pra reproduzir
em duas linguagens.

- **`collate "C"` na ordenação do lado SQL**, porque a collation padrão do
  banco não é a ordem de code unit do JavaScript. Pra UUID em hex as duas
  coincidem, mas depender de coincidência aqui quebra sem ninguém achar.
- **`montarCanonico` mora em `lib/` e não importa nada** (nem o cliente
  Supabase) — é o que permite testá-lo isolado.
  `npx tsx scripts/canonico.spec.mts` cobre 15 casos.
- **`preparar_romaneio` devolve o canônico INTEIRO**, não só o hash, pra
  permitir a comparação byte a byte:
  `scripts/conferir-canonico-no-console.js` faz isso contra dado real.
  **Rodar sempre que alguém tocar em qualquer um dos dois lados.**
- **A tela compara antes de assinar**: online ela calcula local *e* pede o
  do servidor, e se divergirem se recusa a prosseguir. Transforma o risco
  em erro imediato e legível.

Existe um segundo par de gêmeos, bem menos arriscado porque é TypeScript
dos dois lados: `calcularOfflineEventHash` em `src/lib/envelope.ts` e a
cópia dentro de `supabase/functions/sync-romaneio/index.ts`.

### O PIN offline, e por que não é criptografia simétrica

Offline o navegador precisa guardar PIN e token do cartão até a rede
voltar — podem ser horas. Cifrar com chave simétrica local não resolve
nada: a chave teria que ficar acessível à própria página, então quem
controla a página decifra também. Vira ofuscação.

**A saída é cifrar com a chave PÚBLICA do servidor.** O navegador sela e
não tem como reabrir — não existe chave privada nele. Quem abre é a Edge
Function `sync-romaneio`.

- **Híbrido, não RSA direto.** RSA-OAEP 2048 cifra no máximo 190 bytes, e
  os segredos mais as amarrações dão ~300 em JSON. AES-GCM-256 cifra o
  conteúdo e o RSA envolve só a chave de 32 bytes. RSA-4096 caberia hoje
  com 446 bytes, mas quebraria no dia em que alguém somasse um campo — e
  offline, no balcão.
- **O envelope carrega `key_id`.** Ao rotacionar, MANTENHA a chave antiga
  no secret `ROMANEIO_KEYS` enquanto houver saída offline pendente; sem
  ela, o que foi selado antes da troca não abre mais. A função diz qual
  `key_id` faltou.
- **A pública é variável de build** (`VITE_ROMANEIO_PUBKEY`), como o
  `VITE_GOOGLE_CLIENT_ID`. Estando no bundle ela existe offline por
  construção — não há o caso "caiu a internet antes de eu ter a chave".
- Isso **não** resolve JavaScript malicioso no instante em que o PIN é
  digitado. Nada em navegador resolve. Resolve o PIN **em repouso**.
- Chaves geradas por `node scripts/gerar-chaves-offline.mjs`, que escreve
  em `.chaves-offline/` (gitignored) e **nunca imprime a privada**.

### Online e offline terminam no mesmo lugar

A Nova Corrida **sela o envelope sempre**, mesmo online: se o selo cair no
meio por rede, a retirada física pode já ter acontecido, e a operação vai
pra fila com os mesmos ids (reenvio é no-op se já tiver selado).

| | online | offline |
|---|---|---|
| identidade do motoboy | RPC valida o HMAC → "credencial reconhecida" | cache local por `public_id` → **"credencial informada"** |
| PIN | validado na hora, gera autorização de uso único (~2 min) | selado no envelope, validado na sincronização |
| `modo` do romaneio | `online` | `offline_sincronizada` |
| o que a tela afirma | "romaneio selado" | "registrada offline, **ainda não validada**" |

**"Registrado" e "validado" não podem se parecer.** A saída offline é uma
afirmação do balcão; o selo é uma afirmação do servidor.

**Não existe estado novo em `status_entrega`.** O vale fica `pendente` até
selar — que é a verdade do ponto de vista do servidor. O estado offline
mora na fila local e em `romaneios.status`/`.modo`. Pôr um valor novo
naquela coluna atingiria relatórios, fechamento, .xlsx, PDF, auditoria e
as quatro listas de vale: a maior superfície de regressão do projeto.

### Conflito de sincronização

PC A offline entrega o vale ao João; PC B online põe o mesmo vale numa
corrida do Pedro. Quando A sincroniza, o servidor acha o vale já
vinculado.

**Nada é sobrescrito e nada é apagado.** A transação não sela, mas
registra: um `romaneios` com `status = 'conflito'`, sem corrida, guardando
o snapshot **e os traços das duas assinaturas** — a retirada física
aconteceu, e essa prova não pode sumir. Mais evento de auditoria.

O detalhe que decide se isso funciona: **o registro do conflito precisa
commitar**. Por isso `selar_romaneio_interno` devolve `jsonb` discriminado
em vez de levantar exceção nos casos previstos — `raise` faria rollback e
levaria a prova junto. Erro de verdade (autorização inválida, romaneio sem
vale) continua sendo exceção, porque aí não há nada a preservar.

Pelo mesmo motivo `autenticar_credencial` **não levanta exceção com PIN
errado**: o contador de tentativas precisa commitar, senão o bloqueio
progressivo fica desligado sem ninguém perceber. O bloqueio tem teto de 15
minutos — bloqueio permanente automático deixaria qualquer um com o cartão
na mão derrubar o motoboy de vez.

### GRANT restringe coluna; RLS não

O projeto aprendeu duas vezes que RLS não protege coluna (`profiles`, e a
conferência do fechamento), e concluiu "então põe num trigger". Em
`motoboy_credenciais` a ferramenta certa é outra e existe desde sempre:
**`token_hash` e `pin_hash` simplesmente não entram no `grant select`.**
Nenhuma policy, por mais frouxa, consegue devolvê-los — o privilégio não
existe.

Isso é o que permitiu, na etapa 5, **abrir a leitura da tabela para
qualquer autenticado do tenant** sem expor nada: o caixa precisa ter lido
a lista alguma vez online pra o cache offline existir. Policy governa
quais linhas; grant governa quais colunas.

E o `revoke` explícito é obrigatório, não decorativo: o Supabase configura
`alter default privileges ... grant all on tables to anon, authenticated`,
então tabela nova nasce **com tudo liberado**.

### A fila offline tem dono

`filaOperacoes` (Dexie v4) carrega `userId`, `tenantId` e `lojaId`. O caixa
A registra uma saída, sai, o caixa B entra no mesmo PC — a saída de A não
sincroniza sob a sessão de B. **O gate de verdade está na Edge Function**,
que confere o JWT contra o dono; a tela só evita o caso normal chegar lá.

Sair com operação pendente **avisa mas não impede**: o PC do balcão é
compartilhado e trancar o caixa dentro da própria sessão é pior que o
problema. Nada se perde — volta a sincronizar quando aquela conta entrar.

**A chave da fila é própria, sem significado de negócio.** Antes era o id
do negócio, e `corrida` e `fechamento_corrida` usavam ambas o `corridaId`:
fechar uma corrida ainda não sincronizada **substituía a criação dela** no
`put`, e o fechamento seguinte batia em 0 linhas — que no PostgREST não é
erro. Perda silenciosa, reproduzida e corrigida em 2026-08-16. Dependência
entre operações agora é explícita (`chave` / `dependeDeChave`).

### O que a saída offline NÃO alcança

Descoberto no primeiro teste offline com uso real, em 2026-08-18. Três
limites, e o primeiro é arquitetural — não adianta procurar solução de
cache pra ele:

- **Vale criado offline não pode sair offline.** `numero_vale` é gerado
  pelo BANCO (sequência `V-000001…`) e entra no canônico, que é o
  documento que as duas partes assinam. Vale que ainda não subiu não tem
  número, logo não tem como constar de um documento assinado. Guardar a
  lista localmente não resolveria: o que falta não é o dado, é o número.
  A tela avisa quantos vales estão nessa situação, em vez de deixar o
  caixa achar que o lançamento se perdeu.
- **A lista de vales vem do servidor e não fica salva.** Se a internet
  cair com a tela aberta, o cache do TanStack Query segura (`gcTime` de
  30min). Se a página recarregar offline, não há lista. A tela passou a
  dizer isso — antes exibia "Nenhum vale pendente pra sair agora", que é
  uma **afirmação sobre o estoque de vales** e vira mentira quando o que
  houve foi falha ao carregar.
- **Só sai vale da PRÓPRIA filial.** `selar_romaneio_interno` exige
  `e.loja_id = p_loja_id`. Pro caixa e pro gerente a RLS já garante isso,
  mas o **admin enxerga o tenant inteiro** — e a lista, que não filtrava,
  oferecia vale de outra filial numa saída que o servidor recusa sempre.
  O filtro por `loja_id` no cliente não é redundância com a RLS nem
  "confiar no cliente": o servidor continua sendo quem recusa; o ponto é
  não OFERECER o impossível, porque descobrir custa duas assinaturas e um
  romaneio de conflito.

### A fila não pode travar em silêncio

Também de 2026-08-18. `processarFilaOperacoes` tem um guard
`if (processando) return` que era uma trava **de mão única**: bastava um
`await` que nunca resolvesse pra fila inteira parar pra sempre. E não há
timeout em ponto nenhum da cadeia — `functions.invoke` não tem, e `fetch`
sem `signal` espera indefinidamente.

O sintoma é o pior possível, porque não parece erro: o item fica **"Na
fila"**, com `tentativas` em 0 e nenhuma mensagem, e não é tentado nem
depois de reconectar. Só um F5 destravava.

- `processando` ganhou um **relógio** (`LIMITE_RODADA_MS`): passado o
  limite, a rodada seguinte segue mesmo assim. Duas rodadas se
  sobreporem é seguro — toda operação da fila é idempotente por
  construção (ids determinísticos, upsert, `23505` tratado como
  sucesso). Fila parada pra sempre não é.
- **"Tentar agora" alcança `pendente`, não só `erro`.** O botão era
  habilitado por `comErro.length > 0`, então justamente o item preso —
  que nunca falhou, porque nunca foi executado — era o único que ele não
  alcançava. Item sem erro escrito nele é o mais aflitivo de todos.
- `tentarAgora` também zera `processando` antes de rodar, senão o clique
  cairia no guard e não faria nada: a sensação exata de botão quebrado
  que o usuário relatou.

### A marca num lugar só

Trocada em 2026-08-18 pela versão nova, a mesma da credencial do motoboy.
`src/lib/marca.ts` é o único ponto que sabe onde os arquivos estão.

Quatro coisas usam: o cabeçalho do app, a tela de login, a credencial, o
PDF do acerto e o do romaneio. Antes disso havia **duas cópias da mesma
extração** espalhadas pelos geradores da credencial, e a logo antiga
entrava por `import` do bundle em dois componentes.

- **A logo nova é 2008 × 320; a antiga era 502 × 80** — mesma proporção,
  quatro vezes a resolução. Foi essa coincidência que permitiu trocar sem
  mexer em layout nenhum: `LOGO_PROPORCAO` substituiu o `<img>` que o PDF
  do acerto criava só pra medir dimensão a cada exportação.
- **Duas resoluções, e a escolha é por DESTINO** (2026-08-19). A de tela
  (2008 × 320, dentro do `.svg`) serve cabeçalho, login e credencial. Os
  PDFs usam `LOGO_DOCUMENTO_URL` — a MESMA ARTE em 502 × 80, PNG solto em
  `public/marca/`. Nos 56mm do romaneio a de tela dava ~900 dpi, quatro
  vezes o que qualquer impressora aproveita, e o arquivo pagava 130 kB por
  isso; a de documento dá ~226 dpi e o PDF cai pra **16 kB**. Não é
  reversão de marca: as duas são a mesma arte, e a proporção idêntica é o
  que permitiu trocar sem tocar em layout. Importa porque o PDF do
  romaneio sobe pro Drive nas duas vias a cada saída, e uma saída acontece
  várias vezes por dia.
- **O letreiro da arte é BRANCO, e isso é armadilha.** Medido nos pixels:
  zero pixels escuros na região de "Drogaria Cidade", nas duas
  resoluções. Documento que desenha a logo sem uma faixa de `COR_MARCA`
  atrás perde o nome da farmácia e fica só com a cruz — foi exatamente o
  que aconteceu com o PDF do romaneio entre 16 e 19/08, e ninguém notou
  porque a cruz aparecia. O acerto sempre teve a faixa e por isso nunca
  mostrou o problema. `COR_MARCA` mora em `marca.ts` junto das logos por
  esse motivo: ela é parte de saber desenhar a marca, não decoração do
  acerto. Coberto por teste em `scripts/romaneio-pdf.spec.mts` (a faixa
  tem que começar em x=0 e atravessar a página).
- **Os arquivos do designer ficam intactos**, em `public/marca/`. Eles
  carregam o PNG DUAS vezes (`href` e `xlink:href`, byte a byte
  idênticos — o segundo é fallback de renderizador antigo). Dava pra
  cortar pela metade, mas o dia em que alguém comparar o que está no repo
  com o que foi entregue vale mais que os 137 kB. A extração pega a
  primeira ocorrência.
- **Cache por sessão.** Sem ele, gerar credencial e PDF do acerto na
  mesma sessão baixaria ~1,8 MB duas vezes. `limparCacheDaMarca()` existe
  só pros testes: sem ela não há como exercitar "a rede caiu e a logo não
  veio", porque a primeira carga bem-sucedida serve todas as seguintes.
- **Documento sem logo ainda é um documento.** Falha ao carregar não
  derruba a emissão — vale pro acerto e vale ainda mais pro romaneio, que
  é comprovante de custódia.
- **O custo é peso, e ele ficou só na tela.** O cabeçalho passou de
  8,5 kB (PNG) para um SVG de 273 kB — uma busca por sessão, cacheada pelo
  navegador, num PC que abre o app uma vez por turno. O PDF do romaneio
  chegou a 130 kB e **voltou pra 16 kB** com a logo de documento.

**O `favicon.svg` NÃO é a logo da farmácia** — é um ícone roxo genérico
que veio do template do Vite e nunca foi trocado. Não entrou nesta troca
porque não era "a logo antiga em PNG", mas continua sendo um ícone que
não tem nada a ver com a Drogaria Cidade.

### O PDF do romaneio

Construído em 2026-08-18. `src/lib/romaneioPdf.ts`, botões na página do
romaneio, chunk próprio (o jspdf só desce ao clicar). Em 2026-08-19 a
página ganhou o terceiro botão, "Enviar ao Drive" — ver a seção do Drive
pros destinos e pela regra do reenvio.

**A regra que governa o arquivo inteiro: ele sai do SNAPSHOT, nunca do
dado vigente.** Os vales vêm de `romaneios.payload`, congelado no
instante da selagem — não da tabela `entregas`, que pode ter mudado.

É a regra 7 aplicada. Se um endereço foi corrigido depois, o PDF continua
mostrando o que o motoboy assinou, e a correção entra numa **seção
separada** ("Correções posteriores à assinatura"), com a frase de que o
documento acima não muda. Montar do dado vivo pareceria funcionar
perfeitamente e faria o romaneio afirmar que o motoboy recebeu um
endereço que ele nunca recebeu.

- **Duas vias.** `farmacia` leva tudo; `agencia` **omite o valor da
  compra**, que é dado comercial da farmácia e não entra no acerto — ela
  precisa do valor da entrega, não do que o cliente comprou.
- **O cabeçalho tem faixa, e ela não é decoração** — o letreiro da logo é
  branco e sem faixa o documento saía sem o nome da farmácia. Ver "A marca
  num lugar só".
- **Os quatro relógios finalmente têm tela.** Retirada, retorno e duração
  saem de `corridas.saida_em`/`retorno_em`, existentes e sem uso desde
  2026-08-10. A duração usa o relógio do SERVIDOR nos dois lados: misturar
  servidor com dispositivo daria um intervalo que não aconteceu. É o
  insumo do relatório de tempo médio, que passa a ser calculável
  **retroativamente**.
- **Corrida ainda aberta é dita, não omitida** — "retorno: corrida ainda
  aberta". Campo ausente e corrida em andamento não podem se parecer.
- **As assinaturas são vetor**, redesenhadas dos pontos como na tela. Sem
  imagem embutida: o banco guarda traços, e o PDF pode sair em qualquer
  tamanho.
- **O rodapé é o que prova**: `final_hash`, `document_hash`, IP,
  geolocalização (com o rótulo de cache quando for o caso) e a frase de
  que **este PDF é uma renderização do registro, não a fonte da
  verdade**.

`npx tsx scripts/romaneio-pdf.spec.mts` cobre 30 casos, e o primeiro é o
que importa: um romaneio cujo snapshot diverge de propósito do "dado de
hoje", exigindo que o PDF mostre o snapshot.
`scripts/romaneio-de-exemplo.mts` gera as duas vias com dado fictício,
pra conferir desenho sem depender do banco.

### Geolocalização: por que ela nunca bloqueia

Revisto em 2026-08-18, quando o usuário pediu que ela fosse obrigatória
pra selagem. **Não pode ser**, e o motivo é de hardware, não de desenho:

O PC do balcão não tem GPS. O navegador resolve posição mandando os WiFi
vizinhos pro serviço do Google — **isso exige rede**. Offline não existe
a quem perguntar. Exigir coordenada seria proibir saída sem internet, ou
seja, desligar o caminho que o projeto passou dias provando.

E mesmo online, geolocalização de desktop por WiFi erra de centenas de
metros a quilômetros. Como prova de que "o caixa estava na farmácia", a
sessão autenticada diz mais.

**O que dá pra fazer, e está feito** (`src/lib/geolocalizacao.ts`):

- `aquecerGeolocalizacao()` pede uma leitura quando a Nova Corrida monta
  com internet — mesmo lugar onde o cache de credenciais é atualizado. É
  o que deixa algo recente guardado pro caso de a rede cair depois.
- Ao selar: tenta leitura fresca (8s, prazo maior que os 3s de antes,
  porque 3s não davam tempo de alguém RESPONDER ao pedido de permissão);
  não vindo, aceita a do cache do navegador (até 10 min).
- **A leitura de cache é rotulada como tal.** `obtida_em` guarda o
  horário real da medição e `origem` diz `fresca` ou `cache`, e a tela
  escreve "leitura de 11:25, não do momento da selagem". Apresentar uma
  leitura de duas horas antes como se fosse do instante seria a tela
  afirmando o que não sabe — o defeito que este projeto já pagou três
  vezes.
- **Sem coordenada, grava-se o MOTIVO**: `negada`, `sem_suporte`,
  `indisponivel`, `expirou`. "Não registrada" e "negada pelo usuário" são
  fatos diferentes numa cadeia de custódia, e um campo vazio não
  distingue os dois. O retorno nunca é `null`: sempre há uma afirmação.
- Permissão negada **não** tenta o cache: insistir só faria o motoboy
  esperar, e a resposta não mudaria.

`npx tsx scripts/geolocalizacao.spec.mts` cobre os cinco caminhos com um
dublê de `navigator.geolocation` — é a única forma de exercitar "negada"
e "offline sem cache" sem depender de permissão de navegador nem de rede.

### O Romaneio de Retorno — desenho fechado, código não começado

Decidido com o usuário em 2026-08-19, **antes de qualquer código**, a
pedido dele. Nada disto está construído. Quem for construir: leia esta
seção inteira primeiro, porque metade das decisões existe para evitar uma
segunda migration conceitual logo depois.

**A ideia central: são dois documentos, e o segundo nunca altera o
primeiro.**

```
CORRIDA
├── ROMANEIO DE SAÍDA      snapshot do que saiu, 2 assinaturas, hashes
├── EVENTOS DA CORRIDA     entrega, insucesso, divergência
└── ROMANEIO DE RETORNO    snapshot do resultado, referência à saída,
                           2 assinaturas, hashes próprios
```

O retorno **referencia** a saída e nunca a modifica — é a regra 7 aplicada
de novo. Reconstruir "o que voltou" a partir de um romaneio que foi sendo
alterado é exatamente o que este desenho existe para impedir.

#### O bloqueio que motivou a conversa, e a saída

```sql
create unique index assinaturas_corrida_signatario
  on public.assinaturas (corrida_id, tipo_signatario);
```

Cada corrida aceita UMA assinatura de caixa e UMA de motoboy. O retorno
precisa de um segundo par. A unicidade correta passa a ser por
**documento**, não por corrida — com dois índices parciais, para não
reescrever nada:

```sql
UNIQUE (romaneio_id,  tipo_signatario) WHERE romaneio_id IS NOT NULL
UNIQUE (corrida_id,   tipo_signatario) WHERE romaneio_id IS NULL
```

O segundo protege as assinaturas legadas (do fluxo anterior ao romaneio,
que têm `romaneio_id` nulo) pela regra antiga. Nenhum dado histórico é
tocado.

Em `romaneios` entra `tipo` (`saida` | `retorno`) mais
`UNIQUE (corrida_id, tipo)`, que impede dois retornos acidentais. **Ele
isenta os conflitos de graça**: romaneio em conflito tem `corrida_id`
nulo por construção, e no Postgres nulo não colide com nulo.

#### O signatário interno não é "o caixa"

Na saída normalmente é o caixa; no retorno pode ser gerente ou admin.
Então o modelo novo usa `tipo_signatario = 'responsavel_loja'` e guarda
**`papel_no_momento`** (`caixa` | `gerente` | `admin`) à parte. A tela
continua mostrando "Recebido por Ana Souza — Gestora".

`papel_no_momento` existe porque `profiles.papel` é o papel **atual**: se
alguém for promovido, um romaneio de seis meses atrás passaria a afirmar
que o ato foi praticado por um gerente. Mesmo defeito que a regra 7
descreve, noutra coluna.

**E AQUI ESTÁ A ARMADILHA QUE QUASE PASSOU.** O literal do papel entra no
hash da assinatura:

```sql
v_hash_caixa := encode(digest(
  v_hash || '|caixa|' || p_caixa_id::text || '|' || ...
```

Renomear `caixa` → `responsavel_loja` nas linhas existentes **quebraria a
verificação de todo romaneio já selado** — o digest foi calculado com
`|caixa|`. Por isso o CHECK é **ampliado, nunca renomeado**: as saídas
antigas ficam `caixa` para sempre, o modelo novo nasce `responsavel_loja`.
O vocabulário dividido é um fato datado, como o token v1/v2/v3.

Hoje **nada recomputa esses hashes** — eles são gravados e exibidos
truncados, nunca conferidos —, então o risco é latente. Mas fica a regra,
que custa uma linha agora e uma migration depois: **um verificador de hash
tem que ler `tipo_signatario` da própria linha, jamais fixar o literal.**
No retorno, `papel_no_momento` entra no hash desde o primeiro dia — é
fórmula nova, não há o que retrofitar.

#### Numeração: identidade opaca, rótulo no papel

`numero` continua vindo da sequência (`R-000843`), e `tipo` carrega o
significado. **Não** vira `R-000842-S` / `R-000842-R`: os romaneios
existentes são `R-000001…` sem sufixo e imutáveis, então o esquema criaria
uma mistura permanente, e o `-R` teria que ser derivado do irmão por
trigger. Quem está com o papel na mão acha o irmão porque **o PDF
imprime** "Romaneio de Retorno · referente à Saída R-000842".

#### O retorno substitui o fechamento manual

Decisão explícita do usuário: **não existem dois caminhos para encerrar
uma corrida.** A tela "Retorno de Corrida" evolui para produzir e selar o
documento, e só o selo finaliza a corrida.

```
em rota → marcar Entregue/Insucesso → pagamentos e documentos
        → snapshot → cartão + PIN do motoboy → assinatura do motoboy
        → assinatura do responsável da loja → selar → fechar corrida
```

Tudo numa operação transacional. `fecharCorrida` sobrevive **dentro**
dela, nunca como ação de usuário.

**Cartão e PIN de novo, sim** — são duas transferências de custódia em
sentidos opostos (farmácia→motoboy na saída, motoboy→farmácia no
retorno), e reaproveitar a autenticação das 18h42 para provar um ato das
20h17 não prova nada. O bloqueio progressivo que já existe (30s → 2min →
5min → teto de 15min, zerado por um acerto) é adequado e **não precisa
mudar**.

#### O fluxo excepcional é ONLINE por construção

Se o servidor recusar o PIN, aparece "Solicitar intervenção do gestor":
motivo obrigatório, assinatura manuscrita do motoboy mesmo assim,
identidade de quem autorizou, evento de auditoria próprio, e o documento
**marcado no rosto** como autenticação excepcional. Nunca bypass
silencioso, nunca para caixa comum — `is_gerente()`.

**Offline isso não existe, e não é omissão.** Offline não há rejeição de
PIN em tempo real: cartão e PIN são selados no envelope RSA e o servidor
decide na sincronização. Não há a quem o servidor diga "não". Motoboy com
credencial bloqueada assinando offline vira conflito no sync, com a prova
preservada — o caso do `R-000004`.

#### `fechamento_corrida` na fila: drenar, não converter

Um item `fechamento_corrida` pendente no IndexedDB **não pode virar** um
romaneio de retorno: faltam assinatura, PIN e snapshot, que nunca foram
coletados. Descartar seria a perda silenciosa que a chave própria da fila
veio corrigir em 16/08. Então:

| release | comportamento |
|---|---|
| N (o do retorno) | escreve **só** `romaneio_retorno`; ainda **lê** `fechamento_corrida` legado |
| N+1 | ainda lê o legado, por segurança |
| depois | remove o handler, confirmada a fila drenada |

O item legado executa o comportamento antigo, fecha a corrida e grava
auditoria `fechamento_legado_sem_romaneio_retorno`. Vai existir um punhado
de corridas históricas sem romaneio de retorno porque nasceram antes da
regra — o que não pode é abrir buraco novo. **Depois da migration, nenhum
código enfileira `fechamento_corrida`.**

#### As seis etapas, e onde está o risco

1. Migration: `romaneios.tipo`, os dois índices parciais, `tipo_signatario`
   ampliado, `papel_no_momento`, FK do retorno para a saída
2. Canônico do retorno + `selar_romaneio_retorno` transacional
3. Tela: Retorno de Corrida vira o fluxo do documento
4. Fila offline: `romaneio_retorno`, envelope, `sync-romaneio`
5. Fluxo excepcional (online)
6. PDF do retorno + Drive

**A etapa 2 é a perigosa**, e por um motivo específico: o canônico do
retorno tem mais campos que o da saída — desfecho por vale, previsto
contra realizado, motivo de insucesso. São **dois gêmeos TypeScript/SQL de
novo**, com mais superfície para divergir em um byte. Ele precisa do seu
próprio `canonico.spec.mts` e do seu próprio
`conferir-canonico-no-console.js`, separados dos da saída. Ver "As duas
implementações gêmeas" acima antes de escrever qualquer um dos dois lados.

### Ordem dentro da transação do selo

`corrida → vales em rota → romaneio → vínculo → assinaturas`. O UPDATE dos
vales tem que vir **antes** de existir `romaneio_entregas` ou assinatura,
senão o trigger de imutabilidade vê o documento já selado e barra o
próprio selo — toda saída falharia, com o erro apontando pro lugar errado.

### O cartão

```
3 012345 678901234567890
│ └ public_id  └ segredo (15 dígitos ≈ 50 bits)
└ versão
```

**Só dígitos, sem separador, largura fixa, total PAR.** O banco guarda
`public_id` em claro e `token_hash = HMAC-SHA256(segredo_do_Vault,
token)`. Zero dado pessoal no cartão. O total par não é estética: dígito
ímpar sobra fora do Set C e custa 11 módulos sozinho, em vez de dividir o
símbolo com o vizinho.

**Por que numérico, e por que o mais longo é o mais estreito.** Code 128
tem um modo (Set C) que empacota DOIS dígitos por símbolo de 11 módulos;
texto gasta 11 módulos por caractere, seja base32 ou base64. Medido com o
codificador de verdade, para 75mm de área útil num CR80 (85,6mm menos 5mm
de margem de cada lado) e piso de 0,19mm por módulo. **Os módulos incluem
as duas zonas de silêncio de 10X**, que ocupam largura dentro dos mesmos
75mm — esquecê-las infla o resultado em ~7%:

| formato | car. | módulos | a 75mm | |
|---|---|---|---|---|
| v1 `DCM1.<10>.<20>` base32 | 36 | 418 | 0,179mm | 0,9x ❌ |
| `DC2.<6>.<24>` base32 | 35 | 429 | 0,175mm | 0,9x ❌ |
| `DC2.<6>.<22>` base64url | 33 | 407 | 0,184mm | 1,0x ❌ |
| v2 `2<10><31>` dígitos | 42 | 286 | 0,262mm | 1,4x |
| **v3 `3<6><15>` dígitos** | **22** | **176** | **0,426mm** | **2,2x** ✅ |

As três primeiras linhas são **aproximadas por natureza**, e isso é parte
do argumento: num token alfanumérico o bwip-js troca pra Set C sozinho
nos trechos de dígitos, então a largura muda conforme a mistura de
caracteres que o sorteio produzir. Dois cartões do mesmo formato podem
sair com larguras diferentes. As duas últimas linhas são exatas, sempre —
todo token só de dígitos com o mesmo comprimento dá o mesmo número de
módulos. **Formato de largura previsível vale mais que formato estreito
em média**, quando o que está em jogo é caber num cartão físico.

Trocar de alfabeto reduz caracteres, não módulos o bastante — nenhuma
variação alfanumérica cabe. E **o separador é proibido**: um ponto no
meio quebra a corrida numérica, força troca de set, e o mesmo token volta
a quase 400 módulos.

De quebra some o problema que o alfabeto Crockford existia pra mitigar:
com só dígitos não há `O`/`0` nem `I`/`1`/`L` pra confundir.

**Por que o v3 encurtou, se o v2 já cabia.** O v2 cabe e foi lido num
teste real. O que faltava era margem pra impressão fora do ideal — e o
primeiro uso de verdade é um teste em papel comum, antes da gráfica. O
número que decide isso não é o milímetro, é **quantos pontos da
impressora cabem num módulo**: a 300dpi o v2 dava 3,1 pontos, onde o
arredondamento já vale ±16% na largura da barra; o v3 dá 5,0. E papel
comum espalha mais tinta que PVC.

**50 bits não é concessão.** Quem protege a credencial é o PIN, o
bloqueio progressivo e a revogação. A 50 tentativas por segundo contra o
servidor, quebrar um cartão específico levaria ~317 mil anos, e achar
qualquer cartão válido ~11 mil — e acertar o token não dá acesso a nada,
porque ainda falta o PIN com bcrypt de custo 12. O elo fraco é o cartão
perdido, e a resposta pra esse é revogar, não torcer contra 2^50. Já a
folga de 0,426mm perdoa impressora ruim, cartão sujo e leitor velho, que
são riscos que **acontecem**.

**`public_id` de 6 dígitos não enfraquece nada**: ele não é segredo (fica
em claro na tabela e é a chave de busca), e o que autentica é o
`token_hash` conferido logo depois. São 1 milhão de identificadores pra
uma farmácia com dezenas de motoboys, e não colidem com os de 10 dígitos
já emitidos — comprimentos diferentes, strings diferentes.

**Só o v3 é reconhecido** (migration `20260818120000`). v1 e v2 foram
versões de teste, nenhum cartão delas circulou na farmácia, e manter três
caminhos vivos onde a operação tem um só criava superfície. As
credenciais antigas continuam no banco como histórico — o Registro de
Auditoria referencia os eventos delas; o que deixa de existir é um token
daquele formato ser aceito.

`public_id_do_token` (SQL) e `publicIdDoToken` (`src/lib/tokenCartao.ts`)
são os únicos pontos do sistema que sabem o formato, e **mudam sempre
juntos** — divergirem não dá erro claro, dá "o cartão não é reconhecido
offline", onde só o cliente responde. Cobertos por
`npx tsx scripts/tokenCartao.spec.mts`.

**Antes de descontinuar um formato, confira se alguma credencial ATIVA
usa o antigo** — o cabeçalho daquela migration traz a query. Cartão ativo
de formato removido vira um motoboy chegando no balcão com um cartão que
o sistema não conhece mais.

**A altura da barra sai em módulos inteiros, e o alvo tem que ser
explícito e arredondado pra baixo.** O bwip-js não produz fração de
módulo; deixá-lo arredondar sozinho fez a barra do v3 sair com 16,19mm,
estourando a área de 16mm da especificação. Com o v2 isso passava
despercebido, porque o módulo era pequeno e o erro também.

### A credencial CR80 — o que a tela de emissão entrega hoje

Entrou em 2026-08-18, com desenho pronto trazido pelo usuário, e
**substituiu** o cartão de 75 × 20,2mm que só tinha código e token (esse
está descrito logo abaixo, e a descrição vale como história: cartões
daquele formato já impressos continuam válidos, porque o que autentica é
o token e ele não mudou).

- **O desenho é fixo e não se mexe.** `src/lib/credencialMotoboy.ts` só
  substitui quatro valores — token, código de barras, nome, agência — num
  modelo cujas coordenadas, cores, tamanhos e opacidades vieram prontos.
  Se algo parecer arbitrário (`y="16.791477"`, `.085` da cruz,
  `letter-spacing=".22"`), é porque veio do desenho.
- **A credencial agora IDENTIFICA o portador**, com nome e agência
  impressos. Isso reverte a decisão anterior ("cartão perdido não deve
  dizer de quem é nem de onde veio"), por escolha explícita do usuário ao
  trazer o desenho. Continua valendo o que sustentava a decisão antiga: o
  cartão perdido já carregava o token, então quem o acha sempre teve o
  que importa — e a resposta continua sendo revogar, não torcer.
- **`src/lib/code128.ts` é a SEGUNDA implementação de Code 128 do
  projeto**, e existe porque a credencial precisa das barras como
  `<rect>` dentro de um SVG maior. O que a torna aceitável, num projeto
  com regra contra duas codificações, é `scripts/code128.spec.mts`
  conferindo **barra a barra contra o bwip-js** em 24 comprimentos. O
  bwip-js segue sendo o padrão-ouro: divergiu, quem está errado é o
  arquivo novo.
- **O `15.767` do desenho não é arbitrário** — é exatamente a altura
  uniforme de 37 módulos para um token de 22 dígitos (37 × 75/176). Por
  isso o gerador **exige** o formato v3: com outro comprimento a escala
  do símbolo deixa de ser uniforme.
- **v1 e v2 foram removidos** (2026-08-18, migration
  `20260818120000`). Eram versões de teste; hoje o parser recusa. Ver
  acima.
- **O nome longo é abreviado, não espremido.** `fitSansFontSize` para de
  encolher no piso de 2,9, então acima de ~46 caracteres o nome
  transbordava a borda — foi o teste de aceitação que pegou. Quem resolve
  é `ajustarNomeParaCaber`, que abrevia os nomes do meio mantendo
  primeiro e último por extenso. **Isso não mexe no desenho**: muda a
  string, que é dado. Recusar a emissão seria o outro caminho, e é o que
  se faz com o token (que tem tamanho fixo) — mas recusar por nome
  comprido seria impedir de emitir cartão pra quem tem nome comprido.
- **Nada persiste.** O `credential-service.ts` da especificação original
  gravava os arquivos numa pasta; aqui eles são gerados em memória e
  baixados. Um diretório com todas as credenciais funcionais é exatamente
  o que "o arquivo É o cartão" existe pra evitar.
- **Os assets são PNG, não vetor**, apesar do comentário no SVG de origem
  dizer o contrário. A resolução é folgada no tamanho final (847 dpi a
  48mm, 1074 dpi a 47,5mm), então não é problema de qualidade — o custo é
  peso: ~900 kB por lado e ~2 MB no PDF, porque a cruz entra nas duas
  páginas.
- **No PDF o vermelho fica em RGB, de propósito.** Converter cor de marca
  pra CMYK é decisão de identidade visual, não de código. O que a
  conversão poderia estragar — o código de barras — já está em 100% K, e
  é preto sobre o painel branco. **Diga à gráfica qual vermelho vocês
  querem** (Pantone ou CMYK).
- `scripts/credencial-de-teste.mts` gera uma credencial com token
  fictício pro teste de impressão, pelo mesmo motivo do
  `cartao-de-teste.mts`: testar impressora não deve custar uma credencial
  de verdade.

**`src/lib/cartaoPdf.ts` ficou órfão** com a troca — nada no app o
importa. O spec dele continua passando; se for removido, o spec vai
junto. Com ele saiu também o `bwip-js` do bundle de produção (ele agora
só roda nos testes), o que aliviou ~930 kB.

### O cartão antigo, apagado em 2026-08-18

Antes da credencial CR80 havia um cartão de 75 × 20,2mm com só o código
de barras e o token — sem nome, sem filial, pensado pra que um cartão
perdido não dissesse de quem era. Ele foi impresso, bipado no leitor da
farmácia e chegou a rodar; a credencial nova o substituiu por completo.

`src/lib/cartaoPdf.ts` e os scripts dele foram removidos junto: ficaram
órfãos com a troca, e código morto com teste passando continua sendo
código morto. **O que sobreviveu e não podia sair junto** é
`src/lib/tokenCartao.ts` — os testes do parser moravam no spec do cartão
antigo e foram pra `scripts/tokenCartao.spec.mts`. Perder cobertura de um
gêmeo de função SQL no meio de uma limpeza seria a pior forma de perder
um teste: por acidente, sem ninguém notar.

Com o cartão antigo saiu também o `bwip-js` do bundle de produção — ele
agora só roda nos specs, como padrão-ouro contra o qual
`src/lib/code128.ts` é conferido. São ~930 kB que o app não baixa mais.

### O que ficou de fora, de propósito

- **Credencial verificável offline** (cartão assinado que o navegador
  valide sem rede). Avaliado e recusado: provaria só que o cartão foi
  emitido por nós — não presença (isso é o PIN), não revogação
  (impossível offline), e o servidor revalida tudo no sync.
- ~~**PDF do romaneio.**~~ **Construído em 2026-08-18**
  (`src/lib/romaneioPdf.ts`) — ver a seção própria abaixo.
- ~~**Envio do romaneio ao Drive.**~~ **Construído em 2026-08-19** — botão
  na página do romaneio, duas vias. Ver "Google Drive".
- **Portal da agência.** `profiles.papel` já aceita `'agencia'` desde o
  schema inicial; falta a policy.
- **Romaneio de retorno.** **Desenho fechado em 2026-08-19, código não
  começado** — ver a seção própria abaixo. Ele deixou de ser "nada
  impede" e virou uma frente de seis etapas, com decisões já tomadas que
  precisam ser lidas antes de escrever a primeira linha.
- **Correção cadastral por evento** (categoria 1 da regra 7).

---

## Onde roda código no servidor

Até 2026-08-16 este projeto era frontend puro falando direto com Postgres
via RLS, com **uma** exceção. Não é mais. Hoje o servidor aparece em três
formas, e cada uma existe por um motivo que não dá pra contornar no
cliente:

| onde | por quê |
|---|---|
| Edge Function `criar-usuario` | criar login no Auth exige `service_role` |
| Edge Function `sync-romaneio` | abrir o envelope do PIN exige a chave privada |
| RPCs `SECURITY DEFINER` | transação atômica, HMAC/bcrypt e acesso a tabela sem grant |

Duas regras valem para as três: **a `service_role` e a chave privada nunca
aparecem no código nem no repositório** (vivem como variáveis de ambiente
e secret), e **nada que vem no corpo do request decide identidade** — o id
do caixa sai sempre do JWT validado no servidor.

E uma armadilha que já custou uma sessão inteira: **`functions.invoke` não
anexa o JWT da sessão**, manda a anon key. O header `Authorization` vai
explícito nas duas chamadas. Se alguém "simplificar" removendo, quebra com
403 e o motivo não é óbvio.

`SECURITY DEFINER` **ignora a RLS de quem chamou**, então cada checagem de
tenant e loja que a policy fazia de graça precisa ser reescrita à mão
dentro da função. É a classe de buraco que o projeto já abriu antes.

### Gestão de usuários

Criar usuário no Supabase Auth exige a `service_role` key, que ignora RLS
inteira e por isso nunca pode ir pro navegador. Isso mora na Edge Function
`supabase/functions/criar-usuario/`.

Editar e bloquear usuário **não** passam por lá — são `UPDATE` comum em
`profiles`, resolvidos pela RLS. A função tem uma rota só, de propósito:
quanto menor a superfície que roda com `service_role`, melhor.

- **A `service_role` nunca aparece no código nem no repositório.** Ela já
  vem injetada nas Edge Functions como variável de ambiente. Se algum dia
  precisar colar essa chave em algum lugar do projeto, a resposta é não —
  o desenho está errado.
- **Nada que vem no corpo do request é confiado.** `tenant_id` sai do
  perfil de quem chamou (validado pelo JWT), nunca do body; papel é
  checado contra lista fechada; a loja precisa ser do mesmo tenant.
- **Só `admin`** cria/edita usuário — mais restrito que `is_gerente()`,
  que vale pro resto da gestão. Gerente não vê a sub-aba.
- **Senha fica fora do app.** Definir a inicial faz parte da criação;
  trocar depois é feito direto no Supabase, decisão consciente pra não
  existir rota de reset.
- **Cuidado ao mexer nas policies de `profiles`.** Existe um caminho
  legítimo de "usuário atualiza a própria linha" (marcar notificação como
  lida). Uma policy de auto-update sem proteção por coluna deixaria
  qualquer caixa se promover a admin — RLS não restringe coluna. Quem
  segura isso é o trigger `fn_profiles_protege_campos`; não remova sem
  colocar outra coisa no lugar.
- **`profiles.email`** é snapshot gravado na criação (o cliente não lê
  `auth.users`). Como o app não edita e-mail, não desincroniza.
- **Ninguém bloqueia a própria conta** — senão o admin se tranca pra fora
  e só outro admin devolve o acesso.

Deploy das funções (não há CLI do Supabase configurada neste projeto):
dashboard → Edge Functions → Deploy a new function → Via Editor. **Salvar
no editor não publica** — tem um botão Deploy separado, e é fácil sair da
tela achando que subiu; foi o que aconteceu com a `sync-romaneio`.

A função publicada chama-se **`sync-romaneio`** (não `sincronizar-romaneio`).
O nome no dashboard e o do `functions.invoke` têm que bater exatamente, e
o sintoma de não baterem é 404.

---

## O teste que decide o projeto

O caixa preenche os dois papéis à mão. Se o sistema demorar mais que isso, ele
fracassou mesmo funcionando perfeitamente — o caixa volta pro papel e não sai
mais de lá.

**Alvo: menos de 25 segundos, sem tocar no mouse.**

### MEDIDO EM 2026-08-10 — o alvo foi batido

Cronometrado pelo usuário com uso real, já com a máscara de moeda:

| entrega | à mão hoje | tempo no papel | no sistema |
|---|---|---|---|
| normal (R$ 9,00) | 1 vale + 1 linha na planilha = **2 escrituras** | ~1 min | **~15 a 18 s** |
| distante (R$ 18,00) | 2 vales + 2 linhas na planilha = **4 escrituras** | ~1 min 40 s | **~15 a 18 s** |

Entre **4x e 6x mais rápido** que o papel, com folga de ~7 a 10 segundos sobre
o alvo de 25 s. O projeto passou no teste que o define — isso deixa de ser
hipótese.

Repare que o tempo no sistema **não muda** entre os dois casos, enquanto no
papel quase dobra: é onde a diferença mais aparece.

**"Os dois papéis" são vale do tele + planilha de controle da farmácia**, não
duas vias do mesmo vale. Entrega distante multiplica os dois.

**Essa folga é orçamento, não sobra pra gastar à toa.** Toda mudança na tela de
cadastro continua sendo avaliada contra os 25 s, e campo novo ali continua
exigindo justificativa explícita. A diferença é que agora dá pra medir de novo
em vez de discutir no achismo — e uma regressão que coma a folga é visível.

Requisitos derivados:
- Foco automático no primeiro campo ao abrir
- Enter avança para o próximo campo, Enter no último salva
- Salvar não bloqueia a tela: grava local, sincroniza depois, volta pro campo 1

Decisão revista após uso real (sessão 3): telefone do cliente **não** é um campo do
cadastro — na prática o caixa não tem esse dado na hora (viria de busca manual no
Trier), então exigi-lo atrasa o lançamento em vez de ajudar. Autocomplete por
telefone foi removido junto. A tela pós-login também deixou de ser o formulário
direto: é uma lista das entregas do dia, com um botão explícito "Nova entrega" pra
entrar no modo de lançamento rápido.

---

## Ordem de construção

Uma sessão = uma coisa testável no fim. Não construir três telas de uma vez.

1. ~~Schema + RLS + seed de dados fake (só SQL, nenhuma UI)~~ — feito
2. ~~Auth e layout base~~ — feito
3. ~~Tela de cadastro de entrega — cronometrar aqui~~ — feito. Inclui a lista de
   entregas de hoje como tela pós-login e o registro de pagamento previsto +
   divergência com justificativa (originalmente escopado pra sessão própria,
   mas pequeno o bastante pra entrar aqui)
4. ~~Lista do dia com Realtime~~ — feito. `entregas` sincroniza ao vivo entre
   abas/dispositivos; `pagamentos`/divergência ainda não está na publication
   do Realtime, só atualiza ao revalidar
5. ~~Tela de assinatura no tablet~~ — feito. Uma tela só: escolhe motoboy,
   marca vales pendentes (sem corrida ainda), assina, confirma — cria
   `corridas` + `assinaturas` + atualiza as entregas junto, não é fluxo em
   duas etapas. Assinatura é do motoboy na retirada (custódia/
   responsabilidade), não prova de chegada no endereço — isso exigiria GPS,
   que está fora de escopo. `signature_pad` instalado (já estava na stack).
6. ~~Retorno / fechamento de corrida~~ — feito. Tela lista corridas abertas
   → escolhe uma → marca cada vale Entregue/Insucesso (motivo obrigatório
   no insucesso) → fecha a corrida. Testado ponta a ponta.
7. ~~Relatórios~~ — feito. Aba com filtro de período, resumo geral, tabela
   por motoboy e tabela por agência. Só números e tabela — sem gráfico, sem
   PDF, agregação client-side.
8. ~~Fila offline~~ — feito. Cobre as 5 escritas do app (entrega,
   transferência, corrida/assinatura, divergência, fechamento de corrida).
   Ver nota na lista "Dentro" pro detalhe de como cada uma ficou idempotente.
9. ~~Cadeia de custódia (Romaneio de Saída)~~ — feito em 2026-08-16, em
   seis etapas, cada uma testável por si: (1) autoria derivada da sessão,
   (2) credencial física e PIN, (3) romaneio, canônico e transação
   atômica, (4) fila offline com dono e envelope, (5) tela da Nova
   Corrida, (6) custódia no vale e página do romaneio. Ver "Cadeia de
   custódia" acima.
10. ~~Envio do romaneio ao Drive~~ — feito em 2026-08-19. Botão por
    romaneio e **sangria no fim do dia** (aba Fechamento), em
    `Romaneios › Filial › mês › dia › via`. Testado contra o Google de
    verdade. Ver "Google Drive" acima.
11. **Romaneio de Retorno** — **desenho fechado em 2026-08-19, código não
    começado.** Outra frente de seis etapas; as decisões estão na seção
    "O Romaneio de Retorno" acima e precisam ser lidas antes da primeira
    linha. A etapa perigosa é a 2, o canônico — dois gêmeos
    TypeScript/SQL de novo, com mais campos que o da saída.

---

## Convenções

- Domínio em português (`entregas`, `mototaxistas`, `valor_compra_cents`),
  código em inglês (`function createDelivery`)
- `snake_case` no banco, `camelCase` no TypeScript
- Tipos gerados via `supabase gen types typescript`. Não escrever tipo de tabela na mão.
  **Ainda não configurado neste projeto** (exige CLI logada/linkada, nunca foi pedido) —
  por enquanto os arquivos em `src/data/*.ts` usam tipos `Row` manuais e estreitos
  (só as colunas de fato selecionadas), cada um com comentário `// TODO: substituir
  por Database[...] quando supabase gen types estiver configurado`. Quando configurar,
  trocar todos de uma vez, não um de cada vez.
- Migrations em `supabase/migrations/`. **Nunca alterar schema pelo dashboard.**
- **Biblioteca pesada entra por `await import()` e por `optimizeDeps.include`
  no `vite.config.ts`, sempre as duas coisas.** São três hoje —
  `exceljs`, `jspdf` e `jspdf-autotable` — e todas só
  descem quando alguém abre a tela que precisa delas. O import dinâmico
  faz o code splitting no build; o `optimizeDeps` resolve um problema só
  de desenvolvimento: sem ele o Vite descobre a dependência no instante em
  que o import roda, re-otimiza o cache no meio da sessão, e a página
  aberta segura uma URL com hash vencido que passa a responder 504 —
  aparecendo como `Failed to fetch dynamically imported module`. Um reload
  resolve, mas o erro cai justamente na primeira vez que alguém usa a
  tela, e parece bug do app.
- `src/components/` (UI), `src/pages/` (telas), `src/data/` (acesso a dados),
  `src/lib/` (utilitários)
- Valores monetários: helpers em `src/lib/money.ts` — `centsFromDigits(digitos)`,
  `formatCentsInput(cents)` (máscara de digitação) e `formatBRL(cents)` (exibição).
  Nenhum outro lugar do código faz conversão.
- **Campo de dinheiro é sempre `<CampoMoeda>`**, nunca `<Input>` cru. O caixa digita
  só dígitos e eles preenchem da direita (centavos primeiro), igual maquininha de
  cartão: `1` `2` `3` `4` `5` → `0,01` → `0,12` → `1,23` → `12,34` → `123,45`. Ele
  nunca digita `,` nem `.`, então não existe como confundir os dois. O estado do
  componente pai guarda a string de dígitos crua, não o texto formatado.
- **Transferência tem aba própria** (2026-08-12). "Hoje" e "Histórico"
  filtram `tipo = 'cliente'`; a aba "Transferências" filtra o contrário e
  não corta por dia — o volume é baixo, então a mesma lista paginada serve
  de movimento do dia e de histórico. Lá as colunas de venda (Compra e
  Pagamento) são escondidas via `ocultarVenda`, porque seriam "—" em 100%
  das linhas. Query key própria (`transferencias`), então **toda
  invalidação que mexe nos dois tipos precisa citar as duas** — corrida,
  fechamento de corrida, cancelamento e o Realtime já citam.
- **`vales-para-saida` é a query key mais perigosa do app**, e cair na
  mesma armadilha aqui custa mais caro. Ela alimenta a lista de onde o
  caixa escolhe o que vai sair fisicamente da farmácia; servindo dado
  velho, ele manda o mesmo vale duas vezes, e o servidor só recusa depois
  de duas assinaturas colhidas e um romaneio de conflito criado. Por isso
  ela tem `staleTime: 0` (única no projeto), é invalidada por toda
  operação que muda quais vales estão pendentes **e** pelo selo online
  (que não passa pela fila), e a tela ainda esconde vale que já está numa
  operação da fila — offline o vale continua `pendente` no servidor, então
  sem isso ele sairia duas vezes de verdade.
- **A lista de vales não rola pra o lado.** Do número do vale ao "⋮" tem que
  caber na largura da tela — o caixa está com fila no balcão e não vai
  arrastar tabela pro lado pra achar o menu de ações. A `Table` do shadcn põe
  `whitespace-nowrap` em toda célula, então coluna de texto livre (cliente
  com endereço, forma de pagamento, quem registrou) leva `COLUNA_TEXTO` em
  `EntregasTable.tsx` pra poder quebrar linha. Quebrar, não truncar:
  endereço em duas linhas é melhor que endereço cortado. Coluna nova ali é
  decisão de custo — cada uma empurra o "⋮" de volta pra fora.
  - **Cliente e endereço moram na mesma célula**, empilhados. Separados
    custavam ~360px pra responder uma coisa só ("pra quem e onde"), e foi
    isso que pagou a coluna "Usuário" sem trazer a rolagem de volta.
  - **Cliente tem largura fixa (`w-56`), e é a única que tem.** Com a
    tabela em `w-full`, a sobra é repartida proporcionalmente e quem mais
    recebe é a coluna de maior conteúdo — Cliente. Como ela é também a
    única alinhada à esquerda, essa sobra virava um vão morto à direita do
    texto (chegou a 90px com um endereço longo) e afastava o nome do resto
    da linha. Fixando a largura, o endereço longo quebra em duas linhas em
    vez de esticar a coluna, e a sobra vai pras centralizadas, onde se
    divide dos dois lados e não incomoda. **Não resolver isso com uma
    coluna `w-full` no fim**: aquilo espreme as demais até o *mínimo* e um
    endereço longo passa a quebrar em quatro linhas.
  - **O selo "Transferência" mora na coluna Cliente**, na primeira linha,
    com a rota logo abaixo ("Matriz para Filial 02"). Ele já esteve ao lado
    do número do vale e de lá inflava a largura mínima daquela coluna por
    causa de poucas linhas — todo vale normal herdava o espaço vazio. Na
    Cliente ele ocupa a linha do nome, que na transferência guardaria só a
    filial de destino, já dita por extenso na rota. O selo vai dentro de um
    `flex`: como item de linha de texto ele herda espaço de baseline e
    deixa a linha 2px mais alta que as outras.
  - **Data em cima, hora embaixo, sempre**, em duas linhas explícitas. Se a
    célula quebrar sozinha, o resultado depende da largura sobrando e um
    vale aparece diferente do vizinho.
  - **Linha de apoio não usa `text-muted-foreground`** — aquele cinza
    (`oklch(0.556)`) é claro demais pra informação que o caixa lê de fato.
    O padrão é o texto principal a 70%.
  - **Colunas centralizadas, cabeçalho junto — menos Cliente.** Título e
    conteúdo dividem o mesmo centro; centralizar só um dos dois dá a mesma
    sensação de desalinho, invertida, e o status (pastilha estreita) era o
    que mais denunciava. **Cliente é a exceção e fica à esquerda**: ali são
    duas linhas de texto livre, e centralizar deixa nome e endereço com
    recuo diferente um do outro em cada linha da tabela. Regra prática:
    texto corrido lê melhor a partir de uma margem fixa; número, status e
    data leem melhor centralizados.
  - O centro vem de uma classe **por célula**, não de um `[&>td]:` na
    linha: o seletor da linha tem especificidade maior que a classe da
    célula, então a exceção do Cliente perderia justamente pra regra que
    ela deveria contrariar.
  - **A linha inteira é `align-top`.** A `TableCell` do shadcn é
    `align-middle`, e como Cliente e Data ocupam duas linhas enquanto
    valor/status ocupam uma, os de uma linha ficavam centralizados — 9px
    abaixo do nome do cliente, com cada coluna começando numa altura
    diferente. Célula de altura mista sempre alinha pelo topo aqui.
- **`<html lang="pt-BR">`, e isso não é acessibilidade.** Era `"en"`,
  sobra do template do Vite. Com a página inteira em português, o Chrome
  concluía que precisava **traduzir** — e o tradutor reescreve os nós de
  texto. Apareceu em uso real como a aba "Transferências" renderizando
  literalmente **"s"**. O que torna esse bug caro é onde ele NÃO aparece:
  nem no fonte, nem no bundle (conferi os dois), nem num render isolado
  em outro navegador. Só na máquina com tradução ativa. Se algum dia
  surgir texto truncado ou trocado sem explicação, **suspeite do tradutor
  antes de suspeitar do React**.

  São **duas travas, e elas respondem a coisas diferentes** — não mexa
  numa achando que a outra cobre. `lang="pt-BR"` tira o MOTIVO da
  tradução automática (o Chrome só oferece quando acha que a página está
  noutra língua); `translate="no"` no `<html>` mais
  `<meta name="google" content="notranslate">` fecham também o pedido
  MANUAL pelo menu. A segunda trava é herdada pela árvore inteira
  (`document.body.translate === false`), então não precisa ser repetida
  por elemento. Aqui isso vale a pena: não há o que ganhar traduzindo uma
  tela operacional em português pra quem fala português, e há o que
  perder — vale, valor, endereço e status reescritos em silêncio.
- **`navigator.onLine` no JSX é sempre bug; use `useOnline()`.** Ler
  direto no render devolve o valor certo, mas nada faz o React renderizar
  de novo quando a rede cai — não há listener de `online`/`offline` em
  lugar nenhum do app fora da fila. Quem tirasse a rede com a Nova Corrida
  aberta continuava vendo "Confirmar saída" e nenhum aviso. É da família
  do defeito do PIN: **a tela afirmando algo que ela não sabe** — ali o
  botão dizia "identidade conferida" tendo checado só formato; aqui ele
  prometia selo imediato quando o clique só ia enfileirar. Reproduzido
  lado a lado no navegador antes de corrigir. `src/lib/useOnline.ts`
  (`useSyncExternalStore`) resolve a exibição.
  **Mas a DECISÃO continua lendo `navigator.onLine` na hora da ação** —
  entre o render e o clique a rede muda, e ali vale o instante da ação,
  não o do último render. Os dois usos convivem no mesmo arquivo de
  propósito.
- **Sem router.** Não está na stack. Navegação é troca de estado local (`useState<View>`)
  dentro de `Painel.tsx`, com `onVoltar` como prop pra cada tela voltar pra lista. Isso
  aguenta bem o tanto de telas que o MVP tem hoje — se crescer muito mais, reconsiderar
  (mas aí é conversa pra ter, não decisão unilateral).
- **Login é e-mail/senha (Supabase Auth nativo), não usuário.** Pra ficar rápido de
  digitar sem construir um sistema de username de verdade, contas usam e-mail curto
  e fake tipo `caixa1@drogariacidade.local` (não precisa ser e-mail real — não tem
  fluxo de "esqueci minha senha" nem confirmação por e-mail). Decisão consciente,
  não workaround temporário. Contas são criadas pelo painel de admin (o `email_confirm`
  já vem marcado pela Edge Function justamente por isso); só a **troca de senha**
  continua manual no Supabase.

---

## Segredo nenhum no repositório

O repo é privado, mas isso não é desculpa pra relaxar: privado protege de
estranho, não de acidente (repo vira público, alguém ganha acesso, um fork
sai).

- **`.env` está no `.gitignore` e nunca foi commitado.** Conferido no
  histórico inteiro em 2026-08-10, antes do primeiro push.
- **A `service_role` nunca entra aqui** — nem no código, nem em nota, nem
  em exemplo. Ela vive só como variável de ambiente das Edge Functions.
- **Credencial de conta real não vai em arquivo de projeto**, incluindo o
  `NOTAS.md`. Isso já foi violado uma vez: as contas de teste
  (`adminteste@…`, `caixateste@…` e as criadas pelo painel) foram anotadas
  lá com senha, e subiram no primeiro push. São logins **válidos** de um
  Supabase de produção, um deles admin. Se as senhas ainda não foram
  trocadas, trocar em Authentication → Users resolve na raiz — inclusive
  pro histórico já gravado, que não vale reescrever (o `NOTAS.md`
  referencia hashes de commit).

Se precisar anotar credencial pra retomar trabalho, o lugar é fora do
repositório.

---

## Como trabalhar comigo

- Antes de criar tabela nova, mostrar o SQL e esperar confirmação
- Se um requisito conflita com as regras invioláveis, **parar e dizer** — não contornar
- Não adicionar feature que não está na lista "Dentro"
- Ao terminar uma sessão, dizer o que dá pra testar e como
