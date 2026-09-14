// npx tsx scripts/dcr1-vetores.spec.mts
//
// Confere os GOLDEN VECTORS do DCR1 (`scripts/dcr1-vetores.mts`) em três
// frentes, e cada uma prova uma coisa diferente:
//
//   1. o VETOR contra a especificação: hash e bytes correspondem ao texto,
//      blocos na ordem v → p → r, e `r` só para vale com receita;
//   2. a IMPLEMENTAÇÃO (`montarCanonico`) contra o vetor, byte a byte;
//   3. a implementação ANTERIOR à linha `r` (19402cd), lida do git: sem
//      receita, as duas produzem os mesmos bytes. É a prova de que nenhuma
//      saída sem receita mudou — medida, e não "li o código e não mudou".
//
// O lado SQL não roda aqui: `romaneio_canonico` lê de tabelas. A conferência
// dele é `scripts/conferir-canonico-no-console.js`, em dado real.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { montarCanonico, type EntradaCanonica } from '../src/lib/canonico.ts'
import { VETORES_DA_SAIDA, type EntradaDaSaida } from './dcr1-vetores.mts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const tipoDa = (linha: string) => linha.split('\t')[0]

for (const vetor of VETORES_DA_SAIDA) {
  console.log(`\n--- ${vetor.nome} ---`)

  // ---- o vetor corresponde a si mesmo ----------------------------------
  const calculado = createHash('sha256').update(vetor.canonico, 'utf8').digest('hex')
  checa('sha256 corresponde ao texto', calculado === vetor.sha256, calculado)
  const bytes = Buffer.byteLength(vetor.canonico, 'utf8')
  checa('bytes correspondem ao texto', bytes === vetor.bytes, String(bytes))

  // ---- o vetor contra a especificação ----------------------------------
  const linhas = vetor.canonico.split('\n')
  checa('abre com DCR1', linhas[0] === 'DCR1')
  checa(
    'as seis linhas de cabeçalho, na ordem',
    ['tenant', 'loja', 'agencia', 'motoboy', 'caixa', 'vales'].every((r, i) => tipoDa(linhas[i + 1] ?? '') === r)
  )
  checa('a contagem de vales bate', linhas[6] === `vales\t${vetor.entrada.vales.length}`)
  checa('não termina em quebra de linha', !vetor.canonico.endsWith('\n'))

  const corpo = linhas.slice(7)
  checa('só linhas v, p e r depois do cabeçalho', corpo.every((l) => ['v', 'p', 'r'].includes(tipoDa(l))))
  const ordem = corpo.map(tipoDa).join('')
  checa('blocos na ordem v → p → r, sem intercalar', /^v*p*r*$/.test(ordem), ordem)

  const vs = corpo.filter((l) => tipoDa(l) === 'v').map((l) => l.split('\t'))
  const rs = corpo.filter((l) => tipoDa(l) === 'r').map((l) => l.split('\t'))
  const ids = vs.map((c) => c[1])
  checa('uma linha v por vale', vs.length === vetor.entrada.vales.length)
  checa('toda linha v tem 12 campos', vs.every((c) => c.length === 12))
  checa('vales ordenados por entrega_id (code unit)', JSON.stringify(ids) === JSON.stringify([...ids].sort()))
  checa('toda linha r tem 2 campos', rs.every((c) => c.length === 2))
  const comReceita = vetor.entrada.vales
    .filter((v) => v.temReceita)
    .map((v) => v.entregaId)
    .sort()
  checa(
    'uma linha r por vale COM receita, e só eles, em ordem',
    JSON.stringify(rs.map((c) => c[1])) === JSON.stringify(comReceita),
    rs.map((c) => c[1].slice(-2)).join(' ') || 'nenhuma'
  )
  checa('toda linha r aponta pra um vale presente', rs.every((c) => ids.includes(c[1])))

  // ---- a implementação contra o vetor ----------------------------------
  checa('montarCanonico reproduz o vetor byte a byte', montarCanonico(vetor.entrada) === vetor.canonico)
}

console.log('\n--- entre vetores ---')
const [s001, s002] = VETORES_DA_SAIDA
checa(
  'S002 é o S001 com a linha r a mais, e nada além',
  s002.canonico === `${s001.canonico}\nr\t${s001.entrada.vales[0].entregaId}`
)
checa('nenhum vetor repete o hash de outro',
  new Set(VETORES_DA_SAIDA.map((v) => v.sha256)).size === VETORES_DA_SAIDA.length)
checa('todo vetor explica por que existe', VETORES_DA_SAIDA.every((v) => v.porque.trim().length > 40))

// ---- a implementação ANTERIOR ------------------------------------------
console.log('\n--- a implementação anterior à linha r (19402cd) ---')
const COMMIT = '19402cd'
let anterior: ((entrada: EntradaCanonica) => string) | null = null
try {
  const fonte = execFileSync('git', ['show', `${COMMIT}:src/lib/canonico.ts`], { encoding: 'utf8' })
  const arquivo = join(mkdtempSync(join(tmpdir(), 'dcr1-anterior-')), 'canonico.ts')
  writeFileSync(arquivo, fonte)
  anterior = (await import(pathToFileURL(arquivo).href)).montarCanonico
} catch (erro) {
  checa(`leu src/lib/canonico.ts de ${COMMIT} pelo git`, false, String(erro).split('\n')[0])
}

if (anterior) {
  const semReceita = (e: EntradaDaSaida): EntradaDaSaida => ({
    ...e,
    vales: e.vales.map((v) => ({ ...v, temReceita: false })),
  })
  checa('S001 é exatamente o que a implementação anterior produzia',
    anterior(s001.entrada) === s001.canonico)
  for (const vetor of VETORES_DA_SAIDA) {
    const entrada = semReceita(vetor.entrada)
    checa(
      `${vetor.nome.split(' —')[0]} sem receita: os mesmos bytes nas duas implementações`,
      montarCanonico(entrada) === anterior(entrada)
    )
  }
}

console.log(falhas === 0 ? '\nvetores DCR1 ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
