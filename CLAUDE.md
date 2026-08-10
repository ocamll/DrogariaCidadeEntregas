# Sistema de Tele-entrega — Farmácia

## O que é

Sistema complementar ao ERP **Trier** para registro de tele-entregas de farmácia.
Substitui dois formulários manuscritos que o caixa preenche hoje a cada entrega.

**Não** substitui o Trier. **Não** emite documento fiscal. **Não** toca no banco do Trier.

Usuário principal: operador de caixa, PC Windows com Chrome, com fila de cliente
esperando no balcão. Velocidade de digitação é o requisito número um.

Usuário secundário: mototaxista, que só encosta num tablet para assinar.

---

## Stack

Lista fechada. Não instalar dependência nova sem perguntar.

- Vite + React + TypeScript
- Tailwind + shadcn/ui
- TanStack Query (server state) + Dexie (fila offline em IndexedDB, +
  `dexie-react-hooks` pro `useLiveQuery` — pacote oficial da Dexie, não é lib nova)
- `signature_pad` (captura de assinatura)
- Supabase: Postgres + Auth + Storage + Realtime + RLS
- Deploy: Cloudflare Pages

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

7. **Entrega com assinatura capturada é imutável** nos campos de valor, cliente e
   número do vale. Correção é evento novo apontando para o original, nunca `UPDATE`
   silencioso. Há trigger no banco garantindo isso — não tente contorná-la.

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
      mas sem cliente real e sem valor (`valor_compra_cents` default 0, nenhum
      `pagamentos` criado). Único campo digitado: filial de destino (select);
      origem é a loja de quem tá logado, resto é automático igual ao vale normal.
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
      de marcar recebido/devolvida, mutation direta sem fila offline
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
      `entregas` tem duas FKs pra `lojas` (`loja_id` de origem e
      `loja_destino_id` de transferência), então o embed
      `entregas(lojas(nome))` sem hint dá erro de ambiguidade do PostgREST
      (`PGRST201`) — resolvido com `lojas!entregas_loja_id_fkey(nome)`.
      Testado de ponta a ponta: os 5 tipos aparecendo com resumo correto,
      autor resolvido nos 2 tipos novos (que antes só tinham `user_id`
      cru), filtro de filial isolando corretamente Matriz de Filial 02
      (inclusive o vale de transferência aparecendo na filial de origem,
      não na de destino).

### Fora — não construir, não sugerir, não "já que estou aqui"

Onboarding de tenant, tela de cadastro de farmácia, cobrança, subdomínio, portal da
agência, geração de PDF, integração com Trier, leitura de QR de NF-e, app nativo,
notificação WhatsApp, GPS, tarifário por bairro, dashboard com gráfico, conciliação
de cartão por NSU, PIN de mototaxista, encadeamento de hash, tela de fechamento
mensal, exportação automática para Drive, multi-loja.

Se algum destes parecer necessário, **pare e pergunte antes de implementar.**

### Ideias futuras — fora do MVP atual, mas anotadas pra não esquecer

- **Painel do admin criar/gerenciar usuários (caixas) direto pelo app.** Hoje
  cadastro de usuário é manual: Supabase Auth (dashboard) + `insert` em
  `profiles` via SQL Editor. Faz sentido automatizar porque funcionário tem
  rotatividade — mas **loja continua manual**, porque filial é rara e não
  vale a complexidade extra só por ela. Trava técnica: criar usuário no Auth
  exige a `service_role` key, que nunca pode rodar no navegador (ignora RLS
  inteiro). Precisaria da primeira peça de backend do projeto — uma Supabase
  Edge Function rodando essa chave do lado do servidor. Hoje o projeto é
  frontend puro falando direto com Postgres via RLS; isso muda essa forma.

---

## O teste que decide o projeto

O caixa preenche os dois papéis em X segundos. Se o sistema demorar mais que isso,
ele fracassou mesmo funcionando perfeitamente — o caixa volta pro papel e não sai
mais de lá.

**Alvo: menos de 25 segundos, sem tocar no mouse.**

Toda mudança na tela de cadastro precisa ser avaliada contra esse número. Campo novo
nessa tela exige justificativa explícita.

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
- `src/components/` (UI), `src/pages/` (telas), `src/data/` (acesso a dados),
  `src/lib/` (utilitários)
- Valores monetários: helpers `toCents(str)` e `formatBRL(cents)` em `src/lib/money.ts`.
  Nenhum outro lugar do código faz conversão.
- **Sem router.** Não está na stack. Navegação é troca de estado local (`useState<View>`)
  dentro de `Painel.tsx`, com `onVoltar` como prop pra cada tela voltar pra lista. Isso
  aguenta bem o tanto de telas que o MVP tem hoje — se crescer muito mais, reconsiderar
  (mas aí é conversa pra ter, não decisão unilateral).
- **Login é e-mail/senha (Supabase Auth nativo), não usuário.** Pra ficar rápido de
  digitar sem construir um sistema de username de verdade, contas são provisionadas
  com e-mail curto e fake tipo `caixa1@drogariacidade.local` (não precisa ser e-mail
  real — não tem fluxo de "esqueci minha senha" nem confirmação por e-mail no MVP).
  Decisão consciente, não workaround temporário.

---

## Como trabalhar comigo

- Antes de criar tabela nova, mostrar o SQL e esperar confirmação
- Se um requisito conflita com as regras invioláveis, **parar e dizer** — não contornar
- Não adicionar feature que não está na lista "Dentro"
- Ao terminar uma sessão, dizer o que dá pra testar e como
