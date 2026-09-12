// O hash do evento offline da SAÍDA, versão 2 — 4B, 2026-09-12.
//
//   npx tsx scripts/offline-hash-v2.spec.mts
//
// Mesma disciplina do `offline-hash.spec.mts`, que continua cobrindo a
// versão 1 (ainda usada pelo retorno): a cópia da Edge Function é
// EXTRAÍDA do arquivo publicado, nunca reescrita aqui. Reescrever faria
// deste teste uma terceira implementação — o defeito que ele existe pra
// detectar.
//
// E há uma terceira referência: os digests CONGELADOS abaixo foram
// calculados com sha256 puro sobre a string do comentário, antes de
// qualquer uma das duas implementações existir. Os dois gêmeos
// concordarem entre si não prova que estão certos; os dois concordarem
// com uma referência escrita antes deles, sim.
//
// A fórmula:
//
//   OEV2|documentHash|romaneioId|saida|validacao|motivoExcecao ou '-'|
//        motoboyId|ocorridoEmLocal
//
// SAEM os traços e a geolocalização. FICAM o relógio do balcão e a
// modalidade de autorização — o que está no corpo da requisição e não
// está no documento canônico, e que por isso precisa estar preso ao
// envelope.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  calcularOfflineEventHashSaidaV2,
  calcularOfflineEventHashRetornoV2,
} from '../src/lib/envelope.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

type Entrada = Parameters<typeof calcularOfflineEventHashSaidaV2>[0]
type Gemea = (e: Entrada) => Promise<string>

// ---- extrai as gêmeas da Edge Function, pelo NOME, uma por arquivo ----
const fonte = readFileSync('supabase/functions/sync-romaneio/index.ts', 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'gemea-v2-'))

async function extrair(nome: string): Promise<Gemea> {
  const inicio = fonte.indexOf(`async function ${nome}(`)
  if (inicio < 0) throw new Error(`não localizei ${nome} na Edge Function`)
  const fim = fonte.indexOf('\n}', fonte.indexOf('return Array.from', inicio)) + 2
  const corpo = fonte.slice(inicio, fim)
  const arquivo = join(dir, `${nome}.mts`)
  writeFileSync(arquivo, `${corpo}\nexport { ${nome} }\n`, 'utf8')
  console.log(`  extraídas ${corpo.length} chars de ${nome}`)
  return ((await import(pathToFileURL(arquivo).href)) as Record<string, Gemea>)[nome]
}

const daEdge = await extrair('calcularOfflineEventHashSaidaV2')
const retornoDaEdge = await extrair('calcularOfflineEventHashRetornoV2')
console.log('')

const base: Entrada = {
  documentHash: 'a'.repeat(64),
  romaneioId: '019fe83f-1d58-70e9-8dd8-62b04e40d5ea',
  validacao: 'motoboy',
  motivoExcecao: null,
  motoboyId: '019fe840-0000-7000-8000-000000000002',
  ocorridoEmLocal: '2026-09-12T14:32:05.123Z',
}

// ---------------------------------------------------------------------
// (1) OS VETORES CONGELADOS — a terceira referência
// ---------------------------------------------------------------------

const congelados: [string, Entrada, string][] = [
  // OEV2|aaaa…aaaa|019fe83f-…d5ea|saida|motoboy|-|019fe840-…0002|2026-09-12T14:32:05.123Z
  ['motoboy, fluxo normal', base,
   '8903f2802957db5a8b520a22063e5c0497293de0f8ab704483330d06ace959a3'],
  // …|saida|gerente|cartao_perdido|…
  ['gerente, cartão perdido', { ...base, validacao: 'gerente', motivoExcecao: 'cartao_perdido' },
   '76d67067c0e37adfb31a72b18c24da9999f15e1396e79d4c2b7a5782ad2292b8'],
  // …|saida|gerente|pin_esquecido|…
  ['gerente, PIN esquecido', { ...base, validacao: 'gerente', motivoExcecao: 'pin_esquecido' },
   'c0c7b6d5cefa12bed071a6da4c40d2825bda410c8c38e2bd20e11a1100732064'],
]

for (const [nome, entrada, esperado] of congelados) {
  const local = await calcularOfflineEventHashSaidaV2(entrada)
  const edge = await daEdge(entrada)
  checa(`${nome}: cliente = congelado`, local === esperado, local === esperado ? '' : local)
  checa(`${nome}: Edge = congelado`, edge === esperado, edge === esperado ? '' : edge)
}

// ---------------------------------------------------------------------
// (2) OS DOIS GÊMEOS CONCORDAM, campo a campo
// ---------------------------------------------------------------------

const casos: [string, Entrada][] = [
  ['ids em MAIÚSCULA', { ...base, romaneioId: base.romaneioId.toUpperCase(), motoboyId: base.motoboyId.toUpperCase() }],
  ['outro documento', { ...base, documentHash: 'b'.repeat(64) }],
  ['outro relógio', { ...base, ocorridoEmLocal: '2026-09-12T14:32:05.124Z' }],
  ['pipe no relógio', { ...base, ocorridoEmLocal: '2026|09|12' }],
]
for (const [nome, entrada] of casos) {
  const local = await calcularOfflineEventHashSaidaV2(entrada)
  const edge = await daEdge(entrada)
  checa(`gêmeos concordam: ${nome}`, local === edge)
}

// ---------------------------------------------------------------------
// (3) PROPRIEDADES — o que o hash TEM que distinguir
// ---------------------------------------------------------------------

const h = (e: Entrada) => calcularOfflineEventHashSaidaV2(e)

checa('maiúscula e minúscula dão o MESMO hash (ids são normalizados)',
  (await h(base)) === (await h({ ...base, romaneioId: base.romaneioId.toUpperCase(), motoboyId: base.motoboyId.toUpperCase() })))

// É ISTO que impede trocar o modo só no corpo da requisição.
checa('motoboy ≠ gerente',
  (await h(base)) !== (await h({ ...base, validacao: 'gerente', motivoExcecao: 'cartao_perdido' })))

checa('cartão perdido ≠ PIN esquecido',
  (await h({ ...base, validacao: 'gerente', motivoExcecao: 'cartao_perdido' }))
    !== (await h({ ...base, validacao: 'gerente', motivoExcecao: 'pin_esquecido' })))

// O motoboy entra no hash: trocar quem leva os vales no corpo, mantendo o
// envelope, tem que ser recusado como payload alterado.
checa('outro motoboy muda o hash',
  (await h(base)) !== (await h({ ...base, motoboyId: '019fe840-0000-7000-8000-000000000009' })))

checa('hash tem 64 hex', /^[0-9a-f]{64}$/.test(await h(base)))

// ---------------------------------------------------------------------
// (4) O RETORNO, versão 2 — 4B, 2026-09-12
//
//   OEV2|documentHash|romaneioId|retorno|validacao|motivo ou '-'|
//        motoboyId|ocorridoEmLocal
//
// Os três digests abaixo foram calculados com sha256 puro (Python
// hashlib) sobre as strings do comentário, ANTES de a função existir nos
// dois lados — mesma disciplina dos da saída.
// ---------------------------------------------------------------------

const congeladosRetorno: [string, Entrada, string][] = [
  // OEV2|aaaa…aaaa|019fe83f-…d5ea|retorno|motoboy|-|019fe840-…0002|2026-09-12T14:32:05.123Z
  ['retorno, motoboy', base,
   '1590375e6e55ddaea67c94ad258f5c58379f4f0279686a3faac1350a14319ee3'],
  ['retorno, gerente, cartão perdido', { ...base, validacao: 'gerente', motivoExcecao: 'cartao_perdido' },
   'ccb77cf98878e26fb2f0d7ae8930623b43caee49128284bf4c45cf04df1ce8e4'],
  ['retorno, gerente, PIN esquecido', { ...base, validacao: 'gerente', motivoExcecao: 'pin_esquecido' },
   'ff3fac3f7e5dbc3e37b257acca884bcc46ad981dce54d31b83a87c6f41bccb10'],
]

for (const [nome, entrada, esperado] of congeladosRetorno) {
  const local = await calcularOfflineEventHashRetornoV2(entrada)
  const edge = await retornoDaEdge(entrada)
  checa(`${nome}: cliente = congelado`, local === esperado, local === esperado ? '' : local)
  checa(`${nome}: Edge = congelado`, edge === esperado, edge === esperado ? '' : edge)
}

for (const [nome, entrada] of casos) {
  checa(`gêmeos do retorno concordam: ${nome}`,
    (await calcularOfflineEventHashRetornoV2(entrada)) === (await retornoDaEdge(entrada)))
}

const hr = (e: Entrada) => calcularOfflineEventHashRetornoV2(e)

// O literal do documento separa os dois: um envelope de saída não serve de
// retorno nem com as mesmas entradas.
checa('retorno ≠ saída com as mesmas entradas', (await hr(base)) !== (await h(base)))
checa('retorno: motoboy ≠ gerente',
  (await hr(base)) !== (await hr({ ...base, validacao: 'gerente', motivoExcecao: 'pin_esquecido' })))
checa('retorno: outro motoboy muda o hash',
  (await hr(base)) !== (await hr({ ...base, motoboyId: '019fe840-0000-7000-8000-000000000009' })))

// ---------------------------------------------------------------------
// (5) A VERSÃO 1 FICOU SEM CHAMADOR — e sai na limpeza dos traços
// ---------------------------------------------------------------------

const handler = fonte.slice(fonte.indexOf('Deno.serve('))
checa('o handler da Edge Function não chama mais a versão 1',
  !handler.includes('calcularOfflineEventHash('))
checa('e o retorno do handler usa a versão 2',
  handler.includes('calcularOfflineEventHashRetornoV2({'))

console.log(falhas === 0 ? '\nhash offline v2 ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
