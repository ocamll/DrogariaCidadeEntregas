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

console.log('-- =====================================================================')
console.log('-- DCRR1 — o gêmeo SQL contra os golden vectors')
console.log('--')
console.log('-- Gerado por `npx tsx scripts/dcrr1-sql.spec.mts` a partir dos MESMOS')
console.log('-- vetores que o lado TypeScript usa. Toda coluna tem que vir `true`.')
console.log('-- =====================================================================')
console.log('')

console.log('-- ---- os oito válidos: texto, bytes e hash --------------------------')
for (const vetor of VETORES) {
  const rotulo = vetor.nome.split(' —')[0]
  console.log(`select ${literal(rotulo)} as vetor,`)
  console.log(`${chamada(vetor.entrada)} = ${literal(vetor.canonico)} as texto,`)
  console.log(`  octet_length(`)
  console.log(`${chamada(vetor.entrada)}`)
  console.log(`  ) = ${vetor.bytes} as bytes,`)
  console.log(`  encode(digest(`)
  console.log(`${chamada(vetor.entrada)}`)
  console.log(`  , 'sha256'), 'hex') = ${literal(vetor.sha256)} as hash;`)
  console.log('')
}

console.log('-- ---- os doze inválidos: o MESMO motivo do lado TypeScript ----------')
console.log('-- `romaneio_retorno_validar` devolve o motivo; `_canonico` levanta.')
console.log('-- O motivo faz parte do contrato: recusar pelo motivo errado é tão')
console.log('-- divergente quanto aceitar.')
for (const vetor of VETORES_INVALIDOS) {
  const rotulo = vetor.nome.split(' —')[0]
  const e = vetor.entrada as { saidaDocumentHash: string }
  console.log(`select ${literal(rotulo)} as vetor,`)
  console.log(`  public.romaneio_retorno_validar(`)
  console.log(`    ${literal(e.saidaDocumentHash)},`)
  console.log(`    ${comoJsonb(vetor.entrada)}`)
  console.log(`  ) = ${literal(vetor.motivo)} as motivo_confere;`)
}
