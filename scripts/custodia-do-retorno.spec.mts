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

import {
  custodiaInicial,
  reduzirCustodia,
  evidenciaDeOutroDocumento,
  ehTerminal,
  ctaTravado,
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
}

console.log('\n--- (2) o caminho OFFLINE inteiro ---')
{
  const e = correr(custodiaInicial(DOC), [
    { tipo: 'INICIAR' },
    { tipo: 'CARTAO_LIDO', publicId: '777777', motoboyId: 'm-1' },
    { tipo: 'PIN_SELADO', envelope: { k: '…' } },
    ...ASSINATURAS,
    { tipo: 'CONCLUIR', online: false },
    { tipo: 'ENFILEIRADO' },
  ])
  checa('termina em aguardando_validacao', e.nome === 'aguardando_validacao')
  checa('tem envelope', e.envelope !== null)
  checa('NÃO tem autorização', e.autorizacaoId === null)
  // O ponto do §39: offline ninguém validou, e a tela lê este campo.
  checa(
    'credencial NÃO marcada como validada',
    e.credencial?.valor.validadaPeloServidor === false,
    'offline é "informada", nunca "autenticada"'
  )
}

console.log('\n--- (3) trocar o motoboy recolhe TUDO ---')
{
  const antes = correr(custodiaInicial(DOC), [...ATE_AUTORIZADO, ...ASSINATURAS])
  checa('antes, tinha as duas assinaturas', antes.responsavelStrokes !== null)

  const e = correr(antes, [{ tipo: 'TROCAR_MOTOBOY' }])
  checa('volta pra aguardando_cartao', e.nome === 'aguardando_cartao')
  checa('credencial recolhida', e.credencial === null)
  checa('autorização recolhida', e.autorizacaoId === null)
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
  const antes = correr(custodiaInicial(DOC), [...ATE_AUTORIZADO, ...ASSINATURAS])
  const e = correr(antes, [{ tipo: 'CANCELAR' }])
  checa('volta pro começo', e.nome === 'documento_congelado')
  checa('nada de evidência sobrou',
    e.credencial === null && e.autorizacaoId === null &&
    e.responsavelStrokes === null && e.motoboyStrokes === null)
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
    { tipo: 'PIN_SELADO', envelope: { k: 'x' } },
    { tipo: 'PIN_RECUSADO' },
    { tipo: 'ASSINOU_RESPONSAVEL', strokes: [{ t: 'r' }] },
    { tipo: 'ASSINOU_MOTOBOY', strokes: [{ t: 'm' }] },
    { tipo: 'CONCLUIR', online: true },
    { tipo: 'CONCLUIR', online: false },
    { tipo: 'SELADO' },
    { tipo: 'ENFILEIRADO' },
    { tipo: 'CONFLITO', detalhe: {} },
    { tipo: 'ERRO_REDE' },
    { tipo: 'AUTORIZACAO_EXPIROU' },
    { tipo: 'TROCAR_MOTOBOY' },
    { tipo: 'CANCELAR' },
  ]

  const vistos = new Map<string, EstadoCustodia>()
  const fila: EstadoCustodia[] = [custodiaInicial(DOC)]
  let transicoes = 0
  let sujas = 0

  while (fila.length > 0) {
    const atual = fila.pop()!
    for (const evento of eventos) {
      const proximo = reduzirCustodia(atual, evento)
      transicoes++
      if (evidenciaDeOutroDocumento(proximo).length > 0) sujas++

      // Chave pelo estado observável, pra a varredura terminar.
      const chave = [
        proximo.nome,
        proximo.motoboyId,
        proximo.credencial?.valor.validadaPeloServidor,
        !!proximo.autorizacaoId, !!proximo.envelope,
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
}

console.log('\n--- (11) todo estado do tipo é alcançável ou declarado ---')
{
  // Um estado que o redutor nunca produz é código morto disfarçado de
  // contrato. Os de falha de rede/conflito entram pela varredura; os
  // demais pelos caminhos felizes.
  const todos: EstadoNome[] = [
    'documento_congelado', 'aguardando_cartao', 'aguardando_pin',
    'custodia_autorizada', 'assinando_motoboy', 'pronto_para_concluir',
    'selando', 'enfileirando', 'selado', 'aguardando_validacao',
    'cartao_recusado', 'pin_recusado', 'autorizacao_expirada', 'erro_rede', 'conflito',
  ]
  const alcancados = new Set<EstadoNome>()
  const fila: EstadoCustodia[] = [custodiaInicial(DOC)]
  const vistos = new Set<string>()
  const eventos: EventoCustodia[] = [
    { tipo: 'INICIAR' }, { tipo: 'CARTAO_LIDO', publicId: 'p', motoboyId: 'm' },
    { tipo: 'CARTAO_RECUSADO' }, { tipo: 'PIN_AUTORIZADO', autorizacaoId: 'a' },
    { tipo: 'PIN_SELADO', envelope: {} }, { tipo: 'PIN_RECUSADO' },
    { tipo: 'ASSINOU_RESPONSAVEL', strokes: [] }, { tipo: 'ASSINOU_MOTOBOY', strokes: [] },
    { tipo: 'CONCLUIR', online: true }, { tipo: 'CONCLUIR', online: false },
    { tipo: 'SELADO' }, { tipo: 'ENFILEIRADO' }, { tipo: 'CONFLITO', detalhe: {} },
    { tipo: 'ERRO_REDE' }, { tipo: 'AUTORIZACAO_EXPIROU' },
    { tipo: 'TROCAR_MOTOBOY' }, { tipo: 'CANCELAR' },
  ]
  while (fila.length > 0) {
    const atual = fila.pop()!
    alcancados.add(atual.nome)
    for (const evento of eventos) {
      const p = reduzirCustodia(atual, evento)
      const chave = `${p.nome}|${!!p.autorizacaoId}|${!!p.responsavelStrokes}|${!!p.motoboyStrokes}|${!!p.envelope}|${!!p.credencial}`
      if (!vistos.has(chave)) { vistos.add(chave); fila.push(p) }
    }
  }
  const orfaos = todos.filter((n) => !alcancados.has(n))
  checa('nenhum estado inalcançável', orfaos.length === 0, orfaos.join(', '))

  // `assinando_responsavel` fica de fora da lista de propósito: hoje a
  // máquina vai de `custodia_autorizada` direto pro traço do
  // responsável, então ele é um rótulo do desenho que o redutor não
  // produz. Está no tipo pra a tela poder nomear a etapa; se um dia
  // virar um passo de verdade, este teste cobra.
  checa('e `assinando_responsavel` é rótulo, não estado produzido',
    !alcancados.has('assinando_responsavel' as EstadoNome))
}

console.log(falhas === 0 ? '\ncustódia ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
