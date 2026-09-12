// npx tsx scripts/despacho-sync-romaneio.spec.mts
//
// A MATRIZ DE COMPATIBILIDADE DO DESPACHO, e a ordem em que ele acontece.
//
// As funções são EXTRAÍDAS de `supabase/functions/sync-romaneio/index.ts`,
// nunca reescritas aqui — mesma disciplina do `offline-hash.spec.mts` e
// do `envelope.spec.mts`. Reescrever faria deste spec uma segunda
// implementação da regra que ele deveria conferir, que é exatamente o
// defeito das três cópias do conversor (item 65).
//
// A segunda metade é uma checagem de ORDEM sobre o texto do handler. Ela
// é grosseira de propósito: não dá pra rodar Deno aqui, e a invariante
// que o usuário exigiu — *uma operação recusada por tipo divergente não
// chega a nenhuma RPC de selagem* — é sobre onde as coisas acontecem, não
// sobre o que elas devolvem. Uma amarração conferida DEPOIS do despacho
// seria diagnóstico posterior, não condição de entrada.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const CAMINHO = 'supabase/functions/sync-romaneio/index.ts'
const fonte = readFileSync(CAMINHO, 'utf8')

/**
 * O FONTE SEM PROSA, pras asserções que leem TEXTO — E4 (2026-08-27).
 *
 * `fonte` continua cru de propósito: ele alimenta a EXTRAÇÃO das funções
 * que este spec depois executa de verdade, e ali comentário é inofensivo.
 * O que não é inofensivo é asserção de texto lendo comentário, e este
 * arquivo tem a variedade mais exposta delas — o bloco da ordem afirma
 * POSIÇÃO:
 *
 *     const primeiraRpc = pos('.rpc(')
 *     checa(..., p > 0 && p < primeiraRpc)
 *
 * Um `.rpc(` citado num comentário antes da chamada real puxaria a
 * fronteira pra trás e faria checagens corretas falharem; e
 * `handler.split('.rpc(')` contaria três portas onde há duas.
 *
 * Medido em 2026-08-27: hoje nenhuma das asserções deste arquivo depende
 * de comentário — a saída é idêntica com e sem a limpeza. A mudança é
 * profilática, e existe porque a Edge Function é dos arquivos mais
 * comentados do projeto: a próxima linha de explicação é que morde.
 */
const codigo = (f: string) =>
  f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const fonteCodigo = codigo(fonte)

// ---- extrai as três funções de resolução ----
const inicio = fonte.indexOf('function resolverTipoDoRomaneio')
const fim = fonte.indexOf('async function abrirEnvelope')
if (inicio < 0 || fim < 0) throw new Error('não achei o bloco de resolução de tipo')

const dir = mkdtempSync(join(tmpdir(), 'despacho-'))
const arquivo = join(dir, 'tipos.mts')
writeFileSync(
  arquivo,
  'type Segredos = { tipo?: string }\n' +
    fonte.slice(inicio, fim) +
    '\nexport { resolverTipoDoRomaneio, resolverTipoDoBody, conciliarTipos }\n',
  'utf8'
)

type Tipo = 'saida' | 'retorno' | null
const mod = (await import(pathToFileURL(arquivo).href)) as {
  resolverTipoDoRomaneio: (s: { tipo?: string }) => Tipo
  resolverTipoDoBody: (c: Record<string, unknown>) => Tipo
  conciliarTipos: (
    b: Tipo,
    e: Tipo
  ) => { tipo: 'saida' | 'retorno' } | { motivo: string; erro: string }
}

// O que o handler faz, montado a partir das MESMAS funções.
function decidir(bodyTipo?: string, envelopeTipo?: string) {
  const corpo: Record<string, unknown> = bodyTipo === undefined ? {} : { tipo: bodyTipo }
  const segredos = envelopeTipo === undefined ? {} : { tipo: envelopeTipo }
  const r = mod.conciliarTipos(
    mod.resolverTipoDoBody(corpo),
    mod.resolverTipoDoRomaneio(segredos),
    { body: corpo.tipo === undefined, envelope: segredos.tipo === undefined }
  )
  return 'tipo' in r ? r.tipo : `RECUSA:${r.motivo}`
}

const A = '(ausente)'
console.log('\n--- a matriz inteira ---')

// A MATRIZ ENCOLHEU EM 2026-08-25, e encolher é o resultado.
//
// Até aqui, ausência significava `saida` — compatibilidade com os
// envelopes selados antes da 2C.5. O corte para a V1 zera o Supabase e a
// Dexie v7 apaga a fila local, então não existe envelope antigo em lugar
// nenhum, e a frouxidão passou a não proteger dado nenhum.
//
// As QUATRO linhas que aceitavam ausência viraram recusa. Sobrou o caso
// simétrico: os dois lados dizem a mesma coisa, explicitamente.
//
// E ausência tem motivo PRÓPRIO (`tipo_ausente`), separado de
// `tipo_desconhecido`: no dia da virada, "bundle antigo numa aba que
// ninguém recarregou" e "corpo corrompido" pedem coisas opostas — um F5
// contra uma investigação —, e um motivo só faria os dois se parecerem.
const matriz: Array<[string, string, string]> = [
  // body        envelope     esperado
  ['saida', 'saida', 'saida'],
  ['retorno', 'retorno', 'retorno'],
  ['saida', 'retorno', 'RECUSA:tipo_divergente'],
  ['retorno', 'saida', 'RECUSA:tipo_divergente'],
  // As quatro que mudaram de resposta. Elas ficam na tabela EM VEZ DE
  // sumir: o que este teste congela agora é que ausência NÃO PASSA, e
  // apagá-las deixaria a regra nova sem quem a cobrasse.
  [A, A, 'RECUSA:tipo_ausente'],
  ['saida', A, 'RECUSA:tipo_ausente'],
  [A, 'saida', 'RECUSA:tipo_ausente'],
  [A, 'retorno', 'RECUSA:tipo_ausente'],
  ['retorno', A, 'RECUSA:tipo_ausente'],
  // Valor estranho continua sendo outra coisa, e com outro motivo.
  ['coisa_nova', 'saida', 'RECUSA:tipo_desconhecido'],
  ['saida', 'coisa_nova', 'RECUSA:tipo_desconhecido'],
  ['coisa_nova', 'coisa_nova', 'RECUSA:tipo_desconhecido'],
]

for (const [body, envelope, esperado] of matriz) {
  const obtido = decidir(body === A ? undefined : body, envelope === A ? undefined : envelope)
  checa(
    `body=${body.padEnd(11)} envelope=${envelope.padEnd(11)} → ${esperado}`,
    obtido === esperado,
    obtido === esperado ? '' : `veio ${obtido}`
  )
}

console.log('\n--- o que a matriz garante, dito de outro jeito ---')
{
  // "Retorno exige explícito nos dois lados" NÃO é um `if` separado: é
  // consequência da igualdade, porque ausência nunca resolve `retorno`.
  // Este caso existe pra que a propriedade fique escrita como
  // propriedade, e não só espalhada em quatro linhas da tabela acima.
  const combinacoes = [
    [undefined, undefined],
    ['saida', undefined],
    [undefined, 'saida'],
    ['saida', 'saida'],
    ['retorno', undefined],
    [undefined, 'retorno'],
    ['saida', 'retorno'],
    ['retorno', 'saida'],
  ] as const
  const queDaoRetorno = combinacoes.filter(([b, e]) => decidir(b, e) === 'retorno')
  checa(
    'NENHUMA combinação sem os dois explícitos produz retorno',
    queDaoRetorno.length === 0,
    queDaoRetorno.length ? JSON.stringify(queDaoRetorno) : ''
  )
  checa('e com os dois explícitos, produz', decidir('retorno', 'retorno') === 'retorno')
}

console.log('\n--- a ordem: primeiro prova o envelope, depois escolhe a porta ---')
{
  const handler = fonteCodigo.slice(fonteCodigo.indexOf('Deno.serve('))
  const pos = (agulha: string) => handler.indexOf(agulha)

  const primeiraRpc = pos('.rpc(')
  checa('o handler chama alguma RPC', primeiraRpc > 0)

  const antesDaRpc: Array<[string, string]> = [
    ['dono conferido contra o JWT', 'donoDaOperacao !== auth.user.id'],
    ['envelope aberto', 'await abrirEnvelope('],
    ['tipo conciliado corpo × envelope', 'conciliarTipos('],
    ['operationId conferido', 'segredos.operationId.toLowerCase()'],
    ['documentHash conferido', 'segredos.documentHash !== documentHash'],
    ['offlineEventHash recalculado', 'hashRecalculado !== segredos.offlineEventHash'],
  ]
  for (const [nome, agulha] of antesDaRpc) {
    const p = pos(agulha)
    checa(`${nome} ANTES de qualquer RPC`, p > 0 && p < primeiraRpc, p < 0 ? 'não achei' : '')
  }

  // Duas portas, e só duas.
  const quantasRpc = handler.split('.rpc(').length - 1
  checa('exatamente duas RPCs de selagem', quantasRpc === 2, `achei ${quantasRpc}`)
  checa('a porta da saída existe', handler.includes("'selar_romaneio_sincronizado'"))
  checa('a porta do retorno existe', handler.includes("'selar_romaneio_retorno_sincronizado'"))

  // A recusa por tipo é um `return`, não um aviso.
  const trechoConciliacao = handler.slice(pos('conciliarTipos('), pos('const romaneioId'))
  checa(
    'tipo divergente RETORNA, não segue adiante',
    /return responder\(/.test(trechoConciliacao),
    ''
  )
}

console.log('\n--- 4B: nenhum traço, e o modo de validação conferido nos DOIS tipos ---')
{
  const handler = fonteCodigo.slice(fonteCodigo.indexOf('Deno.serve('))
  // `pos` e `primeiraRpc` do bloco da ORDEM não existem aqui — cada bloco
  // tem o próprio escopo, e usá-los rendia `ReferenceError`. Estas são as
  // mesmas medidas, sobre o mesmo `handler` deste bloco.
  const posAqui = (agulha: string) => handler.indexOf(agulha)
  const primeiraRpcAqui = posAqui('.rpc(')

  // A RECUSA DE TRAÇO NÃO DEPENDE DO TIPO. Até o retorno v2 ela era
  // `tipo === 'saida' && …`, e o retorno EXIGIA traço; agora qualquer
  // traço em qualquer corpo é bundle anterior ao 4B.
  const recusaTraco = posAqui('corpo.caixaStrokes !== undefined ||')
  checa('recusa qualquer traço, em qualquer tipo',
    recusaTraco > 0 &&
      handler.includes('corpo.motoboyStrokes !== undefined ||') &&
      handler.includes('corpo.responsavelStrokes !== undefined'))
  checa('e a recusa não está presa a um tipo',
    !handler.slice(recusaTraco - 80, recusaTraco).includes('tipo ==='))
  checa('a recusa de traço vem ANTES de qualquer RPC', recusaTraco > 0 && recusaTraco < primeiraRpcAqui)
  checa('nada no handler lê traço do corpo para usar',
    !handler.includes('Strokes: corpo.') && !handler.includes('p_responsavel_strokes') &&
      !handler.includes('p_motoboy_strokes'))

  checa('modo × envelope conferido ANTES de qualquer RPC',
    posAqui("motivo: 'validacao_divergente'") > 0 &&
      posAqui("motivo: 'validacao_divergente'") < primeiraRpcAqui)
  checa('domínio do modo conferido ANTES de qualquer RPC',
    posAqui("motivo: 'validacao_invalida'") > 0 &&
      posAqui("motivo: 'validacao_invalida'") < primeiraRpcAqui)
  // A conferência do modo valia só para a saída; o retorno v2 a herda.
  const trechoDoModo = handler.slice(posAqui('const modoValido'), posAqui("motivo: 'validacao_divergente'"))
  checa('e a conferência do modo não está presa à saída', !trechoDoModo.includes("tipo === 'saida'"))

  checa('a saída usa o hash offline v2', handler.includes('calcularOfflineEventHashSaidaV2({'))
  checa('o retorno usa o hash offline v2', handler.includes('calcularOfflineEventHashRetornoV2({'))

  for (const [rotulo, rpc] of [
    ['saída', "'selar_romaneio_sincronizado'"],
    ['retorno', "'selar_romaneio_retorno_sincronizado'"],
  ] as const) {
    const trecho = handler.slice(handler.indexOf(rpc))
    const ateOFim = trecho.slice(0, trecho.indexOf('})'))
    checa(`a RPC do ${rotulo} não manda traço nenhum`, !/strokes/i.test(ateOFim))
    checa(`a RPC do ${rotulo} manda modo e motivo`,
      ateOFim.includes('p_validacao:') && ateOFim.includes('p_motivo:'))
  }
}

console.log(falhas === 0 ? '\ndespacho ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
