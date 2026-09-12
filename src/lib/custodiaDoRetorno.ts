// A MÁQUINA DE CUSTÓDIA do Romaneio de Retorno.
//
// Redutor PURO, sem React. O único import é um TIPO, de um arquivo que
// também não importa nada. O visual vem depois e por cima: o primeiro gate
// desta etapa não é "ficou bonito", é percorrer a máquina inteira com
// dublês sem que exista uma transição capaz de reaproveitar evidência de
// um documento anterior.
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
// SEM ASSINATURA MANUSCRITA — 4B, 2026-09-12
//
// Até aqui a máquina colhia dois traços depois do PIN. Eles saíram, pela
// decisão de 2026-09-11 ("apenas cartão e PIN"), e a saída já roda assim
// desde a mesma data. O que sobra são duas evidências e um ato:
//
//     cartão     identificação   de quem é o cartão
//     PIN        autenticação    é mesmo essa pessoa
//     CONCLUIR   confirmação     a farmácia confirma ESTE conteúdo
//
// O terceiro não é evidência guardada no estado: é o próprio clique em
// "Confirmar retorno", e estar logado não conta como manifestação. Por
// isso não existe mais `assinando_*` nem `pronto_para_concluir` — da
// autenticação se vai direto ao CONCLUIR.
//
// ---------------------------------------------------------------------
// A EXCEÇÃO DO GERENTE
//
// Quando o motoboy perdeu o cartão ou esqueceu o PIN, o gerente da filial
// apresenta o cartão DELE e digita o PIN DELE. No retorno o motoboy NÃO é
// escolhido: ele vem da saída, e o documento o nomeia. Então:
//
//     credencial.titular = 'gerente'   quem autentica
//     motoboyId                        continua o do documento
//     motivoExcecao                    obrigatório, e CARIMBADO
//
// O motivo é evidência como as outras — entra na autorização do servidor
// e no hash do evento offline —, e por isso só pode ser escolhido ANTES da
// autenticação. Autenticar um cartão de gerente sem motivo é uma transição
// que não existe: a máquina ignora o evento.
//
// ---------------------------------------------------------------------
// COMO A STALENESS FICA DETECTÁVEL EM VEZ DE CONFIADA
//
// Toda evidência é guardada CARIMBADA com o `documentHash` sob o qual foi
// colhida:
//
//     { paraDocumento: '<hash>', valor: ... }
//
// Assim "esta autenticação é deste documento?" vira uma comparação, e não
// uma confiança em que todo caminho de invalidação lembrou de limpar.
// `evidenciaDeOutroDocumento()` é a invariante, e o spec a checa depois
// de CADA transição.
//
// É o mesmo truque do carimbo em `useSituacaoDaOperacao` (§62), onde ler
// a fila inteira e procurar o item concluía "sincronizada" por um
// instante. Carimbar transforma "ainda não sei" numa resposta possível.
//
// ---------------------------------------------------------------------
// POR QUE O ENVELOPE AINDA NASCE SÓ NO CONCLUIR
//
// Em 2026-08-21 a razão era os traços: o `offlineEventHash` os amarrava,
// e no instante do PIN eles não existiam. Os traços saíram, e a razão
// continua de pé por outro caminho:
//
//     OEV2 | documentHash | romaneioId | retorno | validacao | motivo |
//            motoboyId | ocorridoEmLocal
//
// `ocorridoEmLocal` é o relógio do balcão NO ATO de confirmar, e só existe
// quando a farmácia confirma. Então a ordem continua sendo:
//
//     PIN + token capturados → confirmação → offlineEventHash → envelope
//     → fila
//
// Daí saem as quatro regras abaixo, que são o contrato de hoje.
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
// REGRA 3 — O ADIAMENTO É SÓ DO OFFLINE, E A EVIDÊNCIA ESCOLHE A PORTA
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
//                 confirmação da farmácia
//
// Online não há motivo pra segurar o PIN: quem prova a presença é a
// autorização de uso único, já emitida e amarrada ao hash. Por isso o
// caminho online **não produz envelope** — e o `CONCLUIR` é um tipo
// discriminado, com o envelope existindo só no ramo offline.
//
// E desde o 4B a MÁQUINA recusa a combinação errada, em vez de confiar
// na tela: `CONCLUIR online` só sai de `custodia_autorizada`, e
// `CONCLUIR offline` só de `segredos_capturados`. Um PIN capturado sem
// rede continua sendo "não conferido" mesmo que a internet volte antes do
// clique — ele sobe pela fila e é conferido lá, com o método que diz isso.
//
// Se o selo online falhar por REDE, não há envelope pra mandar pra fila —
// e a política disso é a regra 4.
//
// ---------------------------------------------------------------------
// REGRA 4 — FALHA DE REDE NO SELO ONLINE NÃO VIRA OFFLINE
//
// Congelada em 2026-08-21. O momento é este:
//
//     documento congelado      ✓
//     autorização              talvez consumida, talvez vencida
//     PIN e token              ✗ apagados na autenticação (regra 3)
//     envelope                 ✗ nunca existiu neste ramo
//     servidor selou           ✗ (ou selou e a resposta se perdeu)
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
//       identificação            e destrói a custódia:
//     documento NOVO               autorização    descarta
//                                  identificação  descarta
//                                  PIN/token      já não existem
//
// Ou seja: o caixa **não** refaz a conferência do retorno, nem gera
// `pagamentoId`/`romaneioId`/`documentHash` novos. Ele apresenta o cartão
// e o PIN de novo, sobre o MESMO documento, e confirma de novo.
//
// Por que não repetir o selo com a autorização antiga: ela é de uso único
// e vale dois minutos, e a tela não sabe se o servidor a consumiu antes de
// a rede cair. Reapresentar custa um cartão e seis dígitos; adivinhar o
// estado do servidor custa um "tentar de novo" que às vezes funciona e às
// vezes recusa sem explicação. Se o selo tinha acontecido, o reenvio com o
// mesmo `romaneioId` volta `ja_existia` — nada duplica.
//
// Por isso o estado é PRÓPRIO (`falha_selo_online`) e não o `erro_rede`
// genérico: a ação certa é específica, e a tela precisa dizê-la.
// ---------------------------------------------------------------------

import type { MotivoExcecao } from './excecaoDoGerente'

export type EstadoNome =
  | 'documento_congelado'
  | 'aguardando_cartao'
  | 'aguardando_pin'
  /** ONLINE: o servidor conferiu o PIN e emitiu autorização. */
  | 'custodia_autorizada'
  /** OFFLINE: o PIN foi capturado. NINGUÉM o conferiu, e a tela diz isso. */
  | 'segredos_capturados'
  | 'selando'
  | 'enfileirando'
  | 'selado'
  | 'aguardando_validacao'
  // Terminais de falha, cada um pedindo uma ação diferente.
  | 'cartao_recusado'
  | 'pin_recusado'
  | 'autorizacao_expirada'
  /**
   * O selo ONLINE não completou por REDE. Preserva o documento e descarta
   * a custódia — ver a regra 4.
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

/** De quem é o cartão que foi lido. */
export type TitularDoCartao = 'motoboy' | 'gerente'

export type EstadoCustodia = {
  nome: EstadoNome
  documento: DocumentoCongelado
  /**
   * Quem o documento nomeia — SEMPRE o motoboy da saída, também na
   * exceção. O cartão do gerente nunca vira o responsável pelos vales.
   */
  motoboyId: string | null
  /** Online: identificado E validado. Offline: apenas informado. */
  credencial: Carimbada<{
    publicId: string
    validadaPeloServidor: boolean
    titular: TitularDoCartao
  }> | null
  /**
   * Só na exceção, e só antes de autenticar. Entra na autorização do
   * servidor e no hash do evento offline, por isso é carimbado e cai junto
   * com o resto da custódia.
   */
  motivoExcecao: Carimbada<MotivoExcecao> | null
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
   * Sela PIN, token, operationId, documentHash, tipo, validação e motivo.
   *
   * Só existe no ramo OFFLINE, e só a partir do `CONCLUIR`: o
   * `offlineEventHash` que vai dentro dele carrega o relógio do ato de
   * confirmar, que antes disso não existe.
   */
  envelope: Carimbada<unknown> | null
  /** Por que a custódia foi recolhida, quando foi. A tela precisa dizer. */
  motivoDoRecolhimento: string | null
  /**
   * O QUE A TELA MOSTRA sobre a última tentativa, e de que NATUREZA ela
   * foi. As duas juntas, porque separá-las foi o defeito original.
   *
   * Existe desde o E2.3 (lote D) porque antes ele NÃO existia, e o
   * motivo acabava num `erro: string | null` paralelo ao lado da
   * máquina. Duas fontes pro mesmo fato: a máquina dizia
   * `cartao_recusado` e a string dizia por quê, e nada garantia que as
   * duas estivessem falando do mesmo evento — o `catch` dos handlers,
   * por exemplo, escrevia a string e NÃO despachava nada, então a
   * máquina ficava em `aguardando_cartao` com um texto de erro no ar.
   *
   * Distinto de `motivoDoRecolhimento`: aquele explica por que a
   * custódia foi DESFEITA (e `pin_recusado` não desfaz nada — o cartão
   * lido continua válido).
   *
   * `tipo` existe porque UMA CONSULTA QUE FALHA NÃO MOVE CUSTÓDIA. Uma
   * recusa é um veredito e muda o estado (`cartao_recusado`); uma falha
   * de rede na consulta não descobriu nada, então a máquina fica onde
   * está e só ganha o que dizer.
   */
  mensagem: { texto: string; tipo: 'recusa' | 'falha' } | null
  /** Resultado do conflito, pra tela mostrar o número do romaneio. */
  detalhe: unknown
}

export type EventoCustodia =
  | { tipo: 'INICIAR' }
  /**
   * `motoboyId` é o do DOCUMENTO nos dois casos. Com o cartão do motoboy,
   * a tela já conferiu que ele é o da corrida; com o do gerente, ela passa
   * o motoboy da saída — ninguém escolhe.
   */
  | { tipo: 'CARTAO_LIDO'; publicId: string; motoboyId: string; titular: TitularDoCartao }
  | { tipo: 'CARTAO_RECUSADO'; mensagem: string }
  /** Só vale com cartão de gerente, e só antes de autenticar. */
  | { tipo: 'MOTIVO_ESCOLHIDO'; motivo: MotivoExcecao }
  /** Online: o servidor confirmou o PIN e emitiu a autorização. */
  | { tipo: 'PIN_AUTORIZADO'; autorizacaoId: string }
  /**
   * Offline: PIN e token foram CAPTURADOS — não selados, não conferidos.
   * O evento não carrega o material: ele só avisa que ele existe, e a
   * tela é quem o guarda em memória efêmera.
   */
  | { tipo: 'SEGREDOS_CAPTURADOS' }
  | { tipo: 'PIN_RECUSADO'; mensagem: string }
  /**
   * A CONFIRMAÇÃO DA FARMÁCIA. O envelope entra aqui, e só no ramo
   * offline — é aqui que ele passa a ser construível, e é aqui que o
   * material em claro deixa de precisar existir.
   */
  | { tipo: 'CONCLUIR'; online: true }
  | { tipo: 'CONCLUIR'; online: false; envelope: unknown }
  | { tipo: 'SELADO' }
  | { tipo: 'ENFILEIRADO' }
  /**
   * A CONSULTA falhou — cartão ou PIN. NÃO muda `nome`: nada foi
   * descoberto, então a custódia continua exatamente onde estava e o
   * próximo passo é o mesmo de antes (bipar de novo, digitar de novo).
   */
  | { tipo: 'FALHA_NA_CONSULTA'; mensagem: string }
  | { tipo: 'CONFLITO'; detalhe: unknown }
  /**
   * O selo ONLINE não completou por REDE — não por recusa do servidor.
   * Vale só a partir de `selando`, e é a regra 4.
   */
  | { tipo: 'FALHA_DE_REDE_NO_SELO' }
  | { tipo: 'ERRO_REDE'; mensagem: string }
  | { tipo: 'AUTORIZACAO_EXPIROU' }
  /**
   * Outro cartão vai ser apresentado — o do gerente no lugar do motoboy,
   * ou o contrário. Recolhe tudo. No retorno o MOTOBOY não muda: quem
   * devolve a corrida é quem a levou.
   */
  | { tipo: 'TROCAR_CARTAO' }
  /** Voltar a editar, ou desistir. Recolhe tudo. */
  | { tipo: 'CANCELAR' }

export function custodiaInicial(documento: DocumentoCongelado): EstadoCustodia {
  return {
    nome: 'documento_congelado',
    documento,
    motoboyId: null,
    credencial: null,
    motivoExcecao: null,
    autorizacaoId: null,
    segredosCapturados: null,
    envelope: null,
    motivoDoRecolhimento: null,
    mensagem: null,
    detalhe: null,
  }
}

/**
 * Recolhe TODA a custódia — identificação, motivo, autorização, o sinal
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
    motivoExcecao: null,
    autorizacaoId: null,
    segredosCapturados: null,
    envelope: null,
    motivoDoRecolhimento: motivo,
  }
}

const carimbar = <T,>(estado: EstadoCustodia, valor: T): Carimbada<T> => ({
  paraDocumento: estado.documento.documentHash,
  valor,
})

/**
 * DÁ PRA AUTENTICAR AQUI? Só com um cartão lido — e, se ele for de
 * gerente, com o motivo escolhido.
 *
 * A primeira metade parece redundante e não é: `PIN_RECUSADO` vale de
 * qualquer estado, então `pin_recusado` é alcançável sem cartão nenhum, e
 * de lá um `PIN_AUTORIZADO` terminava autorizado sem credencial. A
 * varredura do spec achou isso em 2026-09-12, com a invariante "todo
 * estado autenticado tem validação a declarar".
 */
function naoPodeAutenticar(estado: EstadoCustodia): boolean {
  if (estado.credencial === null) return true
  return estado.credencial.valor.titular === 'gerente' && estado.motivoExcecao === null
}

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
        'a conferência foi cancelada — a identificação não vale para outro documento'
      )
    case 'TROCAR_CARTAO':
      return recolher(
        { ...estado, motoboyId: null },
        'aguardando_cartao',
        'outro cartão vai ser apresentado — a identificação e o PIN eram do cartão anterior'
      )
    case 'AUTORIZACAO_EXPIROU':
      // A autorização é a prova de que aquela pessoa estava ali NAQUELE
      // momento. Expirada, uma nova autenticação prova que ela está aqui
      // AGORA, e o documento passaria a juntar evidências de duas janelas
      // de presença diferentes sem dizer isso em lugar nenhum.
      //
      // E o recolhimento é EXPLICADO, nunca silencioso — daí
      // `motivoDoRecolhimento`.
      return recolher(
        estado,
        'autorizacao_expirada',
        'a autenticação venceu antes de o retorno ser confirmado — cartão e PIN precisam ser ' +
          'apresentados de novo, para o documento não juntar evidências de dois momentos diferentes'
      )
    // A CONSULTA FALHOU, E ISSO NÃO MOVE A MÁQUINA.
    //
    // A primeira versão do lote D mandava a falha do cartão pra
    // `ERRO_REDE`, que é do passo de CONCLUIR. `erro_rede` não aceita
    // `CARTAO_LIDO`, então o caixa ficava sem conseguir bipar de novo —
    // beco sem saída, achado medindo a tela.
    case 'FALHA_NA_CONSULTA':
      return { ...estado, mensagem: { texto: evento.mensagem, tipo: 'falha' } }

    case 'CARTAO_RECUSADO':
      return { ...estado, nome: 'cartao_recusado', mensagem: { texto: evento.mensagem, tipo: 'recusa' } }
    case 'PIN_RECUSADO':
      // Não recolhe TUDO: o caixa vai tentar o PIN de novo, e o cartão lido
      // (e o motivo, na exceção) continuam válidos.
      //
      // Mas o material em claro SAI. Um PIN recusado é um PIN errado, e
      // não há razão pra ele continuar em memória enquanto o certo é
      // digitado por cima.
      return {
        ...estado,
        nome: 'pin_recusado',
        segredosCapturados: null,
        mensagem: { texto: evento.mensagem, tipo: 'recusa' },
      }
    case 'ERRO_REDE':
      // A operação não completou. Offline ela foi pra fila; online não
      // há envelope pra mandar, e a saída é refazer a autenticação —
      // nunca inventar um envelope sem PIN. Não recolhe.
      return { ...estado, nome: 'erro_rede', mensagem: { texto: evento.mensagem, tipo: 'falha' } }
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
    // autenticar outra vez — ver a regra 4.
    case 'falha_selo_online':
      if (evento.tipo === 'CARTAO_LIDO') {
        return {
          ...estado,
          nome: 'aguardando_pin',
          motoboyId: evento.motoboyId,
          // `validadaPeloServidor` fica FALSE aqui: neste ponto o cartão
          // foi apenas lido. Quem o valida é o servidor, junto do PIN —
          // e offline ninguém valida.
          credencial: carimbar(estado, {
            publicId: evento.publicId,
            validadaPeloServidor: false,
            titular: evento.titular,
          }),
          // UM CARTÃO NOVO É UMA IDENTIFICAÇÃO NOVA. Nada do cartão
          // anterior sobrevive à leitura deste — nem autorização, nem PIN
          // capturado, nem o motivo de uma exceção que talvez nem exista
          // mais.
          motivoExcecao: null,
          autorizacaoId: null,
          segredosCapturados: null,
          envelope: null,
          motivoDoRecolhimento: null,
          // Um passo bem-sucedido apaga o que o anterior disse.
          mensagem: null,
        }
      }
      return estado

    case 'aguardando_pin':
    case 'pin_recusado':
      if (evento.tipo === 'MOTIVO_ESCOLHIDO') {
        // Com o cartão do motoboy não há exceção a registrar — o servidor
        // recusaria `motivo_sem_excecao`, e a máquina nem aceita.
        if (estado.credencial?.valor.titular !== 'gerente') return estado
        return { ...estado, motivoExcecao: carimbar(estado, evento.motivo) }
      }
      if (evento.tipo === 'PIN_AUTORIZADO') {
        if (naoPodeAutenticar(estado)) return estado
        // ONLINE. A autorização já prova a presença, então o PIN não
        // precisa sobreviver a este instante.
        //
        // O `segredosCapturados: null` NÃO é decorativo, e a varredura
        // do caso (10) provou isso em 2026-08-21: dá pra chegar aqui
        // vindo do offline — capturar o PIN sem rede, a rede voltar,
        // `PIN_RECUSADO` passar no meio, e autenticar online.
        return {
          ...estado,
          nome: 'custodia_autorizada',
          autorizacaoId: carimbar(estado, evento.autorizacaoId),
          segredosCapturados: null,
          mensagem: null,
          credencial: estado.credencial
            ? carimbar(estado, { ...estado.credencial.valor, validadaPeloServidor: true })
            : null,
        }
      }
      if (evento.tipo === 'SEGREDOS_CAPTURADOS') {
        if (naoPodeAutenticar(estado)) return estado
        // OFFLINE. `validadaPeloServidor` continua FALSE — o PIN foi
        // capturado, não conferido, e a tela precisa dizer isso.
        //
        // E a autorização cai pelo espelho do caso acima: uma emitida
        // antes é de outra janela de presença. Os dois ramos são
        // exclusivos.
        return {
          ...estado,
          nome: 'segredos_capturados',
          autorizacaoId: null,
          segredosCapturados: carimbar(estado, true),
          mensagem: null,
        }
      }
      return estado

    case 'custodia_autorizada':
      // A confirmação ONLINE. O CTA trava aqui: sair deste estado é o que
      // impede duas tentativas.
      if (evento.tipo === 'CONCLUIR' && evento.online) return { ...estado, nome: 'selando' }
      return estado

    case 'segredos_capturados':
      if (evento.tipo === 'CONCLUIR' && !evento.online) {
        // OFFLINE. O envelope acabou de nascer — e por isso o material em
        // claro deixa de ser necessário aqui: `segredosCapturados` volta a
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
        // A custódia, sim, cai inteira. `motoboyId` vai junto porque nada
        // nesta máquina pode afirmar uma identidade que ainda não foi
        // reestabelecida.
        return recolher(
          { ...estado, motoboyId: null },
          'falha_selo_online',
          'a rede caiu antes de o servidor selar — o que você conferiu está preservado, mas ' +
            'o cartão e o PIN precisam ser apresentados de novo, porque não dá pra saber se a ' +
            'autorização anterior chegou a ser usada'
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
 *   - online nunca é verdadeiro, então o PIN some assim que a
 *     autorização é emitida;
 *   - qualquer caminho de invalidação passa por `recolher()`, que zera o
 *     sinal — cancelar, editar, trocar o cartão, autorização vencida;
 *   - offline, concluir sela o envelope e zera o sinal no mesmo passo.
 */
export function podeGuardarSegredos(estado: EstadoCustodia): boolean {
  return estado.segredosCapturados !== null
}

/**
 * QUEM VALIDOU, e por quê — lido da custódia, nunca de estado paralelo da
 * tela. É o que vai para o hash do evento offline, para o envelope e para
 * o corpo da fila.
 *
 * `null` enquanto não há cartão, ou quando o cartão é de gerente e o
 * motivo ainda não foi escolhido: uma exceção sem motivo não é validação
 * nenhuma.
 */
export function validacaoDaCustodia(
  estado: EstadoCustodia
): { validacao: TitularDoCartao; motivoExcecao: MotivoExcecao | null } | null {
  const titular = estado.credencial?.valor.titular
  if (!titular) return null
  if (titular === 'motoboy') return { validacao: 'motoboy', motivoExcecao: null }
  if (!estado.motivoExcecao) return null
  return { validacao: 'gerente', motivoExcecao: estado.motivoExcecao.valor }
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
    ['motivoExcecao', estado.motivoExcecao],
    ['autorizacaoId', estado.autorizacaoId],
    ['segredosCapturados', estado.segredosCapturados],
    ['envelope', estado.envelope],
  ]
  return suspeitas
    .filter(([, e]) => e !== null && e.paraDocumento !== atual)
    .map(([nome]) => nome)
}
