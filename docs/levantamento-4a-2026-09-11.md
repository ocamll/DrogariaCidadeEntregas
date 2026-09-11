# Levantamento 4A — ciclo do vale, tentativa e evidências

Levantamento de 11/09/2026 sobre a branch `feat/e10-admin-filial` (commit `ed5715a`), feito lendo código e migrations. **O banco não foi consultado nem alterado, e nenhum código foi mudado.** Serve para decidir o contrato antes do 4B e do 4C.

Os links usam âncoras de linha deste commit; elas envelhecem com o código.

## Resumo

- **O que já é forte:** saída e retorno selados, online e offline, com cartão, PIN, sessão, traços, hash do documento e verificador. Nada disso depende de geolocalização, que já está nula.
- **O que não existe:** a nova tentativa da mesma compra. Um vale com insucesso não volta a sair, e o servidor recusaria.
- **O que está calculado errado para o objetivo novo:** relatório e fechamento somam **tarifa e compra de todo vale não cancelado**, pela data do **lançamento**. Isso inclui vale que nunca saiu e compra de tentativa que não entregou.
- **O que o envelope faz, e que nada substitui hoje:** protege PIN e cartão em repouso durante a queda e prende a autenticação àquele documento. Offline é obrigatório, então ele fica.
- **A decisão que mais muda o desenho:** qual evento dá direito à tarifa e em que quinzena ele entra (D1 e D2).

---

## 1. Estado atual — quem confirma cada fato, o que é guardado e onde é verificado

| Fato | Quem confirma hoje | O que fica guardado | Onde é verificado |
|---|---|---|---|
| **Lançamento do vale** | caixa ou gerente, pela sessão | `entregas`: número da sequência do banco, tarifa capturada no cadastro, formas previstas 1:N, `tem_receita`, pendência de papel derivada da forma | RLS de `entregas` e autoria conferida no servidor ([autoria](../supabase/migrations/20260816120000_autoria_no_servidor.sql#L120)). **Não há documento assinado** |
| **Retirada (saída)** | **motoboy:** cartão (identifica) + PIN (autentica) + traços (manifesta). **Farmácia:** sessão (JWT) + traços, com `papel_no_momento` | `romaneios` (snapshot com nome da filial, canônico DCR1, `document_hash`, `final_hash`, modo, dois relógios, IP); duas `assinaturas` (traços, `signature_hash`, `auth_method`, credencial, autorização); corrida aberta; vales `em_rota`; evento `romaneio_selado` | `selar_romaneio_interno`: trava os vales, recusa vale indisponível ou de outra filial virando **conflito com prova**, recalcula o hash **do banco**, consome a autorização de uso único ([saída](../supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql#L149)). Depois, o verificador recalcula documento, cada assinatura e o hash final |
| **Entrega ao cliente** | **ninguém, no ato.** O sistema não registra nada na porta | nada no momento | não há confirmação do destinatário, e o plano decide não exigir |
| **Retorno à farmácia** | **motoboy:** cartão + PIN de novo + traços. **Farmácia:** responsável pela sessão + traços + `papel_no_momento` | romaneio `retorno` (DCRR1: desfecho, motivo e detalhe por vale; pagamentos realizados; documentos recebido/faltante); desfecho em `entregas`; pagamentos `realizado`; eventos; corrida fechada | `selar_romaneio_retorno_interno`: a saída confere, mesmo motoboy, **conjunto de vales igual**, documentos esperados iguais aos declarados, hash, autorização, e **cada pagamento assinado gravado** ([retorno](../supabase/migrations/20260826120000_pagamento_alterado_todos_previstos.sql#L386)). Depois do selo, trigger congela desfecho, motivo e observação ([trigger](../supabase/migrations/20260820180000_fechamento_legado_obsoleto.sql#L110)) |
| **Pagamento na porta** | relato das duas partes no retorno | linhas `pr` do DCRR1 e `pagamentos` realizados | a divergência é **derivada**: previsto × realizado por conjunto de forma e valor, marca `divergente` e grava `pagamento_alterado` sem justificativa digitada ([divergência](../supabase/migrations/20260826120000_pagamento_alterado_todos_previstos.sql#L448)). Depois do retorno, "Notificar ocorrência" registra à mão, por qualquer cargo |
| **Papel de convênio e crediário** | no retorno, as duas partes declaram recebido/faltante (presença física). Depois, quem dá baixa na aba Documentos | status documental; evento `documento_faltante`; na baixa, `documento_recebido_por` e relógio | autoria da baixa conferida no servidor ([autoria](../supabase/migrations/20260816120000_autoria_no_servidor.sql#L137)); a troca de status gera `status_alterado`. Baixa **sem fila offline** ([documentos](../src/data/documentos.ts#L66)) |
| **Receita** | só quem dá baixa na aba Documentos | `receita_recebida_por` e relógio | **fora do documento assinado**, por decisão. A baixa **não gera evento**: receita não é eixo de status ([baixa](../src/data/documentos.ts#L134)). "Não voltou" grava `falta_receita` |
| **Serviço cobrável** | **ninguém.** É calculado na leitura | nada próprio | relatório soma todo vale não cancelado ([regra](../src/data/relatorios.ts#L113)), cortado pela data do **lançamento** ([período](../src/data/relatorios.ts#L210)). Fechamento idem, só cliente e com teto ([fechamento](../src/data/fechamento.ts#L140)). Não existe cobrança da agência |
| **Cancelamento** | qualquer cargo, só vale pendente ([menu](../src/components/EntregaAcoesMenu.tsx#L46)) | motivo, autor conferido, relógio, evento `entrega_cancelada` | CHECK de motivo e autoria no servidor. Não soma dinheiro |
| **Conflito** | o servidor, quando a saída ou o retorno não pode selar | romaneio `conflito` com os traços e os motivos | a prova da retirada não se perde; sai do placar do verificador |

---

## 2. A função de cada peça da evidência

Antes de propor manter ou tirar qualquer coisa, o que cada peça faz e o que se perde sem ela.

| Peça | Função | Sem ela |
|---|---|---|
| **Cartão** (id público + token com HMAC) | **identifica** a credencial | o PIN não sabe de quem é |
| **PIN** (bcrypt, bloqueio progressivo de 30 s a 15 min) | **autentica** a pessoa: é o único ato que prova que o motoboy estava lá ([bloqueio](../supabase/migrations/20260816150000_selo_sincronizado.sql#L75)) | qualquer um que saiba o nome "assina" pelo motoboy |
| **Autorização de uso único** (online, 2 min, presa ao `document_hash`) | impede usar um PIN conferido em outro documento ([autorização](../supabase/migrations/20260816140000_romaneio_de_saida.sql#L453)) | um PIN conferido serviria para qualquer saída naqueles minutos |
| **Envelope RSA** (offline) | guarda PIN e token **em repouso** por horas, e prende operação, documento, tipo e hash do evento ([segredos](../src/lib/envelope.ts#L49)) | ou o PIN fica em claro na fila (proibido), ou não há autenticação offline |
| **Traços manuscritos** | **manifestam** concordância com aquele conteúdo; entram no `signature_hash` e no hash do evento offline | a concordância passa a depender de outro ato (ver D6). Traço não é verificável como biometria |
| **`document_hash`** (DCR1 / DCRR1) | **integridade** do conteúdo; o retorno referencia a saída por ele | ninguém consegue afirmar que o documento de hoje é o assinado |
| **`signature_hash` e `final_hash`** | amarram quem + como autenticou + conteúdo + relógio do servidor + traços | o verificador não teria o que recalcular |
| **Sessão e `papel_no_momento`** | identidade interna vinda do servidor, nunca do cliente | o documento afirmaria o cargo de hoje, não o do ato |
| **IP** | metadado. **Offline é o IP da sincronização**, lido pela Edge Function ([sync](../supabase/functions/sync-romaneio/index.ts#L406)) | pouco: não serve como prova de local |
| **Geolocalização** | nenhuma desde 04/09 | nada; resta só como `-` na fórmula offline e em parâmetros e colunas |
| **Dois relógios** | balcão e servidor lado a lado | um PC 40 minutos errado vira verdade |
| **Conflito registrado** | preserva a prova de uma retirada que não pôde selar | a retirada física some do sistema |
| **Verificador** | prova que as camadas ainda recalculam ([camadas](../supabase/migrations/20260820140000_verificador_do_retorno.sql#L317)) | "está íntegro" vira afirmação, não medição |

---

## 3. Os seis cenários — o que acontece hoje

### 3.1 Entrega concluída

**Funciona**, online e offline, para vales já sincronizados (`R-000023`, `R-000025`, `R-000026`, `R-000031`, `R-000032`).

- **Lacuna — implementar:** o vale entra no relatório como serviço **desde o lançamento**, antes de sair.
- **Decisão:** qual evento dá direito à tarifa (D1) e em que período ele entra (D2).

### 3.2 Tentativa malsucedida cobrável

**Registra bem.** O retorno grava `insucesso` com motivo (`ausente`, `endereco_errado`, `recusou`, `outro` com detalhe) no documento assinado ([motivos](../src/lib/canonicoRetorno.ts#L138)). O relatório **já soma a tarifa**, porque só o cancelado fica de fora.

- **Lacuna — implementar:** as mesmas somas contam também a **compra** de uma venda que não aconteceu, no relatório e no fechamento ([fechamento](../src/data/fechamento.ts#L159)).
- **Decisão:** todo motivo de insucesso é cobrável? `recusou` e `outro` incluídos? (D3)

### 3.3 Nova tentativa da mesma compra

**Não existe caminho.**

- A tela de saída só oferece vale `pendente` e sem corrida ([filtro](../src/data/romaneios.ts#L614)). O vale com insucesso tem corrida e outro status, então nunca aparece.
- Se aparecesse, o servidor recusaria com `ja_em_corrida` ou `status_nao_permite` ([conflito](../supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql#L155)).
- O único contorno hoje é lançar um vale novo do zero. Ele **duplica a compra** nas somas e **não tem vínculo** com a tentativa anterior.
- **Lacuna — implementar:** abrir nova tentativa a partir de um vale com insucesso selado, com número novo, tarifa, formas previstas copiadas com ids novos, vínculo imutável à tentativa anterior, e a compra contada uma vez por compra.
- **Decisão:** onde a compra conta, o que é herdado (formas, documentos, receita), se o vínculo entra no documento assinado, e quem pode abrir (D5).

A evidência que o plano cita para esta lacuna (`corridas.ts:86`) é o hook antigo que a auditoria marcou como código morto. A seleção real é a de `romaneios.ts`.

### 3.4 Divergência de pagamento

**Funciona.** No retorno ela é derivada dos fatos e registrada com origem; depois do retorno, "Notificar ocorrência" cobre o que se descobre mais tarde.

- **Lacuna — implementar:** não existe resolução da divergência. A conferência nunca sobrescreve `divergente`, e nada leva o vale de `divergente` a resolvido. Também não existe retenção do vale na cobrança.
- **Decisão:** quem resolve e como se registra a resolução; se a divergência retém o vale ou só a conferência do dia (D7).

### 3.5 Documento que não voltou

**Funciona na declaração.** `faltante` no retorno deixa o vale com pendência e grava `documento_faltante`. A baixa posterior registra quem recebeu, conferido no servidor. "Não voltou" registra sem encerrar a pendência.

- **Lacuna — implementar:**
  - a baixa não tem fila offline;
  - a tela não mostra andamento nem falha (achado do plano);
  - a baixa de **receita** não deixa evento;
  - a retenção do vale na cobrança, já decidida, não existe.
- **Decisão:** quem pode dar baixa física — só quem recebeu, e o admin não (D7).

### 3.6 Saída e retorno offline

**Funciona para vales que já estavam no servidor.** O `R-000026` provou o caminho (`physical_card_pin_offline_then_verified`). O envelope é aberto e conferido na sincronização, e a porta offline do retorno confere a competência sobre a filial da saída ([competência](../supabase/migrations/20260820170000_selar_romaneio_retorno_sincronizado.sql#L207)).

- **Lacuna — implementar, é o E12:**
  - vale criado na queda não tem número, logo não sai;
  - saída feita offline não aparece como corrida para retorno antes de sincronizar;
  - cancelamento e baixa de documento não entram na fila;
  - a lista de vales some se a página recarregar offline.
  - **Não existe nenhum código de reserva de numeração.** O contrato está no [item 94](../NOTAS.md#L8664).
- **Decisão:** tamanho do bloco reservado, como o terminal é preparado, o que acontece quando o bloco acaba.

---

## 4. Exceções operacionais

| Exceção | Hoje | Lacuna |
|---|---|---|
| **Sem cartão, PIN esquecido ou credencial bloqueada** | a saída e o retorno **não conseguem selar**. O fluxo excepcional (online, gestor, motivo, marcado no rosto do documento) foi decidido em 19/08 e **não tem código** | decisão sobre o processo real (D4), depois implementar |
| **Outro motoboy traz o retorno** | o servidor recusa `outro_motoboy` e grava conflito ([recusa](../supabase/migrations/20260826120000_pagamento_alterado_todos_previstos.sql#L235)) | decisão (D4): é custódia errada ou troca legítima com autorização? |
| **Todos os terminais offline** | saída e retorno de vales já sincronizados funcionam; o resto não | E12 |
| **Credencial bloqueada usada offline** | vira conflito na sincronização, com prova preservada | nenhuma, se o fluxo excepcional existir online |
| **Motoboy sai e não volta no dia** | o vale fica `em_rota` indefinidamente e já soma no relatório | decisão (D1): "tentativa sem desfecho registrado" não é cobrável até resolver |

---

## 5. Lacunas comprovadas

### O que falta implementar — já decidido

| # | Lacuna | Evidência | Passo |
|---|---|---|---|
| I1 | nova tentativa com novo vale vinculado à mesma compra | [filtro de saída](../src/data/romaneios.ts#L614), [recusa](../supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql#L155) | 4C ou próprio |
| I2 | venda separada de serviço nas somas; compra contada uma vez por compra | [relatório](../src/data/relatorios.ts#L113), [fechamento](../src/data/fechamento.ts#L159) | 5 |
| I3 | serviço cobrável por evento da tentativa, não pelo lançamento | [período](../src/data/relatorios.ts#L210) | 5 e 6 |
| I4 | E12: reserva de numeração e cadeia local vale → saída → retorno | nenhum código de reserva | 4C |
| I5 | retenção por vale, cobrança apresentada e aprovação parcial | não existe entidade | 5 e 6 |
| I6 | fluxo excepcional online | nenhum código | 4B |
| I7 | baixa de documento e receita com retorno de erro, fila e evento de receita | [baixa](../src/data/documentos.ts#L134) | 4C e UX |
| I8 | geolocalização residual fora da fórmula offline, dos parâmetros e das colunas | [envelope](../src/lib/envelope.ts#L49) | 4B, no corte |

### O que precisa de decisão sua

| # | Decisão |
|---|---|
| D1 | **Qual evento dá direito à tarifa.** Proposta abaixo: retorno selado com desfecho. E o que vale para um vale em rota sem retorno |
| D2 | **Competência:** calendário da quinzena e a data de qual evento põe o serviço num período |
| D3 | **Motivos cobráveis:** todos os insucessos, ou `recusou` e `outro` pedem análise? Transferência segue a mesma regra? |
| D4 | **Exceções reais:** o que a farmácia faz hoje sem cartão ou PIN, e quando outro motoboy traz o retorno. Quem autoriza |
| D5 | **Nova tentativa:** onde a compra conta, o que herda, se o vínculo entra no documento assinado, quem abre, e se há limite |
| D6 | **Traços manuscritos:** manter, ou substituir por confirmação autenticada (ver proposta) |
| D7 | **Quem faz o quê:** quem aprova a conferência, quem aprova a cobrança, quem resolve divergência, quem dá baixa física |
| D8 | **Papel na transição:** até quando existe, e como recebe o número digital |

---

## 6. Proposta de contrato

**O princípio:** separar quatro funções — identificar, autenticar, manifestar, provar integridade — e dar a cada uma o mecanismo mais forte que o balcão aguenta. Nada sai por ser caro; sai o que não cumpre função.

### Peças existentes

| Peça | Proposta | Justificativa operacional | Impacto nos documentos existentes |
|---|---|---|---|
| Cartão | **manter** | identifica sem digitação, funciona offline pelo cache | nenhum |
| PIN na saída e no retorno | **manter** | é a única prova de presença do motoboy. A agência vai conferir a cobrança contra a evidência da farmácia; sem PIN a evidência vira só a palavra do balcão | nenhum |
| Autorização de uso único (online) | **manter** | prende o PIN a um documento | nenhum |
| Envelope RSA (offline) | **manter, sem substituto** | saída e retorno offline são obrigatórios, e o PIN só pode ser conferido na sincronização. Tirar o envelope obriga PIN em claro na fila ou abandono da autenticação offline | nenhum enquanto mantido |
| Geolocalização residual | **remover no corte**, nos dois gêmeos e no SQL ao mesmo tempo | não prova nada desde 04/09 | a fórmula do hash offline muda de versão; só com a fila vazia. Os `signature_hash` gravados **não** incluem geolocalização, então nenhum documento selado deixa de verificar |
| `document_hash` DCR1 e DCRR1 | **manter** | é o identificador que o painel da agência cita, por romaneio | nenhum |
| Traços manuscritos | **decisão D6** — as duas opções abaixo | | |
| `signature_hash` e `final_hash` | **manter o conceito** | amarram autenticação, conteúdo e relógio | só mudam de fórmula se D6 substituir os traços |
| Sessão e `papel_no_momento` | **manter** | identidade interna vinda do servidor | nenhum |
| IP | **manter como metadado, rotulado** | útil para suporte; offline é o IP da sincronização e não pode ser lido como local da retirada | nenhum |
| Conflito registrado | **manter** | preserva a prova | nenhum |
| Verificador | **manter e estender** | passa a reconhecer versões de fórmula e, com o E12, a completude da numeração | nenhum nos antigos |

**D6 — as duas opções para os traços, sem conclusão prévia:**

| | A. manter os traços | B. confirmação autenticada |
|---|---|---|
| **Como fica** | igual a hoje | a tela mostra os vales, a quantidade e a tarifa; o motoboy confirma e digita o PIN, e o PIN passa a cobrir a manifestação |
| **A favor** | paridade com o papel enquanto ele existir; nada muda nos gêmeos | menos tempo no balcão e sem depender de caneta no tablet; a manifestação fica presa a um ato autenticado, e não a um desenho sem verificação |
| **Contra** | tempo e tablet em toda saída e todo retorno | exige nova versão da fórmula de assinatura |
| **Impacto nos documentos existentes** | nenhum | a versão da assinatura passa a ser lida **da própria linha** (a mesma regra do `tipo_signatario`); os documentos antigos continuam verificando pela fórmula histórica. Os bytes de DCR1 e DCRR1 **não mudam** |

**D6 não precisa ser decidido antes das decisões D1, D2 e D5**, que são as que mudam cobrança.

### O que entra no contrato

| # | Proposta | Justificativa | Impacto nos documentos existentes |
|---|---|---|---|
| A1 | **Nova tentativa** nasce só de um vale com insucesso selado. Recebe número novo e vínculo imutável à tentativa anterior. Proposta: o vínculo fica **no dado, fora do canônico** | o romaneio da nova tentativa já prova a nova retirada; o vínculo é consultável pelo painel e não obriga mudar os gêmeos. Alternativa (D5): colocar no documento, com versão nova do canônico | nenhum, se ficar fora do canônico |
| A2 | **Serviço cobrável** = vale com saída selada e **retorno selado com desfecho** (entregue ou insucesso). Vale em rota sem retorno aparece como "tentativa sem desfecho registrado", não cobrável até resolver. Pendente e cancelado não são serviço | o fato cobrável tem que ter as duas partes autenticadas; é o que a agência consegue conferir | nenhum: é regra de leitura |
| A3 | **Competência** pela retirada no balcão (`ocorrido_em_local` da saída), com o relógio do servidor guardado ao lado | é quando o serviço começou; é a mesma regra que já arquiva romaneio no Drive. Tentativa que atravessa o corte fica na quinzena da saída | nenhum |
| A4 | **A compra conta uma vez por compra**: entra nas vendas só no vale entregue; tentativas malsucedidas somam só serviço | evita venda fantasma e venda duplicada | nenhum: é regra de leitura |
| A5 | **Baixa física** de documento e receita registra quem recebeu e gera evento nos dois casos; pendência retém só o vale afetado na cobrança | receita hoje não deixa rastro de baixa; retenção por vale foi decidida | nenhum no passado; eventos só daqui pra frente |

### A transição

- **A1 a A5 não mexem em um byte** de DCR1 ou DCRR1: são dado fora do canônico ou regra de leitura.
- **Versões novas de fórmula** — assinatura, se D6 for B, e hash offline sem geolocalização — só no corte, com a fila vazia, lendo a versão da linha, e com o verificador medido antes e depois no mesmo instrumento.
- **Os documentos de teste de hoje** somem no corte. Até lá, o placar do verificador tem que continuar fechando (último: `22 · 22 · 0`).

---

## 7. Perguntas para você decidir

1. **Tarifa (D1):** a tarifa é devida quando o retorno é selado com desfecho? E o vale que saiu e ainda não voltou?
2. **Quinzena (D2):** quais são as datas de corte, e a competência pode ser a da retirada?
3. **Motivos (D3):** todo insucesso é cobrável, inclusive `recusou` e `outro`? E a transferência?
4. **Nova tentativa (D5):**
   - a compra entra nas vendas só no vale entregue?
   - a nova tentativa herda formas previstas, documentos esperados e receita?
   - quem pode abri-la?
5. **Exceções (D4):** o que a farmácia faz hoje quando falta cartão ou PIN, e quando outro motoboy traz o retorno?
6. **Quem faz o quê (D7):**
   - quem aprova a conferência do dia?
   - quem aprova a cobrança?
   - quem resolve a divergência?
   - quem pode dar baixa de papel?
7. **Traços (D6):** manter, ou confirmação autenticada com PIN?
8. **Papel (D8):** até quando existe, e como leva o número digital?

---

## 8. Registrado, fora deste levantamento

- **Aceite visual da tabela de receitas:** pendente. Não havia receita pendente para vê-la; não bloqueia o 4A.
- **Antecipação informal de dinheiro pelo motoboy:** continua fora do sistema.
- **Achados de UX do plano:**
  - filial por vale na lista do admin;
  - "Não voltou" fechando antes de gravar;
  - baixa sem retorno de erro;
  - rolagem lateral.

  Estão no item 102 do NOTAS e não foram tratados aqui.
