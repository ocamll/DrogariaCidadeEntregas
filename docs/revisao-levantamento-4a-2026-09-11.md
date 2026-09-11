# Revisão do levantamento 4A

11/09/2026. Documento examinado: [levantamento 4A](../docs/levantamento-4a-2026-09-11.md). Checkout conferido no commit `1014b5d`; o levantamento descreve a base `ed5715a`. Revisão por leitura de código e migrations, sem consulta ao banco, execução de testes, alteração de código ou push. O status local contém somente a alteração preexistente em `.claude/settings.local.json`.

**Parecer:** o levantamento é uma base útil, mas a proposta de contrato precisa dos ajustes abaixo antes da implementação. Os problemas de cálculo, a falta de vínculo entre tentativas, a baixa da receita sem evento e a falta da reserva de numeração foram confirmados no código. Algumas afirmações sobre evidência e algumas regras propostas dizem mais do que os dados permitem ou reabrem decisões já tomadas pelo usuário.

## 1. Preservar as decisões já tomadas

- Uma tentativa efetivamente realizada gera um vale de R$9, mesmo sem entrega. Cada nova tentativa ganha outro vale da mesma compra.
- Pendência de documento ou de acerto retém somente o vale afetado. Os demais seguem para conciliação e pagamento.
- Agência recebe da farmácia por quinzena e paga os motoboys. O controle interno de repasses da agência não precisa fazer parte do primeiro painel.
- Antecipação informal de dinheiro fica fora do sistema. Não criar campos nem fluxo para ela.
- Admin não opera o balcão; caixa e gerente podem operar na própria filial. Gerente pode cobrir o balcão ocasionalmente.
- Operação de saída e retorno durante a queda de internet é obrigatória.

A pergunta do cenário 3.4 sobre reter o vale ou o dia inteiro está respondida: somente o vale. O que ainda falta é definir quem resolve a divergência e como a resolução é registrada.

Para insucesso, aplicar a regra ao fato: houve tentativa realizada? Os rótulos `recusou` e `outro` não devem, por si só, negar ou conceder a tarifa. Um motivo insuficiente pede esclarecimento. Transferência e serviços como busca posterior de documento continuam precisando de regra própria confirmada.

## 2. Separar serviço realizado, comprovação e liberação

A proposta A2 mistura o acontecimento comercial com sua confirmação técnica. O usuário disse que o serviço realizado gera o vale; não disse que o serviço só passa a existir quando o servidor consegue selar o retorno.

Proposta de leitura para o produto:

| Situação | Como apresentar |
|---|---|
| Vale criado, ainda sem saída | Serviço previsto; não compõe o valor liberado. |
| Saiu, mas não há retorno registrado | Aguardando desfecho/comprovação. Não afirmar que a tentativa não ocorreu. |
| Retorno registrado localmente, ainda sem sincronizar | Operação registrada no terminal; validação no servidor pendente. |
| Retorno validado, entregue ou insucesso de tentativa realizada | Serviço confirmado; liberável se não houver pendência impeditiva. |
| Documento ou acerto pendente | Vale retido com motivo; demais vales seguem normalmente. |
| Conflito de sincronização ou recuperação excepcional | Exige resolução identificada; não apagar o ato relatado nem liberar silenciosamente. |

Isso não exige seis novos estados armazenados. São leituras dos fatos que já existem ou serão necessários. O caminho normal pode usar o retorno selado como condição de liberação. Um retorno excepcional autorizado precisa deixar evidência equivalente do tratamento, sem inventar que houve confirmação normal pelo motoboy.

O relatório atual realmente soma tarifa e compra de todo vale não cancelado. A implementação deve separar previsão, serviços confirmados, valores retidos e valores aprovados. A aprovação parcial precisa conhecer a cobrança completa; não torna aceitável uma soma truncada.

Evidências: [regra do relatório](../src/data/relatorios.ts#L113), [período pela criação](../src/data/relatorios.ts#L210) e [somas do fechamento](../src/data/fechamento.ts#L159).

## 3. Corrigir o alcance das evidências

**PIN não é prova isolada de presença física.** Ele permite validar o segredo associado à credencial apresentada. Alguém pode compartilhar ou conhecer esse segredo; portanto, não se deve afirmar que só o titular poderia ter feito o ato ou que esteve no endereço. A distinção segue a descrição de autenticação e seus limites quanto a compartilhamento de credenciais no [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b/introduction/). A aplicação ao processo da farmácia é uma inferência desta revisão, não uma certificação do sistema.

A evidência operacional proposta é o conjunto: identidade da farmácia, credencial do motoboy validada, conteúdo confirmado, horários, desfecho e preservação do registro. O verificador comprova consistência das camadas verificadas; não observa a entrega física nem decide se uma cobrança é comercialmente devida.

**Manter o envelope atual é a recomendação correta.** Hoje ele protege PIN e token e os vincula à operação. A justificativa precisa dizer “não existe substituto implementado e validado neste projeto”, em vez de afirmar que não há outra arquitetura possível. O mecanismo é híbrido: AES-GCM cifra o conteúdo e RSA protege a chave AES. Nada exige redesenhar isso para o piloto.

**Cargo offline precisa de descrição precisa.** As funções de selagem consultam o perfil no momento em que executam no servidor. No offline, esse instante é posterior à confirmação local. Uma troca de cargo durante a queda impede tratar esse valor, sem outra evidência, como o cargo histórico da confirmação no terminal. Registrar a limitação e definir o comportamento para mudança de cargo, filial ou revogação antes da sincronização. Não corrigir isso confiando apenas em um cargo enviado pelo cliente.

Além disso, o cargo é metadado fora do hash histórico da assinatura de saída, mas integra a fórmula da assinatura interna de retorno. O contrato deve manter essa distinção ao descrever o que cada verificação cobre.

Evidências: [segredos protegidos](../src/lib/envelope.ts#L49), [perfil consultado na saída](../supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql#L104), [perfil consultado no retorno](../supabase/migrations/20260826120000_pagamento_alterado_todos_previstos.sql#L161) e [fórmulas distintas no verificador](../supabase/migrations/20260820140000_verificador_do_retorno.sql#L420).

## 4. Recomendar confirmação explícita, cobrindo as duas partes

Minha preferência de UX para D6 é substituir o desenho por confirmação explícita do conteúdo. É recomendação, ainda sujeita à escolha do usuário.

- Motoboy: vê o resumo e o detalhe dos vales, confirma o ato e usa cartão/PIN vinculado àquele conteúdo.
- Farmácia: caixa ou gerente confirma o próprio ato pela sessão autenticada. Apenas estar logado não é manifestação de concordância.
- Na saída, o conteúdo é a retirada dos vales identificados. No retorno, inclui os desfechos, os pagamentos declarados e os documentos recebidos ou faltantes.
- Uma confirmação pode abranger o atendimento com vários vales. Não criar uma confirmação repetida para cada linha sem necessidade operacional.
- Offline, mostrar que a validação da credencial ainda depende da sincronização. A operação deve poder prosseguir conforme o contrato offline; aprovação financeira deve respeitar validações e conflitos pendentes.

A opção B do levantamento descreve principalmente o motoboy. Precisa também definir o ato explícito da farmácia antes de retirar seus traços. Preservar autoria, conteúdo e ligação da confirmação ao documento. Não fazer afirmação de equivalência jurídica entre mecanismos nesta decisão de produto.

Novas fórmulas devem ser versionadas conforme o que mudou, mantendo os verificadores dos documentos preservados. Não adicionar versionamento a camadas que continuarem idênticas apenas por uniformidade.

## 5. Nova tentativa precisa funcionar também com o E12

O levantamento corrigiu a referência anterior do plano: `useEntregasPendentesSemCorrida` só é encontrado na própria definição; a seleção ativa está em `buscarValesParaSaida`. A correção foi incorporada ao plano exportado nesta tarefa.

Manter a proposta de novo número e vínculo imutável à compra/tentativa anterior. Porém, “somente depois de retorno selado no servidor” não pode ser a única porta se uma nova tentativa precisar sair durante a queda. O desenho deve contemplar retorno registrado localmente e nova tentativa dependente dele, com validação ordenada na sincronização e tratamento de conflito. A exigência definitiva no servidor pode permanecer; o terminal precisa representar a cadeia ainda pendente.

Recomendação mínima de integridade para o vínculo:

- Mesma compra de origem, filial e tenant, conforme o fluxo autorizado.
- Reenvio ou clique duplo não cria outra tentativa.
- Dois terminais não abrem, silenciosamente, tentativas concorrentes da mesma compra. Se ocorrer offline, o conflito deve ficar explícito na sincronização.
- Vínculo não é editável depois para mudar quais compras são contadas juntas.
- Não reutilizar IDs de pagamentos, assinaturas, recibos ou estados de recebimento anteriores.

Copiar como preenchimento inicial o que ainda for pertinente, permitindo revisão antes da nova saída. Se o motivo foi endereço errado, a tela deve facilitar corrigir o endereço da nova tentativa. Formas previstas podem mudar. Receita e documentos esperados precisam refletir o que acompanhará aquela saída; não copiar a baixa física anterior nem perder uma pendência antiga.

Caixa e gerente são a proposta natural para abrir nova tentativa na própria filial. Isso segue o acesso de balcão já decidido; não reintroduzir o admin.

Manter o vínculo fora do canônico pode ser suficiente, desde que seja protegido no servidor e sua criação deixe auditoria. Nesse desenho, ele não passa a ser comprovado pelo hash histórico do romaneio. Essa limitação precisa ser explícita, e não escondida pela frase “nenhum byte muda”.

Evidências: [seleção ativa](../src/data/romaneios.ts#L606) e [recusas no servidor](../supabase/migrations/20260902120000_admin_operando_por_filial_saida.sql#L161).

### 5.1. Incluir Service Worker e Cache API no 4C

**O 4C precisa contemplar explicitamente abrir e reabrir o aplicativo sem internet**, além de registrar operações durante a queda. Service Worker e Cache API permitem servir os recursos previamente armazenados do aplicativo quando a rede está indisponível. Essa preparação ocorre enquanto o terminal está conectado. [Referência: uso de Service Workers, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

O desenho offline combina três partes:

| Parte | Responsabilidade no sistema |
|---|---|
| **Service Worker + Cache API** | Disponibilizar telas, scripts, estilos e demais recursos necessários para abrir e operar o aplicativo sem rede, incluindo recursos carregados sob demanda pelos fluxos obrigatórios. |
| **IndexedDB, usando o Dexie existente** | Persistir os dados operacionais necessários, vales novos, corridas, retornos e fila; as telas precisam consultar também esse estado local. |
| **Sincronização + regras do E12** | Preservar a numeração reservada, enviar as operações na ordem das dependências, evitar duplicação e apresentar conflitos. |

IndexedDB oferece armazenamento local de dados estruturados, adequado aos registros e operações do aplicativo. [Referência: IndexedDB, MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).

**Estado observado no código:** há Dexie e fila de operações, mas não foi encontrado registro de Service Worker, uso de Cache API ou configuração de PWA nas fontes e configurações examinadas. O QueryClient também não configura persistência. Evidências: [configuração do Vite](../vite.config.ts#L1), [banco local](../src/lib/db.ts#L1), [processamento da fila](../src/data/filaOffline.ts#L201) e [QueryClient](../src/lib/queryClient.ts#L1).

Exemplo obrigatório: um vale criado durante a queda aparece imediatamente na seleção de saída. Depois de registrar a saída, a corrida aparece para retorno, sem depender de resposta do servidor. Cachear uma resposta antiga da lista não implementa essa sequência; ela depende da atualização e leitura do estado local.

O envelope continua protegendo PIN e token enquanto aguardam validação. Service Worker, Cache API e persistência em IndexedDB não substituem essa proteção. A atualização do cache de arquivos do aplicativo também deve preservar as operações pendentes no banco local.

**Aceite a incluir no 4C, em ambiente de teste publicado:**

1. Preparar o terminal conectado, com os recursos, dados, credenciais e números necessários ao fluxo offline.
2. Desconectar, fechar todas as abas do aplicativo e abri-lo novamente sem internet.
3. Criar um vale, registrar a saída e registrar o retorno ainda sem rede.
4. Reabrir também com operações pendentes e conferir que registros e dependências continuam disponíveis.
5. Reconectar e verificar números preservados, sincronização na ordem correta, ausência de duplicação e resultado das validações.

O teste precisa exercitar a indisponibilidade do site e do servidor de dados. Deixar apenas uma aba já carregada funcionando, ou manter os arquivos acessíveis por um servidor local, não demonstra o requisito de reabertura offline do aplicativo publicado.

## 6. Competência e compras

Recomendo competência do serviço pela retirada, separada da data de liberação, aprovação e pagamento. O calendário exato da quinzena ainda depende do usuário.

Guardar dois relógios não resolve automaticamente um terminal com data errada. Fixar fuso da filial, tratamento de horários incoerentes e correção autorizada da competência, sem editar os bytes assinados. Um vale liberado depois deve preservar a competência original e mostrar em qual acerto foi aprovado ou pago. Não reabrir nem reescrever silenciosamente a aprovação de toda uma quinzena.

Para a compra, contar uma vez o atendimento entregue é uma proposta coerente. A referência deve ser a compra de origem, não simplesmente a soma de todos os vales cujo status é entregue. Duas conclusões incompatíveis da mesma compra exigem resolução, não ocultação por uma soma que escolhe uma delas. Como o sistema complementa o Trier, prefiro o rótulo “Compras entregues” a uma promessa de total fiscal de vendas.

## 7. Auditoria, limpeza e limites do verificador

Confirmada a lacuna da receita: a baixa grava autor e relógios, mas a função de log de entregas acompanha apenas os três eixos de status. Assim, não há o evento específico da baixa de receita nessa implementação.

A futura baixa deve persistir a mudança e seu evento na mesma transação no servidor, de forma idempotente. Gravar status primeiro e evento numa segunda requisição deixaria uma nova possibilidade de histórico incompleto. O fluxo local mantém o texto e o andamento visíveis até confirmar o resultado.

Evidências: [baixa de receita](../src/data/documentos.ts#L134), [carimbo de custódia](../supabase/migrations/20260810150000_custodia_dois_relogios.sql#L28) e [log por alteração de status](../supabase/migrations/20260806232804_schema_inicial.sql#L361).

A geolocalização não está nas fórmulas de assinatura examinadas, mas está no hash do evento offline. Remover esse resíduo exige coordenar produtor, consumidor, parâmetros SQL e filas. Antes do corte, repetir o censo de dados e a verificação: leitura do código não é censo do banco. O placar `22 · 22 · 0` deve continuar descrito como última medição registrada, não como resultado desta revisão.

Eu retiraria da proposta a ideia de fazer o verificador de documentos avaliar “completude da numeração”. Reservas consumidas, não utilizadas ou conflitantes pertencem ao controle operacional do E12. Um intervalo reservado pode ter lacunas legítimas; isso não torna um documento criptograficamente inválido.

## 8. Próxima entrega

Revisar a proposta 4A com estas distinções, incorporar as respostas sobre quinzena, transferência e traços e fechar o processo excepcional. Tamanho dos blocos de numeração, implementação de vínculo, transação de auditoria e versionamento são propostas técnicas a justificar; não precisam virar uma lista de escolhas técnicas para o usuário.

Após isso, 4B pode implementar o contrato de evidências escolhido. O 4C deve incluir carregamento offline com Service Worker e Cache API, persistência dos dados operacionais e sincronização da cadeia do E12. O desenho da nova tentativa precisa estar coordenado com essas três partes antes de se prometer continuidade operacional completa. O fechamento e a cobrança usam essas mesmas regras.

O push continua uma pendência separada. Não foi tentado nesta revisão e não foi usado outro caminho para contornar o bloqueio relatado.
