# Escopo pré-V1 revisado

Decisões do usuário incorporadas em 08/09/2026. Este documento atualiza a [auditoria anterior](analise-limpeza-pre-v1.md). É uma revisão de escopo e impacto; não registra implementação no aplicativo nem mudanças no banco.

Base técnica examinada: `feat/e10-admin-filial`, commit `bc7062a92496fb35aea8733c9ae516e4c7bf776d`.

## 1. Um vale de R$ 9,00, sem adicional por endereço distante

**Decisão:** retirar a escolha de um/dois vales e a regra de pagamento extra em mãos ao motoboy. No registro, o operador não escolhe quantidade nem calcula a taxa: cada vale tem a tarifa acordada, atualmente R$ 9,00.

Saem o seletor, os estados e mensagens de endereço distante, a multiplicação da tarifa, a distinção de quem paga o extra e os totais específicos desse adicional. A taxa continua registrada em centavos por vale e disponível no fechamento. Retirar sua edição do formulário não significa retirar sua evidência financeira.

**Impacto comprovado:** `CadastroEntrega.tsx:82–89,171–175,388–410`; `data/entregas.ts:71–82,134–137`; totais em `data/fechamento.ts:166–167` e `data/relatorios.ts:135,185,250`; PDFs, planilha e snapshot do romaneio.

**Transição:** quantidade, valor pago em mãos e convênio específico fazem parte do DCR1. Primeiro simplificar os novos registros para `quantidade_vales = 1`, `entrega_paga_cliente_cents = 0` e `convenio_id = null`, preservando a serialização. Eliminar campos/colunas do contrato, se desejado, é uma alteração coordenada TS↔SQL no corte. Não encurtar a linha canônica só no frontend.

Manter uma fonte de tarifa acordada, hoje 900 centavos, e o valor registrado na operação. Isso será necessário para comparar cobranças e preservar valores de dias anteriores caso a tarifa mude. Não espalhar o literal 900 entre telas nem usar o preço enviado pela agência como referência de “taxa correta”.

## 2. Convênio genérico, sem cadastro de empresas

**Decisão:** manter a forma de pagamento **Convênio**, com documento que precisa retornar. Retirar identificação de Minerva, Unimed ou qualquer outra entidade; regras comerciais e detalhamento ficam no Trier.

Saem:

- aba e componente `ConveniosCadastro`;
- CRUD, queries e DTOs de convênios em `data/cadastros.ts`;
- seletor e exigência de `convenioId` em `CadastroEntrega`;
- flags `exige_assinatura` e `farmacia_paga_entrega_integral`;
- sementes e textos que descrevem tratamentos particulares por convênio.

Permanecem o valor e a forma de pagamento, o documento esperado, seu recebimento, a indicação de pendência e a auditoria. O código já deriva papel de `convenio`/`crediario`, não de `exige_assinatura`.

Convênio e receita compartilham a necessidade de retorno, mas são documentos distintos. Uma entrega pode exigir ambos: receber a receita não pode quitar automaticamente a pendência do convênio, nem o contrário. Esta decisão não elimina a forma Crediário nem ConvCard.

**Impacto:** `pages/Cadastros.tsx:4,22,32`; `components/ConveniosCadastro.tsx`; bloco de convênios em `data/cadastros.ts`; `CadastroEntrega.tsx:15,89,94,171,257,509`; FK e campos da saída em `20260816140000_romaneio_de_saida.sql:285–302,353–358,859`. A retirada física da tabela exige ajustar dependências numa migration nova; não basta apagar a tela.

## 3. Retirar a forma de pagamento “Outro”

**Decisão:** “Outro” deixa de ser opção de pagamento no cadastro, divergência e retorno. Remover também a aceitação em novos registros no servidor.

**Impacto:** vocabulário em `lib/formasDePagamento.ts`, lista `FORMAS_PAGAMENTO` em `lib/canonicoRetorno.ts:117`, CHECK de pagamentos e validador SQL vigente em `20260820150000_dcrr1_bloco_documentos.sql:104`, além de fixtures e vetores que usem essa forma.

Não fazer substituição global de `outro`: o mesmo literal é motivo de insucesso, com detalhamento obrigatório, e não foi eliminado pelo usuário. `outro_tenant` e mensagens comuns também não têm relação com a forma de pagamento.

Enquanto existir histórico com pagamento “Outro”, sua leitura deve continuar fiel. No corte, confirmar ausência de linhas e itens de fila com essa forma antes de encerrar a compatibilidade. Não converter automaticamente “Outro” para outra modalidade.

## 4. Fechamento diário pronto para aprovação

**Decisão:** o sistema prepara o fechamento; o gestor analisa exceções, registra observações e aprova. Ele não monta a lista nem precisa marcar cada operação normal.

**Fluxo proposto:**

1. Abrir o dia e a filial, com resumo já calculado e serviços detalhados disponíveis para consulta.
2. Mostrar total esperado, total informado pela agência quando disponível, diferença, pendências e horário da última conciliação.
3. Destacar somente as exceções como trabalho do gestor. Os itens sem divergência continuam acessíveis para auditoria.
4. Registrar observações e o tratamento das exceções, sem apagar a evidência que as originou.
5. Aprovar uma versão determinada do fechamento, guardando responsável, horário, observações, escopo e dados usados na comparação.

Fechamento calculado não é fechamento aprovado. Ausência de cobrança do painel não significa diferença zero. Uma comparação ainda incompleta deve dizer isso e não aparecer como conciliada.

Se um retorno offline chegar depois da aprovação, o fechamento aprovado não muda silenciosamente: o sistema apresenta a alteração posterior e uma revisão para análise. O detalhe do bloqueio de aprovação diante de exceções é uma regra a definir, não uma autorização presumida para aprovar tudo.

**Diferença para o código atual:** `pages/Fechamento.tsx` oferece “Marcar dia como conferido”; `data/fechamento.ts` atualiza `status_financeiro` das entregas. Não existe entidade de fechamento aprovado com observações próprias. A query atual filtra `tipo = cliente` e usa lista com teto (`data/fechamento.ts:128–141`). Um fechamento financeiro completo deve incluir os serviços efetivamente cobrados, inclusive transferências quando aplicáveis, e não aprovar somas truncadas.

A data de criação do vale não resolve sozinha a competência: um vale pode ser criado num dia, sair no outro e retornar depois. A regra diária deve ser explícita e conciliável com a competência usada pelo painel da agência. O gestor recebe o resultado pronto; não precisa compensar essa diferença montando o fechamento à mão.

## 5. Conferência da cobrança: construir o painel da agência

**Informação confirmada pelo usuário:** a cobrança virá do **painel da agência**, que **ainda não foi criado**. Portanto, não se trata de integrar um fornecedor identificado. O novo escopo inclui construir a apresentação da cobrança pela agência e sua conferência pela farmácia. O repositório atual não oferece esse painel nem registra os itens de cobrança apresentados.

**Desenho proposto para o painel:** a agência acessa apenas os serviços e valores pertinentes a ela, vê o período e as filiais atendidas e apresenta uma cobrança discriminada. Os serviços já registrados podem preencher uma proposta; os valores e itens efetivamente cobrados precisam de submissão explícita e de versão própria. A farmácia compara essa cobrança com as operações e a tarifa acordada. Copiar o total interno para o painel e compará-lo consigo mesmo não constitui conferência independente da cobrança.

Cada item apresentado deve referenciar o vale/serviço existente sempre que possível. Ajustes ou itens sem correspondência precisam ser identificados, justificados e encaminhados como exceção; não criam retrospectivamente uma entrega ou retirada. Reenvios devem ser idempotentes. Uma cobrança enviada e depois corrigida gera uma revisão rastreável, preservando a versão que embasou eventual aprovação.

O acesso da agência exige autorização própria, vinculada à agência e ao tenant. Não usar cargo de administrador da farmácia para esse acesso. O servidor deve limitar leitura e escrita aos registros permitidos, e a agência não pode editar desfechos, evidências ou aprovações da farmácia. Expor apenas os dados necessários à cobrança; valor da compra e detalhes de pagamento/convênio do cliente não se tornam visíveis por consequência do novo painel.

| Comparação desejada | Base interna existente | Informação ou regra adicional |
|---|---|---|
| Vale criado | ID, número, filial, autoria e horários | Identificador correspondente no painel. |
| Corrida aceita | Corrida e selagem/autorização de saída | Aceite no painel é um fato distinto; não inferir a partir da criação do vale. |
| Motoboy responsável | Corrida, mototaxista e evidências da saída | Correspondência com o cadastro de motoboys da agência. |
| Retirada | Romaneio de saída e vínculos dos vales | Identificador/status externo, se existir. |
| Entrega ou insucesso | Desfecho registrado no retorno | Distinguir relato operacional de comprovante externo de entrega. |
| Cancelamento | Status, autor, motivo e horário | Regra de cobrança conforme etapa do serviço. |
| Devolução | Há insucesso e registros de retorno | Confirmar qual fato comprova devolução do produto; retorno do motoboy ou de papel não prova sozinho devolução da mercadoria. |
| Taxa correta | Valor registrado no vale e tarifa da filial | Tarifa acordada e sua vigência, hoje R$ 9,00 por vale. |
| Cobrança da agência | Não existe entrada hoje | Linha de cobrança, valor, referência, filial, motoboy, competência, autor e versão submetidos pelo novo painel. |

**Exceções que o sistema deverá produzir:**

- **Corrida cobrada sem conclusão:** existe cobrança associada a serviço ainda não concluído nos registros; indicar qual conclusão está faltando.
- **Vale/cobrança duplicada:** mais de uma cobrança para a mesma unidade de serviço. Reenviar a mesma cobrança não pode criar nova linha. Nome/endereço iguais não provam duplicidade de vale.
- **Cancelamento cobrado:** marcar para revisão com etapa e horário. O alerta não equivale, por si só, a concluir que a cobrança é indevida: cancelamento antes e depois da retirada podem ter regras diferentes.
- **Taxa divergente:** comparar valor cobrado com tarifa acordada para aquele serviço e período, em centavos.
- **Retorno pendente:** separar falta de desfecho da corrida, falta de documento de convênio/receita e eventual devolução de mercadoria pendente.
- **Corrida sem comprovação:** mostrar a evidência ausente, conforme o contrato final do produto. Se a assinatura manuscrita sair, não manter uma regra que exija assinatura inexistente.
- **Divergência filial/agência:** cobrança atribuída a filial ou agência diferente da operação e do vínculo permitido.
- **Sem correspondência:** cobrança externa sem serviço interno identificável, ou serviço interno ainda sem cobrança externa. Manter separado de duplicidade.

Uma corrida pode transportar vários vales. **R$ 9,00 por vale não significa R$ 9,00 por corrida.** O novo painel deve explicitar essa unidade de cobrança e a associação vale→corrida para evitar multiplicar ou descartar valores. Se os dados não permitirem associação segura, apresentar a pendência; não aprovar por semelhança de nomes.

## 6. Usuários: “Cargo” e filial operacional do administrador

**Decisão de interface:** trocar o rótulo “Papel” por **Cargo**, inclusive na listagem de usuários.

**Administrador:** esconder a escolha de filial no cadastro e representar o acesso sem vínculo fixo. Ao operar, o admin seleciona uma filial específica dentre as permitidas no seu tenant. Sua visão administrativa continua abrangendo todas elas.

**Demais cargos:** filial obrigatória. O campo inicia visualmente em branco; ao abrir, oferece apenas as filiais. Não existe opção selecionável “Sem filial”. Uma filial vazia impede salvar; a regra também precisa valer na criação/edição no servidor.

**Impacto:** `components/UsuariosCadastro.tsx`, `data/usuarios.ts`, `functions/criar-usuario/index.ts` e proteção de edição do perfil. Selecionar admin deve impedir envio de uma filial antiga escondida no formulário. Ao mudar de admin para caixa/gerente, exigir escolha válida antes de salvar.

“Cargo” é o rótulo de produto. Não é necessário renomear a coluna interna `papel` nem literais usados em RLS, autenticação ou assinaturas para obter essa interface.

**Esta decisão reabre E10.2+:** hoje as três telas de escrita dependem de `profile.lojaId`. Apenas esconder a filial do administrador no cadastro o impediria de operar. Implementar a seleção operacional e ligar cadastro de entrega, transferência e saída ao contexto escolhido faz parte do mesmo resultado.

A filial selecionada deve ficar explícita na operação e ser congelada ao criar/enfileirar seu conteúdo. Trocar de filial depois não pode mudar itens existentes da fila. Seleção por usuário, limpeza na troca de conta e validação de tenant/competência no servidor são necessárias. O E10.1 já implementado deve ser preservado.

## Sequência revisada

1. Retirar a escolha de dois vales, adicional, convênio específico e pagamento “Outro”, com transição coordenada dos contratos persistidos.
2. Entregar “Cargo”, cadastro de filial obrigatório para não administradores e seleção operacional completa para admin. E10 deixa de estar integralmente adiado.
3. Manter o snapshot histórico da filial e a proteção dos documentos existentes.
4. Concluir o contrato de assinaturas/envelope para saber quais evidências sustentam retirada e retorno na conciliação.
5. Construir fechamento diário calculado, exceções, observações e aprovação auditável sobre dados completos.
6. Construir o painel da agência com acesso restrito, cobrança discriminada e submissão auditável; ligar essa cobrança à conciliação do fechamento, definindo competência e regras de cobrança.
7. Executar o corte/reset coordenado e o aceite completo, incluindo operações offline tardias, troca de filial e revisão do fechamento.

Os passos 5 e 6 são duas frentes de produto ligadas entre si. O fechamento pode organizar as exceções operacionais antes de o painel existir, mas não pode se anunciar como conciliado com a agência antes de receber e comparar a cobrança dela. O painel amplia usuários, permissões, dados e fluxo de aprovação; não é um item adicional de limpeza de código.

**Revisões da auditoria anterior:** a manutenção de `farmacia_paga_entrega_integral`, da tela de convênios e do adiamento de E10.2+ foi superada pelas novas decisões. A tela atual de fechamento deixa de ser apenas candidata a organização: seu fluxo será substituído. Migrations históricas, canônicos existentes e isolamento de dados continuam protegidos.
