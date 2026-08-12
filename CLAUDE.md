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
- Supabase: Postgres + Auth + Storage + Realtime + RLS + **uma** Edge Function
  (`criar-usuario` — a única coisa que roda no servidor, ver "Gestão de
  usuários" abaixo)
- Deploy: Cloudflare Pages
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
      mas sem cliente real e sem venda (`valor_compra_cents` default 0, nenhum
      `pagamentos` criado). **Tem valor de entrega**, sim — ver "Tarifa de
      entrega e vales". Único campo digitado: filial de destino (select);
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
- [x] **Painel de admin criar/gerenciar usuários** — entrou **depois** de a
      checklist original fechar (era "Ideias futuras"), por pedido explícito.
      Sub-aba "Usuários" em Cadastros, só pra `admin`. Cria, edita
      nome/papel/filial e bloqueia/libera acesso. Trouxe a primeira (e
      única) peça de backend do projeto — ver "Gestão de usuários" abaixo,
      que é onde estão as regras que não dá pra descobrir lendo só o código.

### Fora — não construir, não sugerir, não "já que estou aqui"

Onboarding de tenant, tela de cadastro de farmácia, cobrança, subdomínio, portal da
agência, geração de PDF, integração com Trier, leitura de QR de NF-e, app nativo,
notificação WhatsApp, GPS, tarifário por bairro, dashboard com gráfico, conciliação
de cartão por NSU, PIN de mototaxista, encadeamento de hash, tela de fechamento
mensal, exportação automática para Drive, tela de cadastro de loja/filial nova
pela UI (continua manual via SQL, filial é rara — **não confundir com suporte
a múltiplas lojas, que já existe** de ponta a ponta; a farmácia real tem 17
filiais).

Se algum destes parecer necessário, **pare e pergunte antes de implementar.**

### Ideias futuras — fora do MVP atual, mas anotadas pra não esquecer

(Nada aqui no momento. O painel de usuários, que era a única entrada desta
lista, foi construído — ver "Gestão de usuários" abaixo. **Loja continua
manual**, porque filial é rara e não vale a complexidade extra só por ela.)

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
  `is_gerente()` sobrevive com um uso só: a trigger
  `fn_entrega_protege_conferencia`, porque *poder conferir* não é
  *enxergar outra filial*. O gerente confere, e alcança só a filial dele
  porque o UPDATE cai na policy de `entregas`.
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
`valor_entrega_cents` = tarifa da filial de **origem** e
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

## Gestão de usuários — a única parte com backend

O projeto é frontend puro falando direto com Postgres via RLS, **com uma
exceção**: criar usuário no Supabase Auth exige a `service_role` key, que
ignora RLS inteira e por isso nunca pode ir pro navegador. Isso mora numa
Edge Function (`supabase/functions/criar-usuario/`), a única peça de
servidor do projeto.

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

Deploy da função (não tem CLI configurada neste projeto): dashboard →
Edge Functions → Deploy a new function → Via Editor, nome `criar-usuario`.

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
- Valores monetários: helpers em `src/lib/money.ts` — `centsFromDigits(digitos)`,
  `formatCentsInput(cents)` (máscara de digitação) e `formatBRL(cents)` (exibição).
  Nenhum outro lugar do código faz conversão.
- **Campo de dinheiro é sempre `<CampoMoeda>`**, nunca `<Input>` cru. O caixa digita
  só dígitos e eles preenchem da direita (centavos primeiro), igual maquininha de
  cartão: `1` `2` `3` `4` `5` → `0,01` → `0,12` → `1,23` → `12,34` → `123,45`. Ele
  nunca digita `,` nem `.`, então não existe como confundir os dois. O estado do
  componente pai guarda a string de dígitos crua, não o texto formatado.
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
    isso que pagou a coluna "Registrado por" sem trazer a rolagem de volta.
  - **Número do vale e o selo "Transferência" nunca quebram** — o selo fica
    ao lado do número, não embaixo.
  - **Data em cima, hora embaixo, sempre**, em duas linhas explícitas. Se a
    célula quebrar sozinha, o resultado depende da largura sobrando e um
    vale aparece diferente do vizinho.
  - **Linha de apoio não usa `text-muted-foreground`** — aquele cinza
    (`oklch(0.556)`) é claro demais pra informação que o caixa lê de fato.
    O padrão é o texto principal a 70%.
  - **A linha inteira é `align-top`.** A `TableCell` do shadcn é
    `align-middle`, e como Cliente e Data ocupam duas linhas enquanto
    valor/status ocupam uma, os de uma linha ficavam centralizados — 9px
    abaixo do nome do cliente, com cada coluna começando numa altura
    diferente. Célula de altura mista sempre alinha pelo topo aqui.
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
