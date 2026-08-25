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

import {
  custodiaInicial,
  reduzirCustodia,
  evidenciaDeOutroDocumento,
  ehTerminal,
  ctaTravado,
  podeGuardarSegredos,
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

const ATE_AUTORIZADO: EventoCustodia[] = [
  { tipo: 'INICIAR' },
  { tipo: 'CARTAO_LIDO', publicId: '777777', motoboyId: 'm-1' },
  { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-1' },
]
const ATE_CAPTURADO: EventoCustodia[] = [
  { tipo: 'INICIAR' },
  { tipo: 'CARTAO_LIDO', publicId: '777777', motoboyId: 'm-1' },
  { tipo: 'SEGREDOS_CAPTURADOS' },
]
const ASSINATURAS: EventoCustodia[] = [
  { tipo: 'ASSINOU_RESPONSAVEL', strokes: [{ t: 'resp' }] },
  { tipo: 'ASSINOU_MOTOBOY', strokes: [{ t: 'moto' }] },
]

console.log('\n--- (1) o caminho ONLINE inteiro ---')
{
  const e = correr(custodiaInicial(DOC), [
    ...ATE_AUTORIZADO,
    ...ASSINATURAS,
    { tipo: 'CONCLUIR', online: true },
    { tipo: 'SELADO' },
  ])
  checa('termina em selado', e.nome === 'selado')
  checa('autorização carimbada no documento', e.autorizacaoId?.paraDocumento === DOC.documentHash)
  checa('credencial VALIDADA pelo servidor', e.credencial?.valor.validadaPeloServidor === true)
  checa('os dois traços presentes', e.responsavelStrokes !== null && e.motoboyStrokes !== null)
  checa('sem envelope no caminho online', e.envelope === null)
  // A regra 3: online quem prova a presença é a autorização, então o PIN
  // não sobrevive ao instante da autenticação. Um `true` aqui seria a
  // tela autorizada a segurar texto claro sem precisar.
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
  for (const evento of ATE_AUTORIZADO) {
    estado = reduzirCustodia(estado, evento)
    if (podeGuardarSegredos(estado)) {
      falhas++
      console.log(`FALHA  PIN autorizado a ficar em memória em ${estado.nome}`)
    }
  }
  checa('chegou a custodia_autorizada', estado.nome === 'custodia_autorizada')
  checa('e em nenhum passo o PIN pôde ser guardado', true)
}

console.log('\n--- (2) o caminho OFFLINE inteiro ---')
{
  const e = correr(custodiaInicial(DOC), [
    ...ATE_CAPTURADO,
    ...ASSINATURAS,
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
  // O material vira envelope no CONCLUIR e some no mesmo passo.
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
  checa('a tela PODE guardar PIN e token aqui', podeGuardarSegredos(capturado))

  const assinado = correr(capturado, ASSINATURAS)
  checa(
    'e continua podendo até a segunda assinatura',
    podeGuardarSegredos(assinado),
    'o offlineEventHash amarra os dois traços — antes deles não há envelope possível'
  )

  const concluido = reduzirCustodia(assinado, {
    tipo: 'CONCLUIR',
    online: false,
    envelope: { k: 1 },
  })
  checa('mas não depois de selado o envelope', podeGuardarSegredos(concluido) === false)
}

console.log('\n--- (3) trocar o motoboy recolhe TUDO ---')
{
  const antes = correr(custodiaInicial(DOC), [...ATE_CAPTURADO, ...ASSINATURAS])
  checa('antes, tinha as duas assinaturas', antes.responsavelStrokes !== null)
  checa('antes, podia guardar o PIN', podeGuardarSegredos(antes))

  const e = correr(antes, [{ tipo: 'TROCAR_MOTOBOY' }])
  checa('volta pra aguardando_cartao', e.nome === 'aguardando_cartao')
  checa('credencial recolhida', e.credencial === null)
  checa('autorização recolhida', e.autorizacaoId === null)
  checa(
    'PIN e token mandados apagar',
    podeGuardarSegredos(e) === false,
    'o PIN de quem estava antes não sela o documento de agora'
  )
  checa('responsavelStrokes recolhido', e.responsavelStrokes === null)
  checa('motoboyStrokes recolhido', e.motoboyStrokes === null)
  checa('motoboyId zerado', e.motoboyId === null)
  checa('e o motivo é DITO', (e.motivoDoRecolhimento ?? '').includes('motoboy'))
}

console.log('\n--- (4) autorização expirada recolhe as DUAS assinaturas ---')
{
  const antes = correr(custodiaInicial(DOC), [...ATE_AUTORIZADO, ...ASSINATURAS])
  const e = correr(antes, [{ tipo: 'AUTORIZACAO_EXPIROU' }])

  checa('estado próprio, não `erro`', e.nome === 'autorizacao_expirada')
  checa('autorização recolhida', e.autorizacaoId === null)
  // A decisão que não era óbvia: o conteúdo não mudou, mas a janela de
  // presença sim. Manter os traços faria o documento juntar evidências
  // de dois momentos sem dizer.
  checa('responsavelStrokes recolhido', e.responsavelStrokes === null)
  checa('motoboyStrokes recolhido', e.motoboyStrokes === null)
  checa(
    'e o recolhimento é EXPLICADO, não silencioso',
    (e.motivoDoRecolhimento ?? '').includes('dois momentos')
  )
}

console.log('\n--- (5) cancelar descarta os traços ---')
{
  const antes = correr(custodiaInicial(DOC), [...ATE_CAPTURADO, ...ASSINATURAS])
  const e = correr(antes, [{ tipo: 'CANCELAR' }])
  checa('volta pro começo', e.nome === 'documento_congelado')
  checa('nada de evidência sobrou',
    e.credencial === null && e.autorizacaoId === null && e.segredosCapturados === null &&
    e.envelope === null && e.responsavelStrokes === null && e.motoboyStrokes === null)
  checa('e o PIN sai da memória junto', podeGuardarSegredos(e) === false)
}

console.log('\n--- (6) `conflito` é terminal, e não retryable ---')
{
  const e = correr(custodiaInicial(DOC), [
    ...ATE_AUTORIZADO, ...ASSINATURAS,
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
  const pronto = correr(custodiaInicial(DOC), [...ATE_AUTORIZADO, ...ASSINATURAS])
  checa('destravado em pronto_para_concluir', ctaTravado(pronto) === false)

  const selando = reduzirCustodia(pronto, { tipo: 'CONCLUIR', online: true })
  checa('travado em selando', ctaTravado(selando))

  // O duplo clique: um segundo CONCLUIR não pode produzir nada.
  const denovo = reduzirCustodia(selando, { tipo: 'CONCLUIR', online: true })
  checa('segundo CONCLUIR é no-op', denovo.nome === 'selando')

  // E offline ele também não pode trocar o envelope já carimbado por um
  // segundo: dois envelopes pra a mesma devolução são dois documentos.
  const prontoOffline = correr(custodiaInicial(DOC), [...ATE_CAPTURADO, ...ASSINATURAS])
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

console.log('\n--- (8) ordem: não dá pra assinar antes de autenticar ---')
{
  const e = correr(custodiaInicial(DOC), [
    { tipo: 'INICIAR' },
    { tipo: 'ASSINOU_RESPONSAVEL', strokes: [{ t: 'cedo' }] },
    { tipo: 'ASSINOU_MOTOBOY', strokes: [{ t: 'cedo' }] },
    { tipo: 'CONCLUIR', online: true },
  ])
  checa('continua em aguardando_cartao', e.nome === 'aguardando_cartao')
  checa('nenhum traço foi aceito', e.responsavelStrokes === null && e.motoboyStrokes === null)
}

console.log('\n--- (9) PIN recusado NÃO apaga o cartão ---')
{
  const e = correr(custodiaInicial(DOC), [
    { tipo: 'INICIAR' },
    { tipo: 'CARTAO_LIDO', publicId: '777777', motoboyId: 'm-1' },
    { tipo: 'PIN_RECUSADO' },
  ])
  checa('estado próprio', e.nome === 'pin_recusado')
  checa('cartão preservado', e.credencial !== null, 'recolher aqui só faria bipar de novo à toa')

  const retomou = correr(e, [{ tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-2' }])
  checa('e dá pra tentar o PIN de novo', retomou.nome === 'custodia_autorizada')

  const offline = correr(e, [{ tipo: 'SEGREDOS_CAPTURADOS' }])
  checa('inclusive pelo caminho offline', offline.nome === 'segredos_capturados')

  // E o PIN recusado SAI da memória. Ele está errado; deixá-lo vivo
  // enquanto o certo é digitado por cima não serve pra nada.
  const recusadoDepoisDeCapturar = correr(custodiaInicial(DOC), [
    ...ATE_CAPTURADO,
    { tipo: 'PIN_RECUSADO' },
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
  //
  // A varredura do caso (10) é quem acusou; este caso existe pra a
  // regressão ter nome, porque "6375 transições" não diz qual quebrou.
  const e = correr(custodiaInicial(DOC), [
    ...ATE_CAPTURADO,
    { tipo: 'PIN_RECUSADO' },
    { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-3' },
  ])
  checa('termina autorizado', e.nome === 'custodia_autorizada' && e.autorizacaoId !== null)
  checa(
    'e o PIN capturado offline NÃO sobrevive à autenticação online',
    podeGuardarSegredos(e) === false
  )

  // O espelho: autorizar e depois cair pro offline não pode deixar a
  // autorização velha para trás, senão a tela poderia concluir pelo
  // caminho online com um PIN que ninguém conferiu.
  const voltouProOffline = correr(custodiaInicial(DOC), [
    ...ATE_AUTORIZADO,
    { tipo: 'PIN_RECUSADO' },
    { tipo: 'SEGREDOS_CAPTURADOS' },
  ])
  checa('e a autorização velha não sobrevive à captura offline',
    voltouProOffline.autorizacaoId === null)
  checa('os dois ramos são exclusivos', podeGuardarSegredos(voltouProOffline))
}

console.log('\n--- (9c) REGRA 4: falha de rede no selo online ---')
{
  const pronto = correr(custodiaInicial(DOC), [...ATE_AUTORIZADO, ...ASSINATURAS])
  const selando = reduzirCustodia(pronto, { tipo: 'CONCLUIR', online: true })
  const e = correr(selando, [{ tipo: 'FALHA_DE_REDE_NO_SELO' }])

  checa('estado PRÓPRIO, não o `erro_rede` genérico', e.nome === 'falha_selo_online')

  // A metade que PRESERVA. Sem ela o caixa refaria a conferência
  // inteira — e os ids novos fariam um documento novo, sem que nada do
  // conteúdo tivesse mudado.
  checa(
    'o documento continua congelado',
    e.documento.romaneioId === DOC.romaneioId && e.documento.documentHash === DOC.documentHash
  )

  // A metade que DESTRÓI. As assinaturas foram colhidas sob uma
  // autenticação que vai ser refeita; conservá-las associaria uma
  // autenticação nova a uma manifestação anterior a ela.
  checa('autorização descartada', e.autorizacaoId === null)
  checa('as DUAS assinaturas descartadas',
    e.responsavelStrokes === null && e.motoboyStrokes === null)
  checa('credencial descartada', e.credencial === null)
  checa('e o PIN continua fora de memória', podeGuardarSegredos(e) === false)
  checa('nada de envelope fabricado', e.envelope === null,
    'faltam os segredos, e inventar um incentivaria guardá-los além do necessário')
  checa('e o motivo é DITO', (e.motivoDoRecolhimento ?? '').includes('assinaturas'))

  // O que a tela NÃO pode oferecer: um "tentar novamente" que repita o
  // selo com a autorização e os traços antigos.
  const insistiu = reduzirCustodia(e, { tipo: 'CONCLUIR', online: true })
  checa('CONCLUIR daqui é no-op — não existe retry silencioso',
    insistiu.nome === 'falha_selo_online')

  // A saída é UMA: autenticar de novo e assinar de novo.
  const refeito = correr(e, [
    { tipo: 'CARTAO_LIDO', publicId: '777777', motoboyId: 'm-1' },
    { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-4' },
    ...ASSINATURAS,
  ])
  checa('e dá pra refazer cartão → PIN → duas assinaturas',
    refeito.nome === 'pronto_para_concluir')
  checa('sobre o MESMO documento', refeito.documento.documentHash === DOC.documentHash)

  // E ela não vale de qualquer lugar: só de `selando`. Um evento de
  // falha aceito em qualquer estado seria um jeito de zerar custódia
  // sem que selo nenhum tivesse sido tentado.
  const cedoDemais = reduzirCustodia(pronto, { tipo: 'FALHA_DE_REDE_NO_SELO' })
  checa('não vale antes de tentar selar', cedoDemais.nome === 'pronto_para_concluir')
  const noOffline = reduzirCustodia(
    reduzirCustodia(
      correr(custodiaInicial(DOC), [...ATE_CAPTURADO, ...ASSINATURAS]),
      { tipo: 'CONCLUIR', online: false, envelope: { k: 1 } }
    ),
    { tipo: 'FALHA_DE_REDE_NO_SELO' }
  )
  checa('e não alcança o ramo offline', noOffline.nome === 'enfileirando',
    'lá a operação vai pra fila com o envelope — não há custódia a desfazer')
}

console.log('\n--- (10) A INVARIANTE, varrendo TODOS os eventos em TODOS os estados ---')
{
  // Não é sobre os caminhos que eu lembrei: é sobre a máquina. Leva cada
  // estado alcançável a receber cada evento possível, e confere que
  // nenhuma combinação produz evidência carimbada com outro documento.
  const eventos: EventoCustodia[] = [
    { tipo: 'INICIAR' },
    { tipo: 'CARTAO_LIDO', publicId: '777777', motoboyId: 'm-1' },
    { tipo: 'CARTAO_RECUSADO' },
    { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'auth-x' },
    { tipo: 'SEGREDOS_CAPTURADOS' },
    { tipo: 'PIN_RECUSADO' },
    { tipo: 'ASSINOU_RESPONSAVEL', strokes: [{ t: 'r' }] },
    { tipo: 'ASSINOU_MOTOBOY', strokes: [{ t: 'm' }] },
    { tipo: 'CONCLUIR', online: true },
    { tipo: 'CONCLUIR', online: false, envelope: { k: 'x' } },
    { tipo: 'SELADO' },
    { tipo: 'ENFILEIRADO' },
    { tipo: 'CONFLITO', detalhe: {} },
    { tipo: 'FALHA_DE_REDE_NO_SELO' },
    { tipo: 'ERRO_REDE' },
    { tipo: 'AUTORIZACAO_EXPIROU' },
    { tipo: 'TROCAR_MOTOBOY' },
    { tipo: 'CANCELAR' },
  ]

  const vistos = new Map<string, EstadoCustodia>()
  const fila: EstadoCustodia[] = [custodiaInicial(DOC)]
  let transicoes = 0
  let sujas = 0
  // A segunda invariante, medida na mesma varredura: nenhum estado
  // ALCANÇÁVEL pelo caminho online pode autorizar PIN em memória.
  let onlineComSegredo = 0

  while (fila.length > 0) {
    const atual = fila.pop()!
    for (const evento of eventos) {
      const proximo = reduzirCustodia(atual, evento)
      transicoes++
      if (evidenciaDeOutroDocumento(proximo).length > 0) sujas++
      if (proximo.autorizacaoId !== null && podeGuardarSegredos(proximo)) onlineComSegredo++

      // Chave pelo estado observável, pra a varredura terminar.
      const chave = [
        proximo.nome,
        proximo.motoboyId,
        proximo.credencial?.valor.validadaPeloServidor,
        !!proximo.autorizacaoId, !!proximo.segredosCapturados, !!proximo.envelope,
        !!proximo.responsavelStrokes, !!proximo.motoboyStrokes,
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
  // Esta asserção ACHOU um defeito de verdade na primeira rodada: dava
  // pra capturar o PIN offline, a rede voltar, e terminar autenticado
  // com o material em claro ainda vivo. Ver o caso (9b).

  // A invariante só vale alguma coisa se ela souber acusar. Um estado
  // fabricado com carimbo errado tem que ser pego — senão "0 sujas"
  // poderia significar que o detector não funciona.
  const forjado: EstadoCustodia = {
    ...custodiaInicial(OUTRO),
    responsavelStrokes: { paraDocumento: DOC.documentHash, valor: [{ t: 'velho' }] },
  }
  checa(
    'e o detector ACUSA um carimbo de outro documento',
    evidenciaDeOutroDocumento(forjado).join(',') === 'responsavelStrokes'
  )

  // E acusa o campo NOVO. Sem esta, `segredosCapturados` entraria no
  // estado sem entrar na invariante, e "0 sujas" seguiria verde por não
  // olhar — um PIN capturado sob outro documento passaria batido.
  const comSinalVelho: EstadoCustodia = {
    ...custodiaInicial(OUTRO),
    segredosCapturados: { paraDocumento: DOC.documentHash, valor: true },
  }
  checa(
    'e ACUSA um PIN capturado sob outro documento',
    evidenciaDeOutroDocumento(comSinalVelho).join(',') === 'segredosCapturados'
  )
}

console.log('\n--- (11) todo estado do tipo é alcançável ou declarado ---')
{
  // Um estado que o redutor nunca produz é código morto disfarçado de
  // contrato. Os de falha de rede/conflito entram pela varredura; os
  // demais pelos caminhos felizes.
  const todos: EstadoNome[] = [
    'documento_congelado', 'aguardando_cartao', 'aguardando_pin',
    'custodia_autorizada', 'segredos_capturados', 'assinando_motoboy',
    'pronto_para_concluir', 'selando', 'enfileirando', 'selado', 'aguardando_validacao',
    'cartao_recusado', 'pin_recusado', 'autorizacao_expirada', 'falha_selo_online',
    'erro_rede', 'conflito',
  ]
  const alcancados = new Set<EstadoNome>()
  const fila: EstadoCustodia[] = [custodiaInicial(DOC)]
  const vistos = new Set<string>()
  const eventos: EventoCustodia[] = [
    { tipo: 'INICIAR' }, { tipo: 'CARTAO_LIDO', publicId: 'p', motoboyId: 'm' },
    { tipo: 'CARTAO_RECUSADO' }, { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'a' },
    { tipo: 'SEGREDOS_CAPTURADOS' }, { tipo: 'PIN_RECUSADO' },
    { tipo: 'ASSINOU_RESPONSAVEL', strokes: [] }, { tipo: 'ASSINOU_MOTOBOY', strokes: [] },
    { tipo: 'CONCLUIR', online: true }, { tipo: 'CONCLUIR', online: false, envelope: {} },
    { tipo: 'SELADO' }, { tipo: 'ENFILEIRADO' }, { tipo: 'CONFLITO', detalhe: {} },
    { tipo: 'FALHA_DE_REDE_NO_SELO' },
    { tipo: 'ERRO_REDE' }, { tipo: 'AUTORIZACAO_EXPIROU' },
    { tipo: 'TROCAR_MOTOBOY' }, { tipo: 'CANCELAR' },
  ]
  while (fila.length > 0) {
    const atual = fila.pop()!
    alcancados.add(atual.nome)
    for (const evento of eventos) {
      const p = reduzirCustodia(atual, evento)
      const chave = `${p.nome}|${!!p.autorizacaoId}|${!!p.segredosCapturados}|${!!p.responsavelStrokes}|${!!p.motoboyStrokes}|${!!p.envelope}|${!!p.credencial}`
      if (!vistos.has(chave)) { vistos.add(chave); fila.push(p) }
    }
  }
  const orfaos = todos.filter((n) => !alcancados.has(n))
  checa('nenhum estado inalcançável', orfaos.length === 0, orfaos.join(', '))

  // `assinando_responsavel` fica de fora da lista de propósito: hoje a
  // máquina vai de `custodia_autorizada`/`segredos_capturados` direto
  // pro traço do responsável, então ele é um rótulo do desenho que o
  // redutor não produz. Está no tipo pra a tela poder nomear a etapa; se
  // um dia virar um passo de verdade, este teste cobra.
  checa('e `assinando_responsavel` é rótulo, não estado produzido',
    !alcancados.has('assinando_responsavel' as EstadoNome))
}

console.log(falhas === 0 ? '\ncustódia ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
