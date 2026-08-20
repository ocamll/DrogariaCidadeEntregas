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

/** O `p_retorno` como jsonb, na forma aninhada que o contrato exige. */
function comoJsonb(entrada: unknown): string {
  const e = entrada as {
    vales: {
      entregaId: string
      desfecho: string
      motivo: string | null
      detalhe: string | null
      pagamentosRealizados: {
        pagamentoId: string
        forma: string
        valorCents: number
        trocoCents: number
      }[]
    }[]
  }
  const vales = e.vales.map((v) => ({
    entrega_id: v.entregaId,
    desfecho: v.desfecho,
    motivo: v.motivo,
    detalhe: v.detalhe,
    pagamentos_realizados: (v.pagamentosRealizados ?? []).map((p) => ({
      pagamento_id: p.pagamentoId,
      forma: p.forma,
      valor_cents: p.valorCents,
      troco_cents: p.trocoCents,
    })),
  }))
  return `${literal(JSON.stringify(vales))}::jsonb`
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
// devolve as 36 linhas de uma vez.
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
console.log('-- 20 selects separados fariam 19 conferências sumirem.')
console.log('--')
console.log('-- 36 linhas: 8 vetores válidos × (texto, bytes, hash) + 12 motivos de')
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
