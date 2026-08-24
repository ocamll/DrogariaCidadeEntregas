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
// ---------------------------------------------------------------------

export type EstadoNome =
  | 'documento_congelado'
  | 'aguardando_cartao'
  | 'aguardando_pin'
  | 'custodia_autorizada'
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
  /** Offline. Sela PIN, token, operationId, documentHash e tipo. */
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
  /** Offline: o PIN foi selado. NÃO foi conferido por ninguém. */
  | { tipo: 'PIN_SELADO'; envelope: unknown }
  | { tipo: 'PIN_RECUSADO' }
  | { tipo: 'ASSINOU_RESPONSAVEL'; strokes: unknown }
  | { tipo: 'ASSINOU_MOTOBOY'; strokes: unknown }
  | { tipo: 'CONCLUIR'; online: boolean }
  | { tipo: 'SELADO' }
  | { tipo: 'ENFILEIRADO' }
  | { tipo: 'CONFLITO'; detalhe: unknown }
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
    envelope: null,
    responsavelStrokes: null,
    motoboyStrokes: null,
    motivoDoRecolhimento: null,
    detalhe: null,
  }
}

/**
 * Recolhe TODA a custódia — as três evidências mais a autorização.
 *
 * Um lugar só, e é isso que impede o esquecimento: todo caminho de
 * invalidação passa por aqui, então acrescentar uma evidência nova ao
 * estado obriga a acrescentá-la aqui também.
 */
function recolher(estado: EstadoCustodia, nome: EstadoNome, motivo: string): EstadoCustodia {
  return {
    ...estado,
    nome,
    credencial: null,
    autorizacaoId: null,
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
      // Não recolhe: ainda não há assinatura nenhuma, e o caixa vai
      // tentar o PIN de novo. Recolher aqui só apagaria a leitura do
      // cartão, que continua válida.
      return { ...estado, nome: 'pin_recusado' }
    case 'ERRO_REDE':
      // A operação foi pra fila. Não é falha do usuário e não recolhe.
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
        return {
          ...estado,
          nome: 'custodia_autorizada',
          autorizacaoId: carimbar(estado, evento.autorizacaoId),
          credencial: estado.credencial
            ? carimbar(estado, { ...estado.credencial.valor, validadaPeloServidor: true })
            : null,
        }
      }
      if (evento.tipo === 'PIN_SELADO') {
        // Offline. `validadaPeloServidor` continua FALSE — o PIN foi
        // guardado, não conferido, e a tela precisa dizer isso.
        return { ...estado, nome: 'custodia_autorizada', envelope: carimbar(estado, evento.envelope) }
      }
      return estado

    case 'custodia_autorizada':
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
        return { ...estado, nome: evento.online ? 'selando' : 'enfileirando' }
      }
      return estado

    case 'selando':
      if (evento.tipo === 'SELADO') return { ...estado, nome: 'selado' }
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
    ['envelope', estado.envelope],
    ['responsavelStrokes', estado.responsavelStrokes],
    ['motoboyStrokes', estado.motoboyStrokes],
  ]
  return suspeitas
    .filter(([, e]) => e !== null && e.paraDocumento !== atual)
    .map(([nome]) => nome)
}
