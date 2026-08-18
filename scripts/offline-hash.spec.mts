// Teste do SEGUNDO par de gêmeos do projeto: `calcularOfflineEventHash`.
//
// Roda com:  npx tsx scripts/offline-hash.spec.mts
//
// O primeiro par (o canônico do romaneio) é TypeScript contra SQL e tem
// seção própria no CLAUDE.md. Este é TypeScript dos dois lados — em
// `src/lib/envelope.ts` e dentro de `supabase/functions/sync-romaneio/`
// —, então o risco de divergir é bem menor. Menor não é zero: os dois
// arquivos são editados em lugares diferentes, um deles é publicado à mão
// pelo dashboard, e o sintoma de divergirem é a saída offline sendo
// recusada com "o conteúdo da saída mudou depois de assinado" — uma
// mensagem que aponta pra adulteração quando a causa é um refactor.
//
// A cópia da Edge Function é EXTRAÍDA do arquivo, não reescrita aqui.
// Reescrever faria deste teste uma terceira implementação, que é
// exatamente o problema que ele existe pra detectar.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { calcularOfflineEventHash } from '../src/lib/envelope.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// ---- extrai a gêmea da Edge Function ----
const fonte = readFileSync('supabase/functions/sync-romaneio/index.ts', 'utf8')
const inicio = fonte.indexOf('async function calcularOfflineEventHash')
const fim = fonte.indexOf('\n}', fonte.indexOf('return Array.from', inicio)) + 2
if (inicio < 0 || fim < 2) throw new Error('não localizei a função na Edge Function')
const corpo = fonte.slice(inicio, fim)

type Entrada = Parameters<typeof calcularOfflineEventHash>[0]

// O trecho extraído é TypeScript, então `new Function` não serve (engasga
// na primeira anotação de tipo) e tirar os tipos na mão seria reescrever
// — justamente o que este teste existe pra detectar. A saída é gravar o
// trecho como um módulo .mts de verdade e deixar o tsx compilá-lo: o que
// roda é o texto do arquivo publicado, caractere por caractere.
const dir = mkdtempSync(join(tmpdir(), 'gemea-'))
const arquivo = join(dir, 'gemea-edge.mts')
writeFileSync(arquivo, `${corpo}\nexport { calcularOfflineEventHash }\n`, 'utf8')
const daEdge = (
  (await import(pathToFileURL(arquivo).href)) as {
    calcularOfflineEventHash: (e: Entrada) => Promise<string>
  }
).calcularOfflineEventHash

console.log(`\n  extraídas ${corpo.length} chars da Edge Function, compiladas como módulo\n`)

// ---- os casos ----
//
// Cada um mexe em UM campo, pra que uma divergência aponte pro campo.
// Os strokes imitam o formato do signature_pad (array de traços, cada um
// com pontos), porque é o que de fato viaja.
const traco = [{ points: [{ x: 1, y: 2, time: 1755400000000, pressure: 0.5 }] }]

const base: Entrada = {
  documentHash: 'a'.repeat(64),
  romaneioId: '019FE83F-1D58-70E9-8DD8-62B04E40D5EA',
  caixaStrokes: traco,
  motoboyStrokes: [{ points: [{ x: 9, y: 8, time: 1755400001000, pressure: 1 }] }],
  ocorridoEmLocal: '2026-08-17T14:32:05.123Z',
  geolocalizacao: null,
}

const casos: [string, Entrada][] = [
  ['base, geolocalização nula', base],
  ['com geolocalização', { ...base, geolocalizacao: { lat: -30.336, lon: -54.32, acc: 12.5 } }],
  ['romaneioId maiúsculo vs minúsculo', { ...base, romaneioId: base.romaneioId.toLowerCase() }],
  ['strokes vazios', { ...base, caixaStrokes: [], motoboyStrokes: [] }],
  ['strokes nulos', { ...base, caixaStrokes: null, motoboyStrokes: null }],
  ['documentHash diferente', { ...base, documentHash: 'b'.repeat(64) }],
  ['outro relógio', { ...base, ocorridoEmLocal: '2026-08-17T14:32:05.124Z' }],
  ['acento no traço', { ...base, caixaStrokes: [{ points: [], rotulo: 'José Antônio' }] }],
  ['barra invertida e aspas', { ...base, caixaStrokes: [{ rotulo: 'a\\"b|c' }] }],
  ['pipe no relógio (separador do hash)', { ...base, ocorridoEmLocal: '2026|08|17' }],
  ['geolocalização 0,0 não é null', { ...base, geolocalizacao: { lat: 0, lon: 0 } }],
  ['número grande', { ...base, caixaStrokes: [{ t: 1755400000000000 }] }],
]

const vistos = new Map<string, string>()
for (const [nome, entrada] of casos) {
  const local = await calcularOfflineEventHash(entrada)
  const edge = await daEdge(entrada)
  checa(nome, local === edge, local === edge ? local.slice(0, 16) + '…' : `${local}\n              ${edge}`)
  vistos.set(nome, local)
}

// ---- propriedades que os dois têm que ter ----
console.log('')
checa('hash tem 64 hex', /^[0-9a-f]{64}$/.test(vistos.get('base, geolocalização nula')!))
checa(
  'romaneioId é normalizado pra minúscula',
  vistos.get('base, geolocalização nula') === vistos.get('romaneioId maiúsculo vs minúsculo')
)
// Se dois casos diferentes colidissem, o hash não estaria amarrando nada.
const distintos = new Set(
  casos.filter(([n]) => n !== 'romaneioId maiúsculo vs minúsculo').map(([n]) => vistos.get(n)!)
)
checa(
  'cada entrada distinta gera hash distinto',
  distintos.size === casos.length - 1,
  `${distintos.size} de ${casos.length - 1}`
)
// A diferença entre "sem geolocalização" e "com" precisa existir: é ela
// que impede alguém trocar a localização depois de assinado.
checa(
  'geolocalização entra no hash',
  vistos.get('base, geolocalização nula') !== vistos.get('com geolocalização')
)

console.log(`\n${falhas === 0 ? 'os dois lados concordam' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
