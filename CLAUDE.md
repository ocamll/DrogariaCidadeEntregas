# Sistema de Tele-entrega — Farmácia

> **LEIA ANTES DE CONSTRUIR: `docs/escopo-pre-v1-revisado.md`.** Em
> 2026-09-08 o usuário fechou um escopo pré-V1 revisado que muda decisões
> estruturais deste arquivo — um vale só, convênio genérico, fim da forma
> "Outro", fechamento com aprovação, painel da agência e filial operacional
> do admin — **esta última revista em 2026-09-11: o admin não opera por
> filial** (ver "E10").
>
> **Passo 1 e o "Outro" CONSTRUÍDOS (2026-09-10); passo 2 CONSTRUÍDO,
> APLICADO e aceito em 2026-09-11; passo 3 CONSTRUÍDO e APLICADO em
> 2026-09-11; o resto não.** Cada seção afetada aqui traz uma nota
> datada de 2026-09-08 dizendo o que foi decidido e o que o código ainda
> faz. Onde as duas coisas divergirem, **o código é o que está no ar e o
> escopo é para onde ele vai** — não confunda um com o outro, e não trate
> a nota como descrição do comportamento atual.
>
> A sequência está em "Ordem de construção", no fim — **revista em
> 2026-09-11 pelo plano de execução `docs/plano-pre-v1-2026-09-11.md`**, que
> manda sobre o escopo revisado onde os dois divergirem.
>
> O documento companheiro é `docs/analise-limpeza-pre-v1.md` — a auditoria
> de limpeza do commit `bc7062a`, com achados técnicos referenciados linha
> a linha. **Ela é anterior**: onde as duas divergirem (convênio integral,
> cadastro de convênios, adiamento do E10.2+), **manda o escopo revisado**,
> e ela própria diz isso na abertura.

## O que é

Sistema complementar ao ERP **Trier** para registro de tele-entregas de farmácia.
Substitui dois formulários manuscritos que o caixa preenche hoje a cada entrega.

**Não** substitui o Trier. **Não** emite documento fiscal. **Não** toca no banco do Trier.

Usuário principal: operador de caixa, PC Windows com Chrome, com fila de cliente
esperando no balcão. Velocidade de digitação é o requisito número um.

Usuário secundário: mototaxista, que só encosta num tablet para assinar —
**desde a decisão de 2026-09-11, para passar o cartão e digitar o PIN**: a
assinatura manuscrita sai do sistema (ainda não construído; ver "Cadeia de
custódia").

A farmácia real tem **18 filiais**, espalhadas por mais de uma cidade
(o banco de desenvolvimento já tem as oito de São Gabriel, medido em
2026-09-11) — o sistema já
suporta múltiplas lojas de ponta a ponta (entregas escopadas por
`loja_id`, transferência entre filiais, relatórios e Registro de
Auditoria filtráveis por filial). Só a **criação** de loja nova continua
manual via SQL, decisão consciente (filial é rara; usuário, que tem
rotatividade, já se cria pelo app — ver "Gestão de usuários" abaixo) —
não confundir isso com "não suporta multi-loja".

**As de SÃO GABRIEL/RS são oito**, levantadas em 2026-08-25: Matriz,
Filial 02, 04, 09, 10, 12, 15 e 18, todas com tarifa de R$ 9,00 e
atendidas pela agência **Gabrielense**. O SQL delas está pronto em
`scripts/corte-pre-v1.sql` (bloco 4); as outras cidades entram depois.

**Os números são da REDE, não da cidade** — por isso a sequência daqui é
esburacada, e os que faltam estão nas outras cidades. Ninguém deve
renumerar pra fechar os buracos: o número é como a farmácia chama a loja,
e mudá-lo quebraria a correspondência com a placa da porta, com o Trier e
com as pastas já criadas no Drive.

E **cidade nova custa mais que lojas**: pela regra de uma agência de tele
por cidade (ver "Cidade, filial e agência"), é `cidades → lojas →
agencias → mototaxistas → credenciais`. Só as lojas as deixaria sem
agência que as atenda — cadastradas e inoperantes, o mesmo modo de falha
da agência sem cidade.

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
  Uma linha de `pagamentos` por forma, dos **dois** lados: **o previsto também é
  1:N desde o E4** (2026-08-27) — o cadastro aceita até 3 formas previstas, e o
  realizado até 4 (ver "Duas formas de pagamento" abaixo). A cardinalidade é 1:N de
  verdade, não só previsto/realizado.

  **`pagamentos` NUNCA teve unique em `(entrega_id, momento)`** — o banco sempre
  aceitou N. O 1:1 vivia só num default do cliente (`id` do previsto derivado do
  uuid da entrega), removido no E3. Não houve constraint a derrubar nem backfill.

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
      (admin/gerente), sub-abas pra cada entidade. **O cadastro de
      CONVÊNIOS saiu** (decidido em 2026-09-08, construído em 2026-09-10 —
      ver "Convênio genérico" abaixo); agências e mototaxistas ficam.
      Tabelas já existiam desde
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
      `convenio_id` + `status_documental='pendente'`) — **o select saiu em
      2026-09-10 e `convenio_id` passou a nascer nulo; a pendência de papel
      continua, derivada da FORMA `convenio`/`crediario`, que é como o
      código já a deriva** — e checkbox "Precisa
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
      nome/cargo/filial e bloqueia/libera acesso. Trouxe a primeira (e
      única) peça de backend do projeto — ver "Gestão de usuários" abaixo,
      que é onde estão as regras que não dá pra descobrir lendo só o código.

### Fora — não construir, não sugerir, não "já que estou aqui"

Onboarding de tenant, tela de cadastro de farmácia, cobrança **do SaaS**,
subdomínio, integração com Trier, leitura de QR de NF-e, app nativo,
notificação WhatsApp, tarifário por bairro, dashboard com gráfico, conciliação
de cartão por NSU, encadeamento de hash entre eventos, tela de fechamento
mensal, tela de cadastro de loja/filial/cidade nova
pela UI (continua manual via SQL, filial é rara e cidade mais ainda —
**não confundir com suporte a múltiplas lojas, que já existe** de ponta a
ponta; a farmácia real tem 18 filiais).

**"Cobrança" aqui é a do SaaS** — cobrar a farmácia pelo uso do sistema.
**Não** é a cobrança que a AGÊNCIA apresenta à farmácia, que é o passo 6
do escopo revisado e está dentro. As duas se chamavam igual, e a
desambiguação entrou em 2026-09-08 para a lista não ser lida como
proibição do que foi decidido construir.

**O PORTAL DA AGÊNCIA SAIU DESTA LISTA EM 2026-09-08**, por decisão
explícita do usuário (`docs/escopo-pre-v1-revisado.md`, seção 5). Ele
deixou de ser recusa e virou o passo 6: a agência apresenta uma cobrança
discriminada e a farmácia a confere contra as próprias operações. **Nada
disso está construído**, e é a maior frente nova do escopo — amplia
usuários, permissões, dados e fluxo de aprovação, não é limpeza de código.
O que a lista continua proibindo é o resto: subdomínio, onboarding,
cobrança do SaaS.

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

> **NA TELA CHAMA-SE "CARGO" — decidido em 2026-09-08, aplicado em
> 2026-09-11** (seção 6 do escopo revisado, passo 2). O rótulo de produto é
> **Cargo**, inclusive na listagem de usuários. **A coluna interna continua
> `papel`**, e renomear literais em RLS, autenticação, `profiles.papel`,
> `tipo_signatario` ou `papel_no_momento` **não faz parte disso** — são
> literais que entram em policy e em hash, e trocá-los quebraria
> verificação de documento já assinado (ver a armadilha do `|caixa|` na
> seção do Romaneio de Retorno).

**A filial é do cargo** — passo 2, 2026-09-11:

| cargo | filial no cadastro |
|---|---|
| caixa, gerente | **obrigatória** — a tela recusa, a Edge Function recusa **antes** de criar o login, e o banco recusa pelo CHECK `profiles_filial_obrigatoria` (migration `20260911120000`) |
| admin | **nenhuma** — o formulário esconde o campo e grava nula, na criação e na edição; a lista mostra "Todas as filiais" |

**Admin antigo com filial NÃO foi atualizado em massa.** O perfil fica como
está até alguém salvá-lo pelo formulário, e aí perde a filial. Não escreva
"nenhum admin tem filial": nenhum admin **novo ou editado** tem. E para o
que a tela decide — a lista, as ações de lançamento — quem manda é o
cargo, nunca `lojaId`.

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

## E10 — admin operando por filial

Pedido em 2026-09-01: o admin **enxergar e filtrar** cada filial (isso já
existe em cinco telas) e **operar em nome de qualquer uma**. Contrato
original nos **itens 91 e 92 do `NOTAS.md`**.

```
E10.1  servidor     ✓ APLICADO   migration 20260902120000
E10.2  cliente      ✗ NÃO SERÁ CONSTRUÍDO — decisão de 2026-09-11
E10.3  seletor      ✗ idem
E10.4  três telas   ✗ idem
```

**REVISTO EM 2026-09-11, olhando a operação real: o admin acompanha todas
as filiais, mas não lança vale.** Por isso a seleção de filial operacional
não existe — nem provider, nem seletor "OPERANDO EM", nem
`sessionStorage`, nem escolha no login, nem congelamento de filial por
formulário, nem campo novo na fila. Isso substitui, **nesse ponto**, a
seção 6 do escopo revisado e a nota de 2026-09-08 que tornava o E10.2+
obrigatório (item 100 do NOTAS).

A razão: **"todas as filiais" é escopo de CONSULTA; um vale sempre pertence
a UMA filial.** Um seletor global criaria escolha desnecessária e risco de
lançar na filial errada — e uma tela em que o cabeçalho diz B enquanto o
formulário segue em A. O congelamento protegeria o dado; a divergência de
contexto continuaria difícil para quem usa.

**O que o admin tem hoje:**

- **não vê "Nova entrega" nem "Transferência"** (`Painel.tsx`). Decide o
  **cargo**, nunca `profile.lojaId` — o admin antigo com Matriz no perfil
  também não vê;
- **isso é UX, não revogação.** A RLS de `entregas` continua aceitando
  admin em qualquer filial do tenant, e nenhuma permissão SQL mudou. Não
  apresente a falta dos botões como controle de acesso;
- **consultas de todas as filiais e filtros por filial continuam**;
- **Nova corrida e Retorno de corrida também saem da experiência do admin**
  (revisão de 2026-09-11): saída e retorno são ações do balcão. O gate de
  cargo cobre os botões e os destinos de navegação; vale igualmente para
  admin sem filial e admin legado com filial. Caixa e gerente mantêm os
  quatro fluxos operacionais. As permissões SQL permanecem inalteradas.

**O E10.1 FICA**, e a regra dele continua valendo para qualquer coisa nova
dentro das funções de selo:

```
o ator é o PARÂMETRO, não a sessão

  p_caixa_id          NUNCA auth.uid()
  v_papel <> 'admin'  NUNCA is_admin()
  v_loja_do_ator      NUNCA current_loja_id()
```

A porta sincronizada é chamada pela Edge Function como `service_role`, onde
**`auth.uid()` é NULL**. Uma guarda escrita com `is_admin()` recusaria
**toda saída offline**, meses depois, sem ninguém ligar o sintoma à guarda.
A guarda protege a selagem e **não pressupõe** que exista tela de operação
para admin.

**Se um dia o admin passar a lançar vale, é decisão de produto NOVA**, não
retomada de pendência. O item 91 fica como registro do desenho de
2026-09-01; os dois arquivos que chegaram a ser escritos para ele foram
apagados sem nunca entrarem num commit.

---

## Fechamento de caixa e o eixo financeiro

> **ESTE FLUXO SERÁ SUBSTITUÍDO — decidido em 2026-09-08, código não
> começado** (passo 5, seção 4 do escopo revisado). O sistema passa a
> **preparar** o fechamento: resumo calculado, exceções destacadas como o
> trabalho do gestor, observações, e **aprovação auditável** de uma versão
> determinada — com responsável, horário, escopo e os dados usados na
> comparação. Hoje existe só "Marcar dia como conferido", e **não existe
> entidade de fechamento aprovado**.
>
> Três regras novas que valem desde já: **fechamento calculado não é
> fechamento aprovado**; ausência de cobrança da agência **não** significa
> diferença zero, e uma comparação incompleta tem que dizer isso em vez de
> aparecer como conciliada; e um retorno offline que chegue depois da
> aprovação **não muda o aprovado em silêncio** — apresenta a alteração e
> abre revisão.
>
> Duas coisas medidas no código atual que o passo 5 tem que resolver:
> `data/fechamento.ts` filtra `.eq('tipo','cliente')` e usa
> `buscarComTeto(LIMITE_FECHAMENTO)` — **não se aprova soma truncada**, e
> um fechamento financeiro completo inclui os serviços efetivamente
> cobrados, transferências incluídas quando aplicável.
>
> **O que continua valendo integralmente é o argumento do "não inventar o
> número"**, mais abaixo. Ele fica ainda mais importante quando houver
> cobrança da agência para comparar: é ela que fecha a conta, não uma
> estimativa nossa.

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

> **UM VALE, SEM ADICIONAL — decidido em 2026-09-08, CONSTRUÍDO em
> 2026-09-10.** É o passo 1 do escopo pré-V1 revisado
> (`docs/escopo-pre-v1-revisado.md`, seção 1). O seletor de 1/2 vales
> saiu do cadastro e a tarifa não é mais multiplicada. Provado de ponta a
> ponta com o vale de teste `V-000062`, lido de volta do banco:
> `quantidade_vales = 1`, `entrega_paga_cliente_cents = 0`,
> `convenio_id = null` e entrega de 900.
> **Os vales anteriores continuam com os valores de quando nasceram** —
> é por isso que a fórmula do "a pagar" abaixo não se simplifica.

- **A tarifa é fixa por filial** (R$ 9,00 hoje), em `lojas.tarifa_entrega_cents`.
  O caixa nunca digita valor de entrega **e não escolhe quantidade**: cada
  vale custa a tarifa acordada da filial.
- **O vale a farmácia sempre deve à agência.** Ela recupera do cliente
  quando a compra é abaixo de R$ 100 (a taxa entra no valor da compra, que
  **já vem somada do Trier** — o sistema não soma nada, e não deve passar a
  somar: viraria cobrança dobrada) e absorve quando é acima. Nos dois casos
  ela deve os R$ 9 à agência, então isso não muda o acerto e não virou coluna.
- **Uma fonte só para a tarifa acordada**, hoje 900 centavos, mais o valor
  registrado na operação. Não espalhar o literal `900` entre telas, e
  **não usar o preço enviado pela agência como referência de "taxa
  correta"** — é justamente ele que a conferência do passo 6 existe pra
  comparar.
- **Tentativa sem entrega também gera vale cobrável, e cada nova tentativa
  gera OUTRO vale** — decidido em 2026-09-11
  (`docs/plano-pre-v1-2026-09-11.md`). Cliente ausente ou endereço errado
  não apagam o serviço. O vale da nova tentativa fica ligado à MESMA
  compra, e o valor da compra **não** soma de novo no fechamento. **Não
  construído:** hoje um vale que já entrou numa corrida não sai outra vez.

**O que a farmácia deve = `valor_entrega_cents - entrega_paga_cliente_cents`.**
Na tela isso se chama **"A pagar à agência"** (ou só "A pagar" nas colunas
do relatório) — "Farmácia deve" foi trocado a pedido do usuário em
2026-08-12. O campo em código continua `valorFarmaciaDeveCents`.

**A fórmula NÃO se simplifica para `valor_entrega_cents`**, mesmo com a
parcela nova sempre zerada: os vales históricos têm
`entrega_paga_cliente_cents` maior que zero, e trocar a conta reescreveria
o acerto do passado. Ela nasceu de um bug real — o relatório somava o
total como se a farmácia devesse tudo, e o acerto vinha inflado em toda
entrega distante.

### O que sai, e o que NÃO sai junto

Sai da **tela e da regra**: o seletor de um/dois vales, os estados e
mensagens de endereço distante, a multiplicação da tarifa, a distinção de
quem paga o extra, os totais específicos desse adicional, e a flag
`farmacia_paga_entrega_integral` (com ela, a exceção do convênio que
bancava os dois vales).

**Não sai do banco nem do contrato.** `quantidade_vales`,
`entrega_paga_cliente_cents` e `convenio_id` **fazem parte da linha `v` do
DCR1** (`canonico.ts`, e o gêmeo `romaneio_canonico`). A transição é:

```
registros NOVOS   quantidade_vales = 1
                  entrega_paga_cliente_cents = 0
                  convenio_id = null
serialização      PRESERVADA — os campos continuam na linha canônica
```

**Nunca encurtar a linha canônica só no frontend.** Eliminar campo do
contrato, se um dia for desejado, é alteração coordenada TS↔SQL feita **no
corte**, com os dois gêmeos mudando juntos.

E a razão original de as duas colunas serem guardadas em vez de derivadas
continua de pé para o histórico: dividir valor pela tarifa daria contagem
errada se a tarifa mudar, e a regra do convênio quebrava a derivação.

**Transferência entre filiais paga a mesma tarifa, sempre 1 vale** — e
esta parte **não muda nada**, porque já era assim.
Confirmado na farmácia em 2026-08-11: quem leva o produto de uma filial
pra outra é o motoboy da agência, e ela cobra por essa corrida como por
qualquer outra. Então o vale de transferência nasce com
`valor_entrega_cents` = tarifa da filial que **pediu** (é ela que paga) e
`quantidade_vales = 1`. `entrega_paga_cliente_cents` fica 0: não
há cliente pra pagar em mãos, a farmácia deve o valor inteiro. O que
continua zero é a **venda** (`valor_compra_cents`, nenhum `pagamentos`) —
transferência não é compra. Antes disso a transferência entrava no
relatório valendo nada, e o acerto com a agência vinha **menor** que o
real, o espelho do bug do endereço distante.

A tarifa é capturada no cadastro e vai no payload da fila offline, não
lida na hora do sync: se ela mudar enquanto o vale espera pra
sincronizar, o certo é gravar a de quando o vale foi criado.

---

## Duas formas de pagamento no cadastro

Construído em 2026-08-27 (E4). O previsto passou a ser 1:N, como o
realizado já era. Quase tudo que isso exigia **já estava pronto** — ver a
tabela no item 88 do NOTAS: o canônico do DCR1 (e o gêmeo TypeScript), o
payload, `romaneio_documentos_esperados`, o contexto do retorno e o
pré-preenchimento do Romaneio de Retorno já varriam N previstos. **Nenhuma
migration.**

- **O caminho de UMA forma não mudou um passo.** Com uma linha, o valor
  previsto **é** o da compra e o campo de valor nem existe na tela: mesmo
  número de teclas, mesma cadeia de Enter, mesmo orçamento de 25
  segundos. A segunda forma vem de um botão "+ outra forma" **fora da
  cadeia de Enter** — o custo cai só sobre o caso que o pede, 1 ou 2 em
  cada 30. Pôr "dividir" como opção do próprio select cobraria uma linha
  a mais do dropdown em toda entrega.
- **A soma tem que bater com o valor da compra**, e **forma repetida é
  recusada** — uma linha por forma. O caso real que a segunda regra pega
  é banal: o caixa clica "+ outra forma", não troca o select, e
  "Dinheiro" fica valendo duas vezes. Sem ela o DCR1 sairia com duas
  linhas `p` idênticas em conteúdo dentro de um documento assinado.
- **A LINHA QUE O CAIXA NÃO DIGITOU ABSORVE O RESTO** (2026-09-03,
  `resolverValoresDasFormas`). Ele digita R$ 100,00 no Pix e o Dinheiro
  já mostra R$ 37,43 — antes essa subtração era feita de cabeça, com fila
  no balcão e no número quebrado, que é quando a divisão acontece. Isso
  **generaliza a regra de uma forma só**: lá o valor É a compra e o campo
  nem aparece, porque com uma linha ela está determinada; com N, as N-1
  preenchidas determinam a última. Vale nas duas telas que dividem
  pagamento — cadastro e o dialog de divergência.

  **Vazio é o sinal**, e não há estado paralelo: `digitos` já separa
  "ainda não preenchi" de "é zero", que é o motivo de o `CampoMoeda`
  mostrar campo vazio em vez de "0,00". É **simétrico** (digitar na
  segunda faz a primeira derivar), e **não deriva** com duas ou mais
  vazias (repartir seria inventar uma divisão), com nenhuma vazia (o
  caixa determinou tudo) nem com resto ≤ 0 (R$ 0,00 é recusado pela
  validação logo depois, e negativo não cabe num campo de dígitos).

  Três coisas que quebram se alguém mexer sem ler: o payload sai de
  `valoresCents`, **nunca dos dígitos crus** — a linha derivada não tem
  dígitos, e relê-los gravaria zero na forma que a tela mostrava
  preenchida; o campo derivado usa `selecionaAoFocar`, senão digitar por
  cima empurra o número em vez de trocá-lo; e `removeForma` **limpa os
  dígitos ao voltar a uma linha só**, senão sobra um valor que o caixa
  não vê e não consegue corrigir, com o erro aparecendo no submit
  apontando pra um campo que não é renderizado. Pelo mesmo motivo a linha
  inicial do dialog **nasce vazia**: preenchê-la faria a derivação
  existir e nunca disparar.

  **O aviso passou a dizer o número, não só que não bate** —
  `faltam R$ 107,43` / `R$ 62,57 a mais que a compra` —, o que cobre
  também o caso em que a derivação não pode agir. Com nada digitado ainda
  ele é neutro, não vermelho: cobrar a soma ali acusaria o caixa de um
  erro que ele não cometeu.
- **O teto do cadastro é 3; o do dialog de divergência é 4, e a diferença
  é deliberada.** Não são o mesmo tipo de afirmação: aqui se **prevê** o
  que vai acontecer, lá se **registra** o que aconteceu. Ser mais
  permissivo no registro é o lado seguro de errar — recusar um fato
  consumado empurraria a correção pra fora do sistema. Recusar uma
  previsão custa um clique.
- **`status_documental` olha TODAS as formas** (`.some()`, nunca
  `.includes()` de uma só): basta uma prever convênio ou crediário pra o
  vale nascer com pendência de papel. É a mesma regra que
  `romaneio_documentos_esperados` aplica no servidor varrendo todas as
  linhas `p` — divergirem faria o retorno recusar
  `documentos_nao_conferem` **depois** de colhidas as duas assinaturas.
- **A validação acontece na TELA, antes de enfileirar — nunca em
  `criarEntrega`.** Revalidar na sincronização poderia recusar uma
  operação já aceita no balcão, e o item iria pra `erro` e pro backoff
  pra sempre, que é o pior sintoma conhecido do projeto.

**`divergiuDoPrevisto` é um GÊMEO, e ele nasceu de uma discordância
medida.** O servidor compara conjuntos de `forma|valor`
(`selar_romaneio_retorno_interno`); o cliente decidia por **contagem**
(`linhas.length > 1 || linhas[0].forma !== esperada`). Enquanto existia um
previsto só os dois concordavam por acidente — com dois, um vale previsto
`pix + dinheiro` e pago exatamente `pix + dinheiro` seria fiel pro
servidor e divergente pra tela. A ordenação dos dois lados **não** precisa
casar: cada um ordena os próprios conjuntos com o próprio comparador, e
igualdade de multiconjunto independe da ordem total escolhida. O que
precisa casar é a chave e o fato de duplicata contar.

**`pagamento_alterado` tem DOIS escritores**, e é fácil consertar um só. O
E3.B corrigiu o do servidor (`limit 1` → agrega todos); `marcarDivergencia`
ficou escalar até o E4. Quem mexer no `de` desse evento tem que mexer nos
dois — `eventos` é append-only, e evento errado não se corrige depois.

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

### Convênio genérico — decidido em 2026-09-08, construído em 2026-09-10

Passo 1 do escopo revisado (`docs/escopo-pre-v1-revisado.md`, seção 2).
**A forma de pagamento "Convênio" FICA**, e o documento que precisa
retornar também. O que sai é a **identificação da empresa**: Minerva,
Unimed ou qualquer outra. Regra comercial e detalhamento ficam no Trier.

```
SAIU   aba e componente ConveniosCadastro
       CRUD, queries e DTOs de convênios em data/cadastros.ts
       o seletor e a exigência de convenioId no cadastro de entrega
       as flags exige_assinatura e farmacia_paga_entrega_integral, da UI
       o modelo de semente de convênio em scripts/corte-pre-v1.sql

FICA   a forma de pagamento, o valor, o documento esperado,
       o recebimento, a pendência e a auditoria

AINDA  a tabela `convenios` e as duas colunas de flag, no banco —
NO     retirada física é migration própria, feita no corte, com as
BANCO  dependências da saída do romaneio ajustadas
```

**Isso quase não custa código, e a razão é boa:** a derivação do papel já
sai da **forma** (`convenio`/`crediario`, via `GERAM_DOCUMENTO_FISICO`), e
nunca de `exige_assinatura`. A custódia de papel não depende de saber qual
empresa é.

**Convênio e receita continuam documentos DISTINTOS.** Uma entrega pode
exigir os dois, e **receber a receita não pode quitar a pendência do
convênio**, nem o contrário. Esta decisão também **não** elimina
`crediario` nem `convcard`.

**Apagar a tela não apaga a tabela.** `entregas.convenio_id` é FK, e
`convenios` aparece na saída do romaneio
(`20260816140000_romaneio_de_saida.sql`). A retirada física da tabela, se
for desejada, é migration própria com as dependências ajustadas — e o
`convenio_id` continua na linha `v` do DCR1 de qualquer forma, nascendo
nulo. Ver "Tarifa de entrega e vales" para a regra da serialização.

---

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

> **A ASSINATURA MANUSCRITA SAI — decidido em 2026-09-11, NÃO CONSTRUÍDO.**
> Nas palavras do usuário: *"Não é para deixar assinaturas do sistema,
> apenas cartão e pin."* A evidência do motoboy passa a ser **cartão + PIN**;
> a da farmácia, a **sessão com um ato explícito de confirmar** o conteúdo.
> O **gerente ganha credencial própria** (cartão + PIN), usada quando o
> motoboy **perdeu o cartão**, na saída e no retorno — sem travar o fluxo. O
> documento registra que quem validou foi o gerente, sem fingir a validação
> do motoboy. PIN esquecido não precisa dela: redefine-se o PIN.
>
> Tudo o que esta seção descreve sobre traços (`strokes`, canvas, as duas
> assinaturas, `signature_pad`) **continua sendo o código de hoje** e sai no
> 4B, com versão nova das fórmulas de `signature_hash` e do hash do evento
> offline, lida da própria linha. **Os bytes de DCR1 e DCRR1 não mudam**: os
> traços nunca entraram no canônico. Detalhe na seção 12 de
> `docs/levantamento-4a-2026-09-11.md`.

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

  **ISTO DESCREVE O ESTADO DE HOJE, NÃO UMA INVARIANTE.** O **E12**
  (contrato fechado em 2026-09-03, item 94 do NOTAS, código não
  começado; **obrigatório antes do piloto desde 2026-09-11**, etapa 4C do
  plano) resolve exatamente este limite com **reserva antecipada de
  numeração** — o talonão: com internet, o terminal reserva um bloco de
  números; offline, o vale nasce com número **definitivo**, e a saída
  segue com romaneio assinado, canônico e hashes intactos, sem exceção
  nova na cadeia de custódia. Número reservado **nunca** volta ao pool.
  Quem for mexer nesta seção leia o item 94 antes.
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
- **`tipo_signatario` NUNCA é impresso como cargo.** O lado interno se
  chama **"farmácia"** na tela e no papel — `'caixa'` é o nome do slot e
  está dentro do hash, mas quem sela pode ser gerente ou admin, e o
  sistema não impõe papel na saída. O cargo real sai de
  `papel_no_momento`, e some quando a coluna é nula em vez de ser
  derivado de `profiles.papel`, que é o cargo de hoje. O mapa de rótulos
  mora em `src/lib/papeis.ts` e é o MESMO nos dois — página e PDF já
  divergiram uma vez, e uma segunda cópia do mapa seria o mesmo defeito.
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
- **O rodapé é o que prova**: `final_hash`, `document_hash`, IP e a
  frase de que **este PDF é uma renderização do registro, não a fonte da
  verdade**. A geolocalização saía aqui até 2026-09-04 — ver a seção
  dela abaixo.

`npx tsx scripts/romaneio-pdf.spec.mts` cobre 30 casos, e o primeiro é o
que importa: um romaneio cujo snapshot diverge de propósito do "dado de
hoje", exigindo que o PDF mostre o snapshot.
`scripts/romaneio-de-exemplo.mts` gera as duas vias com dado fictício,
pra conferir desenho sem depender do banco.

### Geolocalização: REMOVIDA em 2026-09-04

Existiu de 2026-08-18 a 2026-09-04, e saiu por decisão do usuário. O
argumento que a encerrou é o mais curto possível: **o que a coordenada
provava?** Que a selagem aconteceu na farmácia — que é onde ela sempre
acontece, por desenho. Ela nunca rastreou entrega e nunca afirmou nada
sobre a rua.

Custava permissão de navegador, timeout de 8s, lógica de cache, cinco
modos de falha e um spec inteiro. Valor operacional próximo de zero.

**O que saiu:** `src/lib/geolocalizacao.ts`, `geolocalizacao.spec.mts`, o
aquecimento nas duas telas, a captura na selagem, a linha da Custódia e
as duas linhas do PDF do romaneio.

**O QUE FICOU, E POR QUE NÃO É DESCUIDO:**

```
envelope.ts        o campo `geolocalizacao` na assinatura de
                   calcularOfflineEventHash — e ele entra na FÓRMULA
sync-romaneio      a cópia GÊMEA da mesma fórmula
romaneios.ts       p_geolocalizacao: null nas duas RPCs
```

A fórmula serializa `null` como `-`, e a Edge Function já fazia
`corpo.geolocalizacao ?? null`. Passando `null` de um lado e omitindo o
campo do outro, **os dois gêmeos continuam produzindo bytes idênticos** —
provado por `offline-hash.spec.mts` ("os dois lados concordam") e pelos
três hashes congelados em `envelope.spec.mts`.

Remover o campo da fórmula mudaria um lado só, e o sintoma seria o pior
do projeto: a saída offline deixaria de sincronizar, sem erro legível. O
campo sai junto com o envelope inteiro, na etapa seguinte da limpeza.

**Nada no SQL foi tocado.** `p_geolocalizacao` continua existindo nas
funções e `romaneios.geolocalizacao` continua sendo coluna — as duas
recebem `null` daqui em diante. A limpeza do schema vai junto com a
remoção das assinaturas, que já reabre aquelas funções de qualquer jeito.


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

**A saída continua `caixa`. O retorno nasce `responsavel_loja`.**
Decidido em 2026-08-19, e não é meio-termo: são dois momentos com regras
diferentes. Na Nova Corrida quem entrega a custódia é o caixa; no retorno
quem recebe pode ser caixa, gerente ou admin, e o rótulo tem que
comportar os três.

A vantagem prática decidiu: **`selar_romaneio_interno` e a fórmula do
hash da saída não são tocados**. Reabrir a função mais crítica do projeto
por uniformidade conceitual seria risco sem retorno.

Se um dia a regra de negócio disser que outra pessoa pode entregar a
corrida na saída, aí sim reconsiderar — como decisão funcional própria,
nunca preventivamente.

O retorno guarda também **`papel_no_momento`** (`caixa` | `gerente` |
`admin`), e a tela mostra "Recebido por Ana Souza — Gestora".

**Ressalva medida em 2026-08-19, e ela vale para quem for construir:** o
sistema **não impõe** que a saída seja feita por um caixa. "Nova corrida"
não tem gate de papel — o botão aparece para qualquer autenticado — e
`selar_romaneio_interno` só checa escopo de filial. Então um gerente pode
selar uma saída hoje, e a linha fica `tipo_signatario = 'caixa'` com o
`user_id` dele. O rótulo é **estrutural** ("o lado da farmácia"), não uma
afirmação sobre o cargo de quem assinou — e é assim que ele deve ser
lido e exibido, sob pena de a tela afirmar o que não sabe.

Por isso, decidido junto: **a saída passa a gravar `papel_no_momento`
também**, na etapa 2. É uma coluna a mais no INSERT da assinatura, lida
de `profiles` no instante da selagem — **não encosta na fórmula do
hash**, que continua idêntica byte a byte. Sem ela, responder "quem
entregou essa corrida, caixa ou gerente?" seis meses depois exigiria
olhar `profiles.papel`, que é o papel de hoje.

A distinção que torna isso seguro, e que precisa continuar valendo:
**a identidade do signatário interno nunca vem do cliente.** Online,
`selar_romaneio` sequer aceita um `p_caixa_id` — passa `auth.uid()`.
Offline, a Edge Function valida o JWT, confere contra o dono da operação
na fila e passa `p_caixa_id: auth.user.id`. Ler `profiles` por esse id é
ler o cargo de uma identidade já provada. **Se alguém um dia fizer o id
entrar por parâmetro do cliente, `papel_no_momento` vira registro falso
com cara de auditoria** — pior que não ter.

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

#### As etapas, e o gate que a 2A impõe

1. **Schema** — feito e conferido em 2026-08-19
   (`20260819120000_romaneio_de_retorno_schema.sql`), com as consultas de
   pré e pós-voo no próprio arquivo.
2. **2A — prova de integridade e canônico. GATE OBRIGATÓRIO.**
   Nenhuma linha de `selar_romaneio_retorno` antes desta fechar:
   1. ~~verificador de hash dos romaneios de saída~~ — **feito**
      (`20260819130000_verificador_de_hash.sql`)
   2. ~~rodar contra os reais e registrar o baseline~~ — **feito**:
      `9 verificados · 9 válidos · 0 divergências`
   3. ~~golden vectors do DCRR1, revisados à mão~~ — **feito**: 8 válidos
      e 12 inválidos, 209 asserções (`scripts/dcrr1-vetores.mts`). Os
      inválidos congelam **o que é PERMITIDO serializar**, fechando a
      divergência "TS aceita, SQL rejeita" — que bytes idênticos para
      entradas válidas nunca pegariam
   4. ~~canônico do retorno em TypeScript, conferido contra os
      vetores~~ — **feito** (`src/lib/canonicoRetorno.ts`), com as três
      responsabilidades separadas: validar, normalizar, serializar
   5. ~~canônico do retorno em SQL, conferido contra os MESMOS
      vetores~~ — **feito e conferido no banco em 2026-08-19**
      (`20260819140000_canonico_retorno.sql`): **36 de 36**, ou seja os 8
      vetores válidos batendo em texto, bytes e hash, e os 12 inválidos
      recusados pelo mesmo motivo do lado TypeScript
   6. ~~`canonico-retorno.spec.mts` e
      `conferir-canonico-retorno-no-console.js`~~ — **feito e rodado em
      2026-08-19: 5 cenários, três critérios cada, todos verdes**, sobre
      o `R-000001` com documento de 3 vales. Ele deixou de ser "TS × SQL
      concordam?" (os vetores já provaram, com mais força) e virou
      **teste de TRANSPORTE**: o caminho
      `supabase-js → PostgREST → jsonb` preserva o input que o navegador
      assinou? Precisa da migration
      `20260819150000_conferir_canonico_retorno.sql`
   7. ~~`papel_no_momento` no INSERT da saída~~ — **feito e aplicado**
      (`20260819160000_papel_no_momento_na_saida.sql`). A fórmula do hash
      não mudou um byte, conferido por diff antes e por recomputação
      depois
   8. ~~rodar o verificador **de novo**~~ — **feito**
   9. ~~provar que nenhum hash existente mudou nem deixou de verificar~~ —
      **PROVADO: `9 · 9 · 0`, idêntico ao baseline.** 36 camadas
      recomputadas depois da mudança, todas ainda verificando. Não é "li
      o código e não mudou": é medição no mesmo instrumento
   10. ~~fluxo E2E da saída: cartão → PIN → assinaturas → canônico →
       hashes → selo~~ — **feito em 2026-08-20**: `R-000013` selado com
       `papel_no_momento = 'admin'` na assinatura do caixa, e o
       verificador foi a **10 · 10 · 0**

   **A 2A FECHOU.** E o `R-000013` verificando prova mais que o baseline
   intacto: os nove antigos batendo mostram que nada existente foi
   corrompido; o **novo** batendo mostra que a função reescrita produz
   hashes que o verificador reproduz — e o verificador foi escrito a
   partir da função ANTIGA. Fórmula alterada sem querer teria deixado os
   nove velhos passando e só o novo divergindo.

   A linha que parece estranha e está certa: `tipo_signatario = 'caixa'`
   com `papel_no_momento = 'admin'`. O documento diz o slot estrutural (o
   lado da farmácia) e o cargo real de quem assinou, separados. Era pra
   isso que a coluna existia.
3. **2B** — `selar_romaneio_retorno` transacional. **Aplicada em
   2026-08-20** (`20260820130000`). Junto veio `20260820120000`, que
   corrige o domínio de `forma` do DCRR1 — e teve que ser aplicada
   ANTES, senão a 2B recusaria `convcard` e `crediario` depois de
   colhidas as duas assinaturas. As duas trazem no rodapé as consultas
   de conferência; a de 2B exercita as recusas contra dado real, porque
   o caminho feliz exige PIN e é E2E de tela (2D).

   **Aplicada e conferida em 2026-08-20.** DCRR1 SQL 43/43, baseline das
   saídas intacto em 10 · 10 · 0, e as recusas medidas contra a corrida
   aberta do `R-000014`: `vales_nao_conferem` (pelo lado do vale
   sobrando), `outro_motoboy`, `saida_hash_nao_confere`, e `42501` na
   autorização — que é o resultado mais forte, porque chegar lá exige
   que todas as outras validações tenham passado.

   O que ela deliberadamente **não** faz: estender `verificar_romaneio`
   pro retorno. Isso é a 2B.4, logo abaixo — e não era opcional: o
   verificador filtra por `status = 'selado'`, **não por tipo**, então um
   retorno selado já entraria no placar aplicando a fórmula da saída e
   reportando duas divergências que não existem.

4. **2B.4 — verificador de hashes do retorno.** **Aplicado em
   2026-08-20** (`20260820140000`). Vira invariante operacional em vez de
   teste: quando a 2D permitir o caminho feliz, "selou" deixa de
   significar "a RPC devolveu sucesso" e passa a significar que as
   camadas recalculam. Diagnóstico por camada e **read-only** —
   divergiu, reporta armazenado × calculado e para.

   **O BASELINE NÃO É UM NÚMERO FIXO, E CONFUNDIR ISSO CUSTA UM SUSTO.**
   Ele sobe a cada saída nova: era 9 antes do `R-000013`, 10 depois, e
   deu **11 · 11 · 0** na aplicação da 2B.4, porque o `R-000014` foi
   selado no meio pra a conferência da 2B ter corrida aberta.

   O gate nunca foi "o número é 10". É **"as mesmas que verificavam
   continuam verificando, e nenhuma sumiu"** — e a forma de checar isso
   sem depender de memória é a contagem fechar contra a SEQUÊNCIA:

   ```
   selados   11   R-000001 03 05 06 07 08 10 11 12 13 14
   ausentes   3   R-000002 04 09     ← e são exatamente os 3 conflitos
   ------------------------------
   11 + 3 = 14 = maior número emitido
   ```

   Todo número explicado, nenhum documento perdido. É por isso que o
   resumo separa `conflito (fora do placar)` em linha própria: sem esse
   número, os três buracos na sequência não teriam como ser explicados, e
   `9 · 9 · 0` pareceria tão saudável quanto `11 · 11 · 0`.

   **UM ORQUESTRADOR PÚBLICO, FÓRMULAS INTERNAS SEPARADAS.** Decidido
   com o usuário em 2026-08-20, e a distinção não é estilo:

   ```
   verificar_romaneio(id)
     ├── lê `tipo_signatario` DA LINHA        (sempre, nos dois casos)
     ├── tipo = 'saida'   → fórmula histórica da saída
     ├── tipo = 'retorno' → fórmula DCRR1 do retorno
     └── devolve diagnóstico uniforme
   ```

   As duas já são criptograficamente diferentes — a saída concatena
   `selado_em::text`, o retorno usa `to_char` com máscara e ainda inclui
   `papel_no_momento`. **Não "melhore" a fórmula da saída dentro do
   verificador.** Ele existe pra reproduzir o documento como ele foi
   criado, defeitos históricos da fórmula incluídos; o `to_char` do
   retorno conserta a fórmula NOVA e não muda retroativamente o
   significado de hash nenhum já assinado.

   O que continua sendo comum é a leitura de `tipo_signatario` da linha.
   Nunca `if saida then 'caixa' / if retorno then 'responsavel_loja'` —
   isso é fixar o literal com passos extras.

5. **2B.5 — o bloco `d`.** **FEITO em 2026-08-20**, com o processo real
   levantado. Migrations `20260820150000` (gêmeo SQL) e `20260820160000`
   (`esperado = declarado` + `status_documental`), ambas aplicadas.
   Conferido: **65 de 65** contra os golden vectors no banco, e as 6
   asserções da 2B.5 verdes. Detalhe completo na seção do DCRR1 acima.

   O censo que veio junto e que a 2C vai querer: **1 das 11 saídas
   seladas espera papel** (um convênio). É a única onde o bloco `d`
   importa hoje, e é onde `documentos_nao_conferem` é exercitável contra
   dado real. Nenhum vale de crediário foi lançado ainda — aquele caminho
   inteiro segue sem exercício.

   Ver a seção do DCRR1: o prazo era **antes de a 2C começar a persistir
   o payload em IndexedDB**, e não antes do primeiro selo. Item na
   fila de um caixa é documento já assinado esperando subir; mudar o
   formato depois disso quebra o que está guardado no navegador dele.

6. **2B.6 — repetir os gates** (vetores, os dois gêmeos, o verificador)
   depois do bloco `d`. Se o `d` entrar, ele muda o `document_hash`, e é
   exatamente o hash que a fila da 2C vai carregar.
7. **2C** — fila offline: `romaneio_retorno`, envelope, `sync-romaneio`.
   **Não comece antes da 2B.6.** A fila persiste o payload que produz o
   `document_hash`, então construí-la sobre um contrato com uma última
   mudança gratuita pendente é garantir retrabalho — e não só de código:
   de dado no navegador de quem já usou. **Desenho fechado em 2026-08-20,
   antes do código — seção própria abaixo ("A 2C").** Leia-a inteira
   antes da primeira linha: ela tem uma etapa que não é fila nem crypto,
   e sim um gate de segurança da regra 7.
8. **2D** — tela: Retorno de Corrida vira o fluxo do documento.
   **FEITA em 21 e 25/08**, e o caminho feliz rodou nos DOIS modos:

   ```
   R-000023  online
   R-000025  online
   R-000026  offline_sincronizada
   ```

   O placar de integridade saiu de `retorno 0 · 0 · 0` para
   **`3 · 3 · 0`**, 5 camadas cada — a primeira vez que
   `saida_referenciada`, `documento`, as duas assinaturas e `final`
   rodam contra documento de verdade.

   O `R-000026` é o que prova mais: a assinatura do motoboy ficou com
   `auth_method = physical_card_pin_offline_then_verified`, carimbo que
   só existe por uma via — PIN selado no envelope RSA no balcão, aberto
   e conferido pela Edge Function na sincronização.

   Leia a regra do CONGELAMENTO antes de mexer no componente: ela é a
   invariante de UI mais importante da etapa, e é ela que impede a tela
   de assinar um documento e mandar outro.
9. Fluxo excepcional (online), depois PDF do retorno + Drive

**A ordem não é burocracia.** A tela é a parte fácil; o contrato canônico
entre navegador e Postgres é o que precisa estar fechado primeiro. E o
verificador vem antes de `papel_no_momento` porque sem ele "nada moveu"
é uma afirmação, não uma medição — o mesmo método do §22 e do §49, onde
medir o "antes" no mesmo instrumento foi o que impediu concluir certo por
sorte.

#### A 2C — desenho fechado em 2026-08-20, código não começado

Mesmo método do item 58: fechar antes de escrever. A conversa mudou duas
decisões e achou uma etapa que não estava no plano — e essa etapa **não é
fila nem criptografia, é um gate de segurança da regra 7.**

```
2C.1  selar_romaneio_retorno_sincronizado          (migration)
2C.2  trigger de obsolescência do fechamento legado (migration)
2C.3  Dexie v5: backfill de `chave` + self-dependency no scheduler
2C.4  `romaneio_retorno` na fila, com payload congelado
2C.5  envelope com `tipo`
2C.6  sync-romaneio: despacho por tipo
2C.7  proteção local: não oferecer corrida com fechamento pendente
2C.8  regressões e janela de compatibilidade
```

**A porta offline do retorno não existe, e a 2B sabia disso.**
`selar_romaneio_retorno_interno` recebe `p_autorizacao_id` — uma
autorização já emitida, de uso único, amarrada ao `document_hash`.
Offline não existe autorização: o PIN só pode ser conferido na
sincronização, a partir do envelope. A 2B construiu só a porta online e
deixou a offline anotada num comentário. O espelho é literal —
`selar_romaneio_sincronizado` resolve o tenant pelo perfil do caixa,
chama `autenticar_credencial_interno`, confere que **o cartão é do
motoboy que o documento nomeia**, e então *cunha* a autorização
(1 minuto, amarrada ao hash) só pra o caminho do selo ser um só. Faça
igual, trocando `registrar_conflito_romaneio` por
`registrar_conflito_retorno`.

O que essa forma compra, e é o motivo de não improvisar outra: **online e
offline convergem no MESMO selo interno.** Não há segunda implementação
de selagem, logo não há segunda fórmula de hash pra divergir.

##### 2C.2 — o fechamento legado pode violar um DCRR1 já selado

```
retorno sela → corrida fecha → fechamento_corrida legado chega depois
→ reescreve desfecho → o banco passa a dizer algo diferente
   do documento assinado
```

Só **uma** das duas ordens é destrutiva. Fechamento antes do retorno dá
`corrida_ja_fechada` → conflito, prova preservada, caro mas seguro
(a 2B já previu isso num comentário). Retorno antes do fechamento é a
regra 7 violada por escrita tardia, **sem erro nenhum**.

**A dependência da fila NÃO pode ser a única proteção.** Pode haver fila
antiga em outro computador, outra sessão, um navegador dias offline, ou
uma chamada de cliente antigo. A ordenação local é otimização e UX; a
última linha de defesa tem que estar no banco.

**E não pode ser um guard em RPC, porque `fecharCorrida` não é RPC** — é
um laço de UPDATEs diretos em `entregas` mais um UPDATE em `corridas`,
pelo PostgREST. Não existe função onde pôr o guard. Isso não enfraquece o
argumento, fortalece: guard em RPC jamais cobriria "cliente antigo". Quem
cobre é **trigger**, e o precedente é `fn_entrega_protege_conferencia` —
existe pelo mesmo motivo, a escrita precisa ficar aberta e RLS não
restringe coluna.

Três coisas que o trigger precisa acertar:

- **O selo do retorno tem que se identificar como escritor autorizado.**
  O interno insere o romaneio `'selado'` **antes** de gravar os desfechos
  vale a vale. Um trigger ingênuo ("existe retorno selado pra esta
  corrida? recuse") dispara durante o PRÓPRIO selo e bloqueia todo
  retorno — é o item 34 repetido: *toda saída falharia, com o erro
  apontando pro lugar errado*.
- **Congelar exatamente o que o DCRR1 afirma: desfecho, motivo e
  detalhe.** Nada além. Congelar demais quebra `status_documental` (o
  convênio volta dias depois, pela aba Documentos) e `status_financeiro`
  (o `marcarDivergencia`, que este arquivo mantém de propósito para o que
  se descobre DEPOIS do retorno selado).
- **O erro tem que ser classificável como terminal.** Só levantar
  exceção põe o item legado em `erro` e no backoff pra sempre — o pior
  sintoma conhecido do projeto. SQLSTATE distinguível → o handler legado
  marca terminal (o mecanismo `ErroTerminalDeSaida` já existe) e grava
  auditoria `fechamento_legado_obsoleto`.

**Isto não contradiz a regra 7, e alguém vai achar que sim.** A regra 7
lista status, observações e motivo de insucesso como MUTÁVEIS depois da
saída — e está certa, porque a saída não afirma desfecho. **O retorno
afirma.** É a mesma regra aplicada ao segundo documento.

##### 2C.3 — a fila tem duas correções, e uma é latente

**`fechamento_corrida` não tem `chave` própria**, só
`dependeDeChave: corridaId`. Nada pode depender dele. E não adianta
passar a setar daqui pra frente: os itens que importam são os que já
estão gravados no IndexedDB de alguém. Precisa de **Dexie v5 com backfill
`chave = payload.corridaId`** nos existentes.

Feito isso, `dependeDeChave: corridaId` no retorno cobre os dois de uma
vez — espera a `romaneio_saida` (que já usa `chave: corridaId`) **e** o
fechamento legado. Uma regra, o mecanismo que já existe, nada inventado.

**E `chave` igual a `dependeDeChave` é deadlock silencioso.** O guard é
`todos.some((outro) => outro.chave === item.dependeDeChave)` e **não
exclui o próprio item**. Uma operação que declarasse as duas com o mesmo
valor dependeria de si mesma e nunca rodaria: `pendente`, `tentativas` em
0, sem mensagem — o sintoma do §50.4, que já custou uma sessão.

Por isso **`romaneio_retorno` declara só `dependeDeChave`, nunca
`chave`** — e, mesmo assim, o guard genérico ganha `outro.id !== item.id`,
pra não deixar a armadilha armada pro próximo tipo de fila. Dois testes,
e o segundo não é redundante: *item com chave X e dependeDeChave X não se
bloqueia por si próprio*, e *outro item com chave X bloqueia
corretamente*. Sem o segundo, uma correção que desligasse o bloqueio
inteiro passaria.

##### 2C.4 e 2C.5 — congelado, e sem mentir no protocolo novo

**A fila guarda o jsonb já convertido, não o objeto de domínio.** É a
lição do item 65 aplicada antes de doer: guardando `EntradaRetorno` e
chamando `paraJsonbRetorno` na hora de enviar, uma mudança de código
entre enfileirar e sincronizar converte diferente, o servidor reconstrói
outro DCRR1 e recusa `documento_alterado` com o documento já assinado.
Congelado significa **estrutura convertida e persistida**, não bytes
serializados: ordem de propriedade do JSON não é contrato, o contrato é o
DCRR1 que o SQL reconstrói.

**Os traços ganham nome novo no protocolo novo, e nenhum fallback:**

```
romaneio_saida legado →  caixaStrokes        ┐
romaneio_retorno novo →  responsavelStrokes  ┴→ assinaturaInternaStrokes
                         motoboyStrokes       → assinaturaMotoboyStrokes
```

A normalização acontece antes de `calcularOfflineEventHash`, e **a
fórmula não muda um byte** porque ela concatena valores, não chaves.
Renomear no fio é que seria quebra — corpos já gravados dizem
`caixaStrokes`. Mas o retorno é rígido: **exige `responsavelStrokes`**.
Não existe `romaneio_retorno` antigo em IndexedDB nenhum, então aceitar
`caixaStrokes` ali seria criar hoje compatibilidade com um formato que
nunca existiu — e perpetuar um nome que mente sobre quem assinou, que é a
armadilha do `tipo_signatario` de novo.

**O `tipo` tem a mesma assimetria, e ela é deliberada:**

```
body sem tipo                    → legado, interpretar como `saida`
body tipo = saida                → saída nova
body tipo = retorno              → retorno novo
body tipo = retorno + envelope sem tipo   → RECUSA
body.tipo ≠ envelope.tipo                 → RECUSA
```

**Ausência de `tipo` é compatibilidade histórica exclusiva do protocolo
de saída anterior à 2C.** Ela existe só pra preservar fila antiga, e não
deve virar permissividade para operação nova. O `tipo` vai **dentro do
envelope** ao lado de `operationId` e `documentHash`: sem isso ele é
campo não verificado, e o servidor acreditaria em vez de comparar.

Sem discriminador nenhum, a `sync-romaneio` de hoje lê `corpo.entregaIds`
e chama `selar_romaneio_sincronizado` direto — por isso a ausência
PRECISA significar saída, senão todo `romaneio_saida` parado numa fila
deixa de sincronizar no dia do deploy.

##### O particionamento da fila, medido em 2026-08-20

Perguntado explicitamente, então fica a resposta e não a impressão:

- **O caso "A captura, B loga depois" está coberto duas vezes** — o gate
  do cliente e o da Edge Function contra o JWT.
- Mas está coberto por **`user_id` sozinho**. `tenantId` e `lojaId` são
  gravados no item da fila e **nunca comparados**, em lugar nenhum.
- **Tenant não é problema**: o servidor o deriva do perfil de quem chama,
  nunca do payload.
- **Loja é o ponto fraco, e só na saída.** `p_loja_id` vem do payload e é
  conferida só contra os vales (`e.loja_id <> p_loja_id`), o que prova
  consistência interna, não competência. `SECURITY DEFINER` ignora RLS,
  então a proteção efetiva é "o caixa não consegue ler os ids de outra
  filial", não "a função recusa".
- **O retorno já nasce imune**, e é um acerto da 2B que vale preservar:
  ele **não tem `p_loja_id`** — a loja sai de `v_saida.loja_id`, do
  romaneio de saída selado. Payload nenhum opina.

Por isso o buraco da saída **não entra na 2C** (não é alcançável pelo
caminho normal, e a frente do retorno não o herda). O que entra é uma
linha: a porta offline nova confere que o responsável tem competência
sobre a loja da saída, pra não repetir o padrão em código novo.


#### A 2D — desenho fechado em 2026-08-20, código não começado

Mesmo método do item 58 e da 2C: fechar antes de escrever. Agora a tela
encosta em tudo que 2A–2C passaram protegendo, e a regra central é do
usuário:

> **A tela coleta fatos e manifestações; ela nunca decide o que é verdade
> oficial.** Ela congela o mesmo `p_retorno` que vai ser assinado e
> entrega esse artefato ao caminho online ou offline já construído.

```
2D.1  contrato da tela / máquina de estados   ← este documento
2D.2  montagem do retorno
2D.3  autenticação + assinaturas
2D.4  envio online / enfileiramento offline
2D.5  caminho feliz E2E
2D.6  as três regressões históricas pendentes
```

##### A máquina de estados, e por que ela vem antes do JSX

```
selecionando_corrida
      ↓
preenchendo_retorno  ←──────────── editar volta pra cá, SEMPRE
      ↓ congelar
documento_congelado
      ↓
autenticando_motoboy
      ↓
assinando_responsavel
      ↓
assinando_motoboy
      ↓
   ┌──┴───────────────┐
 online            offline
   ↓                  ↓
selando          enfileirando
   ↓                  ↓
selado        aguardando_validacao
```

Estados de falha EXPLÍCITOS, e não um `error` genérico — cada um manda
fazer uma coisa diferente:

| estado | o que a tela oferece |
|---|---|
| `autenticacao_recusada` | tentar o PIN de novo; nunca "seguir assim mesmo" |
| `documento_alterado` | reconstruir — é a única saída, e ela é segura |
| `conflito` | mostrar o número do romaneio de conflito e parar |
| `erro_rede` | a operação foi pra fila; não é falha do usuário |

`conflito` merece nome próprio porque **não é erro**: é um desfecho
previsto, com prova preservada no servidor. Tratá-lo como `error`
genérico faria a tela sugerir "tente de novo", que é exatamente o que não
se deve fazer.

##### O CONGELAMENTO, que é a regra de UI mais importante da etapa

Enquanto `preenchendo_retorno`, tudo é editável: desfecho, motivo,
detalhe, pagamentos realizados, documentos `recebido`/`faltante`.

Ao confirmar:

```
EntradaRetorno → paraJsonbRetorno() → jsonb congelado
                                    → montarCanonicoRetorno()
                                    → document_hash
                 + romaneioId (uuidv7)
                 + pagamentoId por linha (uuidv7)
```

**Daí em diante nada disso muda naquela tentativa.**

E se o caixa voltar e editar qualquer fato, TUDO que dependia do hash
morre junto:

```
editar
  ↓ descarta
  document_hash        o documento é outro
  jsonb congelado      idem
  romaneioId           a operação é outra
  pagamentoIds         entram no DCRR1, logo no hash
  autorização          nasce amarrada ao hash antigo
  PIN e token          capturados sob o documento anterior
  ENVELOPE             sela operationId + documentHash + tipo
  strokes dos DOIS     foram colhidos sobre outro documento
```

**O envelope na lista não é detalhe** — o usuário citou hash,
autorização e assinaturas, e ele é o quarto. Reaproveitá-lo faria a
sincronização recusar `envelope_trocado` horas depois, com as duas
assinaturas colhidas: o envelope amarra `operationId` e `documentHash`,
e os dois mudaram.

Desde 2026-08-21 o envelope só nasce no `CONCLUIR` (ver "O PIN offline é
CAPTURADO, não selado", abaixo), então ele não tem como sobreviver a uma
edição — o princípio continua, e passou a ser garantido por construção
em vez de por disciplina. **Quem entrou na lista no lugar dele foi o PIN
em claro**, que existe entre a captura e a selagem: e por isso o
recolhimento da máquina zera o sinal que autoriza a tela a guardá-lo.

E os traços têm que ser DESCARTADOS, não reaproveitados: uma assinatura
manuscrita é manifestação sobre um conteúdo específico. Recolher a
mesma imagem sobre um documento diferente é falsificar consentimento —
é a mesma família do §39, com o preço maior.

##### O PRÉ-PREENCHIMENTO DO PAGAMENTO NÃO PODE LEVAR O `pagamento_id`

Achado em 2026-08-20, lendo o vale impresso pela conferência da 2D.2. É
a armadilha mais afiada que a 2D tem, porque o gatilho dela é uma
conveniência óbvia.

**O id do pagamento PREVISTO é o mesmo uuid da entrega.** Está assim
desde que a feature existe, de propósito e documentado em
`criarPagamentoPrevisto`: *"id determinístico (default: mesmo uuid da
entrega, relação é 1:1)"* — é o que dá idempotência ao reenvio da fila
sem precisar de upsert.

Então, no contexto, isto é normal e não é defeito:

```
entrega_id   : 01a00d0c-add7-…
pagamento_id : 01a00d0c-add7-…   ← o previsto
```

**E aqui está o problema.** A tela vai querer pré-preencher o realizado
com o previsto, pra o caixa só confirmar. Se ela copiar o objeto inteiro,
o `pagamentoId` vai junto — e o DCRR1 passa a carregar, na linha `pr`, o
id do previsto.

O que acontece então **não é erro**: `selar_romaneio_retorno_interno`
insere os realizados com `on conflict (id) do nothing`, e aquele id já
existe como linha `momento = 'previsto'`. O insert não faz nada, o selo
conclui, e o documento assinado afirma um pagamento realizado que **não
existe em `pagamentos`**.

```
tela copia o previsto inteiro
  → DCRR1 diz  pr E1 <id-do-previsto> dinheiro 12390 0
  → insert bate no on conflict
  → nada é gravado
  → romaneio SELADO afirmando um realizado inexistente
```

Perda silenciosa, com duas assinaturas em cima — e ela não aparece em
lugar nenhum, porque o `on conflict do nothing` existe por um bom motivo
(reenvio da fila não pode duplicar) e não vai ser removido.

**A regra, então:**

```
pré-preencher COPIA    forma, valorCents, trocoCents
pré-preencher NUNCA    pagamentoId
```

O `pagamentoId` do realizado é **sempre** um uuidv7 novo, cunhado no
congelamento junto com o `romaneioId` — e recunhado a cada novo
congelamento, como todo o resto que depende do hash.

**E o congelamento deve RECUSAR a colisão**, não só evitá-la: antes de
montar o DCRR1, nenhum `pagamentoId` da entrada pode ser igual a um
`pagamentoId` dos previstos do contexto. É invariante local, custa um
`Set`, e torna o defeito impossível de representar em vez de improvável.

Isso é o §59 aplicado de novo — *tornar um erro impossível de
representar vale mais que rejeitá-lo* —, e é a mesma razão pela qual
`pagamentosRealizados` é aninhado no vale.

##### O que a tela mostra, e de ONDE

**Os fatos antigos vêm do SNAPSHOT da saída, nunca de `entregas`.** É a
regra 7 e a lição do PDF do romaneio: o dado vigente pode ter sido
corrigido, e mostrar o valor de hoje faria o caixa conferir contra algo
que o motoboy nunca recebeu. Correção posterior, se houver, aparece
como aviso ao lado — nunca substituindo.

```
Vale V-000123
Cliente / endereço            do snapshot da saída, somente leitura
Valor da compra               idem
Pagamento PREVISTO            idem

Desfecho        ○ Entregue   ○ Insucesso
  motivo/detalhe              só quando insucesso
Pagamento realizado           forma, valor, troco
Documentos esperados          uma linha por papel que a saída exige
```

**O CONJUNTO DE VALES É FIXO.** Vem do romaneio de saída e a tela não
oferece adicionar nem remover — `selar_romaneio_retorno` exige
igualdade de conjunto (nem falta nem sobra vale), e oferecer o
impossível custaria duas assinaturas.

**As linhas de documento também não são criadas à mão.** A expectativa
sai do canônico assinado da saída. Um botão "adicionar crediário" faria
o documento afirmar custódia de papel que aquela saída nunca gerou —
e a transação recusa por igualdade de conjunto.

##### O que a tela precisa e HOJE NÃO EXISTE

Levantado contra o código em 2026-08-20:

| precisa | estado |
|---|---|
| quais documentos a saída espera | **já existe**: `documentos_esperados_do_retorno(uuid)`, `security invoker`, com grant para `authenticated` |
| `saidaRomaneioId` e `saidaDocumentHash` da corrida | **falta** — `CorridaAberta` traz id, motoboy, agência, saída e vales, e nada do romaneio |
| pagamento PREVISTO por vale | **falta** — não há consulta de previsto por corrida |
| cliente/endereço/valor do SNAPSHOT | **falta** — hoje só há o caminho por `entregas` |

O primeiro é um achado que economiza trabalho: a 2B.5 já deixou a porta
do lado do cliente, com RLS aplicada por ser `security invoker`. A 2D
**não precisa de migration** para saber o que a saída espera.

Os outros três são uma consulta nova em `src/data/romaneios.ts` —
algo como `useRetornoParaCorrida(corridaId)`, que devolve o romaneio de
saída (id e `document_hash`) mais, por vale, o que veio do snapshot e o
previsto. Uma consulta, não quatro: a tela não pode montar o documento a
partir de fontes que podem discordar entre si.

##### Custódia: o vocabulário muda entre online e offline

```
                 online                    offline
identidade   servidor valida o HMAC    cache local por public_id
             "credencial reconhecida"  "credencial INFORMADA"
PIN          validado na hora          CAPTURADO; só vira envelope
                                       depois das duas assinaturas
o que a      "identidade confirmada"   "PIN guardado, NÃO conferido"
tela afirma
```

Nada de "credencial validada" offline, porque não foi. É a regra que o
§39 e o §49 pagaram duas vezes: **a tela nunca afirma o que não sabe.**

###### O PIN offline é CAPTURADO, não selado — e o envelope nasce no fim

Corrigido em 2026-08-21, quando a primeira integração com a tela achou
uma **impossibilidade** no desenho da 2D.1, não um bug de código:

```
offlineEventHash = documentHash + responsavelStrokes + motoboyStrokes + …
```

O envelope carrega esse hash dentro dele, e a Edge Function o recalcula
do corpo pra decidir entre selar e recusar `payload_alterado`. Logo, no
instante em que o PIN é digitado **os dois traços ainda não existem, e o
envelope não é construível ali**. A ordem verdadeira é:

```
PIN + token capturados → assinatura do responsável → assinatura do
motoboy → offlineEventHash → envelope → fila
```

Disso saem três regras, e as três valem para quem for mexer na máquina:

1. **"Selado" é palavra reservada.** O evento chama-se
   `SEGREDOS_CAPTURADOS`, e o estado `segredos_capturados` — nunca
   `custodia_autorizada`, porque offline ninguém autorizou nada. Selar é
   o que `selarSegredos()` faz, com RSA e AES. Este projeto já pagou por
   vocabulário que afirma mais do que aconteceu.

2. **PIN e token NÃO entram no estado da máquina.** Ela guarda um SINAL
   carimbado (`segredosCapturados`); o material vive só numa ref efêmera
   do componente — nunca Dexie, nunca localStorage, nunca payload de
   fila, nunca evento de auditoria. A permissão pra ele existir é
   DERIVADA: `podeGuardarSegredos(estado)`. Falso, a ref se apaga.
   Recarregar a página perde os segredos e obriga a refazer o PIN, e
   isso é melhor que persistir texto claro pra permitir retomada.

3. **O adiamento é só do offline.** Online, quem prova a presença é a
   autorização de uso único já amarrada ao hash, então **o PIN sai da
   memória assim que ela é emitida** e o caminho online **não produz
   envelope**. `CONCLUIR` é tipo discriminado (`online: true` sem
   envelope, `online: false` com), o que torna "online com envelope"
   impossível de escrever.

   É onde o retorno difere da saída, que sela o envelope sempre — e a
   consequência disso é a regra 4.

4. **Falha de rede no selo online NÃO vira offline.** Congelada em
   2026-08-21. Nesse instante o documento está congelado e as duas
   assinaturas existem, mas o PIN já foi apagado e envelope nunca houve
   neste ramo — então não há o que mandar pra fila, e fabricar um
   incentivaria guardar o PIN além do necessário.

   A política separa duas coisas que parecem a mesma:

   | | edição do documento | falha de rede no selo |
   |---|---|---|
   | `romaneioId`, `pagamentoIds` | destrói | **preserva** |
   | `retornoJsonb`, `documentHash` | destrói | **preserva** |
   | autorização | destrói | destrói |
   | as duas assinaturas | destrói | destrói |
   | resultado | documento NOVO | mesmo documento, custódia refeita |

   O caixa **não** refaz a conferência do retorno: refaz cartão + PIN e
   as duas assinaturas, sobre o mesmo documento.

   **As assinaturas caem de propósito**, mesmo com o conteúdo intacto. O
   que o sistema afirma é uma sequência — *autenticação → manifestação
   sobre o documento*. Conservar os traços e autenticar por cima
   inverteria a ordem, associando uma autenticação nova a uma
   manifestação anterior a ela. É a ambiguidade temporal que a
   `AUTORIZACAO_EXPIROU` já recusa.

   Por isso o estado é próprio (`falha_selo_online`) e não o `erro_rede`
   genérico: a tela precisa dizer a ação certa — *"os dados conferidos
   foram preservados, mas é preciso autenticar o motoboy e assinar de
   novo"*. **Nunca um botão "tentar novamente"** que repita o selo com a
   autorização e os traços antigos.

**E a varredura da máquina achou uma janela que a leitura não acharia:**
capturar o PIN offline → a rede voltar → `PIN_RECUSADO` no meio →
autenticar online terminava com autorização emitida **e** o material em
claro ainda autorizado a viver. Hoje `PIN_AUTORIZADO` zera o sinal,
`SEGREDOS_CAPTURADOS` zera a autorização (os dois ramos são exclusivos) e
`PIN_RECUSADO` descarta o material — um PIN recusado é um PIN errado.

E os três são evidências diferentes, apresentadas separadamente:

```
cartão   = identificação      quem é
PIN      = autenticação       é ele mesmo
strokes  = manifestação       ele concorda com ISTO
```

**`papel_no_momento` NUNCA é um dropdown.** Não existe "eu sou:
[caixa/gerente/admin]" na tela. O cargo sai do perfil da sessão e quem
persiste é o servidor, a partir do `auth.uid()` — é isso que faz dele
registro de auditoria e não afirmação do cliente. A tela só EXIBE
("Responsável pela loja — Camilo Ferreira · Caixa").

##### Uma montagem só, bifurcação só no transporte

```
montarRetorno()
      ↓
jsonb congelado + document_hash + strokes + envelope
      ↓
  ┌───┴────┐
online   offline
```

Nunca `montarRetornoOnline()` e `montarRetornoOffline()`. Dois
construtores é como o `paraJsonbRetorno` do item 65 aconteceu — e aqui
o preço seria assinar uma coisa e mandar outra.

Offline persiste exatamente o que a 2C.4 já sabe guardar e a 2C.6 sabe
transportar: `retornoJsonb`, `documentHash`, `responsavelStrokes`,
`motoboyStrokes`, `envelope`, `versaoDocumento`, `dependeDeChave =
corridaId` e **nenhuma `chave`**.

##### O guard contra duplo clique

Ao entrar em `selando` ou `enfileirando`, o CTA trava. A idempotência do
servidor continua existindo — o guard de reenvio da 2C.1, o `on conflict
do nothing`, os ids determinísticos —, mas a UI não deve FABRICAR
trabalho: dois envelopes e dois `operationId` para a mesma retirada são
dois documentos, e um deles vai virar lixo que alguém precisa entender
depois.

##### A UX: o caixa não precisa saber nada disto

```
Conferir retorno → identificar motoboy → assinar → concluir
```

e, sem rede:

```
Retorno registrado offline · aguardando validação
```

`DCRR1`, hash, envelope RSA, autorização efêmera e conflito de
sincronização ficam debaixo da interface. O vocabulário do balcão é
"conferir", "identificar", "assinar" — e é o mesmo que a Nova Corrida já
usa.

##### O que a 2D.5 mede, e o número que ela move

Primeiro ONLINE, que elimina a variável fila. Depois de selar:

```
DCRR1 existe · status selado · corrida fechada
entregas atualizadas · pagamentos realizados corretos
status_documental recomputado · duas assinaturas
papel_no_momento gravado
verificar_romaneio: documento, assinatura interna, assinatura motoboy,
                    envelope e saida_referenciada
```

E o placar de integridade, que hoje diz `retorno 0 · 0 · 0`, passa a
`retorno 1 · 1 · 0` — a primeira vez que as cinco camadas do verificador
do retorno saem do papel. **Elas nunca rodaram contra um retorno**,
porque não existe nenhum.

Depois o offline, que fecha a promessa que a 2C deliberadamente não fez.

##### As três regressões históricas, e por que só agora

1. **retorno feliz real** — cartão, PIN, assinaturas, selo, verificador;
2. **saída offline LEGADA sincronizando de verdade** — não só
   atravessando a conciliação, como o caso (1) da 2C.6 provou;
3. **`fechamento_corrida` legado × DCRR1 selado** — o trigger recusa, o
   handler reconhece o SQLSTATE, o item vira terminal e
   `fechamento_legado_obsoleto` aparece no Registro de Auditoria.

A terceira é a metade que a 2C.8 deixou vermelha de propósito: exercitá-la
exige um DCRR1 real, que só existe depois da 2D.5.

**A lista acima foi SUPERADA em 2026-08-25** — ver "A 2D.6" logo abaixo.
A (1) foi cumprida; a (2) e a (3) deixaram de fazer sentido, porque o
formato que elas testariam não vai existir depois do corte.

##### A 2D.6 — CORTE LIMPO PRÉ-V1

**Decisão fechada em 2026-08-25**, e ela substitui a estratégia de
retrocompatibilidade das seções seguintes.

> Não haverá necessidade de retrocompatibilidade com artefatos locais das
> versões intermediárias de desenvolvimento, porque o rollout definitivo
> será precedido por limpeza controlada dos dados de teste e do estado
> persistido dos clientes.

O raciocínio: a compatibilidade foi útil **enquanto** havia filas e dados
gerados pelas versões intermediárias. Com um corte controlado antes da
V1, deixa de existir "passado" operacional a preservar — e manter os
caminhos antigos seria entrar em produção carregando dívida criada pelo
próprio desenvolvimento.

**As cinco consequências:**

**1. `fechamento_corrida` legado**
- nenhuma feature nova pode criá-lo;
- o handler de compatibilidade sai no corte;
- **não** é necessário fabricar item legado só pra testar drenagem;
- **permanece no banco** a proteção que impede escrita sobre um DCRR1
  selado (o trigger da 2C.2). Ela fica por ser **invariante de
  integridade**, não compatibilidade: depois que um Romaneio de Retorno
  está selado, nenhum caminho — antigo, novo ou bug futuro — reescreve
  aqueles fatos.

**2. Protocolo offline**
- `tipo` é OBRIGATÓRIO nos novos body/envelopes;
- o fallback "ausência de tipo = `saida`" sai depois do corte;
- saída e retorno passam a usar protocolo explícito.

**3. Dexie v7**
- versão de corte pré-V1;
- descarta artefatos locais incompatíveis das versões de desenvolvimento;
- **não tenta reinterpretar** filas antigas;
- instala somente o estado local suportado pela V1.

**4. Rollout**
- banco de teste/produção conforme o roteiro de corte;
- limpar IndexedDB/estado local pré-V1;
- garantir atualização/reload dos terminais;
- impedir abas antigas de continuar produzindo payload de versão
  anterior;
- só então liberar operação real.

**5. Regressão pós-corte**
- saída online; saída offline;
- retorno online; retorno offline;
- hashes/verificadores;
- fila e sincronização;
- nenhuma operação nova sem `tipo`;
- nenhuma operação nova `fechamento_corrida`.

**Objetivo:** entrar na V1 sem carregar compatibilidade permanente para
formatos que existiram somente durante o desenvolvimento.

O roteiro executável do corte — censo, wipe, sequências, sementes e
conferência — está em `scripts/corte-pre-v1.sql`. Ele é o único lugar do
projeto que viola a regra 4, e diz isso na primeira linha.

###### As duas provas que a 2D.6 exige, e por que não são testes

A decisão pede garantir que nada novo crie `fechamento_corrida` e que
nenhum payload saia sem `tipo`. As duas ficaram **estruturais**, não
testadas:

```
TipoOperacaoFila       sem 'corrida' e 'fechamento_corrida'
                       → enfileirar não compila
SegredosDoRomaneio     tipo: 'saida' | 'retorno'   (era opcional)
                       → envelope sem tipo não compila
```

Regra que o compilador cobra não depende de alguém lembrar dela daqui a
seis meses. E foi o compilador que enumerou os 17 pontos a remover —
não a memória de quem removeu.

###### O baseline preservado, para a remoção não parecer acidente

Estado do banco no dia do corte, medido:

```
saida  selada      13
saida  conflito     3
retorno selado      3
                  ────
documentos relevantes no corte: 19
```

Quem olhar a remoção do código legado daqui a alguns meses precisa achar
este número junto — senão parece que alguém apagou compatibilidade por
descuido, e não como decisão com um estado conhecido embaixo.

**Observação do ambiente atual:** todos os 3 conflitos históricos de
Romaneio de Saída foram produzidos por `offline_sincronizada`; nenhum
conflito de saída foi observado no caminho online. Isso é **consistente**
com a janela de concorrência maior do offline, mas o histórico observado
**não é, isoladamente, prova causal**.

##### (superada) A janela de compatibilidade do `fechamento_corrida`

> **SUPERADA pela 2D.6 em 2026-08-25.** A janela de releases descrita
> abaixo pressupunha filas antigas nos computadores das filiais. Com o
> corte controlado, elas não existem — e a remoção aconteceu de uma vez,
> sem janela. O texto fica como registro do raciocínio que valia enquanto
> a premissa valia.

Congelado em 2026-08-20. O handler legado **não sai porque a fila está
vazia numa máquina**: cada navegador tem a própria fila em IndexedDB, e a
farmácia tem 18 filiais. Vazio aqui não prova vazio lá.

```
release N     nada mais enfileira `fechamento_corrida`
              o handler legado continua, e reconhece o SQLSTATE `DCRR1`
release N+1   handler continua; observar auditoria `fechamento_legado_obsoleto`
depois        sem ocorrência recente E rollout confirmado → considerar remoção
```

Não são três releases por numerologia: o princípio é que **clientes
antigos tenham tido oportunidade real de atualizar e drenar**. Descartar
antes disso é a perda silenciosa que a chave própria da fila veio
corrigir em 16/08, com outro nome.

O sinal que autoriza a remoção é a AUDITORIA, não a fila local: enquanto
`fechamento_legado_obsoleto` aparecer no Registro de Auditoria, existe
cliente antigo drenando por aí.

##### (superada) As duas metades do protocolo de compatibilidade

> **SUPERADA pela 2D.6.** A metade do CLIENTE saiu no corte: sem escritor
> legado, não há quem receba a recusa. A metade do BANCO — o trigger —
> **fica**, e a 2D.6 diz por quê: ela deixou de ser compatibilidade e
> virou invariante de integridade.

Nenhuma funciona sozinha, e isso é a lição da 2C.8:

```
banco    trigger recusa a escrita          → o dano não acontece
cliente  reconhece `DCRR1` → TERMINAL      → o item não retenta pra sempre
         + grava `fechamento_legado_obsoleto`
```

Só o trigger deixaria o item legado em `erro` e no backoff **para
sempre** — o pior sintoma conhecido do projeto (§50.4). E a auditoria tem
que ser gravada pelo CLIENTE: um `insert into eventos` antes do `raise`
seria desfeito pelo rollback que o próprio `raise` provoca.

#### DCRR1 — o canônico do retorno, CONGELADO em 2026-08-19

Congelado antes de existir código, e congelar aqui importa: **depois que
o primeiro romaneio de retorno real for selado, o significado byte a byte
de `DCRR1` vira parte permanente do histórico.**

**O princípio: o retorno assina só o que ele ACRESCENTA.** Tudo que a
saída já selou é referenciado, nunca copiado. Repetir cria uma segunda
fonte para o mesmo fato, que pode discordar da primeira — e aí existem
dois documentos assinados afirmando coisas diferentes, sem desempate.

```
DCRR1
saida        <uuid do romaneio de saída>
saida_hash   <document_hash da saída>
motoboy      <uuid>
responsavel  <uuid>
v   <entrega_id>  <desfecho>  <motivo>  <detalhe>
v   ...
pr  <entrega_id>  <pagamento_id>  <forma>  <valor_cents>  <troco_cents>
pr  ...
d   <entrega_id>  <tipo_documento>  <situacao>
d   ...
```

**Três blocos, nessa ordem, e cada um pode estar vazio.** `pr` some no
vale com insucesso; `d` some quando nenhum vale da corrida gera papel.
Bloco vazio é ausência de linha, nunca placeholder — é por isso que
acrescentar o `d` em 2026-08-20 não moveu nenhum dos dez hashes que já
existiam.

```
tipo_documento ∈ { convenio, crediario }
situacao       ∈ { recebido, faltante }
```

Ordenação do `d`: por `entrega_id`, depois por `tipo_documento`. A
identidade da linha é o PAR, não só o `entrega_id` — um vale pode ter
convênio e crediário ao mesmo tempo.

Convenções idênticas às do `DCR1`, sem exceção: TAB como separador, `-`
para nulo, ids em minúscula, ordenação por code unit (`collate "C"` no
SQL), vales ordenados por `entrega_id`, pagamentos em bloco próprio
**depois** de todos os vales com ordenação dupla (`entrega_id`, depois
`pagamento_id`), sem `\n` final. `DCRR1` difere de `DCR1` no 4º byte —
os dois tipos de documento não podem ser confundidos.

**O que NÃO entra, e por quê:**

| fora | razão |
|---|---|
| `tenant`, `loja`, `corrida` | deriváveis da saída, que `saida` + `saida_hash` identificam inequivocamente |
| **`numero_vale`** | o retorno não deve ter a **capacidade** de afirmar o número do vale. Se a saída disser `V-000521` e o retorno `V-000512`, qual vale? |
| `vales <n>` | derivável contando as linhas `v`; os prefixos já dão o enquadramento |
| cliente, endereço, valores, `quantidade_vales` | já selados na saída |
| totais | deriváveis — e todo campo redundante é mais uma chance de os gêmeos divergirem |
| custódia de papel | tem prazo próprio; o papel volta dias depois, e selar isso assinaria pendência rotineiramente aberta |
| `divergente = true` | derivado da comparação previsto × realizado |
| **qualquer relógio** | ver a regra abaixo |

**`saida_hash` é o `document_hash` da saída, nunca o `final_hash`.** O
motivo é o offline: quando o retorno é registrado, o `document_hash` já
existe localmente, mas o `final_hash` só nasce quando o servidor sela — e
o motoboy pode voltar com a rede ainda caída. É o único identificador
criptográfico que **os dois lados conhecem** no instante da assinatura.

Isto **não** é o "encadeamento de hash entre eventos" da lista Fora.
Aquilo é cadeia global entre eventos; isto é um documento referenciando o
documento que ele fecha, que é inerente ao que um retorno é.

**`motoboy` e `responsavel` ficam** — são os dois participantes da nova
transferência de custódia, e são fato novo. O servidor **exige a
igualdade** com quem de fato assinou:

```
canonico.motoboy      = assinatura_motoboy.motoboy_id
canonico.responsavel  = assinatura_loja.user_id
```

Sem isso existiria "documento diz João, assinatura é Pedro".

##### De onde vem cada fato — parâmetro ou banco

**Nenhum fato acrescentado pelo Romaneio de Retorno pode ser obtido de
uma coluna mutável do estado operacional para reconstruir o canônico. Os
fatos assinados vêm do input estruturado do retorno; o banco é usado para
validar identidade, pertencimento, integridade e permissões.**

Isso parece contradizer a saída, e não contradiz — mas a diferença
**precisa** estar escrita, senão alguém "conserta" um dos dois para
combinar com o outro. `romaneio_canonico` LÊ de `entregas` (cliente,
endereço, valores), e está certo. A regra que reconcilia os dois:

> O canônico **lê do banco** o que PREEXISTE ao ato, e recebe **por
> parâmetro** o que o ato DECLARA.

| | saída | retorno |
|---|---|---|
| natureza do fato | já estava lá; ninguém digita ao assinar | é declarado no ato, pelas duas partes |
| de onde vem | `entregas` | parâmetro `jsonb` |
| se mudar entre assinar e selar | os bytes mudam e a assinatura deixa de valer — **é feature**, e o comentário da função diz isso | não há o que mudar: a transação é que vai gravar |

Ler `desfecho` ou `detalhe` de `entregas` para montar o canônico do
retorno seria circular — o canônico dependeria do que a própria transação
está prestes a escrever. E `observacoes`, onde o `fecharCorrida` hoje
guarda o detalhe do insucesso, é coluna de uso geral que qualquer coisa
reescreve.

**O servidor não recebe canônico pronto.** Ele recebe dados
estruturados, reconstrói o DCRR1 sozinho e compara com o `document_hash`
que o cliente assinou. O parâmetro é `jsonb` **aninhado**, espelhando o
modelo do TypeScript:

```json
[{ "entrega_id": "…", "desfecho": "entregue", "motivo": null,
   "detalhe": null,
   "pagamentos_realizados": [
     { "pagamento_id": "…", "forma": "pix",
       "valor_cents": 12345, "troco_cents": 0 }]}]
```

O aninhamento não é organização: é o que impede o SQL de reabrir, com um
`select` plano de `pagamentos`, o caso que o TypeScript fechou por
construção — pagamento apontando para vale que não está no documento.

**ORDEM DE VALIDAÇÃO ≠ ORDEM DE SERIALIZAÇÃO.** A validação percorre na
ordem RECEBIDA (`with ordinality` no SQL), porque o motivo reportado
depende dela e os dois gêmeos têm que reportar o mesmo. Só depois de
válida a entrada é normalizada, ordenada e serializada.

**E a mesma entrada alimenta a transação.** Não "parâmetro gera canônico,
depois lê tabela para atualizar": o `p_retorno` gera o DCRR1, valida o
hash, grava o desfecho das entregas, grava os pagamentos, gera os eventos
e fecha a corrida. O fato assinado é literalmente o fato aplicado — e
offline isso deixa de ser elegância e vira necessidade, porque entre
assinar às 18h42 e sincronizar às 19h10 o estado operacional pode ter
mudado.

O que o banco confere antes de selar (recebo por parâmetro **não**
significa confiar no cliente): a saída existe e está selada; o
`saida_hash` bate com o `document_hash` persistido; a corrida é daquela
saída; cada `entrega_id` pertence ao romaneio de saída; não falta nem
sobra vale; o motoboy é o da custódia; o responsável é a identidade
server-side; e o retorno ainda pode ser selado.

##### As regras que decorrem

**1. Nenhum timestamp, e o teste vale para qualquer campo futuro: se o
cliente não sabe antes de selar, não entra.** O canônico é o que o
navegador assina, e offline não há servidor a consultar — um `now()` de
servidor é impossível por construção, e o relógio do dispositivo é o que
a regra 8 manda não usar sozinho. Os tempos ficam em
`corridas.retorno_em`/`retorno_em_local` e `romaneios.selado_em`, que a
fórmula da assinatura já amarra.

**2. Normalização é parte do CANÔNICO; validação é do servidor.** As
regras de negócio —

```
desfecho = entregue    → motivo = '-'  e  detalhe = '-'
desfecho = insucesso   → motivo obrigatório
motivo   = outro       → detalhe obrigatório e não vazio
```

— têm que ser aplicadas **dentro do construtor do canônico**, idênticas
nos dois lados. Se ficarem só na validação, um input malformado passa por
um lado e não pelo outro e os bytes divergem, que é o modo de falha sem
erro claro. Validação rejeita; normalização não pode divergir.

**3. Escaping reusa `texto_para_canonico` verbatim** —
`translate(texto, E'\t\n\r', '   ')` com `coalesce(…, '-')`, e o gêmeo TS
`replace(/[\t\n\r]/g, ' ')`. **Ele não é injetivo**: `"a\tb"` e `"a b"`
dão o mesmo canônico, então o hash cobre a forma sanitizada e não a
original, que é o que o snapshot guarda. Para nome e endereço isso nunca
importou; com texto livre colado, importa saber. Escape reversível seria
injetivo e é a alternativa recusada: criaria uma segunda convenção de
escaping num projeto cujo risco nº 1 é divergência de gêmeos.

**4. `pagamento_id` é uuidv7 do cliente** (regra 5) — é o que permite ele
entrar no canônico sem violar a regra 1.

**5. O domínio de `forma` é o CHECK de `pagamentos.forma`, e nada mais.**
Hoje: `dinheiro, credito, debito, pix, convenio, convcard, crediario,
outro`. Ele vive em **quatro** cópias deliberadas — os golden vectors, o
`FORMAS` do spec deles (que existe pra não concordar consigo mesmo),
`src/lib/canonicoRetorno.ts` e o gêmeo SQL — e **as quatro mudam
juntas**.

> **`outro` SAIU do domínio de pagamento — decidido em 2026-09-08,
> CONSTRUÍDO E APLICADO em 2026-09-10** (seção 3
> do escopo revisado). **Ganhou passo PRÓPRIO**, separado do passo 1 por
> decisão do usuário: mexer no domínio de `forma` toca as quatro cópias
> mais o CHECK e o validador SQL, e isso não se mistura com a
> simplificação da tarifa.
>
> Saiu das opções do cadastro, da divergência e do retorno, e cliente e
> servidor recusam em operação nova. O servidor recusa desde que
> `20260910120000_outro_sai_das_formas_de_pagamento.sql` foi aplicada,
> em 2026-09-10: ela troca o CHECK e o `romaneio_retorno_validar` juntos,
> e foi gerada por `scripts/patch-validar-retorno-outro.mts`, que prova
> que nada fora da lista de formas mudou. **Não edite o bloco do
> validador à mão.** Conferida ao aplicar: CHECK validado sem `outro`,
> 66 de 66 vetores DCRR1 no SQL Editor, verificador em 20 · 20 · 0.
>
> **Escolher ≠ exibir.** `FORMAS_ACEITAS` (em `lib/formasDePagamento.ts`)
> governa o que se OFERECE. `FormaPagamento` e `FORMA_PAGAMENTO_LABEL`
> **continuam com `outro`**, porque são o vocabulário de LEITURA: duas
> telas indexam o rótulo sem fallback, e tirar a chave faria um pagamento
> antigo renderizar `undefined`.
>
> **NUNCA fazer substituição global do literal `outro`.** O mesmo literal
> é **motivo de insucesso** — com detalhamento obrigatório —, e esse não
> foi eliminado. `outro_tenant` e mensagens genéricas também não têm
> relação com forma de pagamento. Uma troca cega aqui atinge três coisas
> diferentes com o mesmo nome.
>
> E enquanto existir histórico com pagamento `outro`, **a leitura dele
> continua fiel**: nada de converter automaticamente para outra
> modalidade. No corte, confirmar ausência de linhas e de itens de fila
> com essa forma antes de encerrar a compatibilidade.

Corrigido em 2026-08-20, e vale como aviso: o DCRR1 foi congelado em
19/08 com a lista do **schema inicial**, que a migration
`20260807123331` já tinha substituído doze dias antes. `vale` saiu do
banco e ficou no contrato; `convcard` e `crediario` entraram no banco e
não entraram nele. Os três lugares concordavam porque copiaram o mesmo
engano — que é exatamente o que os golden vectors existem pra impedir, e
não impediram porque o erro estava neles também. **Vetor trava a
implementação contra a especificação; não trava a especificação estar
certa sobre o banco.**

Custou nada porque nenhum retorno real tinha sido selado. Depois do
primeiro, custaria o histórico.

**O crediário tem duas naturezas, e a linha `pr` carrega só uma.** Ela
afirma o PAGAMENTO ("o realizado foi crediário, R$ 120,00"). O carnê que
sai junto pra o cliente assinar é outro fato, e misturá-lo ali faria o
documento confundir "o dinheiro foi combinado" com "o papel voltou
assinado".

Isso **revisa parcialmente** a decisão de manter toda custódia de papel
fora do retorno. Aquela decisão continua certa para o papel cujo ciclo
fica aberto depois da corrida — receita, convênio que volta dias depois.
O papel do crediário é diferente: sai naquela corrida, é assinado durante
aquela entrega, e deve voltar na mesma. Ele pertence ao ciclo do retorno.

**CONSTRUÍDO E CONGELADO EM 2026-08-20**, depois de levantado o processo
real com o usuário. `pr` = o que aconteceu com o dinheiro; `d` = o que
aconteceu com o papel. Um vale pode dizer as duas coisas sem que uma
finja pela outra:

```
pr  E1  P1  crediario  12000  0
d   E1      crediario  recebido
```

O que o fluxo real respondeu, e o que cada resposta decidiu:

| pergunta | resposta | consequência |
|---|---|---|
| quando o papel existe? | emitido na VENDA, sai com a entrega | a saída já sabe: a obrigatoriedade sai do canônico assinado dela |
| quantas vias voltam? | UMA (a nota fiscal fica com o cliente) | o `d` não precisa de quantidade nem de id |
| volta na mesma corrida? | sim; excepcionalmente outro tele busca depois | ver a regra do `faltante` abaixo |
| e se não voltar? | o tele volta e traz — "PRECISA vir" | `faltante` é pendência aberta, não desfecho |
| volta sem assinatura? | nunca aconteceu | o domínio não julga assinatura |

**`recebido` É PRESENÇA FÍSICA, e nada além.** Não afirma assinatura,
validade nem preenchimento. Nada de `retornado_assinado`, `irregular` ou
`conferido`: isso depende da conferência do gestor, que é outro fluxo e
acontece depois — documento que voltou sem assinatura é `recebido`,
porque fisicamente foi, e a irregularidade vira evento posterior. Pôr o
julgamento aqui faria o documento assinado afirmar o que quem assinou não
tinha como saber.

Por isso este par é válido e não é contraditório (vetor V014):

```
v   E1  insucesso  ausente   -
d   E1  crediario  recebido
```

A entrega falhou e o papel voltou em branco. O `d` **não** é filtrado por
desfecho, ao contrário do `pr`: o papel saiu sob custódia do motoboy,
então o destino dele é declarado de qualquer jeito.

**`faltante` descreve o estado físico NO INSTANTE em que o retorno foi
selado.** Se o documento chegar depois — outra corrida, no dia seguinte —,
**isso não corrige nem reescreve o DCRR1**: constitui evento novo sobre o
vale. A corrida B nem poderia declará-lo, porque aquele vale não estava
na saída dela. Alguém vai querer "consertar" um `faltante` daqui a seis
meses; é a regra 7 dizendo que não.

**A obrigatoriedade sai da `forma` das linhas `p` do canônico ASSINADO da
saída** — `convenio` ou `crediario` esperam um `d` cada. Nenhuma tabela
mutável participa. E a checagem é **igualdade de conjunto**
(`documentos_esperados = documentos_declarados`), não continência: "todo
esperado apareceu" deixaria sobra passar, e sobra é o documento afirmando
custódia de papel que aquela saída nunca gerou.

**Ausência NÃO vira `faltante`.** Esperava crediário e não veio linha
`d` → recusa. Normalizar inventaria um fato que ninguém declarou.

**A FRONTEIRA, e ela decide onde cada regra mora:**

```
canônico PURO      domínio, duplicata, normalização, ordenação, bytes
                   NÃO sabe o que a saída esperava

selar_romaneio_    esperado = declarado, contra a saída selada
retorno
```

Trazer a expectativa pra dentro do canônico custaria a pureza — que é o
que permitiu, na 2A, montar um documento multi-vale quando nenhum
romaneio selado tinha mais de um. Por isso "esperava e não veio" não é
golden vector: é recusa contextual, provada no placar da 2B.

**`entregas.status_documental` é recomputado do zero a cada retorno**, e
é AGREGADO por vale (a coluna é uma só e um vale pode ter os dois tipos):
nenhum esperado → `nao_aplica`; todos recebidos → `recebido`; ao menos um
faltante → `pendente`. Nunca `extraviado` automático — isso é conclusão
posterior de que o papel se perdeu. Quando a conferência do gestor exigir
granularidade por `(entrega_id, tipo_documento)`, é tabela própria, não
mais um valor nesta coluna.

E o cadastro passou a marcar **crediário** como `pendente` junto com
convênio (`GERAM_DOCUMENTO_FISICO` em `data/entregas.ts`). Sem isso o
primeiro retorno com crediário criaria a contradição que a 2B.5 veio
impedir: o documento assinado dizendo que falta papel e o banco dizendo
que não há questão documental aplicável.

##### A divergência deixa de ser um botão

Durante o retorno **não existe** "marcar divergência". O operador informa
o que de fato voltou (forma, valor, troco), o servidor compara com o
previsto da saída, e se diferir grava na MESMA transação: pagamento
realizado selado, evento `pagamento_alterado`, e `status_financeiro`.

**A divergência é consequência dos fatos, não uma decisão manual** — e é
isso que impede "o caixa registrou o retorno e esqueceu de clicar".

`marcarDivergencia` **continua existindo** para o outro caso: o que se
descobre depois do retorno já selado (contagem de dinheiro, conferência
posterior, problema achado no dia seguinte).

##### Golden vectors ANTES do SQL

A ordem de construção é do usuário, e a razão é sutil: TS implementa um
bug → SQL copia o mesmo entendimento → os dois concordam → o teste passa.
Dois gêmeos que concordam não provam que estão certos.

```
contrato DCRR1 → golden vectors revisados à mão
  → TypeScript → teste contra os vetores
  → SQL        → teste contra os MESMOS vetores
  → comparação TS ↔ SQL contra dado real
```

Com os vetores passam a existir **três** referências, não duas. Vale
notar que o canônico da SAÍDA tem só duas (`canonico.spec.mts` testa
propriedades, `conferir-canonico-no-console.js` compara TS×SQL) — os
golden vectors são melhoria sobre o que existe, e vale considerar
retrofitá-los lá depois.

**O triângulo fechou em 2026-08-19**: TS 60/60 contra os vetores, SQL
36/36 contra os MESMOS vetores. Como os dois concordam com uma terceira
referência escrita à mão antes de ambos, concordam entre si — e não por
um ter sido traduzido do outro.

**O que a etapa 6 acrescentou, e o resultado:** os vetores são
sintéticos, e rodam dos dois lados *de dentro*. Ela respondeu outra
pergunta — *o transporte preserva o que os gêmeos concordam?* — com **5
cenários verdes** em 2026-08-19, sobre um documento real de 3 vales.

Três coisas que o canônico impresso provou e que os booleanos não
mostram: a **ordenação atravessou o fio** (o input mandou
entregue/insucesso/entregue e a saída veio ordenada por `entrega_id`, com
o insucesso primeiro); o **bloco `pr` convive com vale sem pagamento**; e
o par vazio/nulo **escala** — 1 byte de diferença com 1 vale, 3 bytes com
3 vales, um `-` por vale.

**Um detalhe do desenho que precisa continuar valendo:**
`conferir_canonico_retorno` é PURA e **não valida pertencimento**, e é
isso que permitiu montar um documento multi-vale quando nenhum romaneio
selado tinha mais de um vale. Quem confere se o vale é daquela saída é
`selar_romaneio_retorno` — lá a mesma liberdade seria erro grave.

Fixtures obrigatórias: acentuação, Unicode fora do BMP, TAB, CRLF, LF,
string vazia, null, `motivo = outro` com detalhe, detalhe com espaços nas
pontas, pagamentos fora de ordem no input, e um vale só contra vários.

#### O verificador de hash — o que o projeto nunca teve

Até aqui o sistema **gerava** evidência criptográfica sem **conseguir
verificá-la**: `signature_hash` e `final_hash` eram calculados, gravados
e exibidos truncados, nunca recomputados. A etapa 2A fecha isso, e o
insumo já está todo no banco:

```
signature_hash = digest(
     romaneios.document_hash
  |  assinaturas.tipo_signatario        ← LIDO DA LINHA
  |  assinaturas.user_id  ou  motoboy_id
  |  assinaturas.strokes::text
  |  romaneios.selado_em                ← é o `v_agora` da fórmula
  |  'sessao_autenticada'  ou  romaneios.modo
)
final_hash = digest(document_hash | hash_caixa | hash_motoboy)
```

Quatro regras, e a última é a que mais importa:

1. **Reproduzir a fórmula histórica exatamente** — concatenação, ordem,
   casts, representação dos `strokes`, timestamp e literais. Não "uma
   fórmula equivalente".
2. **`tipo_signatario` vem da linha**, nunca fixado. Uma função que
   fixasse o literal falharia nos romaneios da outra era — é por isso que
   esta regra se prova sozinha aqui.
3. **Read-only.** Nunca "corrigir" hash. Divergiu, ele reporta romaneio,
   hash gravado, hash recalculado e qual camada divergiu — e para.
4. **Não escrever "todos têm que passar" antes de medir pela primeira
   vez.** O gate é: *rodar o baseline sobre todos os romaneios selados;
   qualquer divergência precisa ser explicada antes de prosseguir.*

#### O BASELINE, medido em 2026-08-19

```
9 verificados · 9 válidos · 0 divergências
4 camadas cada: documento, assinatura interna, assinatura motoboy, envelope
```

**Este é o número que a etapa 2A tem que devolver depois de
`papel_no_momento` entrar no INSERT.** Diferente dele, para.

Duas coisas que o baseline provou de passagem:

- **A reconstrução do fuso estava certa.** Se UTC estivesse errado, as
  camadas `assinatura:*` divergiriam todas e a `documento` passaria — ela
  não tem timestamp na fórmula. Esse padrão não apareceu.
- **A regra 2 se provou sozinha.** Três dos nove são
  `offline_sincronizada` (`R-000001`, `06`, `10`), e eles só batem porque
  o último componente sai de `romaneios.modo`. Um verificador com
  `'online'` fixo teria falhado exatamente nesses três.

E ele achou uma coisa que não é sobre hash: **o `R-000001` está gravado
como `offline_sincronizada`**, enquanto o NOTAS o citava em quatro
lugares como a prova do caminho online. A conclusão sobrevive (seis
outros romaneios são `online`); a citação estava errada. Corrigido no
item 42 do NOTAS, com a hipótese — a selagem provavelmente caiu no
caminho offline e foi registrada como online pelo que a tela mostrava,
que é o defeito do item 40, em vigor naquele dia.

**O que o verificador NÃO verifica, declarado antes de rodar** — senão o
primeiro baseline mostra "divergências" que não são, e alguém entra em
pânico ou, pior, "conserta":

| o quê | por quê |
|---|---|
| romaneios em **conflito** (`R-000002`, `R-000004`) | não têm `final_hash` nem corrida, e as assinaturas deles vivem em `romaneios.conflito`, não em `assinaturas` |
| assinaturas **legadas** (`romaneio_id IS NULL`) | o `hash_sha256` delas vem da fórmula do schema inicial, que é outra coisa |
| romaneios **offline sincronizados** (`R-000010`) | verificam sim — mas só se o último componente vier de `romaneios.modo`, e não do literal `'online'`. É o segundo caso que prova a regra 2 |

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
- ~~**Portal da agência.**~~ **Entrou no escopo em 2026-09-08** como passo
  6 do escopo revisado — desenho na seção 5 de
  `docs/escopo-pre-v1-revisado.md`, **código não começado**.
  `profiles.papel` já aceita `'agencia'` desde o schema inicial; falta a
  policy, e ela é o começo: o acesso é vinculado à agência e ao tenant, e
  **nunca pelo cargo de administrador da farmácia**.
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
- **Filial obrigatória para caixa e gerente, nula para admin** (passo 2,
  2026-09-11) — na tela, na Edge Function antes do `createUser`, e no
  banco pelo CHECK `profiles_filial_obrigatoria`. Ver "Quem vê o quê".
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

**A linha "distante" é MEDIÇÃO HISTÓRICA, não caso vivo.** Ela vale como o
que foi cronometrado em 2026-08-10, quando o endereço distante cobrava dois
vales. Com a decisão de 2026-09-08 (um vale, sem adicional) esse caso deixa
de existir no cadastro — e o passo 1 **só pode melhorar** o número, porque
tira um campo da tela sem acrescentar nenhum. Não é preciso recronometrar
para aprová-lo; é preciso recronometrar se algum passo **acrescentar**
campo.

**"Os dois papéis" são vale do tele + planilha de controle da farmácia**, não
duas vias do mesmo vale. Entrega distante multiplica os dois.

**Essa folga é orçamento, não sobra pra gastar à toa.** Toda mudança na tela de
cadastro continua sendo avaliada contra os 25 s, e campo novo ali continua
exigindo justificativa explícita. A diferença é que agora dá pra medir de novo
em vez de discutir no achismo — e uma regressão que coma a folga é visível.

**O E4 é o exemplo de como gastar zero** (2026-08-27): as duas formas de
pagamento entraram sem tocar no caminho de uma forma. Nenhum campo novo,
nenhuma tecla a mais, a mesma cadeia de Enter — só um botão fora dela. O
teste da regra: *"o que muda pra quem NÃO usa a feature?"* Se a resposta
não for "nada", o desenho ainda não está pronto. **O cronômetro não foi
rodado de novo**, e pela mesma razão não precisou: não há passo novo a
medir no caminho medido.

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
11. ~~**Romaneio de Retorno**~~ — **feito**, em seis etapas, entre 19 e
    25/08. O caminho feliz rodou nos dois modos (`R-000023` e `R-000025`
    online, `R-000026` `offline_sincronizada`) e o placar de integridade
    do retorno saiu de `0 · 0 · 0` para `3 · 3 · 0`. As decisões estão na
    seção "O Romaneio de Retorno" acima. Falta a etapa 9 daquela frente: o
    fluxo excepcional (online) e o PDF do retorno + Drive.

### A sequência pré-V1 revisada — decidida em 2026-09-08

Substitui a ordem anterior (`E10 E11 E12 E6 E9 E7 E8 → STAGING → corte`).
Vem de `docs/escopo-pre-v1-revisado.md`, revista em 2026-09-11 por
`docs/plano-pre-v1-2026-09-11.md`; **construídos até aqui: os passos 0, 1, 2 e 3.**

```
0.  alinhar a fonte de verdade ao escopo revisado   ✓ 2026-09-08
1.  um vale sem adicional · convênio genérico       ✓ 2026-09-10
1b. sem "Outro" — passo próprio   ✓ 2026-09-10 (migration aplicada)
2.  "Cargo" · filial obrigatória · admin sem lançamento   ✓ 2026-09-11 (aplicado e aceito)
3.  snapshot histórico da filial nos documentos   ✓ 2026-09-11 (aplicado)
4A. mapear ciclo do vale, tentativa e evidências — levantamento v2 feito, aguarda decisões   ← AQUI
4B. implementar o contrato de assinaturas e envelope
4C. continuidade offline: abrir o app sem rede (Service Worker + Cache API), telas no estado local e E12 — obrigatória antes do piloto
5.  conferência diária calculada, com exceções e aprovação versionada
6.  painel da agência e conciliação por vale, por quinzena
7A. staging e ensaio do corte
7B. corte final, produção e piloto em 1 filial, com a agência
```

**O passo 2 mudou de conteúdo em 2026-09-11.** O "E10 completo" saiu:
na operação real o admin não lança vale (ver "E10"). No lugar dele, o
admin deixou de ver as ações de balcão — lançamento e, desde a revisão do
plano no mesmo dia, também saída e retorno.

**O plano de execução de 2026-09-11** (`docs/plano-pre-v1-2026-09-11.md`)
reorganizou os passos 4 a 7 com respostas do usuário. Decisões confirmadas
que mudam o desenho — **nenhuma construída**, fora a limpeza de interface
do admin:

- **O sistema substitui a planilha da farmácia E dá à agência uma
  contraparte própria.** O piloto precisa das duas partes, e de saída e
  retorno sem internet.
- **O vale é a unidade de conferência.** "Marcos: dez vales, R$ 90" é
  resumo; o sistema guarda QUAIS são os dez, senão não aponta o duplicado.
  Nome ou endereço iguais não bastam para chamar de duplicidade.
- **Pendência retém só o vale afetado.** Dez apresentados com um retido
  aprovam R$ 81 e mantêm R$ 9 pendentes, com os três totais visíveis às
  duas partes; o retido não é apagado, cancelado nem marcado como pago.
- **A agência APRESENTA a cobrança**, com a própria lista, responsável,
  horário e versão. Rascunho gerado não é a agência ter conferido;
  correção vira revisão; referência sem correspondência vira divergência,
  nunca entrega fictícia; reenviar não duplica.
- **Aprovação operacional, aprovação da cobrança e pagamento são três
  fatos distintos.** "Sem cobrança recebida" não é diferença zero.
- **A farmácia paga a agência por quinzena, e a agência paga os
  motoboys.** O repasse interno dela fica pós-V1, e **a antecipação
  informal de dinheiro pelo motoboy fica FORA do sistema** por decisão
  explícita — não é lacuna.
- **Admin consulta e decide; não lança vale, não libera saída nem registra
  retorno.** Gerente tem filial fixa e cobre o balcão ocasionalmente.

**Respondido pelo usuário em 2026-09-11** (item 104 do NOTAS; seção 12 do
levantamento 4A):

- **Sem assinatura manuscrita no sistema — só cartão e PIN** do lado do
  motoboy. Decidido, não construído (4B).
- **Gestor com credencial própria** (cartão + PIN) para verificar a saída do
  motoboy, sem travar o fluxo.
- **Outro motoboy trazendo o retorno nunca aconteceu**: a recusa
  `outro_motoboy` fica, sem fluxo novo.
- **Gestor e financeiro são os responsáveis**: o gestor responde ao
  financeiro quando algo dá errado.
- **Busca posterior de documento não gera vale.**

E, na segunda rodada do mesmo dia:

- **O gestor é o gerente da filial**, e a credencial dele serve **quando o
  motoboy perde o cartão**, na saída e no retorno.
- **O financeiro é o admin**: o gerente confere o dia e resolve
  divergência; o admin aprova a cobrança.
- **Baixa de papel é do caixa, e eventualmente do gerente**, na própria
  filial — não do admin.
- **O vale de papel continua no começo do piloto** e acaba se ele for
  aprovado, porque o vale passa a estar no painel da agência. Enquanto
  existir, o papel precisa levar o número do sistema — e **hoje a tela de
  cadastro não mostra o número depois de salvar**.

**Ainda abertas, e as duas são de cobrança (passos 5 e 6), não do 4B:** as
datas da quinzena; e **se transferência gera vale — a resposta "acredito
que não" contradiz a confirmação de 2026-08-11** registrada em "Tarifa", e
nada muda antes de checar com a farmácia ou a agência.

**Os passos 5 e 6 são duas frentes de produto ligadas.** O fechamento pode
organizar as exceções operacionais antes de o painel existir, mas **não
pode se anunciar como conciliado com a agência antes de receber e comparar
a cobrança dela**.

**O passo 3 era um defeito medido, não uma melhoria — CONSTRUÍDO e
APLICADO em 2026-09-11** (migration `20260911130000`). Conferido: `R-000031`
e `R-000032`, os primeiros depois dela, já carregam o nome, e o
verificador foi a 22 · 22 · 0 com os dois verificando. Na página, com o
nome atual da filial reescrito só no navegador, o `R-000031` manteve o nome
gravado e um romaneio antigo caiu no nome atual. O nome da filial nos
documentos vinha de join vivo: renomear uma filial mudava o cabeçalho de
PDFs históricos e mandava um reenvio para outra pasta do Drive. Agora ele
é congelado em `payload.loja_nome` no selo — saída, retorno e conflito — e
`nomeDaFilialDoDocumento` (`lib/filialDoDocumento.ts`) é a única leitura,
no mapper compartilhado de página, PDF e sangria.

- **Fora do canônico, de propósito.** O `document_hash` continua cobrindo
  só o `loja_id`; nenhum hash muda, e o verificador não lê o payload.
- **Documento anterior à migration cai no nome atual.** É leitor de
  formato histórico, só para dados de teste que o corte apaga. **Não houve
  preenchimento retroativo**: gravar o nome de hoje seria inventar o do
  instante do selo.
- **Chave presente com nulo NÃO cai no nome atual**: o snapshot existe e
  diz que não havia nome.
- **A saída offline congela o nome do instante da sincronização**, não o
  da retirada — só diverge se a filial for renomeada nesse meio tempo.
- **A migration é gerada** por `scripts/patch-payload-loja-nome.mts`, que
  prova que só a chave entrou. Não edite à mão.

**O staging continua vindo DEPOIS de todas as funções**, e a razão é do
usuário: o objetivo dele não é ver se builda fora do localhost, é provar o
produto como multiusuário e multiperfil — o que exige o papel `'agencia'`
do passo 6 existindo.

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
- **Texto livre passa por `src/lib/texto.ts`, e só na ENTRADA** (E1,
  2026-08-25). Quatro funções, uma por natureza de campo:

  | função | campos |
  |---|---|
  | `normalizarNome` | cliente, motoboy, agência, convênio, usuário |
  | `normalizarEndereco` | endereço do cliente |
  | `normalizarParagrafo` | justificativa, observação, motivo do insucesso |
  | `normalizarLinha` | o resto de uma linha só |

  **A fronteira é a regra**, e `scripts/fiacao-texto.spec.mts` a prova
  lendo o fonte, porque "não é chamado em lugar nenhum" é afirmação sobre
  o código, não sobre execução:

  ```
  DIGITAÇÃO → normalização → validação → persistência → snapshot
  ```

  e **nunca** o contrário. `canonico.ts`, `canonicoRetorno.ts`,
  `congelarRetorno.ts`, `romaneioPdf.ts`, `contextoRetorno.ts` e as telas
  de exibição **não podem importar daqui**. O canônico tem gêmeo em SQL e
  sanitiza só TAB/CR/LF; normalizar na leitura mudaria os bytes que as
  duas partes assinaram.

  Também nunca passa por aqui: **senha, PIN, token de cartão, hash, uuid,
  username, e-mail técnico** — nada disso é linguagem humana.

  O que ela **não** faz, e não vai fazer: inventar acento. `"joao"`
  continua `"Joao"`. `Joao`, `Fatima` e `Luis` são grafias legalmente
  registradas, e adivinhar corromperia nome de documento — no endereço,
  mandaria o motoboy pra rua errada.

  **A caixa é tímida:** só é ajustada quando o texto está inteiro numa
  caixa só. `"Maria DE fátima"` e `"João MacArthur"` saem intocados —
  caixa mista é escolha do autor. É essa timidez que torna aceitável o
  único falso positivo conhecido do endereço (`"RUA MIX CENTER"` →
  `"Rua MIX Center"`, pelo validador de numeral romano que existe pra
  acertar `"Rua XV de Novembro"`).
- **Busca é o contrato OPOSTO, e mora em outra função** (E1.1). A regra:

  ```
  persistência preserva o que foi digitado
  busca é tolerante
  ```

  `normalizarNome('Joao')` continua `'Joao'` porque mudar o dado seria
  inventar um nome; `normalizarParaBusca` achata acento e caixa porque
  ela não altera nada — só decide quais registros correspondem.
  `casaComBusca(valor, pesquisa)` normaliza **os dois lados**, e existe
  pra nenhuma tela escrever `.includes()` esquecendo um deles.

  **O resultado da busca NUNCA volta pro campo.** O caso (12) de
  `texto.spec.mts` existe só pra isso: ele afirma que, sobre a mesma
  entrada, as duas funções discordam de propósito. Sem ele, alguém daqui
  a meses pensa "já temos uma função que tira acento" e a usa pra
  salvar.

  Do lado do BANCO, o gêmeo é `public.sem_acento(text)` mais as colunas
  geradas `cliente_nome_busca` / `cliente_endereco_busca` — o Histórico
  filtra por elas, e elas **nunca entram num `select`**, porque a tela
  mostraria `"joao da silva"` no lugar do nome da pessoa.

  Três coisas dessa migration que não são óbvias:

  - **`unaccent` é STABLE, não IMMUTABLE**, e coluna gerada exige
    imutável. O invólucro declara `immutable` chamando a forma de dois
    argumentos com o **dicionário explícito** — é o dicionário explícito
    que torna a declaração honesta, porque sem ele o resultado
    dependeria do `search_path` de quem chama.
  - **Coluna gerada, não trigger.** Ela não pode ser escrita, então não
    tem como divergir da origem — nem servir de porta dos fundos pra
    regra 7, já que mudá-la exigiria mudar `cliente_nome`, que a
    `fn_entrega_imutavel` congela.
  - **Nenhum índice, de propósito.** A busca é `like '%termo%'`, com
    curinga à esquerda, e btree não serve pra isso — seria cargo cult
    com custo de manutenção. O que serviria é `pg_trgm` + GIN, e o SQL
    está comentado na migration esperando o volume justificar.

  Medido ao aplicar: **16 · 16 · 0** no verificador, ou seja, duas
  colunas novas em `entregas` não moveram documento assinado nenhum.
  Isso vale porque canônico e payload leem **colunas explícitas**, nunca
  `to_jsonb(e)` — se alguém trocar por `to_jsonb`, elas entram no hash
  sozinhas.
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
- **O anel de foco tem contraste MEDIDO, e ele é requisito funcional aqui**
  (2026-09-08). `--ring: oklch(0.6)` dá 3,95:1 sobre o fundo claro,
  5,01:1 sobre o escuro e 4,54:1 sobre o card escuro — o mesmo valor nos
  dois temas, de propósito. **Não clareie esse token**, e não devolva a
  meia opacidade que ele tinha: `focus-visible:ring-ring/50` chegava ao
  olho em **1,54:1**, contra os 3:1 que a WCAG pede.

  Isto não é acessibilidade genérica. O requisito do projeto é **zero
  mouse**, e numa tela percorrida por Tab e Enter o anel é a única coisa
  que diz onde o caixa está. A medição está em
  `anti-slop/audit-001-2026-09-08.md`; para conferir qualquer par de
  cores, `npx tsx scripts/contraste.mts "#RRGGBB" "#RRGGBB"`.

  **Compor opacidade com o fundo é o que mata contraste**, e isso vale
  para qualquer indicador futuro: com `/50` NENHUM tom de cinza alcança
  3:1, porque a mistura puxa tudo para o meio. Medido: o máximo é 2,92
  com um cinza quase preto.

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
- **Aviso de operação enfileirada sai da FILA, nunca de string estática —
  use `<StatusDeGravacao>`.** As três telas de lançamento montavam
  `"… salva — sincronizando…"` à mão num estado que ninguém limpava: a
  frase ficava no ar depois de a operação ter subido, e ficava
  **idêntica** se ela tivesse falhado, travado por dependência ou virado
  conflito. `enfileirarOperacao` devolve a chave da fila e
  `useSituacaoDaOperacao` traduz o estado real; o texto da tela afirma só
  o fato consumado ("Entrega de José salva") e a cláusula de
  sincronização é escrita por quem olha a fila. **Só o caso feliz se
  apaga sozinho** — aviso de problema que some enquanto ninguém olha é o
  mesmo defeito invertido. Duas armadilhas medidas e que voltam se alguém
  reescrever: o `onLimpar` inline **não pode entrar nas dependências** do
  efeito do timer (função nova a cada render reinicia a contagem, e o
  aviso volta a não sumir enquanto o caixa digita), e a situação tem que
  ser consultada **pelo id** com carimbo de qual id é — ler a fila
  inteira e procurar na lista conclui "sincronizada" no instante entre o
  `put` e a liveQuery reconsultar.
- **Reticência de PROCESSO anima; de truncamento ou placeholder, não.**
  `Carregando`, `Salvando`, `Enviando`, `Gerando` levam `…` animado, via
  `src/components/EmAndamento.tsx` — `<Carregando />` pro parágrafo de
  lista/tela, `<EmAndamento>Salvando</EmAndamento>` pro rótulo de botão,
  `<Reticencias />` pro resto. Já `1 … 5 6 … 84` da paginação,
  `hash abc123…` e `Selecione…` ficam parados: ali o `…` quer dizer "tem
  mais coisa" ou "escolha algo", e movimento seria mentira. **O `<span>`
  do `<EmAndamento>` não é supérfluo** — o `Button` é `inline-flex` com
  `gap-1.5`, e as reticências soltas lá dentro viram outro item de flex,
  com 6px de vão entre a palavra e os pontos (medido).
- **`prefers-reduced-motion` tira o deslocamento, não o sinal.** As
  reticências de "sincronizando" pulsam porque o movimento é a
  informação: parado, o aviso volta a ser indistinguível de frase
  esquecida na tela. Com movimento reduzido some o `translateY` e fica o
  esmaecer. Não é teórico — **o navegador desta máquina responde
  `reduce`**, então um `animation: none` ali deixaria o usuário sem ver
  nada se mexer.
- **Sem router.** Não está na stack. Navegação é troca de estado local (`useState<View>`)
  dentro de `Painel.tsx`, com `onVoltar` como prop pra cada tela voltar pra lista. Isso
  aguenta bem o tanto de telas que o MVP tem hoje — se crescer muito mais, reconsiderar
  (mas aí é conversa pra ter, não decisão unilateral).
- **Login é USUÁRIO e senha desde o E5** (2026-08-30). O caixa digita
  `camilo`, não um e-mail. Por baixo continua sendo o Supabase Auth
  nativo: `src/lib/username.ts` compõe `camilo@drogariacidade.invalid` e
  chama `signInWithPassword`.

  **A arquitetura A é o que força esse desenho.** A decisão congelada
  proíbe RPC pública que enumere usernames — e uma
  `resolver_username(text) → email` É um oráculo de enumeração. Sem
  lookup, sobra compor o endereço deterministicamente. De quebra a
  unicidade global vem de graça (e-mail é único no Auth), e "global" é o
  certo: antes de autenticar não existe tenant pra desempatar.

  **`.invalid` é reservado pela RFC 2606** — nunca resolve, ninguém
  registra, e se autodocumenta pra quem abre o painel do Supabase.
  `DOMINIO_TECNICO` é uma constante só; **trocá-la exige atualizar o
  e-mail de toda conta existente.**

  **O e-mail é COMPOSTO no servidor, nunca aceito do cliente.** A Edge
  Function deixou de ler `corpo.email` — aceitar o endereço permitiria
  criar uma conta que o login jamais alcançaria. Mesma regra que já valia
  pra `tenant_id` e `papel`.

  **O GÊMEO é a parte frágil:** `normalizarUsername` existe no cliente e
  numa cópia dentro da Edge Function (Deno, fora do bundle). Divergindo
  em um byte, a conta nasce com um endereço e o login tenta outro — e o
  sintoma é "senha inválida", sem verificador, sem canônico, sem pista.
  `scripts/username.spec.mts` **lê os dois arquivos e compara o corpo das
  duas funções**; mexeu num lado, mexe no outro.

  Username **tira acento** (`josé` → `jose`), ao contrário de
  `normalizarNome`, que preserva — o local part de um e-mail não os
  aceita. É o par de contratos opostos do E1.1 outra vez, e por isso
  username **nunca** passa por `lib/texto.ts`.

  Não há fluxo de "esqueci minha senha" nem confirmação por e-mail
  (`email_confirm` já vem marcado). Contas são criadas pelo painel de
  admin; **trocar senha e trocar username continuam manuais no Supabase.**

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
