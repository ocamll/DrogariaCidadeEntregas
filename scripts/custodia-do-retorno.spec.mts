// npx tsx scripts/custodia-do-retorno.spec.mts
//
// O PRIMEIRO GATE DA 2D.3, e ele não é sobre aparência:
//
//     percorrer a máquina inteira sem que exista UMA transição capaz de
//     reaproveitar evidência de um documento anterior.
//
// A invariante é checada depois de CADA transição de CADA caminho, e não
// só nos casos que eu lembrei de escrever — é isso que a torna uma
// afirmação sobre a máquina, e não sobre a minha imaginação.
//
// Desde 2026-08-21 ele guarda uma segunda invariante, que nasceu da
// primeira integração com a tela: **PIN e token em claro só podem estar
// na memória do componente enquanto `podeGuardarSegredos` for
// verdadeiro** — e isso nunca acontece no caminho online.
//
// E desde o 4B (2026-09-12), sem assinatura manuscrita, uma terceira:
// **cartão de gerente nunca autentica sem motivo**, e o motoboy do
// documento não muda por causa do cartão apresentado. Os casos que
// colhiam traços foram reescritos para o que o contrato afirma agora —
// cartão, PIN e o ato de confirmar —, e não afrouxados.

import {
  custodiaInicial,
  reduzirCustodia,
  evidenciaDeOutroDocumento,
  ehTerminal,
  ctaTravado,
  podeGuardarSegredos,
  validacaoDaCustodia,
  type EstadoCustodia,
  type EventoCustodia,
  type EstadoNome,
} from '../src/lib/custodiaDoRetorno.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const DOC = { romaneioId: 'r-1', documentHash: 'a'.repeat(64) }
const OUTRO = { romaneioId: 'r-2', documentHash: 'b'.repeat(64) }

/** Reduz conferindo a invariante a cada passo. */
function correr(inicial: EstadoCustodia, eventos: EventoCustodia[]): EstadoCustodia {
  let estado = inicial
  for (const evento of eventos) {
    estado = reduzirCustodia(estado, evento)
    const sujas = evidenciaDeOutroDocumento(estado)
    if (sujas.length > 0) {
      falhas++
      console.log(
        `FALHA  evidência de outro documento após ${evento.tipo} em ${estado.nome}: ${sujas.join(', ')}`
      )
    }
  }
  return estado
}

const CARTAO_DO_MOTOBOY: EventoCustodia = {
  tipo: 'CARTAO_LIDO', publicId: '777777', motoboyId: 'm-1', titular: 'motoboy',
}
// O motoboyId é o do DOCUMENTO: com o cartão do gerente, a tela passa o
// motoboy da saída.
const CARTAO_DO_GERENTE: EventoCustodia = {
  tipo: 'CARTAO_LIDO', publicId: '888888', motoboyId: 'm-1', titular: 'gerente',
}

const ATE_AUTORIZADO: EventoCustodia[] = [
  { tipo: 'INICIAR' },
  CARTAO_DO_MOTOBOY,
  { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-1' },
]
const ATE_CAPTURADO: EventoCustodia[] = [
  { tipo: 'INICIAR' },
  CARTAO_DO_MOTOBOY,
  { tipo: 'SEGREDOS_CAPTURADOS' },
]
const ATE_GERENTE_AUTORIZADO: EventoCustodia[] = [
  { tipo: 'INICIAR' },
  CARTAO_DO_GERENTE,
  { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'pin_esquecido' },
  { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-g' },
]
const ATE_GERENTE_CAPTURADO: EventoCustodia[] = [
  { tipo: 'INICIAR' },
  CARTAO_DO_GERENTE,
  { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'cartao_perdido' },
  { tipo: 'SEGREDOS_CAPTURADOS' },
]

console.log('\n--- (1) o caminho ONLINE inteiro ---')
{
  const e = correr(custodiaInicial(DOC), [
    ...ATE_AUTORIZADO,
    { tipo: 'CONCLUIR', online: true },
    { tipo: 'SELADO' },
  ])
  checa('termina em selado', e.nome === 'selado')
  checa('autorização carimbada no documento', e.autorizacaoId?.paraDocumento === DOC.documentHash)
  checa('credencial VALIDADA pelo servidor', e.credencial?.valor.validadaPeloServidor === true)
  const v = validacaoDaCustodia(e)
  checa('validado pelo MOTOBOY, sem motivo', v?.validacao === 'motoboy' && v.motivoExcecao === null)
  checa('sem envelope no caminho online', e.envelope === null)
  // A regra 3: online quem prova a presença é a autorização, então o PIN
  // não sobrevive ao instante da autenticação.
  checa(
    'e o PIN NUNCA fica guardado no caminho online',
    e.segredosCapturados === null && podeGuardarSegredos(e) === false
  )
}

console.log('\n--- (1b) online, passo a passo: o PIN some ao autenticar ---')
{
  // Sem este caso, "nunca guarda online" poderia ser verdade só no fim,
  // com uma janela aberta no meio — que é justamente onde o material
  // ficaria vivo.
  let estado = custodiaInicial(DOC)
  let janela = 0
  for (const evento of ATE_AUTORIZADO) {
    estado = reduzirCustodia(estado, evento)
    if (podeGuardarSegredos(estado)) janela++
  }
  checa('chegou a custodia_autorizada', estado.nome === 'custodia_autorizada')
  checa('e em nenhum passo o PIN pôde ser guardado', janela === 0)
}

console.log('\n--- (1c) a EXCEÇÃO online: o gerente autoriza, o motoboy continua o do documento ---')
{
  const e = correr(custodiaInicial(DOC), [
    ...ATE_GERENTE_AUTORIZADO,
    { tipo: 'CONCLUIR', online: true },
    { tipo: 'SELADO' },
  ])
  checa('termina em selado', e.nome === 'selado')
  checa('o cartão autenticado é o do GERENTE', e.credencial?.valor.titular === 'gerente')
  // O aceite essencial do 4B: o cartão apresentado nunca vira o
  // responsável pelos vales.
  checa('e o motoboy continua sendo o do documento', e.motoboyId === 'm-1')
  const v = validacaoDaCustodia(e)
  checa('validação = gerente, PIN esquecido',
    v?.validacao === 'gerente' && v.motivoExcecao === 'pin_esquecido')
  checa('motivo carimbado no documento', e.motivoExcecao?.paraDocumento === DOC.documentHash)
  checa('e o PIN do gerente também não fica em memória', podeGuardarSegredos(e) === false)
}

console.log('\n--- (1d) o motivo é OBRIGATÓRIO na exceção, e vem ANTES do PIN ---')
{
  const semMotivo = correr(custodiaInicial(DOC), [{ tipo: 'INICIAR' }, CARTAO_DO_GERENTE])
  const tentouOnline = reduzirCustodia(semMotivo, { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'x' })
  checa('cartão de gerente SEM motivo não autentica online',
    tentouOnline.nome === 'aguardando_pin' && tentouOnline.autorizacaoId === null)
  const tentouOffline = reduzirCustodia(semMotivo, { tipo: 'SEGREDOS_CAPTURADOS' })
  checa('nem captura o PIN offline',
    tentouOffline.nome === 'aguardando_pin' && !podeGuardarSegredos(tentouOffline))
  checa('e sem motivo não há validação a declarar', validacaoDaCustodia(semMotivo) === null)

  // Com o cartão do motoboy não há exceção a registrar.
  const motoboyComMotivo = correr(custodiaInicial(DOC), [
    { tipo: 'INICIAR' },
    CARTAO_DO_MOTOBOY,
    { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'cartao_perdido' },
  ])
  checa('motivo com o cartão do MOTOBOY é ignorado', motoboyComMotivo.motivoExcecao === null)

  // Depois de autenticar, o motivo está na autorização do servidor: trocar
  // por cima faria a tela afirmar um motivo que o documento não tem.
  const autorizado = correr(custodiaInicial(DOC), ATE_GERENTE_AUTORIZADO)
  const trocouDepois = reduzirCustodia(autorizado, { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'cartao_perdido' })
  checa('o motivo NÃO muda depois de autenticar', trocouDepois.motivoExcecao?.valor === 'pin_esquecido')

  // Antes de autenticar ele pode mudar — inclusive depois de um PIN errado.
  const recusado = correr(custodiaInicial(DOC), [
    { tipo: 'INICIAR' },
    CARTAO_DO_GERENTE,
    { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'pin_esquecido' },
    { tipo: 'PIN_RECUSADO', mensagem: 'PIN incorreto.' },
  ])
  checa('PIN recusado mantém o motivo', recusado.motivoExcecao?.valor === 'pin_esquecido')
  const corrigiu = reduzirCustodia(recusado, { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'cartao_perdido' })
  checa('e ainda dá pra corrigir o motivo', corrigiu.motivoExcecao?.valor === 'cartao_perdido')

  // Um cartão NOVO é uma identificação nova: nada do anterior sobrevive.
  const outroCartao = correr(custodiaInicial(DOC), [
    { tipo: 'INICIAR' },
    CARTAO_DO_GERENTE,
    { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'cartao_perdido' },
    { tipo: 'CARTAO_RECUSADO', mensagem: 'outro cartão' },
    CARTAO_DO_MOTOBOY,
  ])
  checa('ler outro cartão zera o motivo da exceção anterior',
    outroCartao.motivoExcecao === null && outroCartao.credencial?.valor.titular === 'motoboy')
}

console.log('\n--- (2) o caminho OFFLINE inteiro ---')
{
  const e = correr(custodiaInicial(DOC), [
    ...ATE_CAPTURADO,
    { tipo: 'CONCLUIR', online: false, envelope: { k: '…' } },
    { tipo: 'ENFILEIRADO' },
  ])
  checa('termina em aguardando_validacao', e.nome === 'aguardando_validacao')
  checa('tem envelope', e.envelope !== null)
  checa('envelope carimbado no documento', e.envelope?.paraDocumento === DOC.documentHash)
  checa('NÃO tem autorização', e.autorizacaoId === null)
  // O ponto do §39: offline ninguém validou, e a tela lê este campo.
  checa(
    'credencial NÃO marcada como validada',
    e.credencial?.valor.validadaPeloServidor === false,
    'offline é "informada", nunca "autenticada"'
  )
  checa(
    'e o PIN deixa de ser guardável assim que o envelope existe',
    podeGuardarSegredos(e) === false
  )
}

console.log('\n--- (2b) offline: a janela do PIN começa e termina onde deve ---')
{
  const capturado = correr(custodiaInicial(DOC), ATE_CAPTURADO)
  checa('estado próprio, não `custodia_autorizada`', capturado.nome === 'segredos_capturados')
  checa('sinal carimbado no documento', capturado.segredosCapturados?.paraDocumento === DOC.documentHash)
  checa(
    'a tela PODE guardar PIN e token até a confirmação',
    podeGuardarSegredos(capturado),
    'o offlineEventHash leva o relógio do ato de confirmar — antes dele não há envelope possível'
  )

  const concluido = reduzirCustodia(capturado, {
    tipo: 'CONCLUIR',
    online: false,
    envelope: { k: 1 },
  })
  checa('mas não depois de selado o envelope', podeGuardarSegredos(concluido) === false)
}

console.log('\n--- (2c) a EXCEÇÃO offline ---')
{
  const e = correr(custodiaInicial(DOC), [
    ...ATE_GERENTE_CAPTURADO,
    { tipo: 'CONCLUIR', online: false, envelope: { k: 'g' } },
    { tipo: 'ENFILEIRADO' },
  ])
  checa('termina em aguardando_validacao', e.nome === 'aguardando_validacao')
  const v = validacaoDaCustodia(e)
  checa('validação = gerente, cartão perdido',
    v?.validacao === 'gerente' && v.motivoExcecao === 'cartao_perdido')
  checa('cartão do gerente só INFORMADO', e.credencial?.valor.validadaPeloServidor === false)
  checa('e o motoboy continua o do documento', e.motoboyId === 'm-1')
}

console.log('\n--- (3) trocar o cartão recolhe TUDO ---')
{
  const antes = correr(custodiaInicial(DOC), ATE_GERENTE_CAPTURADO)
  checa('antes, tinha motivo', antes.motivoExcecao !== null)
  checa('antes, podia guardar o PIN', podeGuardarSegredos(antes))

  const e = correr(antes, [{ tipo: 'TROCAR_CARTAO' }])
  checa('volta pra aguardando_cartao', e.nome === 'aguardando_cartao')
  checa('credencial recolhida', e.credencial === null)
  checa('motivo recolhido', e.motivoExcecao === null)
  checa('autorização recolhida', e.autorizacaoId === null)
  checa(
    'PIN e token mandados apagar',
    podeGuardarSegredos(e) === false,
    'o PIN do cartão anterior não sela o documento com outro cartão'
  )
  checa('motoboyId zerado até o próximo cartão', e.motoboyId === null)
  checa('e o motivo do recolhimento é DITO', (e.motivoDoRecolhimento ?? '').includes('cartão'))
}

console.log('\n--- (4) autorização expirada recolhe a custódia ---')
{
  const antes = correr(custodiaInicial(DOC), ATE_GERENTE_AUTORIZADO)
  const e = correr(antes, [{ tipo: 'AUTORIZACAO_EXPIROU' }])

  checa('estado próprio, não `erro`', e.nome === 'autorizacao_expirada')
  checa('autorização recolhida', e.autorizacaoId === null)
  // O conteúdo não mudou, mas a janela de presença sim.
  checa('credencial recolhida', e.credencial === null)
  checa('motivo recolhido junto', e.motivoExcecao === null)
  checa(
    'e o recolhimento é EXPLICADO, não silencioso',
    (e.motivoDoRecolhimento ?? '').includes('dois momentos')
  )
}

console.log('\n--- (5) cancelar descarta a custódia ---')
{
  const antes = correr(custodiaInicial(DOC), ATE_GERENTE_CAPTURADO)
  const e = correr(antes, [{ tipo: 'CANCELAR' }])
  checa('volta pro começo', e.nome === 'documento_congelado')
  checa('nada de evidência sobrou',
    e.credencial === null && e.autorizacaoId === null && e.segredosCapturados === null &&
    e.envelope === null && e.motivoExcecao === null)
  checa('e o PIN sai da memória junto', podeGuardarSegredos(e) === false)
}

console.log('\n--- (6) `conflito` é terminal, e não retryable ---')
{
  const e = correr(custodiaInicial(DOC), [
    ...ATE_AUTORIZADO,
    { tipo: 'CONCLUIR', online: true },
    { tipo: 'CONFLITO', detalhe: { numero: 'R-000021' } },
  ])
  checa('estado é conflito', e.nome === 'conflito')
  checa('é terminal', ehTerminal(e.nome))
  checa('carrega o detalhe pra tela mostrar o número', e.detalhe !== null)
  checa('e o CTA fica travado', ctaTravado(e))

  // Insistir não faz nada: o servidor preservou a prova de propósito.
  const depois = correr(e, [{ tipo: 'CONCLUIR', online: true }, { tipo: 'SELADO' }])
  checa('insistir não sai do conflito', depois.nome === 'conflito')
}

console.log('\n--- (7) o CTA trava durante selando/enfileirando ---')
{
  const pronto = correr(custodiaInicial(DOC), ATE_AUTORIZADO)
  checa('destravado em custodia_autorizada', ctaTravado(pronto) === false)

  const selando = reduzirCustodia(pronto, { tipo: 'CONCLUIR', online: true })
  checa('travado em selando', ctaTravado(selando))

  // O duplo clique: um segundo CONCLUIR não pode produzir nada.
  const denovo = reduzirCustodia(selando, { tipo: 'CONCLUIR', online: true })
  checa('segundo CONCLUIR é no-op', denovo.nome === 'selando')

  // E offline ele também não pode trocar o envelope já carimbado por um
  // segundo: dois envelopes pra a mesma devolução são dois documentos.
  const prontoOffline = correr(custodiaInicial(DOC), ATE_CAPTURADO)
  const enfileirando = reduzirCustodia(prontoOffline, {
    tipo: 'CONCLUIR',
    online: false,
    envelope: { k: 1 },
  })
  const outraVez = reduzirCustodia(enfileirando, {
    tipo: 'CONCLUIR',
    online: false,
    envelope: { k: 2 },
  })
  checa('travado em enfileirando', ctaTravado(enfileirando))
  checa(
    'e não substitui o envelope já carimbado',
    (outraVez.envelope?.valor as { k: number } | undefined)?.k === 1
  )
}

console.log('\n--- (8) a ordem, e a EVIDÊNCIA escolhe a porta ---')
{
  const cedo = correr(custodiaInicial(DOC), [
    { tipo: 'INICIAR' },
    { tipo: 'CONCLUIR', online: true },
  ])
  checa('não dá pra confirmar antes de apresentar cartão', cedo.nome === 'aguardando_cartao')

  const soCartao = correr(custodiaInicial(DOC), [
    { tipo: 'INICIAR' },
    CARTAO_DO_MOTOBOY,
    { tipo: 'CONCLUIR', online: true },
    { tipo: 'CONCLUIR', online: false, envelope: {} },
  ])
  checa('nem com o cartão lido e o PIN por conferir', soCartao.nome === 'aguardando_pin')

  // Autorização online não sai pela fila: não há PIN pra envelope.
  const autorizado = correr(custodiaInicial(DOC), ATE_AUTORIZADO)
  const pelaFila = reduzirCustodia(autorizado, { tipo: 'CONCLUIR', online: false, envelope: { k: 1 } })
  checa('custodia_autorizada NÃO conclui pelo ramo offline',
    pelaFila.nome === 'custodia_autorizada' && pelaFila.envelope === null)

  // E PIN capturado sem rede não sela online, mesmo que a rede volte:
  // ninguém o conferiu.
  const capturado = correr(custodiaInicial(DOC), ATE_CAPTURADO)
  const peloSelo = reduzirCustodia(capturado, { tipo: 'CONCLUIR', online: true })
  checa('segredos_capturados NÃO conclui pelo selo online', peloSelo.nome === 'segredos_capturados')
}

console.log('\n--- (9) PIN recusado NÃO apaga o cartão ---')
{
  const e = correr(custodiaInicial(DOC), [
    { tipo: 'INICIAR' },
    CARTAO_DO_MOTOBOY,
    { tipo: 'PIN_RECUSADO', mensagem: 'PIN incorreto.' },
  ])
  checa('estado próprio', e.nome === 'pin_recusado')
  checa('cartão preservado', e.credencial !== null, 'recolher aqui só faria bipar de novo à toa')

  const retomou = correr(e, [{ tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-2' }])
  checa('e dá pra tentar o PIN de novo', retomou.nome === 'custodia_autorizada')

  const offline = correr(e, [{ tipo: 'SEGREDOS_CAPTURADOS' }])
  checa('inclusive pelo caminho offline', offline.nome === 'segredos_capturados')

  // E o PIN recusado SAI da memória.
  const recusadoDepoisDeCapturar = correr(custodiaInicial(DOC), [
    ...ATE_CAPTURADO,
    { tipo: 'PIN_RECUSADO', mensagem: 'PIN incorreto.' },
  ])
  checa(
    'PIN recusado apaga o material capturado',
    podeGuardarSegredos(recusadoDepoisDeCapturar) === false
  )
  checa('mas o cartão continua', recusadoDepoisDeCapturar.credencial !== null)
}

console.log('\n--- (9b) a JANELA que a varredura achou em 2026-08-21 ---')
{
  // Caminho real: o caixa captura o PIN sem rede, a rede volta, e ele
  // autentica online. Antes do conserto o estado terminava com
  // autorização emitida E material em claro ainda autorizado a viver na
  // memória da tela — os dois ramos misturados.
  const e = correr(custodiaInicial(DOC), [
    ...ATE_CAPTURADO,
    { tipo: 'PIN_RECUSADO', mensagem: 'PIN incorreto.' },
    { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-3' },
  ])
  checa('termina autorizado', e.nome === 'custodia_autorizada' && e.autorizacaoId !== null)
  checa(
    'e o PIN capturado offline NÃO sobrevive à autenticação online',
    podeGuardarSegredos(e) === false
  )

  // O espelho: autorizar e depois cair pro offline não pode deixar a
  // autorização velha para trás.
  const voltouProOffline = correr(custodiaInicial(DOC), [
    ...ATE_AUTORIZADO,
    { tipo: 'PIN_RECUSADO', mensagem: 'PIN incorreto.' },
    { tipo: 'SEGREDOS_CAPTURADOS' },
  ])
  checa('e a autorização velha não sobrevive à captura offline',
    voltouProOffline.autorizacaoId === null)
  checa('os dois ramos são exclusivos', podeGuardarSegredos(voltouProOffline))
}

console.log('\n--- (9c) REGRA 4: falha de rede no selo online ---')
{
  const pronto = correr(custodiaInicial(DOC), ATE_GERENTE_AUTORIZADO)
  const selando = reduzirCustodia(pronto, { tipo: 'CONCLUIR', online: true })
  const e = correr(selando, [{ tipo: 'FALHA_DE_REDE_NO_SELO' }])

  checa('estado PRÓPRIO, não o `erro_rede` genérico', e.nome === 'falha_selo_online')

  // A metade que PRESERVA.
  checa(
    'o documento continua congelado',
    e.documento.romaneioId === DOC.romaneioId && e.documento.documentHash === DOC.documentHash
  )

  // A metade que DESTRÓI. A autorização é de uso único, e a tela não sabe
  // se o servidor a consumiu antes de a rede cair.
  checa('autorização descartada', e.autorizacaoId === null)
  checa('credencial descartada', e.credencial === null)
  checa('motivo da exceção descartado', e.motivoExcecao === null)
  checa('e o PIN continua fora de memória', podeGuardarSegredos(e) === false)
  checa('nada de envelope fabricado', e.envelope === null,
    'faltam os segredos, e inventar um incentivaria guardá-los além do necessário')
  checa('e o motivo do recolhimento é DITO', (e.motivoDoRecolhimento ?? '').includes('de novo'))

  const insistiu = reduzirCustodia(e, { tipo: 'CONCLUIR', online: true })
  checa('CONCLUIR daqui é no-op — não existe retry silencioso',
    insistiu.nome === 'falha_selo_online')

  // A saída é UMA: apresentar o cartão e o PIN de novo.
  const refeito = correr(e, [
    CARTAO_DO_GERENTE,
    { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'pin_esquecido' },
    { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-4' },
  ])
  checa('e dá pra refazer cartão → motivo → PIN', refeito.nome === 'custodia_autorizada')
  checa('sobre o MESMO documento', refeito.documento.documentHash === DOC.documentHash)

  // E ela não vale de qualquer lugar: só de `selando`.
  const cedoDemais = reduzirCustodia(pronto, { tipo: 'FALHA_DE_REDE_NO_SELO' })
  checa('não vale antes de tentar selar', cedoDemais.nome === 'custodia_autorizada')
  const noOffline = reduzirCustodia(
    reduzirCustodia(
      correr(custodiaInicial(DOC), ATE_CAPTURADO),
      { tipo: 'CONCLUIR', online: false, envelope: { k: 1 } }
    ),
    { tipo: 'FALHA_DE_REDE_NO_SELO' }
  )
  checa('e não alcança o ramo offline', noOffline.nome === 'enfileirando',
    'lá a operação vai pra fila com o envelope — não há custódia a desfazer')
}

console.log('\n--- (10) AS INVARIANTES, varrendo TODOS os eventos em TODOS os estados ---')
{
  // Não é sobre os caminhos que eu lembrei: é sobre a máquina. Leva cada
  // estado alcançável a receber cada evento possível.
  const eventos: EventoCustodia[] = [
    { tipo: 'INICIAR' },
    CARTAO_DO_MOTOBOY,
    CARTAO_DO_GERENTE,
    { tipo: 'CARTAO_RECUSADO', mensagem: 'Credencial não reconhecida.' },
    { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'cartao_perdido' },
    { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'pin_esquecido' },
    { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-x' },
    { tipo: 'SEGREDOS_CAPTURADOS' },
    { tipo: 'PIN_RECUSADO', mensagem: 'PIN incorreto.' },
    { tipo: 'CONCLUIR', online: true },
    { tipo: 'CONCLUIR', online: false, envelope: { k: 'x' } },
    { tipo: 'SELADO' },
    { tipo: 'ENFILEIRADO' },
    { tipo: 'CONFLITO', detalhe: {} },
    { tipo: 'FALHA_DE_REDE_NO_SELO' },
    { tipo: 'FALHA_NA_CONSULTA', mensagem: 'Failed to fetch' },
    { tipo: 'ERRO_REDE', mensagem: 'Failed to fetch' },
    { tipo: 'AUTORIZACAO_EXPIROU' },
    { tipo: 'TROCAR_CARTAO' },
    { tipo: 'CANCELAR' },
  ]

  const vistos = new Map<string, EstadoCustodia>()
  const fila: EstadoCustodia[] = [custodiaInicial(DOC)]
  let transicoes = 0
  let sujas = 0
  // Nenhum estado com autorização pode deixar PIN em memória.
  let onlineComSegredo = 0
  // Nenhuma autenticação (autorização, PIN capturado ou envelope) com
  // cartão de gerente e sem motivo.
  let excecaoSemMotivo = 0
  // Todo estado autenticado tem uma validação completa pra declarar.
  let autenticadoSemValidacao = 0

  while (fila.length > 0) {
    const atual = fila.pop()!
    for (const evento of eventos) {
      const proximo = reduzirCustodia(atual, evento)
      transicoes++
      if (evidenciaDeOutroDocumento(proximo).length > 0) sujas++
      if (proximo.autorizacaoId !== null && podeGuardarSegredos(proximo)) onlineComSegredo++
      const autenticou =
        proximo.autorizacaoId !== null || proximo.segredosCapturados !== null || proximo.envelope !== null
      if (autenticou && proximo.credencial?.valor.titular === 'gerente' && proximo.motivoExcecao === null) {
        excecaoSemMotivo++
      }
      if (
        (proximo.nome === 'custodia_autorizada' || proximo.nome === 'segredos_capturados') &&
        validacaoDaCustodia(proximo) === null
      ) {
        autenticadoSemValidacao++
      }

      // Chave pelo estado observável, pra a varredura terminar.
      const chave = [
        proximo.nome,
        proximo.motoboyId,
        proximo.credencial?.valor.validadaPeloServidor,
        proximo.credencial?.valor.titular,
        proximo.motivoExcecao?.valor,
        !!proximo.autorizacaoId, !!proximo.segredosCapturados, !!proximo.envelope,
      ].join('|')
      if (!vistos.has(chave)) {
        vistos.set(chave, proximo)
        fila.push(proximo)
      }
    }
  }

  checa(
    'NENHUMA transição produz evidência de outro documento',
    sujas === 0,
    `${transicoes} transições, ${vistos.size} estados distintos`
  )
  checa(
    'e NENHUM estado com autorização deixa o PIN em memória',
    onlineComSegredo === 0,
    'a regra 3 valendo pela máquina, não pelo caminho que eu escrevi'
  )
  checa('e NENHUMA autenticação de gerente existe sem motivo', excecaoSemMotivo === 0)
  checa('e todo estado autenticado tem validação a declarar', autenticadoSemValidacao === 0)

  // A invariante só vale alguma coisa se ela souber acusar.
  const forjado: EstadoCustodia = {
    ...custodiaInicial(OUTRO),
    credencial: {
      paraDocumento: DOC.documentHash,
      valor: { publicId: '777777', validadaPeloServidor: true, titular: 'motoboy' },
    },
  }
  checa(
    'e o detector ACUSA um carimbo de outro documento',
    evidenciaDeOutroDocumento(forjado).join(',') === 'credencial'
  )

  const comSinalVelho: EstadoCustodia = {
    ...custodiaInicial(OUTRO),
    segredosCapturados: { paraDocumento: DOC.documentHash, valor: true },
  }
  checa(
    'e ACUSA um PIN capturado sob outro documento',
    evidenciaDeOutroDocumento(comSinalVelho).join(',') === 'segredosCapturados'
  )

  // E acusa o campo NOVO: sem isto `motivoExcecao` entraria no estado sem
  // entrar na invariante, e "0 sujas" seguiria verde por não olhar.
  const comMotivoVelho: EstadoCustodia = {
    ...custodiaInicial(OUTRO),
    motivoExcecao: { paraDocumento: DOC.documentHash, valor: 'pin_esquecido' },
  }
  checa(
    'e ACUSA um motivo de exceção de outro documento',
    evidenciaDeOutroDocumento(comMotivoVelho).join(',') === 'motivoExcecao'
  )
}

console.log('\n--- (11) todo estado do tipo é alcançável ---')
{
  // Um estado que o redutor nunca produz é código morto disfarçado de
  // contrato. Desde o 4B os estados de assinatura saíram do TIPO, e não
  // só do caminho — `assinando_responsavel` era rótulo sem transição, e
  // não sobrou nada assim.
  const todos: EstadoNome[] = [
    'documento_congelado', 'aguardando_cartao', 'aguardando_pin',
    'custodia_autorizada', 'segredos_capturados',
    'selando', 'enfileirando', 'selado', 'aguardando_validacao',
    'cartao_recusado', 'pin_recusado', 'autorizacao_expirada', 'falha_selo_online',
    'erro_rede', 'conflito',
  ]
  const alcancados = new Set<EstadoNome>()
  const fila: EstadoCustodia[] = [custodiaInicial(DOC)]
  const vistos = new Set<string>()
  const eventos: EventoCustodia[] = [
    { tipo: 'INICIAR' }, CARTAO_DO_MOTOBOY, CARTAO_DO_GERENTE,
    { tipo: 'CARTAO_RECUSADO', mensagem: 'Credencial não reconhecida.' },
    { tipo: 'MOTIVO_ESCOLHIDO', motivo: 'pin_esquecido' },
    { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'a' },
    { tipo: 'SEGREDOS_CAPTURADOS' }, { tipo: 'PIN_RECUSADO', mensagem: 'PIN incorreto.' },
    { tipo: 'CONCLUIR', online: true }, { tipo: 'CONCLUIR', online: false, envelope: {} },
    { tipo: 'SELADO' }, { tipo: 'ENFILEIRADO' }, { tipo: 'CONFLITO', detalhe: {} },
    { tipo: 'FALHA_DE_REDE_NO_SELO' },
    { tipo: 'ERRO_REDE', mensagem: 'Failed to fetch' }, { tipo: 'AUTORIZACAO_EXPIROU' },
    { tipo: 'TROCAR_CARTAO' }, { tipo: 'CANCELAR' },
  ]
  while (fila.length > 0) {
    const atual = fila.pop()!
    alcancados.add(atual.nome)
    for (const evento of eventos) {
      const p = reduzirCustodia(atual, evento)
      const chave = `${p.nome}|${!!p.autorizacaoId}|${!!p.segredosCapturados}|${!!p.envelope}|${p.credencial?.valor.titular}|${!!p.motivoExcecao}`
      if (!vistos.has(chave)) { vistos.add(chave); fila.push(p) }
    }
  }
  const orfaos = todos.filter((n) => !alcancados.has(n))
  checa('nenhum estado inalcançável', orfaos.length === 0, orfaos.join(', '))
}

// ---------------------------------------------------------------------
console.log('\n--- (12) TODA FALHA CARREGA O MOTIVO — E2.3, lote D ---')
// ---------------------------------------------------------------------
{
  // Antes deste bloco o motivo vivia num `erro: string | null` PARALELO
  // à máquina, na tela. Com o motivo dentro do evento, um estado de falha
  // sem explicação deixa de ser representável.
  const base = custodiaInicial(DOC)

  const recusado = reduzirCustodia(base, {
    tipo: 'CARTAO_RECUSADO',
    mensagem: 'Credencial não reconhecida.',
  })
  checa('cartao_recusado carrega o motivo', recusado.mensagem?.texto === 'Credencial não reconhecida.')
  checa('e ele é do tipo RECUSA', recusado.mensagem?.tipo === 'recusa')

  const rede = reduzirCustodia(base, { tipo: 'ERRO_REDE', mensagem: 'Failed to fetch' })
  checa('erro_rede carrega o motivo', rede.mensagem?.texto === 'Failed to fetch')
  checa('e ele é do tipo FALHA', rede.mensagem?.tipo === 'falha')

  checa('e cartao_recusado ≠ erro_rede', recusado.nome !== rede.nome)

  // Com o `INICIAR`: a partir de `documento_congelado` o `CARTAO_LIDO` é
  // ignorado, e sem ele este bloco mediria um estado sem credencial.
  const comCartao = correr(base, [{ tipo: 'INICIAR' }, CARTAO_DO_MOTOBOY])
  checa('   (o fixture de fato leu um cartão)', comCartao.credencial !== null)
  const pinRuim = reduzirCustodia(comCartao, { tipo: 'PIN_RECUSADO', mensagem: 'PIN incorreto.' })
  const pinRede = reduzirCustodia(comCartao, { tipo: 'ERRO_REDE', mensagem: 'Failed to fetch' })
  checa('pin_recusado carrega o motivo', pinRuim.mensagem?.texto === 'PIN incorreto.')
  checa('e pin_recusado ≠ erro_rede', pinRuim.nome !== pinRede.nome)

  checa('pin_recusado descarta os segredos', pinRuim.segredosCapturados === null)
  checa('e nenhum dos dois apaga a leitura do cartão',
    pinRuim.credencial !== null && pinRede.credencial !== null)

  checa('o estado inicial não carrega mensagem', base.mensagem === null)

  // UMA CONSULTA QUE FALHA NÃO MOVE A MÁQUINA — defeito real, achado
  // medindo a tela em 2026-08-26.
  const aguardando = correr(base, [{ tipo: 'INICIAR' }])
  const falhouAoBipar = reduzirCustodia(aguardando, {
    tipo: 'FALHA_NA_CONSULTA',
    mensagem: 'Failed to fetch',
  })
  checa('a falha na consulta NÃO move a máquina', falhouAoBipar.nome === aguardando.nome)
  checa('mas ela passa a ter o que dizer', falhouAoBipar.mensagem?.texto === 'Failed to fetch')
  checa('e é FALHA, não recusa', falhouAoBipar.mensagem?.tipo === 'falha')
  const rebipou = reduzirCustodia(falhouAoBipar, CARTAO_DO_MOTOBOY)
  checa('e BIPAR DE NOVO continua funcionando', rebipou.nome === 'aguardando_pin')
  checa('e o sucesso limpa a mensagem da falha', rebipou.mensagem === null)

  const falhouNoPin = reduzirCustodia(comCartao, {
    tipo: 'FALHA_NA_CONSULTA',
    mensagem: 'Failed to fetch',
  })
  checa('no PIN também não move', falhouNoPin.nome === comCartao.nome)
  checa('e autenticar de novo continua possível',
    reduzirCustodia(falhouNoPin, { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'a' }).nome ===
      'custodia_autorizada')

  const conflito = reduzirCustodia(base, { tipo: 'CONFLITO', detalhe: { numero: 'R-000099' } })
  checa('conflito é estado próprio, não erro_rede', conflito.nome === 'conflito')
  checa('e ele preserva o detalhe pra tela mostrar o romaneio', conflito.detalhe !== null)
}

console.log(falhas === 0 ? '\ncustódia ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
