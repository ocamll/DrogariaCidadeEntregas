# Mudança de escopo: divergências e documentos conferidos no retorno da corrida

Criado em 13/09/2026. **Versão 2, atualizada em 14/09/2026.** Documento de orientação para o Claude Code. Esta versão substitui a anterior; o nome do arquivo foi mantido para facilitar o envio.

Este documento foi solicitado pelo usuário durante a construção do fluxo de “Notificar divergência”. Registra a mudança de direção e as condições para implementá-la. A produção deste documento não alterou código, migrations ou dados do sistema e não constitui autorização para aplicar alterações no banco.

## 1. A decisão que substitui o plano anterior

O usuário percebeu que o registro separado de divergência repete a conferência feita no retorno da corrida, momento em que esses problemas normalmente são descobertos.

**Decisão: remover o botão separado de notificar divergência e centralizar no retorno o registro das diferenças de pagamento, dos documentos faltantes e do desfecho da tentativa.**

O caixa informa o que aconteceu. O servidor compara o previsto com o realizado, registra a divergência e disponibiliza a ocorrência para acompanhamento. O caixa não deve preencher o retorno e depois repetir a informação em outra janela para avisar a gestão.

**Complemento confirmado em 14/09: a aba Documentos fica apenas para gestores e administradores acompanharem o que voltou, o que está pendente e o que foi recebido posteriormente.** A conferência inicial dos documentos sai dessa aba e integra o retorno. O caixa registra um recebimento posterior por uma ação contextual no vale, sem acesso à aba gerencial e sem reabrir o retorno selado.

| Ponto de acesso | Quem usa | Responsabilidade |
|---|---|---|
| Retorno da corrida | Caixa; gerente quando assumir excepcionalmente o balcão | Confirmar desfecho, pagamentos e documentos; informar o contexto das diferenças. O admin continua sem fluxo de balcão. |
| Aba Documentos | Gestor da filial; admin em todas as filiais do tenant | Consultar documentos recebidos e pendentes, histórico e providências; acompanhar a resolução. |
| Ação “Receber documento” no vale | Caixa da filial; gerente quando atuar no balcão | Registrar a chegada posterior do documento físico. |
| Notificações | Destinatários autorizados de cada ocorrência | Avisar e abrir o registro correspondente; sem repetir a conferência ou encerrar a pendência pela leitura. |

Esta decisão substitui a premissa de manter `pagamento_alterado` como evento produzido tanto pelo cliente quanto pelo selo. Não cancela a proteção da auditoria, o acompanhamento de credenciais ou as demais regras do 4B.

Como há trabalho em andamento, comece conferindo o diff atual, os commits e as migrations já aplicadas. Preserve as mudanças úteis e ajuste somente o que dependia da existência do formulário separado. Não reverta o trabalho inteiro.

## 2. O que foi conferido no código

Referências relativas à raiz do repositório, conferidas em 13/09/2026. Revalidar o estado ao retomar: há construção em andamento e os números de linha podem mudar.

| Arquivo e símbolo | Situação observada | Consequência |
|---|---|---|
| `src/components/EntregaAcoesMenu.tsx`, `EntregaAcoesMenu` | O item se chama “Notificar ocorrência” e abre `NotificarOcorrenciaDialog`. `podeNotificar` considera tipo do vale e receita, sem restringir pelo status da entrega. | O acesso aparece até em momentos em que o retorno ainda não aconteceu. Retirar o item, seu estado e suas propriedades exclusivas. |
| `src/components/NotificarOcorrenciaDialog.tsx` | Reúne divergência de pagamento e falta de receita. Enfileira operações `divergencia` e `falta_receita`. | A remoção do diálogo exige conferir os dois caminhos, não apenas o texto do botão. |
| `src/data/pagamentos.ts`, `marcarDivergencia` | Insere linhas de pagamento `realizado`, marca `status_financeiro = 'divergente'` e grava `pagamento_alterado`. | É um segundo caminho de escrita do realizado. A mudança deve eliminar esse escritor, depois de tratar as operações antigas da fila. |
| `src/pages/RetornoCorrida.tsx` | Já coleta pagamentos realizados, troco, desfecho e situação dos documentos. | O retorno será o ponto de entrada desses fatos. Ainda precisa comportar a explicação da divergência de pagamento/documento; o detalhe atual de insucesso não substitui essa explicação. |
| `supabase/migrations/20260912120000_selo_do_retorno_versao_2.sql` | O selo grava pagamentos, calcula divergências e produz `pagamento_alterado` e `documento_faltante`. | Aproveitar essa origem. Conferir a definição efetivamente vigente antes de modificar funções. |
| `src/data/notificacoes.ts` e `src/data/auditoria.ts` | Há leitura dos eventos antigos e distinção de origem de pagamento. A lista de notificações inspecionada ainda não inclui `documento_faltante`. | Preservar leitores necessários ao histórico e integrar os eventos produzidos pelo retorno ao acompanhamento. |
| `src/pages/DocumentosPendentes.tsx` e `src/data/documentos.ts` | Existem baixa de recebimento posterior e ações de notificar falta de receita/convênio fora do diálogo dos vales. | Transformar a aba em acompanhamento gerencial, incluindo recebidos; reaproveitar a baixa em uma ação contextual no vale para o balcão. Retirar a declaração repetida da mesma falta. Conferir consumidores antes de apagar funções. |
| `src/lib/db.ts` e `src/data/filaOffline.ts` | A fila tipa e processa `divergencia` e `falta_receita`. | A ausência do botão não prova que deixou de existir trabalho pendente em IndexedDB. |
| `supabase/migrations/20260913120000_eventos_e_assinaturas_so_do_servidor.sql` | O arquivo já existe e ainda permite ao cliente `pagamento_alterado`, recusando as chaves `origem` e `romaneio_retorno_id`. | A proteção construída continua útil, mas sua lista final de escritores muda. A existência do arquivo não comprova aplicação no banco. |

## 3. Como o retorno deve funcionar

### Conferência por vale

O caixa confirma o desfecho, o pagamento efetivo e quais documentos voltaram. O sistema destaca as diferenças junto ao vale correspondente, antes da confirmação final.

Exemplos de apresentação:

- “Previsto: R$ 100,00 em dinheiro. Recebido para a compra: R$ 80,00. Diferença: R$ 20,00 a menos.”
- “Previsto: cartão. Realizado: Pix, no mesmo valor.”
- “Receita: não voltou com o motoboy.”

Troca de forma e diferença de valor precisam ser distinguíveis. Pagamento com troco correto não é divergência: numa compra de R$ 100 com R$ 40 em Pix e R$ 60 em dinheiro, receber R$ 100 em espécie e devolver R$ 40 de troco continua aplicando R$ 60 em dinheiro à compra.

O cliente pode antecipar o aviso para ajudar o caixa, mas a classificação persistida continua sendo calculada e validada no servidor. Reutilizar a regra de comparação existente, sem criar outra fórmula na interface.

### Explicação do ocorrido

Recomendação de UX para esta implementação: exibir “O que aconteceu?” apenas nos itens com divergência ou documento faltante. Guardar a explicação por vale e, quando necessário, por ocorrência dentro dele.

O operador deve poder registrar que o motivo ainda precisa ser apurado. Não exigir uma justificativa inventada nem impedir o registro verdadeiro do retorno porque o caixa não sabe explicar a diferença.

A explicação calculada pelo sistema e o relato do operador são informações distintas:

- o sistema demonstra a diferença entre os dados;
- o operador relata o contexto conhecido;
- o gestor registra depois a análise e a providência.

### Confirmação, offline e acompanhamento

Ao confirmar o retorno, os fatos e seus vínculos devem ser persistidos de forma consistente. Não depender de um segundo envio manual de “notificação” depois do selo.

No offline, a explicação deve acompanhar o mesmo registro local e sobreviver ao fechamento do navegador, às tentativas de sincronização e aos conflitos. A tela deve informar que o retorno e a ocorrência aguardam sincronização. Não afirmar que o gestor recebeu antes disso.

Depois da sincronização aceita, a ocorrência fica disponível ao gestor da filial. O encaminhamento ao admin ocorre quando o gestor precisar de decisão administrativa ou financeira, conforme já decidido pelo usuário. O gestor pode resolver o que estiver dentro de sua responsabilidade.

O encaminhamento em tempo real continua sendo requisito do acompanhamento de divergências. Um evento no banco, um contador ou uma consulta periódica não comprovam que esse fluxo já está pronto. Reabertura da tela e reconexão precisam recuperar as pendências mesmo quando um aviso em tempo real não chegar.

## 4. Aba Documentos gerencial e recebimentos posteriores

### A aba Documentos deixa de ser uma segunda conferência do caixa

Remover o acesso à aba Documentos do painel do caixa. Manter a aba para gestores e administradores, com estes escopos:

- o gestor consulta e acompanha os documentos da própria filial;
- o admin consulta e acompanha todas as filiais do tenant, com filtro de filial;
- o caixa consulta os documentos do vale necessário à sua operação e registra recebimento posterior, sem receber a listagem gerencial completa.

A restrição da aba precisa alcançar a rota e a consulta gerencial, não apenas esconder o item no menu. Separar esse acesso das leituras contextuais necessárias ao cadastro, retorno e recebimento posterior; não bloquear o trabalho do caixa ao restringir a listagem gerencial.

A aba deve mostrar os documentos por vale e tipo, com acesso ao romaneio e ao histórico, distinguindo:

| Situação exibida | Significado |
|---|---|
| **Recebido no retorno** | A conferência do retorno declarou que o documento voltou naquele momento. |
| **Pendente** | O retorno declarou o documento faltante e ainda não existe recebimento posterior confirmado. |
| **Recebido posteriormente** | O retorno declarou falta, e outro registro documenta a chegada depois, com quem recebeu e quando. |

Esses são rótulos de apresentação; não exigem criar um novo enum no banco sem necessidade. Antes da conferência do retorno, não afirmar que o documento “não voltou”: ele ainda pode estar com o motoboy. Se esses vales aparecerem na consulta, indicar que aguardam conferência.

A consulta não pode se limitar às pendências atuais. Deve permitir checar também o que voltou, filtrar por situação, tipo de documento e período, e localizar um vale. Datas de retorno e de recebimento posterior precisam aparecer com seus significados, sem transformar a chegada posterior em chegada no retorno.

O gestor pode registrar providências e encaminhar o que exigir decisão do admin. Encerrar uma análise administrativa ou ler uma notificação não equivale a receber fisicamente um documento. A pendência documental permanece até o recebimento correspondente.

### Documentos que chegam mais tarde: ação contextual no vale

Manter a baixa posterior de receita e documento de convênio, acessível ao caixa pela ação **“Receber documento”** ao localizar o vale. Não exigir que o caixa entre na aba gerencial nem recriar uma página paralela de conferência.

Exemplo: o retorno de segunda-feira declarou a receita faltante. Na terça-feira, o caixa localiza o vale, seleciona a receita pendente e confirma que está com o documento em mãos. A aba gerencial passa a mostrar “Recebido posteriormente”, com autor e horário. O romaneio de segunda-feira continua afirmando corretamente que a receita não voltou naquele retorno.

Requisitos dessa ação:

- validar no servidor o cargo, a filial, o vale e o documento que está sendo recebido;
- registrar o recebimento por documento; receber a receita não dá baixa automática no convênio do mesmo vale;
- preservar autoria, horário do fato e horário de registro/sincronização quando aplicável;
- impedir duplicação por clique repetido ou reenvio e não sobrescrever silenciosamente quem recebeu primeiro;
- atualizar o acompanhamento do gestor sem exigir nova notificação manual;
- só apresentar o recebimento como confirmado após a persistência aceita. Se houver suporte offline para essa ação, distinguir claramente “aguardando sincronização” de “recebido”. O alcance offline do recebimento posterior deve ser explicitado na implementação; a obrigatoriedade de saída e retorno offline permanece.

O gerente conserva essa ação quando atuar no balcão. O acesso gerencial do admin não deve ganhar automaticamente uma função de declarar recebimento físico.

Retirar as ações “Não voltou” que apenas repetem a conferência já registrada no retorno. Substituir o uso gerencial delas pelo acompanhamento da pendência existente, quando cabível. Não manter um segundo formulário para produzir a mesma ocorrência, e não apagar a página de Documentos inteira.

### Problemas descobertos posteriormente

A centralização no retorno não significa que uma descoberta posterior deva ser descartada ou inserida retroativamente no documento selado.

Direção recomendada para o acompanhamento de exceções: permitir um registro posterior vinculado ao vale e ao romaneio, com autor, horário, relato e tratamento pelo gestor. Esse registro não deve reutilizar `marcarDivergencia` para acrescentar pagamentos realizados ao retorno antigo.

O desenho específico dessa ocorrência posterior ainda precisa ser definido. Não criar nesta limpeza um novo formulário de pagamento equivalente ao que está sendo removido. Se a entrega dessa capacidade ficar para outra etapa, registrar a limitação explicitamente; não afirmar que o sistema já cobre todas as descobertas posteriores.

## 5. Preservação do selo e da auditoria

- Não alterar canônicos, hashes, assinaturas, payloads históricos ou eventos já persistidos para acomodar a nova interface.
- Não acrescentar a explicação a uma fórmula canônica apenas no TypeScript. Qualquer evolução de contrato assinado exige tratamento correspondente no SQL e nos verificadores, preservando as versões anteriores.
- Para esta mudança, a recomendação é tratar o relato e o acompanhamento como registros de auditoria vinculados ao vale e ao romaneio, fora dos bytes já assinados. Não apresentá-los como conteúdo assinado pelo motoboy se não fazem parte da assinatura.
- Definir onde o relato será persistido antes de adicionar o campo à tela. Ele precisa manter vínculo e autoria, sobreviver ao offline e não desaparecer se a sincronização falhar.
- Retorno em conflito não deve aparecer como retorno selado nem gerar uma ocorrência que alegue ter sido calculada a partir de um selo concluído. Preservar o relato para o tratamento do conflito.
- Reenvio não pode duplicar pagamentos, ocorrências ou encaminhamentos. Podem existir ocorrências de naturezas diferentes para o mesmo vale; repetir a mesma confirmação não cria outra ocorrência igual.
- O motoboy responsável continua sendo o da operação. Esta mudança não transfere a atribuição para o gerente ou para o autor da justificativa.

## 6. O que remover e o que aproveitar

Remover, quando os consumidores e a transição estiverem conferidos:

- o item “Notificar ocorrência” do menu dos vales, centralizando no retorno as declarações que ele repete;
- `NotificarOcorrenciaDialog` e os estados e propriedades que existam somente para abri-lo;
- o formulário manual de divergência de pagamento;
- `marcarDivergencia`, seu tipo de entrada e auxiliares exclusivamente usados por esse caminho;
- a criação de novos itens `divergencia` na fila e, concluída a transição, seu tipo e executor;
- o acesso do caixa à aba e à consulta gerencial de Documentos, preservando sua consulta contextual do vale;
- as ações de declarar novamente “Não voltou” quando repetem o fato já registrado no retorno;
- código de escrita de falta de receita/convênio que realmente ficar sem consumidor depois dessa reorganização, com tratamento da fila antiga quando existir;
- imports, reexports e testes que existam exclusivamente para o fluxo removido.

Se a remoção deixar o menu de um vale sem nenhuma ação válida, remover também o acionador vazio. O cancelamento de vale pendente continua sendo uma ação distinta.

Aproveitar o trabalho em andamento que ainda serve:

- comparações de pagamentos, dinheiro em centavos e cálculo de troco;
- explicações legíveis de previsto versus realizado;
- distinção entre ocorrência informada e divergência calculada;
- leitores dos eventos históricos;
- a lógica de recebimento posterior de documentos, adaptada para a ação contextual e com autoria e permissões verificadas;
- proteções contra escrita indevida de eventos e assinaturas;
- testes de comportamento e de permissões que continuem relevantes.

Não apagar `src/data/pagamentos.ts`, `src/lib/formasDePagamento.ts` ou `src/data/eventos.ts` por inteiro. Eles têm consumidores além do diálogo. Também não remover a escrita de pagamentos previstos do cadastro, que continua necessária.

## 7. A mudança na proteção de eventos

**Estado final desejado: `pagamento_alterado` produzido exclusivamente pelo servidor, como resultado da comparação no retorno.**

A necessidade anterior de permitir esse tipo ao cliente desaparece com a remoção completa do escritor manual. Não manter a permissão apenas porque ela estava no desenho anterior.

Antes de alterar a migration já construída:

1. Conferir se `20260913120000_eventos_e_assinaturas_so_do_servidor.sql` já foi aplicada e quais políticas estão efetivamente no banco.
2. Se já foi aplicada, preparar uma migration adicional para a nova restrição; não reescrever o passado como se a alteração já estivesse aplicada.
3. Coordenar a retirada de `pagamento_alterado` da lista do cliente com a desativação do escritor antigo e o tratamento da fila.
4. Preservar as restrições de assinaturas e a proteção dos marcadores de origem que ainda se apliquem.
5. Conferir separadamente os outros tipos escritos pelo cliente. Reavaliar `falta_receita` e `falta_documento_convenio` depois da retirada das notificações duplicadas, preservando leitores e tratando filas antigas. `entrega_cancelada`, a baixa posterior e outras ações ainda legítimas precisam ter seu caminho de escrita conferido antes de qualquer revogação geral.

A restrição da aba Documentos e a permissão de receber um documento são controles diferentes. A API de recebimento posterior deve aceitar o operador autorizado da filial sem abrir para ele as consultas de gestão de outras operações ou filiais. Não conceder uma permissão genérica de alterar documentos selados para viabilizar essa ação.

As leituras de `pagamento_alterado` permanecem: o servidor continua produzindo esse evento e o histórico contém registros anteriores. Não inventar uma origem comprovada para eventos antigos.

## 8. Transição da fila offline

A remoção do botão interrompe novos registros, mas não resolve operações já enfileiradas.

Fazer um levantamento dos terminais envolvidos e dos itens antigos. Conferir somente a fila desta máquina não demonstra que todas as filas estão vazias.

- Não apagar itens pendentes, marcar como sincronizados sem execução nem convertê-los silenciosamente em retorno.
- Conferir se o vale de um item antigo já possui retorno selado. Não executar cegamente uma escrita adicional de pagamento que possa contradizer ou duplicar o realizado desse retorno.
- Documentar o tratamento dos itens encontrados. Caso algum exija decisão humana, preservá-lo com contexto e motivo até o tratamento.
- Manter compatibilidade temporária somente se houver necessidade demonstrada, com condição objetiva para sua retirada. O destino final é remover o caminho antigo, não escondê-lo indefinidamente.
- Tratar clientes antigos ainda abertos ou com versão em cache antes de considerar concluída a exclusão da permissão no servidor. Se houver recusa de sincronização, apresentar o motivo e preservar o item.

Não executar reset do banco, limpeza geral do armazenamento local ou descarte de dados como parte automática desta mudança.

## 9. Ordem de execução sugerida

1. **Reconciliar o trabalho em andamento.** Apresentar o que já foi feito, o que permanece útil e o que foi superado por esta decisão. Atualizar a documentação correspondente sem reabrir decisões não relacionadas.
2. **Conferir cobertura do retorno.** Verificar pagamento misto, troco, documentos, explicação, autoria, offline e conflitos. Definir a persistência do relato sem alterar documentos anteriores.
3. **Preparar a transição.** Identificar consumidores e itens antigos da fila; conferir migrations e políticas aplicadas. Escolher a sequência de publicação coerente com esse estado.
4. **Centralizar a experiência.** Concluir a coleta e a explicação no retorno e retirar o botão e o formulário paralelo. Entregar a ação contextual “Receber documento” para a chegada posterior e retirar a aba Documentos do caixa. Não copiar a janela antiga para dentro do retorno: aproveitar a conferência que já existe ali.
5. **Integrar o acompanhamento.** Transformar Documentos em consulta gerencial de recebidos e pendentes, com histórico e escopos por cargo. Ler os eventos do retorno, inclusive `documento_faltante`, e permitir o tratamento pela gestão. Separar o que está entregue do que ainda depende da etapa de encaminhamento em tempo real.
6. **Fechar a escrita antiga.** Com a transição resolvida, restringir `pagamento_alterado` ao servidor e eliminar código, tipos e processamento exclusivos do caminho antigo.
7. **Validar e registrar.** Executar os testes pertinentes, build e lint; relatar o resultado e as pendências reais.

É permitido separar interface, integração e proteção do banco em commits coerentes. A mudança de direção não exige desfazer o que já foi construído corretamente.

## 10. Critérios de aceite

| Cenário | Resultado esperado |
|---|---|
| Vale pendente, em corrida ou concluído | Nenhum botão separado de notificar divergência; nenhum menu vazio deixado pela remoção. |
| Previsto e realizado iguais | Retorno sem falsa divergência e sem pedido adicional para notificar a gestão. |
| Pagamento misto com troco correto | Comparação considera o valor aplicado à compra; o troco não produz falsa divergência. |
| Forma ou valor divergente | Diferença visível no próprio vale; relato vinculado; ocorrência produzida pelo servidor. |
| Motivo ainda desconhecido | O caixa registra que precisa de apuração, sem inventar explicação nem perder o retorno. |
| Receita ou convênio não volta | Fato registrado no retorno e acessível ao acompanhamento, sem exigir outra declaração da mesma falta. |
| Documento chega no dia seguinte | Caixa localiza o vale e usa “Receber documento”, sem abrir a aba gerencial; baixa com autoria e horário, preservando a falta declarada no retorno original. |
| Vale com receita e documento de convênio pendentes | Receber um não dá baixa no outro. |
| Clique repetido ou reenvio do recebimento posterior | Nenhuma duplicação e nenhuma substituição silenciosa da autoria do primeiro recebimento. |
| Consulta de Documentos pelo gestor/admin | Distingue recebido no retorno, pendente e recebido posteriormente; permite consultar também os recebidos, com histórico. |
| Caixa tenta abrir a aba ou chamar a consulta gerencial diretamente | Acesso recusado; as leituras contextuais e o recebimento autorizado do próprio vale continuam funcionando. |
| Gestor tenta consultar ou receber documento de outra filial | Acesso recusado; admin consulta as filiais do próprio tenant sem ganhar função de balcão. |
| Vale ainda sem retorno conferido | Não aparece como documento comprovadamente faltante; a interface informa que aguarda conferência. |
| Gestor lê o aviso ou encerra uma análise | A pendência documental não é baixada como recebida sem o registro do recebimento físico. |
| Retorno offline com explicação | Dados e relato sobrevivem ao fechamento/reabertura e à sincronização; a tela distingue pendente de confirmado. |
| Reenvio ou sincronização concorrente | Nenhum pagamento ou ocorrência duplicado para a mesma operação. |
| Retorno em conflito | Relato preservado; nenhuma apresentação indevida como retorno selado. |
| Item antigo de divergência na fila | Tratamento explícito; nenhuma perda, conversão silenciosa ou inserção cega sobre retorno já selado. |
| Escrita direta de `pagamento_alterado` pelo cliente, após a transição | Recusada; o selo legítimo continua gravando o evento. |
| Cadastro de pagamentos previstos e ações legítimas restantes | Continuam funcionando após o ajuste de permissões. |
| Histórico e verificadores | Eventos anteriores continuam legíveis; documentos já selados mantêm os mesmos bytes e continuam verificando. |
| Gestor de uma filial | Vê e trata somente as ocorrências permitidas; o encaminhamento ao admin preserva o vínculo com o vale. |

Incluir testes negativos de permissão com identidades reais de teste, além dos testes de comportamento. Uma conferência textual do código, sozinha, não comprova RLS ou funcionamento offline. Testes que escrevam no banco dependem da autorização e do ambiente adequado.

## 11. Retorno esperado do Claude

Ao retomar, informar:

1. quais partes da construção atual serão mantidas, removidas ou adaptadas;
2. como a explicação ficará vinculada ao retorno e sobreviverá ao offline;
3. como a aba Documentos ficará restrita à gestão e como o caixa registrará o recebimento posterior pelo vale;
4. como serão tratados os itens antigos da fila e a mudança de permissões;
5. quais critérios de aceite foram demonstrados e quais ainda dependem de outra etapa.

Se alguma ambiguidade de negócio impedir uma escolha, apresentar um cenário concreto ao usuário. Não presumir que esta decisão autoriza alterar documentos selados, descartar filas ou aplicar migrations remotas.
