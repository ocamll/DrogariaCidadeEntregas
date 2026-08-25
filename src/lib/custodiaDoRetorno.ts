// A MÁQUINA DE CUSTÓDIA do Romaneio de Retorno.
//
// Redutor PURO, sem React e sem imports. O visual vem depois e por cima:
// o primeiro gate desta etapa não é "ficou bonito", é percorrer a máquina
// inteira com dublês sem que exista uma transição capaz de reaproveitar
// evidência de um documento anterior.
//
// ---------------------------------------------------------------------
// ELA NÃO MONTA NADA, E NÃO DECIDE NADA
//
// Começa em `documento_congelado` e RECEBE o pacote pronto —
// `romaneioId`, `documentHash`, jsonb e ids finais. Não monta o retorno,
// não altera fato nenhum, e não decide status de entrega, financeiro ou
// documental. Ela COLETA CUSTÓDIA e entrega às portas já provadas de
// 2B/2C.
//
// ---------------------------------------------------------------------
// AS TRÊS EVIDÊNCIAS SÃO COISAS DIFERENTES
//
//     cartão   identificação   quem é
//     PIN      autenticação    é ele mesmo
//     traços   manifestação    ele concorda com ISTO
//
// A última é a que exige o cuidado desta máquina inteira: uma assinatura
// manuscrita é manifestação sobre um CONTEÚDO ESPECÍFICO. Reaproveitá-la
// sobre outro documento é falsificar consentimento.
//
// ---------------------------------------------------------------------
// COMO A STALENESS FICA DETECTÁVEL EM VEZ DE CONFIADA
//
// Toda evidência é guardada CARIMBADA com o `documentHash` sob o qual foi
// colhida:
//
//     { paraDocumento: '<hash>', valor: ... }
//
// Assim "esta assinatura é deste documento?" vira uma comparação, e não
// uma confiança em que todo caminho de invalidação lembrou de limpar.
// `evidenciaDeOutroDocumento()` é a invariante, e o spec a checa depois
// de CADA transição.
//
// É o mesmo truque do carimbo em `useSituacaoDaOperacao` (§62), onde ler
// a fila inteira e procurar o item concluía "sincronizada" por um
// instante. Carimbar transforma "ainda não sei" numa resposta possível.
//
// ---------------------------------------------------------------------
// O QUE MUDOU EM 2026-08-21, MONTANDO O COMPONENTE
//
// A primeira integração com a tela achou uma IMPOSSIBILIDADE no desenho
// anterior, e ela não era de código: era do contrato.
//
//     offlineEventHash = documentHash
//                      + responsavelStrokes
//                      + motoboyStrokes
//                      + ocorridoEmLocal + geolocalização
//
// O envelope carrega esse hash dentro dele, e a Edge Function o
// RECALCULA a partir do corpo pra decidir entre selar e recusar
// `payload_alterado`. Ou seja: no instante em que o PIN é digitado, os
// dois traços ainda não existem, logo **o envelope não é construível
// ali**. A versão anterior desta máquina pedia, no evento do PIN, um
// artefato que só nasce duas transições depois.
//
// A ordem verdadeira é esta, e só ela:
//
//     PIN + token capturados
//           ↓
//     assinatura do responsável
//           ↓
//     assinatura do motoboy
//           ↓
//     offlineEventHash
//           ↓
//     envelope
//           ↓
//     fila
//
// Daí saem as três regras abaixo, que são o contrato de hoje.
//
// ---------------------------------------------------------------------
// REGRA 1 — "SELADO" É PALAVRA RESERVADA
//
// O evento offline chama-se `SEGREDOS_CAPTURADOS`, e não `PIN_SELADO`.
// Enquanto existe PIN em claro e não existe envelope, nada foi selado —
// e este projeto já pagou caro por vocabulário que afirma mais do que
// aconteceu (`tipo_signatario = 'caixa'` para quem podia ser gerente;
// "credencial validada" para o que só tinha sido informada). Selar é o
// que acontece em `selarSegredos()`, com RSA e AES, e o nome fica
// reservado para lá.
//
// ---------------------------------------------------------------------
// REGRA 2 — O PIN E O TOKEN NÃO ENTRAM NESTE ESTADO
//
// A máquina guarda um SINAL carimbado (`segredosCapturados`), nunca o
// material. Objeto de estado acaba em log, em snapshot de teste, em
// telemetria e em persistência acidental; PIN em claro não pode estar em
// nenhum desses lugares.
//
// O material vive só em memória efêmera do componente — uma ref
// dedicada, nunca Dexie, nunca localStorage, nunca payload da fila,
// nunca evento de auditoria. E a permissão pra ele existir é DERIVADA
// daqui: `podeGuardarSegredos(estado)`. Falso, a ref se apaga.
//
// Recarregar a página antes de concluir perde os segredos e obriga a
// refazer o PIN. É melhor que persistir texto claro pra permitir
// retomada.
//
// ---------------------------------------------------------------------
// REGRA 3 — O ADIAMENTO É SÓ DO OFFLINE
//
//                    PIN fornecido
//                          ↓
//                  ┌───────┴────────┐
//               ONLINE            OFFLINE
//                  ↓                 ↓
//         servidor autentica    guarda o segredo
//                  ↓            efêmero
//         autorização amarrada       ↓
//         ao documentHash            ↓
//                  ↓                 ↓
//         PIN SAI DA MEMÓRIA         ↓
//                  └────────┬────────┘
//                           ↓
//                      assinaturas
//
// Online não há motivo pra segurar o PIN: quem prova a presença é a
// autorização de uso único, já emitida e amarrada ao hash. Por isso o
// caminho online **não produz envelope** — e o `CONCLUIR` é um tipo
// discriminado, com o envelope existindo só no ramo offline. Assim
// "online com envelope" deixa de ser um estado que dá pra escrever.
//
// Se o selo online falhar por REDE depois das duas assinaturas, não há
// envelope pra mandar pra fila — e a política disso é a regra 4.
//
// ---------------------------------------------------------------------
// REGRA 4 — FALHA DE REDE NO SELO ONLINE NÃO VIRA OFFLINE
//
// Congelada em 2026-08-21. O momento é este:
//
//     documento congelado      ✓
//     duas assinaturas         ✓
//     autorização              provavelmente já inútil
//     PIN e token              ✗ apagados na autenticação (regra 3)
//     envelope                 ✗ nunca existiu neste ramo
//     servidor selou           ✗
//
// Fabricar um envelope agora é impossível — faltam os segredos. E mesmo
// que fosse possível, "recuperar" assim incentivaria guardar o PIN além
// do necessário, desfazendo a regra 3. Então a operação NÃO cai na fila.
//
// A política separa duas coisas que parecem a mesma:
//
//     EDIÇÃO DO DOCUMENTO        FALHA DE REDE NO SELO
//     destrói tudo               preserva o documento
//       romaneioId                 romaneioId     preserva
//       pagamentoIds               pagamentoIds   preserva
//       documentHash               retornoJsonb   preserva
//       autorização                documentHash   preserva
//       assinaturas              e destrói a custódia:
//     documento NOVO               autorização    descarta
//                                  assinaturas    descarta
//                                  PIN/token      já não existem
//
// Ou seja: o caixa **não** refaz a conferência do retorno, nem gera
// `pagamentoId`/`romaneioId`/`documentHash` novos. Ele refaz cartão +
// PIN e as duas assinaturas, sobre o MESMO documento.
//
// **E as assinaturas são descartadas de propósito**, embora o conteúdo
// não tenha mudado. O que este sistema afirma é uma SEQUÊNCIA:
//
//     autenticação → manifestação sobre o documento
//
// Conservar os traços e autenticar de novo por cima inverteria a ordem —
// uma autenticação nova associada a uma manifestação capturada antes
// dela. É a mesma ambiguidade temporal que `AUTORIZACAO_EXPIROU` recusa,
// e que esta frente vem eliminando desde a 2A. Tecnicamente defensável;
// probatoriamente não.
//
// Por isso o estado é PRÓPRIO (`falha_selo_online`) e não o `erro_rede`
// genérico: a ação certa é específica, e a tela precisa dizê-la —
// "os dados conferidos foram preservados, mas é preciso autenticar o
// motoboy e assinar de novo". **Nunca um botão "tentar novamente"** que
// repita o selo com a autorização e os traços antigos.
// ---------------------------------------------------------------------

export type EstadoNome =
  | 'documento_congelado'
  | 'aguardando_cartao'
  | 'aguardando_pin'
  /** ONLINE: o servidor conferiu o PIN e emitiu autorização. */
  | 'custodia_autorizada'
  /** OFFLINE: o PIN foi capturado. NINGUÉM o conferiu, e a tela diz isso. */
  | 'segredos_capturados'
  | 'assinando_responsavel'
  | 'assinando_motoboy'
  | 'pronto_para_concluir'
  | 'selando'
  | 'enfileirando'
  | 'selado'
  | 'aguardando_validacao'
  // Terminais de falha, cada um pedindo uma ação diferente.
  | 'cartao_recusado'
  | 'pin_recusado'
  | 'autorizacao_expirada'
  /**
   * O selo ONLINE não completou por REDE, depois das duas assinaturas.
   * Preserva o documento e descarta a custódia — ver a política abaixo.
   */
  | 'falha_selo_online'
  | 'erro_rede'
  /** Desfecho PREVISTO, com prova preservada no servidor. Não é erro. */
  | 'conflito'

/** O que o congelamento produziu. A máquina só lê. */
export type DocumentoCongelado = {
  romaneioId: string
  documentHash: string
}

type Carimbada<T> = { paraDocumento: string; valor: T }

export type EstadoCustodia = {
  nome: EstadoNome
  documento: DocumentoCongelado
  /** Quem o documento nomeia. Trocar destrói toda a custódia. */
  motoboyId: string | null
  /** Online: identificado E validado. Offline: apenas informado. */
  credencial: Carimbada<{ publicId: string; validadaPeloServidor: boolean }> | null
  /** Online. Amarrada ao documentHash, de uso único. */
  autorizacaoId: Carimbada<string> | null
  /**
   * SÓ UM SINAL, e carimbado: "há PIN e token capturados sob ESTE
   * documento, em memória efêmera do componente".
   *
   * O material NUNCA passa por aqui — ver a regra 2 no topo. Ele existe
   * apenas no caminho OFFLINE, e apenas entre a captura e a selagem do
   * envelope; online o PIN sai da memória assim que a autorização é
   * emitida.
   */
  segredosCapturados: Carimbada<true> | null
  /**
   * Sela PIN, token, operationId, documentHash e tipo.
   *
   * Só existe no ramo OFFLINE, e só a partir do `CONCLUIR`: o
   * `offlineEventHash` que vai dentro dele amarra os dois traços, que
   * antes disso não existem.
   */
  envelope: Carimbada<unknown> | null
  responsavelStrokes: Carimbada<unknown> | null
  motoboyStrokes: Carimbada<unknown> | null
  /** Por que a custódia foi recolhida, quando foi. A tela precisa dizer. */
  motivoDoRecolhimento: string | null
  /** Resultado do conflito, pra tela mostrar o número do romaneio. */
  detalhe: unknown
}

export type EventoCustodia =
  | { tipo: 'INICIAR' }
  | { tipo: 'CARTAO_LIDO'; publicId: string; motoboyId: string }
  | { tipo: 'CARTAO_RECUSADO' }
  /** Online: o servidor confirmou o PIN e emitiu a autorização. */
  | { tipo: 'PIN_AUTORIZADO'; autorizacaoId: string }
  /**
   * Offline: PIN e token foram CAPTURADOS — não selados, não conferidos.
   * O evento não carrega o material: ele só avisa que ele existe, e a
   * tela é quem o guarda em memória efêmera.
   */
  | { tipo: 'SEGREDOS_CAPTURADOS' }
  | { tipo: 'PIN_RECUSADO' }
  | { tipo: 'ASSINOU_RESPONSAVEL'; strokes: unknown }
  | { tipo: 'ASSINOU_MOTOBOY'; strokes: unknown }
  /**
   * O envelope entra AQUI, e só no ramo offline — é aqui que ele passa a
   * ser construível, e é aqui que o material em claro deixa de precisar
   * existir. Online não há envelope: a prova de presença é a autorização.
   */
  | { tipo: 'CONCLUIR'; online: true }
  | { tipo: 'CONCLUIR'; online: false; envelope: unknown }
  | { tipo: 'SELADO' }
  | { tipo: 'ENFILEIRADO' }
  | { tipo: 'CONFLITO'; detalhe: unknown }
  /**
   * O selo ONLINE não completou por REDE — não por recusa do servidor.
   * Vale só a partir de `selando`, e é a regra 4: preserva o documento,
   * descarta a custódia. Ver `reduzirCustodia`.
   */
  | { tipo: 'FALHA_DE_REDE_NO_SELO' }
  | { tipo: 'ERRO_REDE' }
  | { tipo: 'AUTORIZACAO_EXPIROU' }
  /** O motoboy apresentado não é o mesmo. Recolhe tudo. */
  | { tipo: 'TROCAR_MOTOBOY' }
  /** Voltar a editar, ou desistir. Recolhe tudo. */
  | { tipo: 'CANCELAR' }

export function custodiaInicial(documento: DocumentoCongelado): EstadoCustodia {
  return {
    nome: 'documento_congelado',
    documento,
    motoboyId: null,
    credencial: null,
    autorizacaoId: null,
    segredosCapturados: null,
    envelope: null,
    responsavelStrokes: null,
    motoboyStrokes: null,
    motivoDoRecolhimento: null,
    detalhe: null,
  }
}

/**
 * Recolhe TODA a custódia — as três evidências, a autorização, o sinal
 * dos segredos e o envelope.
 *
 * Um lugar só, e é isso que impede o esquecimento: todo caminho de
 * invalidação passa por aqui, então acrescentar uma evidência nova ao
 * estado obriga a acrescentá-la aqui também.
 *
 * `segredosCapturados` voltando a `null` é também o que manda a tela
 * apagar o PIN e o token da memória — ver `podeGuardarSegredos`.
 */
function recolher(estado: EstadoCustodia, nome: EstadoNome, motivo: string): EstadoCustodia {
  return {
    ...estado,
    nome,
    credencial: null,
    autorizacaoId: null,
    segredosCapturados: null,
    envelope: null,
    responsavelStrokes: null,
    motoboyStrokes: null,
    motivoDoRecolhimento: motivo,
  }
}

const carimbar = <T,>(estado: EstadoCustodia, valor: T): Carimbada<T> => ({
  paraDocumento: estado.documento.documentHash,
  valor,
})

export function reduzirCustodia(
  estado: EstadoCustodia,
  evento: EventoCustodia
): EstadoCustodia {
  // ---- eventos que valem de QUALQUER estado -------------------------
  //
  // Vêm primeiro de propósito: são os de invalidação, e um `switch` por
  // estado que os tratasse caso a caso seria a forma mais provável de
  // esquecer um.
  switch (evento.tipo) {
    case 'CANCELAR':
      return recolher(
        { ...estado, motoboyId: null },
        'documento_congelado',
        'a conferência foi cancelada — os traços não valem para outro documento'
      )
    case 'TROCAR_MOTOBOY':
      return recolher(
        { ...estado, motoboyId: null },
        'aguardando_cartao',
        'o motoboy mudou — cartão, PIN e as duas assinaturas são de quem estava antes'
      )
    case 'AUTORIZACAO_EXPIROU':
      // DECISÃO, e ela não era óbvia: recolhe as DUAS assinaturas.
      //
      // O conteúdo não mudou — o `documentHash` é o mesmo —, então em
      // tese os traços continuariam sendo manifestação sobre o mesmo
      // documento. O que muda é OUTRA coisa: a autorização é a prova de
      // que aquela pessoa estava ali NAQUELE momento. Expirada, uma nova
      // autenticação prova que ela está aqui AGORA, e o documento
      // passaria a juntar evidências de duas janelas de presença
      // diferentes sem dizer isso em lugar nenhum.
      //
      // É a regra que o projeto persegue desde o §39: a tela (e o
      // documento) não afirmam o que não sabem. Custa duas assinaturas;
      // afirmar simultaneidade que não houve custa a cadeia inteira.
      //
      // E o recolhimento é EXPLICADO, nunca silencioso — daí
      // `motivoDoRecolhimento`.
      return recolher(
        estado,
        'autorizacao_expirada',
        'a autenticação venceu antes de concluir — cartão, PIN e as duas ' +
          'assinaturas precisam ser refeitos, para o documento não juntar ' +
          'evidências de dois momentos diferentes'
      )
    case 'CARTAO_RECUSADO':
      return { ...estado, nome: 'cartao_recusado' }
    case 'PIN_RECUSADO':
      // Não recolhe TUDO: ainda não há assinatura nenhuma, e o caixa vai
      // tentar o PIN de novo. Recolher aqui só apagaria a leitura do
      // cartão, que continua válida.
      //
      // Mas o material em claro SAI. Um PIN recusado é um PIN errado, e
      // não há razão pra ele continuar em memória enquanto o certo é
      // digitado por cima.
      return { ...estado, nome: 'pin_recusado', segredosCapturados: null }
    case 'ERRO_REDE':
      // A operação não completou. Offline ela foi pra fila; online não
      // há envelope pra mandar, e a saída é refazer a autenticação —
      // nunca inventar um envelope sem PIN. Não recolhe.
      return { ...estado, nome: 'erro_rede' }
    case 'CONFLITO':
      // TERMINAL desta tentativa, e NÃO um erro retryable: o servidor
      // preservou a prova de propósito. Sugerir "tente de novo" aqui
      // seria o oposto do que se deve fazer.
      return { ...estado, nome: 'conflito', detalhe: evento.detalhe }
  }

  // ---- e os que dependem de onde a máquina está ---------------------
  switch (estado.nome) {
    case 'documento_congelado':
      if (evento.tipo === 'INICIAR') return { ...estado, nome: 'aguardando_cartao' }
      return estado

    case 'aguardando_cartao':
    case 'cartao_recusado':
    // A saída de `falha_selo_online` é UMA só, e é esta: bipar o cartão
    // de novo. Não há caminho daqui pro selo que não passe por
    // autenticar e assinar outra vez — ver a regra 4.
    case 'falha_selo_online':
      if (evento.tipo === 'CARTAO_LIDO') {
        return {
          ...estado,
          nome: 'aguardando_pin',
          motoboyId: evento.motoboyId,
          // `validadaPeloServidor` fica FALSE aqui: neste ponto o cartão
          // foi apenas lido. Quem o valida é o servidor, junto do PIN —
          // e offline ninguém valida. A tela lê este campo pra escolher
          // entre "credencial reconhecida" e "credencial informada".
          credencial: carimbar(estado, { publicId: evento.publicId, validadaPeloServidor: false }),
          motivoDoRecolhimento: null,
        }
      }
      return estado

    case 'aguardando_pin':
    case 'pin_recusado':
      if (evento.tipo === 'PIN_AUTORIZADO') {
        // ONLINE. A autorização já prova a presença, então o PIN não
        // precisa sobreviver a este instante.
        //
        // O `segredosCapturados: null` NÃO é decorativo, e a varredura
        // do caso (10) provou isso em 2026-08-21: dá pra chegar aqui
        // vindo do offline — capturar o PIN sem rede, a rede voltar,
        // `PIN_RECUSADO` passar no meio, e autenticar online. Sem esta
        // linha o estado terminava com autorização emitida E material em
        // claro ainda autorizado a viver na memória da tela, que é
        // exatamente a janela que a regra 3 fecha.
        return {
          ...estado,
          nome: 'custodia_autorizada',
          autorizacaoId: carimbar(estado, evento.autorizacaoId),
          segredosCapturados: null,
          credencial: estado.credencial
            ? carimbar(estado, { ...estado.credencial.valor, validadaPeloServidor: true })
            : null,
        }
      }
      if (evento.tipo === 'SEGREDOS_CAPTURADOS') {
        // OFFLINE. `validadaPeloServidor` continua FALSE — o PIN foi
        // capturado, não conferido, e a tela precisa dizer isso.
        //
        // O nome do estado também: `segredos_capturados` não é
        // `custodia_autorizada`. Ninguém autorizou nada aqui.
        //
        // E a autorização cai pelo espelho do caso acima: uma emitida
        // antes é de outra janela de presença, e mantê-la faria a tela
        // poder concluir pelo caminho online com um PIN que ninguém
        // conferiu. Os dois ramos são exclusivos.
        return {
          ...estado,
          nome: 'segredos_capturados',
          autorizacaoId: null,
          segredosCapturados: carimbar(estado, true),
        }
      }
      return estado

    case 'custodia_autorizada':
    case 'segredos_capturados':
      if (evento.tipo === 'ASSINOU_RESPONSAVEL') {
        return {
          ...estado,
          nome: 'assinando_motoboy',
          responsavelStrokes: carimbar(estado, evento.strokes),
        }
      }
      return estado

    case 'assinando_responsavel':
      if (evento.tipo === 'ASSINOU_RESPONSAVEL') {
        return {
          ...estado,
          nome: 'assinando_motoboy',
          responsavelStrokes: carimbar(estado, evento.strokes),
        }
      }
      return estado

    case 'assinando_motoboy':
      if (evento.tipo === 'ASSINOU_MOTOBOY') {
        return {
          ...estado,
          nome: 'pronto_para_concluir',
          motoboyStrokes: carimbar(estado, evento.strokes),
        }
      }
      return estado

    case 'pronto_para_concluir':
      if (evento.tipo === 'CONCLUIR') {
        // O CTA trava aqui: sair deste estado é o que impede duas
        // tentativas. A idempotência do servidor continua existindo, mas
        // a UI não deve FABRICAR trabalho — dois envelopes e dois
        // `operationId` para a mesma retirada são dois documentos, e um
        // deles vira lixo que alguém precisa entender depois.
        if (evento.online) return { ...estado, nome: 'selando' }
        // OFFLINE. O envelope acabou de nascer, com os dois traços
        // dentro do `offlineEventHash` — e por isso o material em claro
        // deixa de ser necessário aqui: `segredosCapturados` volta a
        // `null`, que é o sinal pra a tela apagar a ref.
        return {
          ...estado,
          nome: 'enfileirando',
          envelope: carimbar(estado, evento.envelope),
          segredosCapturados: null,
        }
      }
      return estado

    case 'selando':
      if (evento.tipo === 'SELADO') return { ...estado, nome: 'selado' }
      if (evento.tipo === 'FALHA_DE_REDE_NO_SELO') {
        // REGRA 4. O documento (que mora em `estado.documento` e no
        // congelado que a tela segura) NÃO é tocado: o conteúdo não
        // mudou, e refazer a conferência inteira seria castigo sem
        // ganho probatório nenhum.
        //
        // A custódia, sim, cai inteira — inclusive as duas assinaturas,
        // que foram colhidas sob uma autenticação que agora vai ser
        // refeita. `motoboyId` vai junto porque nada nesta máquina pode
        // afirmar uma identidade que ainda não foi reestabelecida.
        return recolher(
          { ...estado, motoboyId: null },
          'falha_selo_online',
          'a rede caiu antes de o servidor selar — o que você conferiu está ' +
            'preservado, mas o motoboy precisa ser autenticado e as duas ' +
            'assinaturas colhidas de novo, para o documento não juntar uma ' +
            'autenticação nova com assinaturas de antes dela'
        )
      }
      return estado

    case 'enfileirando':
      if (evento.tipo === 'ENFILEIRADO') return { ...estado, nome: 'aguardando_validacao' }
      return estado

    default:
      return estado
  }
}

/** Estados a partir dos quais nada mais acontece nesta tentativa. */
export function ehTerminal(nome: EstadoNome): boolean {
  return nome === 'selado' || nome === 'aguardando_validacao' || nome === 'conflito'
}

/** O CTA de concluir deve estar travado? */
export function ctaTravado(estado: EstadoCustodia): boolean {
  return (
    estado.nome === 'selando' || estado.nome === 'enfileirando' || ehTerminal(estado.nome)
  )
}

/**
 * A TELA PODE ESTAR SEGURANDO PIN E TOKEN NESTE INSTANTE?
 *
 * Falso, e a ref efêmera do componente tem que ser apagada. É a única
 * autorização que existe pra o material em claro ficar em memória, e ela
 * é DERIVADA da máquina — não uma disciplina que cada caminho da tela
 * precise lembrar.
 *
 * Consequências que caem de graça, e são o motivo de a permissão morar
 * aqui em vez de no componente:
 *
 *   - online nunca é verdadeiro, então o PIN some assim que a
 *     autorização é emitida;
 *   - qualquer caminho de invalidação passa por `recolher()`, que zera o
 *     sinal — cancelar, editar, trocar motoboy, autorização vencida;
 *   - offline, concluir sela o envelope e zera o sinal no mesmo passo.
 */
export function podeGuardarSegredos(estado: EstadoCustodia): boolean {
  return estado.segredosCapturados !== null
}

/**
 * A INVARIANTE: nenhuma evidência pode ser de outro documento.
 *
 * Devolve os nomes das evidências carimbadas com um `documentHash`
 * diferente do atual. Vazio é o único resultado aceitável, e o spec
 * confere isto depois de CADA transição.
 *
 * Ela existe porque "todo caminho de invalidação lembrou de limpar" é
 * uma afirmação sobre código que ninguém consegue verificar lendo. Com o
 * carimbo, vira uma comparação.
 */
export function evidenciaDeOutroDocumento(estado: EstadoCustodia): string[] {
  const atual = estado.documento.documentHash
  const suspeitas: Array<[string, Carimbada<unknown> | null]> = [
    ['credencial', estado.credencial],
    ['autorizacaoId', estado.autorizacaoId],
    ['segredosCapturados', estado.segredosCapturados],
    ['envelope', estado.envelope],
    ['responsavelStrokes', estado.responsavelStrokes],
    ['motoboyStrokes', estado.motoboyStrokes],
  ]
  return suspeitas
    .filter(([, e]) => e !== null && e.paraDocumento !== atual)
    .map(([nome]) => nome)
}
