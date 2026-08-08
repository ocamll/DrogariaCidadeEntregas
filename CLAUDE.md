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
      (não só nos já divergentes). Aceita **mais de uma forma na divergência**
      (ex: metade pix, metade dinheiro — até 4 linhas, soma tem que bater com
      o valor da compra), grava um `pagamentos.realizado` por forma + evento
      `pagamento_alterado` com justificativa. Admin/gerente vê contador no
      cabeçalho (só o aviso do dia, some do ar quando o dia vira) e aba
      "Divergências" (registro permanente — vale, cliente, de/pra com
      valores, justificativa e autor de toda divergência já marcada, sem
      limite de data). Sem a aba, a justificativa só existia no banco;
      ninguém em gestão conseguia consultar o "porquê" depois do dia acabar.
- [x] Relatórios em tela: dia, período, por mototaxista, por agência — aba
      "Relatórios" (admin/gerente), filtro De/Até (atalhos "Hoje"/"Este
      mês"), resumo geral (vales, cliente vs. transferência, valor de
      compra/entrega, contagem por status) + tabela por motoboy + tabela
      por agência (vales, entregues, insucessos, valor de entrega).
      Agregação client-side, sem view/RPC nova — volume do MVP não
      justifica ainda. Sem gráfico e sem PDF (ambos na lista "Fora").
      Testado com "Este mês": números batem, inclusive corrida antiga sem
      agência contando só pro motoboy.
- [ ] Cadastro de agências, mototaxistas, convênios
- [~] **Fila offline** (IndexedDB + sync em background + indicador visual) —
      feito só pro cadastro de entrega (o fluxo de velocidade/zero-mouse,
      o que mais precisa disso). `criarEntrega` virou `upsert` (não
      `insert`) e `criarPagamentoPrevisto` aceita id determinístico
      (mesmo uuid da entrega) — sem isso, reenviar um item da fila depois
      de falha parcial duplicava o pagamento previsto. Sincroniza sozinho
      no evento `online` e ao abrir o app; indicador no cabeçalho mostra
      quantos itens estão pendentes/com erro. Testado de verdade: bloqueei
      `navigator.onLine`, cadastrei uma entrega (ficou só no IndexedDB,
      nada foi pro Supabase), religuei, sincronizou sozinha e pegou vale
      real do banco. **Transferência, corrida/assinatura, divergência e
      fechamento de corrida continuam só online** — não entraram nessa
      fila ainda, ficam pra quando/se fizer falta.
- [ ] Lista simples de documentos de convênio pendentes de retorno
- [ ] Log de eventos

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
8. ~~Fila offline~~ — feito, escopo reduzido: só cadastro de entrega.
   Ver nota na lista "Dentro" sobre o que ficou de fora e por quê.

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
