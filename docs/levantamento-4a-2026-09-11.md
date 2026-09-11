# Levantamento 4A — ciclo do vale, tentativa e evidências

**Versão 2, 11/09/2026.** Incorpora a [revisão do levantamento](revisao-levantamento-4a-2026-09-11.md). A versão 1 está no commit `1014b5d`.

Feito lendo código e migrations sobre a branch `feat/e10-admin-filial` (commit `ed5715a`). **O banco não foi consultado nem alterado, e nenhum código foi mudado.** Serve para fechar o contrato antes do 4B e do 4C. Os links usam âncoras de linha deste commit, que envelhecem com o código.

**O que mudou da versão 1:**
- **PIN:** deixou de ser tratado como prova isolada de presença; a evidência é o conjunto.
- **Leitura do serviço:** a regra que misturava serviço realizado e comprovação virou uma leitura em seis situações.
- **Nova tentativa:** precisa funcionar com o E12 offline e ganhou regras de integridade.
- **Offline:** o 4C inclui abrir o aplicativo sem internet.
- **Cargo offline:** tem uma limitação que a versão 1 não dizia.
- **Verificador:** não mede completude de numeração.
- **Perguntas:** as que já tinham resposta saíram, e as técnicas viraram propostas.

## Resumo

- **O que já é forte:** saída e retorno selados, online e offline, com credencial do motoboy validada, sessão da farmácia, conteúdo com hash e verificador. O verificador prova que as camadas recalculam; **não observa a entrega nem decide se uma cobrança é devida.**
- **O que não existe:**
  - a nova tentativa da mesma compra;
  - abrir o aplicativo sem internet: não há Service Worker, Cache API nem persistência das consultas.
- **O que está calculado errado para o objetivo novo:** relatório e fechamento somam **tarifa e compra de todo vale não cancelado**, pela data do **lançamento**.
- **O envelope fica:** protege PIN e cartão em repouso durante a queda e os prende à operação, e **não existe substituto implementado e validado neste projeto.**
- **Recomendação para os traços:** confirmação explícita do conteúdo pelas duas partes. A escolha continua sendo sua.

---

## 1. Decisões já tomadas — preservar

- **Tentativa realizada gera vale de R$ 9, mesmo sem entrega.** Cada nova tentativa ganha outro vale, da mesma compra.
- **Pendência de documento ou de acerto retém só o vale afetado.** Os demais seguem para conciliação e pagamento.
- **A agência recebe por quinzena e paga os motoboys.** O repasse interno dela não entra no primeiro painel.
- **A antecipação informal de dinheiro fica fora do sistema.** Nenhum campo, nenhum fluxo.
- **Admin não opera o balcão.** Caixa e gerente operam na própria filial; o gerente cobre o balcão ocasionalmente.
- **Saída e retorno durante a queda de internet são obrigatórios.**

**A regra do insucesso é o fato, não o rótulo:** houve tentativa realizada? `recusou` e `outro` não concedem nem negam a tarifa por si. Um motivo insuficiente pede esclarecimento. **Transferência e busca posterior de documento** ainda precisam de regra própria confirmada.

---

## 2. Estado atual — quem confirma cada fato, o que é guardado e onde é verificado

| Fato | Quem confirma hoje | O que fica guardado | Onde é verificado |
|---|---|---|---|
| **Lançamento do vale** | caixa ou gerente, pela sessão | `entregas`: número da sequência do banco, tarifa capturada no cadastro, formas previstas 1:N, `tem_receita`, pendência de papel derivada da forma | RLS de `entregas` e autoria conferida no servidor ([autoria](../supabase/migrations/20260816120000_autoria_no_servidor.sql#L120)). **Não há documento assinado** |
| **Retirada (saída)** | **motoboy:** cartão identifica a credencial, PIN valida o segredo dela, traços manifestam. **Farmácia:** sessão + traços; o cargo é lido do perfil **no instante em que o servidor sela** ([perfil](../supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql#L104)) | `romaneios` (snapshot com nome da filial, canônico DCR1, `document_hash`, `final_hash`, modo, dois relógios, IP); duas `assinaturas` (traços, `signature_hash`, `auth_method`, credencial, autorização); corrida aberta; vales `em_rota`; evento `romaneio_selado` | `selar_romaneio_interno`: trava os vales, transforma vale indisponível ou de outra filial em **conflito com prova**, recalcula o hash **do banco** e consome a autorização de uso único ([saída](../supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql#L149)) |
| **Entrega ao cliente** | **ninguém, no ato** | nada no momento | não há confirmação do destinatário, e o plano decide não exigir |
| **Retorno à farmácia** | **motoboy:** cartão + PIN de novo + traços. **Farmácia:** responsável pela sessão + traços; cargo lido no instante do selo ([perfil](../supabase/migrations/20260826120000_pagamento_alterado_todos_previstos.sql#L161)) | romaneio `retorno` (DCRR1: desfecho, motivo e detalhe por vale; pagamentos realizados; documentos recebido/faltante); desfecho em `entregas`; pagamentos `realizado`; eventos; corrida fechada | `selar_romaneio_retorno_interno`: saída confere, mesmo motoboy, **conjunto de vales igual**, documentos esperados iguais aos declarados, hash, autorização, e **cada pagamento assinado gravado** ([retorno](../supabase/migrations/20260826120000_pagamento_alterado_todos_previstos.sql#L386)). Depois do selo, trigger congela desfecho, motivo e observação ([trigger](../supabase/migrations/20260820180000_fechamento_legado_obsoleto.sql#L110)) |
| **Pagamento na porta** | relato das duas partes no retorno | linhas `pr` do DCRR1 e `pagamentos` realizados | a divergência é **derivada** (previsto × realizado por conjunto de forma e valor), marca `divergente` e grava `pagamento_alterado` ([divergência](../supabase/migrations/20260826120000_pagamento_alterado_todos_previstos.sql#L448)). Depois do retorno, "Notificar ocorrência" registra à mão |
| **Papel de convênio e crediário** | no retorno, as duas partes declaram recebido/faltante (presença física). Depois, quem dá baixa na aba Documentos | status documental; evento `documento_faltante`; na baixa, `documento_recebido_por` e relógio | autoria da baixa conferida no servidor ([autoria](../supabase/migrations/20260816120000_autoria_no_servidor.sql#L137)); a troca de status gera `status_alterado`. Baixa **sem fila offline** ([documentos](../src/data/documentos.ts#L66)) |
| **Receita** | só quem dá baixa na aba Documentos | `receita_recebida_por` e relógio | **fora do documento assinado**, por decisão. A baixa grava autor e relógios, mas **não gera evento**: o log de `entregas` só acompanha os três eixos de status ([log](../supabase/migrations/20260806232804_schema_inicial.sql#L361), [baixa](../src/data/documentos.ts#L134)) |
| **Serviço cobrável** | **ninguém** — é calculado na leitura | nada próprio | relatório soma todo vale não cancelado ([regra](../src/data/relatorios.ts#L113)), cortado pela data do **lançamento** ([período](../src/data/relatorios.ts#L210)). Fechamento idem, só cliente e com teto ([fechamento](../src/data/fechamento.ts#L140)). Não existe cobrança da agência |
| **Cancelamento** | qualquer cargo, só vale pendente ([menu](../src/components/EntregaAcoesMenu.tsx#L46)) | motivo, autor conferido, relógio, evento `entrega_cancelada` | CHECK de motivo e autoria no servidor |
| **Conflito** | o servidor, quando a saída ou o retorno não pode selar | romaneio `conflito` com os traços e os motivos | a prova da retirada não se perde; sai do placar do verificador |
| **Abrir o aplicativo sem internet** | **nada o garante** | o Dexie guarda fila, cache de credenciais e contextos de retorno ([banco local](../src/lib/db.ts#L248)) | **não há Service Worker, Cache API, manifest nem persistência do QueryClient** ([QueryClient](../src/lib/queryClient.ts#L3), [Vite](../vite.config.ts)). Uma aba já aberta continua; uma aba reaberta sem rede não carrega |

---

## 3. A função de cada peça da evidência

**A evidência operacional é o CONJUNTO**: identidade da farmácia, credencial do motoboy validada, conteúdo confirmado, horários, desfecho e preservação do registro. Nenhuma peça sozinha prova o ato.

| Peça | Função | O que ela NÃO prova, ou o que se perde sem ela |
|---|---|---|
| **Cartão** (id público + token com HMAC) | **identifica** a credencial apresentada | sem ele, o PIN não sabe de quem é |
| **PIN** (bcrypt, bloqueio de 30 s a 15 min) | **valida** que quem opera conhece o segredo daquela credencial ([bloqueio](../supabase/migrations/20260816150000_selo_sincronizado.sql#L75)) | **não prova sozinho presença física nem exclusividade do titular**: um segredo pode ser compartilhado ou conhecido. Sem ele, a credencial não tem validação nenhuma |
| **Autorização de uso único** (online, 2 min, presa ao `document_hash`) | prende a validação a um documento ([autorização](../supabase/migrations/20260816140000_romaneio_de_saida.sql#L453)) | sem ela, uma validação serviria para qualquer saída naqueles minutos |
| **Envelope** (AES-GCM cifra o conteúdo, RSA protege a chave) | guarda PIN e token **em repouso** durante a queda e prende operação, documento, tipo e hash do evento ([segredos](../src/lib/envelope.ts#L49)) | sem ele, não há substituto implementado e validado neste projeto: o PIN ficaria em claro na fila, ou a validação offline deixaria de existir |
| **Traços manuscritos** | **manifestam** concordância com aquele conteúdo; entram no `signature_hash` e no hash do evento offline | não são verificáveis como biometria |
| **`document_hash`** (DCR1 / DCRR1) | **integridade** do conteúdo; o retorno referencia a saída por ele | sem ele, ninguém afirma que o documento de hoje é o confirmado |
| **`signature_hash` e `final_hash`** | amarram quem, como validou, conteúdo, relógio do servidor e traços | sem eles, o verificador não teria o que recalcular |
| **Sessão e `papel_no_momento`** | identidade interna vinda do servidor, nunca do cliente | **na saída, o cargo é metadado fora do hash** ([DCR1](../supabase/migrations/20260820140000_verificador_do_retorno.sql#L440)); **no retorno, entra no hash da assinatura interna** ([DCRR1](../supabase/migrations/20260820140000_verificador_do_retorno.sql#L432)). **Offline, o cargo é lido na sincronização**, depois da confirmação no terminal: uma troca de cargo durante a queda impede tratá-lo, sozinho, como o cargo do momento da confirmação |
| **IP** | metadado. **Offline é o IP da sincronização** ([sync](../supabase/functions/sync-romaneio/index.ts#L406)) | não serve como prova de local |
| **Geolocalização** | nenhuma desde 04/09 | não está nas fórmulas de assinatura; está no **hash do evento offline**, como `-` |
| **Dois relógios** | balcão e servidor lado a lado | **não resolvem sozinhos** um terminal com data errada |
| **Conflito registrado** | preserva a prova de uma retirada que não pôde selar | sem ele, a retirada física some do sistema |
| **Verificador** | prova que as camadas recalculam ([camadas](../supabase/migrations/20260820140000_verificador_do_retorno.sql#L317)) | **não** observa entrega física, **não** decide se uma cobrança é devida |

---

## 4. Os seis cenários — o que acontece hoje

### 4.1 Entrega concluída

**Funciona**, online e offline, para vales já sincronizados (`R-000023`, `R-000025`, `R-000026`, `R-000031`, `R-000032`).

- **Implementar:** o vale entra no relatório como serviço **desde o lançamento**, antes de sair. A leitura correta está na seção 6.

### 4.2 Tentativa malsucedida cobrável

**Registra bem.** O retorno grava `insucesso` com motivo (`ausente`, `endereco_errado`, `recusou`, `outro` com detalhe) no documento assinado ([motivos](../src/lib/canonicoRetorno.ts#L138)). O relatório já soma a tarifa.

- **Implementar:** as mesmas somas contam também a **compra** de uma entrega que não aconteceu ([fechamento](../src/data/fechamento.ts#L159)).
- **Já decidido:** a regra é o fato (houve tentativa?), não o rótulo do motivo.

### 4.3 Nova tentativa da mesma compra

**Não existe caminho.**

- A seleção ativa de saída só oferece vale `pendente` e sem corrida ([seleção](../src/data/romaneios.ts#L606)). O vale com insucesso nunca aparece.
- Se aparecesse, o servidor recusaria com `ja_em_corrida` ou `status_nao_permite` ([recusas](../supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql#L155)).
- O único contorno hoje é lançar um vale do zero, que **duplica a compra** e **não tem vínculo**.
- **Implementar:** a proposta A1 (seção 8), inclusive **durante a queda**, com o E12.

A evidência que o plano citava (`corridas.ts:86`) é um hook que só aparece na própria definição. Foi corrigida no plano.

### 4.4 Divergência de pagamento

**Funciona.** No retorno ela é derivada dos fatos e registrada com origem; depois, "Notificar ocorrência" cobre o que se descobre mais tarde.

- **Já decidido:** a divergência retém **só o vale afetado**.
- **Implementar:**
  - não existe resolução — nada leva o vale de `divergente` a resolvido;
  - não existe retenção na cobrança.
- **Decidir (P5):** quem resolve a divergência e como a resolução é registrada.

### 4.5 Documento que não voltou

**Funciona na declaração.** `faltante` deixa pendência e grava `documento_faltante`; a baixa posterior registra quem recebeu; "Não voltou" registra sem encerrar.

- **Implementar:**
  - a baixa não tem fila offline;
  - a tela não mostra andamento nem falha;
  - a baixa de receita não gera evento;
  - não existe retenção do vale.
- **Decidir (P5):** quem pode dar baixa física.

### 4.6 Saída e retorno offline

**Funciona para vales que já estavam no servidor, com a aba já aberta.** O `R-000026` provou o caminho (`physical_card_pin_offline_then_verified`). A porta offline do retorno confere competência sobre a filial da saída ([competência](../supabase/migrations/20260820170000_selar_romaneio_retorno_sincronizado.sql#L207)).

**Implementar, e são três partes (proposta A6):**
- **abrir e reabrir o aplicativo sem internet:** não existe Service Worker nem Cache API;
- **as telas lerem o estado local:**
  - vale criado na queda aparecendo na saída;
  - saída local aparecendo como corrida para retorno;
  - cancelamento e baixa na fila;
- **o E12:**
  - vale criado na queda não tem número;
  - **não existe nenhum código de reserva de numeração** ([contrato](../NOTAS.md#L8664)).

---

## 5. Exceções operacionais

| Exceção | Hoje | O que falta |
|---|---|---|
| **Sem cartão, PIN esquecido ou credencial bloqueada** | saída e retorno **não conseguem selar**. O fluxo excepcional decidido em 19/08 (online, gestor, motivo, marcado no documento) **não tem código** | o processo real (P4), depois implementar |
| **Outro motoboy traz o retorno** | o servidor recusa `outro_motoboy` e grava conflito ([recusa](../supabase/migrations/20260826120000_pagamento_alterado_todos_previstos.sql#L235)) | o processo real (P4) |
| **Todos os terminais offline** | saída e retorno de vales já sincronizados funcionam, só com aba já aberta | A6 |
| **Credencial bloqueada usada offline** | vira conflito na sincronização, com prova preservada | nenhum, se o fluxo excepcional existir online |
| **Cargo, filial ou acesso mudam durante a queda** | o servidor lê o perfil na sincronização; o documento pode sair com o cargo novo ou ser recusado por inativo | proposta técnica na seção 9 |
| **Motoboy sai e não volta no dia** | o vale fica `em_rota` e já soma no relatório | leitura "aguardando desfecho" (seção 6) |

---

## 6. A leitura do serviço — sem estados novos

Substitui a regra da versão 1, que misturava o serviço realizado com a comprovação técnica. **Não são seis estados armazenados**: são leituras de fatos que já existem, ou que A1, A5 e A6 criam.

| Situação | Como apresentar |
|---|---|
| Vale criado, ainda sem saída | **serviço previsto**; não compõe valor liberado |
| Saiu, sem retorno registrado | **aguardando desfecho ou comprovação**; não afirmar que a tentativa não ocorreu |
| Retorno registrado no terminal, sem sincronizar | **operação registrada; validação no servidor pendente** |
| Retorno validado, entregue ou insucesso de tentativa realizada | **serviço confirmado**; liberável se não houver pendência impeditiva |
| Documento ou acerto pendente | **vale retido com motivo**; os demais seguem |
| Conflito de sincronização ou recuperação excepcional | **exige resolução identificada**; não apagar o ato relatado nem liberar em silêncio |

- **O caminho normal usa o retorno validado como condição de liberação.**
- **Um retorno excepcional autorizado** deixa evidência equivalente do tratamento, **sem fingir** que houve a confirmação normal do motoboy.
- **As somas passam a separar** previsão, serviços confirmados, valores retidos e valores aprovados.
- **A aprovação parcial conhece a cobrança inteira:** ela não torna aceitável uma soma cortada pelo teto.

---

## 7. Lacunas comprovadas — o que falta implementar

| # | Lacuna | Evidência | Passo |
|---|---|---|---|
| I1 | nova tentativa com novo vale vinculado à compra, também offline | [seleção](../src/data/romaneios.ts#L606), [recusas](../supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql#L155) | 4C |
| I2 | somas separadas: previsão, confirmado, retido, aprovado; compras entregues contadas uma vez por compra | [relatório](../src/data/relatorios.ts#L113), [fechamento](../src/data/fechamento.ts#L159) | 5 |
| I3 | competência pela retirada, não pelo lançamento | [período](../src/data/relatorios.ts#L210) | 5 e 6 |
| I4 | E12: reserva de numeração e cadeia local vale → saída → retorno → nova tentativa | nenhum código de reserva | 4C |
| I5 | abrir e reabrir o aplicativo sem internet (Service Worker + Cache API) e telas lendo o estado local | [QueryClient](../src/lib/queryClient.ts#L3), [Vite](../vite.config.ts) | 4C |
| I6 | retenção por vale, cobrança apresentada e aprovação parcial | não existe entidade | 5 e 6 |
| I7 | resolução de divergência registrada | nada leva `divergente` a resolvido | 5 |
| I8 | fluxo excepcional online | nenhum código | 4B |
| I9 | baixa de documento e receita com evento na mesma transação, retorno de erro e fila | [baixa](../src/data/documentos.ts#L134) | 4C e UX |
| I10 | geolocalização fora do hash do evento offline, dos parâmetros e das colunas | [envelope](../src/lib/envelope.ts#L49) | 4B, no corte |

---

## 8. Proposta de contrato

**O princípio:** a evidência é o conjunto de identidade da farmácia, credencial do motoboy validada, conteúdo confirmado, horários, desfecho e preservação do registro. Cada peça fica pelo que cumpre, não pelo que custa.

### Peças existentes

| Peça | Proposta | Justificativa operacional | Impacto nos documentos existentes |
|---|---|---|---|
| Cartão | **manter** | identifica sem digitação e funciona offline pelo cache | nenhum |
| PIN na saída e no retorno | **manter** | valida a credencial do motoboy no ato; é a parte do conjunto que vem dele | nenhum |
| Autorização de uso único (online) | **manter** | prende a validação a um documento | nenhum |
| Envelope (offline) | **manter** | saída e retorno offline são obrigatórios, a validação só ocorre na sincronização, e não existe substituto implementado e validado neste projeto | nenhum enquanto mantido |
| Geolocalização residual | **remover no corte**, coordenando produtor, consumidor, parâmetros SQL e filas | não prova nada desde 04/09 | a fórmula do hash do evento offline muda de versão, só com fila vazia; **nenhum `signature_hash` gravado a inclui** |
| `document_hash` DCR1 e DCRR1 | **manter** | é o que o painel da agência cita, por romaneio | nenhum |
| Traços manuscritos | **recomendação: confirmação explícita** (abaixo) — escolha sua (P3) | | |
| `signature_hash` e `final_hash` | **manter o conceito** | amarram validação, conteúdo e relógio | nova versão **só nas camadas que mudarem** |
| Sessão e `papel_no_momento` | **manter**, com a limitação offline tratada (seção 9) | identidade interna vinda do servidor | nenhum |
| IP | **manter como metadado, rotulado** | útil para suporte; offline é o da sincronização | nenhum |
| Conflito registrado | **manter** | preserva a prova | nenhum |
| Verificador | **manter e ensinar versões novas de fórmula**. **Não** medir completude de numeração: reservas consumidas, não usadas ou em conflito são controle operacional do E12, e um intervalo reservado pode ter lacunas legítimas sem que documento nenhum fique inválido | | nenhum nos antigos |

### Traços: confirmação explícita, cobrindo as duas partes

**Recomendação, sujeita à sua escolha (P3).** Sem afirmar equivalência jurídica entre mecanismos.

- **Motoboy:** vê o resumo e o detalhe dos vales, confirma o ato e usa cartão e PIN vinculados àquele conteúdo.
- **Farmácia:** caixa ou gerente confirma o próprio ato pela sessão autenticada. **Apenas estar logado não é manifestação de concordância**: é preciso um ato explícito de confirmação.
- **O conteúdo confirmado:**
  - **na saída**, a retirada dos vales identificados;
  - **no retorno**, os desfechos, os pagamentos declarados e os documentos recebidos ou faltantes.
- **Uma confirmação por atendimento**, cobrindo vários vales, e não uma por linha.
- **Offline:** a tela diz que a validação da credencial depende da sincronização. A operação prossegue conforme o contrato offline; a aprovação financeira respeita validações e conflitos pendentes.
- **Versões de fórmula só onde algo muda**, com o verificador lendo a versão da própria linha (a mesma regra do `tipo_signatario`). Os documentos preservados continuam verificando pela fórmula histórica, e os bytes de DCR1 e DCRR1 não mudam.

Se você preferir manter os traços, nada muda nos gêmeos, e o custo continua sendo tempo e tablet em toda saída e todo retorno.

### O que entra no contrato

**A1 — Nova tentativa.**
- **Vínculo:** nasce de um vale com insucesso, com número novo e vínculo imutável à compra de origem e à tentativa anterior.
- **Integridade:**
  - mesma compra de origem, filial e tenant;
  - reenvio ou clique duplo não cria outra tentativa;
  - dois terminais não abrem tentativas concorrentes da mesma compra em silêncio — se acontecer offline, vira conflito explícito na sincronização;
  - o vínculo não é editável depois;
  - não se reutilizam ids de pagamentos, assinaturas nem estados de recebimento anteriores.
- **Offline:** a exigência definitiva fica no servidor, mas o terminal representa a cadeia pendente. Retorno registrado localmente → nova tentativa dependente dele → validação ordenada na sincronização.
- **Preenchimento inicial, revisável antes da saída:**
  - se o motivo foi endereço errado, a tela facilita corrigir o endereço;
  - as formas previstas podem mudar;
  - receita e documentos esperados refletem o que acompanha **aquela** saída, sem copiar a baixa anterior e sem perder uma pendência antiga.
- **Quem abre:** caixa e gerente, na própria filial. Admin não.
- **O vínculo fica fora do canônico, e isso tem um custo que precisa estar escrito:** ele é protegido no servidor e sua criação deixa auditoria, mas **não passa a ser comprovado pelo hash histórico do romaneio**.

**A2 — Leitura do serviço.** A tabela da seção 6. A liberação no caminho normal exige retorno validado.

**A3 — Competência.**
- **Pela retirada**, separada da liberação, da aprovação e do pagamento.
- **Relógio:** fuso fixado por filial, tratamento de horário incoerente de terminal, e correção autorizada da competência **sem editar os bytes assinados**.
- **Vale liberado depois:** preserva a competência original e mostra em qual acerto foi aprovado ou pago. A aprovação da quinzena não é reaberta nem reescrita em silêncio.
- O calendário da quinzena depende de você (P1).

**A4 — Compras entregues.**
- **Uma vez por compra de origem** — não a soma de todos os vales com status entregue.
- **Duas conclusões incompatíveis da mesma compra** pedem resolução, não uma soma que escolhe uma delas.
- **Rótulo "Compras entregues"**, e não "vendas": o sistema complementa o Trier e não promete total fiscal.

**A5 — Baixa física de papel e receita.**
- **Mudança e evento na mesma transação no servidor, de forma idempotente.** Gravar o status numa requisição e o evento em outra abriria um histórico incompleto novo.
- **A tela mantém o texto e o andamento até confirmar o resultado.**

**A6 — Continuidade offline em três partes (4C).**

| Parte | Responsabilidade |
|---|---|
| **Service Worker + Cache API** | abrir e reabrir o aplicativo sem rede, com telas, scripts, estilos e os recursos carregados sob demanda pelos fluxos obrigatórios |
| **IndexedDB (o Dexie existente)** | persistir vales novos, corridas, retornos e fila; **as telas leem esse estado local**, não uma resposta antiga da lista em cache |
| **Sincronização + E12** | preservar a numeração reservada, enviar na ordem das dependências, evitar duplicação e mostrar conflitos |

- **O envelope continua protegendo PIN e token** enquanto aguardam validação; nenhuma das três partes o substitui.
- **A atualização do cache do aplicativo preserva as operações pendentes** no banco local.

**Aceite do 4C, em ambiente de teste publicado:**
1. preparar o terminal conectado: recursos, dados, credenciais e números reservados;
2. desconectar, fechar todas as abas e abrir o aplicativo de novo sem internet;
3. criar um vale, registrar a saída e registrar o retorno sem rede;
4. reabrir com operações pendentes e conferir registros e dependências;
5. reconectar e conferir números preservados, sincronização na ordem certa, nenhuma duplicação e o resultado das validações.

O teste exercita a indisponibilidade **do site e do servidor de dados**. Uma aba já carregada, ou arquivos servidos por um servidor local, não demonstram a reabertura offline do aplicativo publicado.

### A transição

- **A1 a A5 não mudam bytes de DCR1 nem de DCRR1.** O que eles acrescentam — o vínculo da nova tentativa, a leitura do serviço, a competência — **não fica comprovado pelo hash histórico**; é protegido no servidor e auditado.
- **Versões novas de fórmula** — assinatura, se a confirmação explícita for escolhida, e hash do evento offline sem geolocalização — só no corte, com fila vazia, lendo a versão da linha.
- **Antes do corte:** repetir o censo do banco e a verificação. `22 · 22 · 0` é a **última medição registrada**, não resultado deste levantamento.

---

## 9. Propostas técnicas — a justificar na implementação, não perguntas

| Tema | Proposta |
|---|---|
| **Cargo, filial ou acesso mudando durante a queda** | o servidor continua sendo a fonte, sem aceitar cargo enviado pelo cliente. Recusa, ou gera conflito identificado, quando a mudança retira competência sobre a filial ou o acesso da conta; o documento registra o instante local e o do selo, sem afirmar que o cargo lido é o do momento da confirmação |
| **Tamanho do bloco do E12, esgotamento e recuperação do terminal** | dimensionar pelo movimento real de cada filial; recarregar com rede; bloco nunca volta ao pool |
| **Implementação do vínculo da nova tentativa** | coluna imutável protegida por trigger, criação por RPC idempotente com evento |
| **Transação da baixa com evento** | RPC única, idempotente por chave do cliente |
| **Versionamento de fórmulas** | só nas camadas que mudarem, lido da linha |

---

## 10. Perguntas para você decidir — respondidas em parte na seção 12

1. **Quinzena (P1):** quais são as datas de corte?
2. **Serviços sem regra (P2):** a transferência e a busca posterior de documento geram vale? Com que regra?
3. **Traços (P3):** confirmação explícita das duas partes, como recomendado, ou manter os traços?
4. **Exceções (P4):** o que a farmácia faz hoje quando falta cartão ou PIN, e quando outro motoboy traz o retorno? Quem autoriza?
5. **Responsáveis (P5):**
   - quem aprova a conferência do dia;
   - quem aprova a cobrança;
   - quem resolve divergência;
   - quem pede esclarecimento de motivo insuficiente;
   - quem dá baixa física de papel.
6. **Papel na transição (P6):** até quando existe, e como recebe o número digital?

---

## 11. Registrado, fora deste levantamento

- **Aceite visual da tabela de receitas:** pendente; não havia receita pendente para vê-la. Não bloqueia.
- **Antecipação informal de dinheiro:** continua fora do sistema.
- **Achados de UX do plano:**
  - filial por vale na lista do admin;
  - "Não voltou" fechando antes de gravar;
  - baixa sem retorno de erro;
  - rolagem lateral.

  Estão no item 102 do NOTAS.

---

## 12. Respostas do usuário — 11/09

| # | Resposta, nas palavras dele | Como fica | Situação |
|---|---|---|---|
| P1 | "Não sei." | as datas de corte da quinzena continuam abertas. Proposta a confirmar com o financeiro e a agência: dias 1 a 15 e 16 ao último dia do mês | **aberta** |
| P2 | "Acredito que não." | **busca posterior de documento não gera vale** — não existe fluxo para isso, e nada muda. **Transferência: ver o conflito abaixo** | **transferência aberta** |
| P3 | "Não é para deixar assinaturas do sistema, apenas cartão e pin." | **a assinatura manuscrita sai**, do motoboy e da farmácia, na saída e no retorno. Do motoboy fica **cartão + PIN**. Da farmácia fica a **sessão com o ato explícito de confirmar** — o botão de confirmação, e não o simples fato de estar logado | **decidido, não construído** |
| P4 | "Podemos criar cartões credenciais para os gestores também, assim ele pode verificar a saída do motoboy, sendo uma pessoa de mais confiança na filial. Sem travar o fluxo. Nunca antes outro motoboy trouxe o retorno." | **o gestor ganha credencial própria (cartão + PIN)** para verificar a saída do motoboy, sem que isso trave o fluxo normal. **Outro motoboy trazendo o retorno nunca aconteceu**: a recusa `outro_motoboy` fica, e nenhum fluxo novo é criado | **decidido, com dúvidas abaixo** |
| P5 | "Gestor e Financeiro. Pois o gestor deve explicações ao financeiro caso algo dê errado." | o **gestor** confere o dia, resolve divergência e responde por ela; o **financeiro** aprova a cobrança | **decidido, com dúvidas abaixo** |
| P6 | "Não entendi a pergunta." | reformulada abaixo | **aberta** |

### O conflito da transferência

A resposta "acredito que não" **contradiz** o que foi confirmado na farmácia em 2026-08-11 e está no `CLAUDE.md`, seção "Tarifa":

> quem leva o produto de uma filial pra outra é o motoboy da agência, e ela cobra por essa corrida como por qualquer outra

O código cobra tarifa na transferência desde então: o vale de transferência nasce com a tarifa da filial que pediu. Tirar isso muda o acerto com a agência para menos. **Nada muda até confirmar com a farmácia ou a agência.**

### O que P3 muda no 4B — técnico, não é pergunta

Os bytes de DCR1 e DCRR1 **não mudam**: os traços nunca entraram no canônico. Mudam:

| Onde | O que muda |
|---|---|
| `assinaturas` | nova versão sem traços; `strokes` deixa de ser exigido nos registros novos |
| fórmulas de `signature_hash` (saída e retorno) | versão nova, sem traços, lida da própria linha; documentos antigos continuam verificando pela fórmula histórica |
| hash do evento offline (`envelope.ts` e a cópia na `sync-romaneio`) | versão nova sem traços, nos dois gêmeos ao mesmo tempo, só com a fila vazia — junto com a saída da geolocalização |
| Nova corrida e Retorno | sai o canvas; entra a confirmação explícita do conteúdo |
| PDF do romaneio e página do romaneio | deixam de desenhar assinatura e passam a mostrar a validação por cartão e PIN e quem confirmou pela farmácia |
| verificador | aprende a versão nova |
| `signature_pad` | pode sair da stack quando nada mais o usar |

### Dúvidas que as respostas abriram

1. **Credencial do gestor (P4):**
   - "gestor" é o **gerente da filial**?
   - ela é usada **só quando o motoboy está sem cartão ou PIN** — o gestor valida no lugar para a saída não parar — ou pode ser usada **em qualquer saída**, como verificação extra opcional?
   - vale **também no retorno**?
2. **Financeiro (P5):** é o **administrador** do sistema, ou uma pessoa diferente que ainda não tem cargo? Hoje existem só caixa, gerente e admin.
3. **Baixa de papel (P5):** quem marca que o documento de convênio ou a receita voltou — o caixa que recebeu no balcão, ou o gestor?
4. **Papel na transição (P6), reformulada:** quando o piloto começar, o motoboy ainda vai levar algum **vale de papel escrito à mão**? Se sim, por quanto tempo, e o número escrito nele vai ser o mesmo que o sistema gerou (V-000123)? Ou o papel acaba no primeiro dia?

### As dúvidas respondidas

| Dúvida | Resposta, nas palavras do usuário | Como fica |
|---|---|---|
| Credencial do gestor | "Sim. Em caso do motoboy perder o cartão, já que se ele esquecer o PIN, temos como redefinir já no sistema. Sim." | o **gestor é o gerente da filial**. A credencial dele é usada **quando o motoboy perdeu o cartão**, **na saída e no retorno**. PIN esquecido não precisa dela: redefine-se o PIN |
| Financeiro | "Sim" | o **financeiro é o administrador**. O gerente confere o dia e resolve divergência; o admin aprova a cobrança |
| Baixa de papel | "O caixa geralmente, ou o gestor eventualmente" | **caixa e gerente da própria filial** dão baixa; o admin não, porque não recebe papel no balcão |
| Papel na transição | "No início sim. Se for aprovado acredito que não, já que o vale já ficaria registrado no painel da agência." | **no começo do piloto o vale de papel continua**; se o piloto for aprovado, ele acaba, porque o vale passa a estar no painel da agência |

### O que essas respostas exigem — técnico, para o 4B, 4C e 6

- **Redefinir PIN existe, mas só pelo admin e só com internet** (`redefinir_pin` exige `is_admin()`, [credenciais](../supabase/migrations/20260816130000_motoboy_credenciais.sql#L605)). Um motoboy que esquece o PIN numa filial sem internet, ou sem o admin disponível, fica parado. Isso é provisionamento, e continua fora do offline pelo contrato do E12; o que se pode decidir depois é se o gerente também redefine.
- **A credencial de hoje é só de motoboy** (`emitir_credencial(p_motoboy_id)`, ligada a `mototaxistas`). A do gerente é **um tipo novo de credencial**, ligada a `profiles`.
- **O documento tem que dizer quem validou.** Com cartão perdido, o motoboy continua identificado no documento, escolhido na lista, mas **quem valida é o gerente, com o cartão e o PIN dele**. O documento registra isso como validação pelo gerente, e **não finge** que houve a validação normal do motoboy. Offline, o PIN do gerente vai no mesmo envelope e é conferido na sincronização.
- **Baixa física:** hoje qualquer cargo dá baixa, inclusive o admin. Passa a ser caixa e gerente, na própria filial — é o achado de UX do plano, agora com resposta.
- **O papel do piloto precisa levar o número do sistema, e hoje a tela não mostra esse número.** Depois de salvar, o cadastro diz "Entrega de José salva", sem o `V-000123`: o número só aparece na lista, depois que o vale sincroniza. **Online:** mostrar o número assim que o servidor o devolve. **Offline:** só existe com o E12, que reserva o número antes da queda.
- **O fim do papel depende do painel da agência (passo 6).** O critério de aprovação do piloto passa a incluir a agência conseguir conferir os vales pelo painel.

### Ainda aberto

- **Datas da quinzena.**
- **Transferência gera vale?** Continua o conflito com a confirmação de 2026-08-11.

As duas afetam **cobrança e fechamento (passos 5 e 6)**, e **não o contrato de evidências do 4B**, que já tem o que precisa para ser desenhado.
