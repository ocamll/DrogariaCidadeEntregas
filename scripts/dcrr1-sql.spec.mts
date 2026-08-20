// Gera o SQL que confere o gêmeo PostgreSQL contra os GOLDEN VECTORS.
//
// Roda com:  npx tsx scripts/dcrr1-sql.spec.mts > conferir.sql
// e cola o resultado no SQL Editor.
//
// POR QUE ELE GERA SQL EM VEZ DE RODAR
//
// Não há CLI do Supabase configurada neste projeto, e conectar ao banco
// daqui exigiria credencial. O que dá pra fazer sem isso é emitir as
// consultas a partir dos MESMOS vetores que o lado TypeScript usa — não
// de vetores "equivalentes", que é como duas verdades nascem.
//
// O SQL gerado é auto-explicativo: cada linha devolve o nome do vetor e
// um booleano. Uma coluna `false` diz qual vetor e qual critério.
//
// TRÊS CRITÉRIOS, como no lado TypeScript: o TEXTO, os BYTES e o HASH.
// `octet_length` é o análogo de `Buffer.byteLength`, e é ele que separa
// "mudou um caractere" de "mudou a codificação" — o que o V003, fora do
// BMP, existe pra revelar.
import { VETORES, VETORES_INVALIDOS } from './dcrr1-vetores.mts'
import { paraJsonbRetorno, type EntradaRetorno } from '../src/lib/canonicoRetorno.ts'

const ASPA = String.fromCharCode(39)

/** Literal de texto do Postgres, com E'' para os escapes. */
function literal(texto: string): string {
  const escapado = texto
    .split('\\').join('\\\\')
    .split(ASPA).join(ASPA + ASPA)
    .split('\t').join('\\t')
    .split('\n').join('\\n')
  return `E${ASPA}${escapado}${ASPA}`
}

/**
 * O `p_retorno` como jsonb, na forma aninhada que o contrato exige.
 *
 * USA `paraJsonbRetorno`, a MESMA função que a tela vai usar. Isto aqui
 * já foi uma tradução própria, escrita à mão, e em 2026-08-20 ela custou
 * caro: o bloco `d` entrou no canônico e as DUAS cópias do conversor
 * ficaram sem o campo. A conferência contra o banco acusou os seis
 * vetores com documento falhando em texto/bytes/hash, e a causa não
 * estava no SQL — estava em mandar menos do que se assinou.
 *
 * Uma tradução só, no lugar de três. Se ela esquecer um campo agora, o
 * caso `paraJsonbRetorno leva tudo que o canônico assina` do
 * `canonico-retorno.spec.mts` pega antes de chegar no banco.
 */
function comoJsonb(entrada: unknown): string {
  return `${literal(JSON.stringify(paraJsonbRetorno(entrada as EntradaRetorno)))}::jsonb`
}

function chamada(entrada: unknown): string {
  const e = entrada as {
    saidaRomaneioId: string
    saidaDocumentHash: string
    motoboyId: string
    responsavelId: string
  }
  return [
    '  public.romaneio_retorno_canonico(',
    `    ${literal(e.saidaRomaneioId)}::uuid,`,
    `    ${literal(e.saidaDocumentHash)},`,
    `    ${literal(e.motoboyId)}::uuid,`,
    `    ${literal(e.responsavelId)}::uuid,`,
    `    ${comoJsonb(entrada)}`,
    '  )',
  ].join('\n')
}

// UMA CONSULTA SÓ, e isso não é estética: o SQL Editor do Supabase
// mostra apenas o resultado do ÚLTIMO statement. Emitir 20 selects
// separados fazia 19 conferências rodarem e desaparecerem — quem rodasse
// via só a última e não teria como saber das outras. Um `union all`
// devolve todas de uma vez.
// Cada conferência é um RAMO sem a palavra-chave da frente. Quem junta
// decide o que vai antes de cada um — só assim o primeiro é `select` e
// todos os outros são `union all select`.
//
// A primeira versão colocava `select` dentro do laço, então o segundo
// vetor abria um `select` novo no meio do CTE e o Postgres reclamava
// exatamente ali. Montar o texto por concatenação cega é como esse tipo
// de erro nasce; separar "o que é o ramo" de "como os ramos se ligam"
// é o que impede.
const ramos: string[] = []

for (const vetor of VETORES) {
  const r = literal(vetor.nome.split(' —')[0])
  ramos.push(`${r} as vetor, 'texto' as criterio,\n${chamada(vetor.entrada)} = ${literal(vetor.canonico)} as ok`)
  ramos.push(`${r}, 'bytes', octet_length(\n${chamada(vetor.entrada)}\n  ) = ${vetor.bytes}`)
  ramos.push(
    `${r}, 'hash', encode(digest(\n${chamada(vetor.entrada)}\n  , 'sha256'), 'hex') = ${literal(vetor.sha256)}`
  )
}

for (const vetor of VETORES_INVALIDOS) {
  const r = literal(vetor.nome.split(' —')[0])
  const e = vetor.entrada as { saidaDocumentHash: string }
  // `is not distinct from` e não `=`: se o SQL ACEITAR um vetor inválido,
  // `romaneio_retorno_validar` devolve NULL, e `NULL = 'motivo'` é NULL —
  // a linha apareceria vazia em vez de `false`, que é o pior jeito de uma
  // falha se apresentar.
  ramos.push(
    `${r}, 'motivo', public.romaneio_retorno_validar(\n    ${literal(e.saidaDocumentHash)},\n    ${comoJsonb(vetor.entrada)}\n  ) is not distinct from ${literal(vetor.motivo)}`
  )
}

const linhas = ramos.map((ramo, i) => `  ${i === 0 ? 'select' : 'union all select'} ${ramo}`)

console.log('-- =====================================================================')
console.log('-- DCRR1 — o gêmeo SQL contra os golden vectors')
console.log('--')
console.log('-- Gerado por `npx tsx scripts/dcrr1-sql.spec.mts` a partir dos MESMOS')
console.log('-- vetores que o lado TypeScript usa — não de vetores "equivalentes",')
console.log('-- que é como duas verdades nascem.')
console.log('--')
console.log('-- UMA CONSULTA SÓ: o SQL Editor mostra apenas o último statement, e')
console.log(`-- ${linhas.length} selects separados fariam ${linhas.length - 1} conferências sumirem.`)
console.log('--')
// Contado, nunca fixo. Estas duas linhas diziam "36" e "20" quando já
// eram 43 e 43, porque os vetores cresceram em 2026-08-20 e o cabeçalho
// não: número escrito à mão dentro de texto gerado envelhece calado, e
// quem for rodar a conferência lê o cabeçalho pra saber o que esperar.
console.log(
  `-- ${linhas.length} linhas: ${VETORES.length} vetores válidos × (texto, bytes, hash) + ` +
    `${VETORES_INVALIDOS.length} motivos de`
)
console.log('-- recusa. As que falharem vêm PRIMEIRO.')
console.log('-- =====================================================================')
console.log('with conferencia(vetor, criterio, ok) as (')
console.log(linhas.join('\n'))
console.log(')')
console.log('select vetor, criterio, ok from conferencia order by ok, vetor, criterio;')
console.log('')
console.log('-- E o resumo, se quiser só o número:')
console.log('--   ... select count(*) filter (where ok) as passaram,')
console.log('--              count(*) filter (where not ok) as falharam from conferencia;')
