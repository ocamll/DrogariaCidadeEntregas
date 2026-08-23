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
  const r = mod.conciliarTipos(mod.resolverTipoDoBody(corpo), mod.resolverTipoDoRomaneio(segredos))
  return 'tipo' in r ? r.tipo : `RECUSA:${r.motivo}`
}

const A = '(ausente)'
console.log('\n--- a matriz inteira ---')
const matriz: Array<[string, string, string]> = [
  // body        envelope     esperado
  [A, A, 'saida'], //            o que já rodava, e continua rodando
  ['saida', A, 'saida'], //      ROLLOUT: item capturado antes da 2C.5
  [A, 'saida', 'saida'], //      cliente antigo, envelope novo
  ['saida', 'saida', 'saida'],
  ['retorno', 'retorno', 'retorno'],
  ['retorno', A, 'RECUSA:tipo_divergente'], //  ausência nunca vira retorno
  [A, 'retorno', 'RECUSA:tipo_divergente'],
  ['saida', 'retorno', 'RECUSA:tipo_divergente'],
  ['retorno', 'saida', 'RECUSA:tipo_divergente'],
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
  const handler = fonte.slice(fonte.indexOf('Deno.serve('))
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

console.log('\n--- o vocabulário dos traços é rígido por tipo ---')
{
  const handler = fonte.slice(fonte.indexOf('Deno.serve('))
  checa(
    'retorno lê responsavelStrokes',
    handler.includes("tipo === 'retorno' ? corpo.responsavelStrokes : corpo.caixaStrokes")
  )
  checa(
    'e recusa retorno sem responsavelStrokes',
    handler.includes("corpo.responsavelStrokes === undefined")
  )
  // RECUSA os dois sentidos, e não só a ausência. Ignorar um campo do
  // protocolo errado seria aceitar em silêncio um corpo confuso.
  checa(
    'recusa retorno que traga caixaStrokes',
    handler.includes("tipo === 'retorno' && corpo.caixaStrokes !== undefined")
  )
  checa(
    'recusa saída que traga responsavelStrokes',
    handler.includes("tipo === 'saida' && corpo.responsavelStrokes !== undefined")
  )
  // Sem fallback: o retorno nunca pode cair em caixaStrokes.
  const rpcRetorno = handler.slice(handler.indexOf("'selar_romaneio_retorno_sincronizado'"))
  const ateOFim = rpcRetorno.slice(0, rpcRetorno.indexOf('})'))
  checa('a RPC do retorno não menciona caixaStrokes', !ateOFim.includes('caixaStrokes'))
}

console.log(falhas === 0 ? '\ndespacho ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
