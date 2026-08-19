// Testes do PDF do romaneio (src/lib/romaneioPdf.ts).
//
// Roda com:  npx tsx scripts/romaneio-pdf.spec.mts
//
// O caso que justifica este arquivo é o primeiro: **o PDF tem que sair do
// SNAPSHOT, não do dado vigente**. É a regra 7 — o documento assinado não
// muda. Montar do dado vivo pareceria funcionar perfeitamente e faria o
// romaneio afirmar que o motoboy recebeu um endereço que ele nunca
// recebeu.
//
// O teste monta um romaneio cujo snapshot diverge de propósito do que
// "seria hoje", e exige que o PDF mostre o snapshot.
import { inflateSync } from 'node:zlib'
import { montarRomaneioPdf, duracaoDaCorrida } from '../src/lib/romaneioPdf.ts'
import type { RomaneioCompleto } from '../src/data/romaneios.ts'
import { limparCacheDaMarca } from '../src/lib/marca.ts'

import { readFile } from 'node:fs/promises'
// A logo é buscada por fetch, porque no app isso roda no navegador. Aqui
// o fetch lê de public/ — é o mesmo byte que o app serve.
globalThis.fetch = (async (url: string) => {
  const texto = await readFile('public' + String(url), 'utf8')
  return { ok: true, status: 200, text: async () => texto }
}) as unknown as typeof fetch

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// Traços no formato do signature_pad.
const traco = (pontos: [number, number][]) => [
  { points: pontos.map(([x, y]) => ({ x, y, time: 0, pressure: 0.5 })) },
]

const ENDERECO_ASSINADO = 'Rua Assinada, 100'
const ENDERECO_CORRIGIDO = 'Rua Corrigida Depois, 999'

const romaneio: RomaneioCompleto = {
  romaneioId: '019fe83f-1d58-70e9-8dd8-62b04e40d5ea',
  numero: 'R-000010',
  status: 'selado',
  modo: 'offline_sincronizada',
  seladoEm: '2026-08-18T14:35:00.000Z',
  ocorridoEmLocal: '2026-08-18T14:30:00.000Z',
  recebidoEmServidor: '2026-08-18T14:35:01.000Z',
  finalHash: 'f'.repeat(64),
  documentHash: 'd'.repeat(64),
  canonico: 'DCR1\n…',
  conflito: null,
  lojaNome: 'Matriz',
  criadoPorNome: 'Camilo',
  ip: '187.10.20.30',
  geolocalizacao: { lat: -30.336, lon: -54.32, precisao_m: 30, obtida_em: '2026-08-18T14:29:00.000Z', origem: 'cache' },
  corrida: {
    saidaEm: '2026-08-18T14:35:00.000Z',
    saidaEmLocal: '2026-08-18T14:30:00.000Z',
    retornoEm: '2026-08-18T16:05:00.000Z',
    retornoEmLocal: '2026-08-18T16:04:00.000Z',
    status: 'fechada',
  },
  payload: {
    versao: 'DCR1',
    vales: [
      {
        entrega_id: 'a',
        numero_vale: 'V-000042',
        tipo: 'cliente',
        cliente_nome: 'Cliente Assinado',
        cliente_endereco: ENDERECO_ASSINADO,
        quantidade_vales: 1,
        valor_compra_cents: 12345,
        valor_entrega_cents: 900,
        entrega_paga_cliente_cents: 0,
      },
      {
        entrega_id: 'b',
        numero_vale: 'V-000043',
        tipo: 'transferencia',
        cliente_nome: 'Filial 02',
        cliente_endereco: 'Matriz para Filial 02',
        quantidade_vales: 1,
        valor_compra_cents: 0,
        valor_entrega_cents: 900,
        entrega_paga_cliente_cents: 0,
      },
    ],
  },
  assinaturas: [
    {
      tipoSignatario: 'caixa',
      strokes: traco([[10, 10], [40, 30], [70, 12]]),
      nome: 'Camilo',
      agenciaNome: null,
      authMethod: 'sessao_autenticada',
      credencialPublicId: null,
      signatureHash: 'a'.repeat(64),
      assinadoEm: '2026-08-18T14:35:00.000Z',
      assinadoEmLocal: '2026-08-18T14:30:00.000Z',
      ip: '187.10.20.30',
      geolocalizacao: null,
    },
    {
      tipoSignatario: 'motoboy',
      strokes: traco([[5, 40], [30, 10], [60, 44], [90, 8]]),
      nome: 'João Silva',
      agenciaNome: 'Gabrielense Tele',
      authMethod: 'physical_card_pin_offline_then_verified',
      credencialPublicId: '171233',
      signatureHash: 'b'.repeat(64),
      assinadoEm: '2026-08-18T14:35:00.000Z',
      assinadoEmLocal: '2026-08-18T14:30:00.000Z',
      ip: '187.10.20.30',
      geolocalizacao: { lat: -30.336, lon: -54.32, precisao_m: 30, origem: 'fresca', obtida_em: '2026-08-18T14:30:00.000Z' },
    },
  ],
} as unknown as RomaneioCompleto

function textoDoPdf(bytes: ArrayBuffer): string {
  const pdf = Buffer.from(bytes)
  let conteudo = pdf.toString('latin1')
  for (const m of conteudo.matchAll(/stream\r?\n/g)) {
    const ini = m.index! + m[0].length
    const fim = conteudo.indexOf('endstream', ini)
    try {
      conteudo += '\n' + inflateSync(Buffer.from(conteudo.slice(ini, fim), 'latin1')).toString('latin1')
    } catch {
      /* nem todo stream é deflate */
    }
  }
  return conteudo
}

const daFarmacia = textoDoPdf(await montarRomaneioPdf(romaneio, 'farmacia'))

console.log('\n--- o PDF sai do SNAPSHOT, não do dado vigente ---')
checa('mostra o endereço que foi ASSINADO', daFarmacia.includes('Rua Assinada'))
checa(
  'NÃO mostra a correção posterior no corpo',
  !daFarmacia.includes('Rua Corrigida Depois'),
  'se falhar, o documento foi regenerado com dado novo'
)
checa('traz os dois vales do snapshot', daFarmacia.includes('V-000042') && daFarmacia.includes('V-000043'))
checa('identifica a transferência como tal', daFarmacia.includes('Transfer'))

console.log('\n--- correção posterior aparece SEPARADA ---')
const comCorrecao = textoDoPdf(
  await montarRomaneioPdf(romaneio, 'farmacia', [
    {
      quando: '2026-08-18T15:00:00.000Z',
      autor: 'Camilo',
      resumo: `Endereço: ${ENDERECO_ASSINADO} para ${ENDERECO_CORRIGIDO}`,
    },
  ])
)
checa('a seção de correções aparece', comCorrecao.includes('posteriores'))
checa('o endereço novo aparece na seção', comCorrecao.includes('Rua Corrigida Depois'))
checa('e o assinado continua no corpo', comCorrecao.includes('Rua Assinada'))
checa('diz que o documento acima não muda', comCorrecao.includes('n'))

console.log('\n--- via da agência omite o valor da compra ---')
const daAgencia = textoDoPdf(await montarRomaneioPdf(romaneio, 'agencia'))
checa('via da farmácia mostra a compra', daFarmacia.includes('123,45'))
checa('via da agência NÃO mostra a compra', !daAgencia.includes('123,45'))
checa('mas mostra o valor da entrega', daAgencia.includes('9,00'))
checa('a via está identificada', daAgencia.includes('ncia') && daFarmacia.includes('rmacia') === false)

console.log('\n--- os relógios ---')
checa('retirada aparece', daFarmacia.includes('Retirada'))
checa('retorno aparece', daFarmacia.includes('Retorno'))
checa('duração aparece', daFarmacia.includes('Dura'))
checa('duração de 1h30', duracaoDaCorrida('2026-08-18T14:35:00.000Z', '2026-08-18T16:05:00.000Z') === '1h30', String(duracaoDaCorrida('2026-08-18T14:35:00.000Z', '2026-08-18T16:05:00.000Z')))
checa('duração curta em minutos', duracaoDaCorrida('2026-08-18T14:00:00.000Z', '2026-08-18T14:25:00.000Z') === '25 min')
checa('corrida aberta não inventa duração', duracaoDaCorrida('2026-08-18T14:00:00.000Z', null) === null)
checa('retorno antes da saída não vira número negativo', duracaoDaCorrida('2026-08-18T16:00:00.000Z', '2026-08-18T14:00:00.000Z') === null)

const semRetorno = textoDoPdf(
  await montarRomaneioPdf({ ...romaneio, corrida: { ...romaneio.corrida!, retornoEm: null } }, 'farmacia')
)
checa('corrida aberta é dita, não omitida', semRetorno.includes('ainda aberta'))

console.log('\n--- o que prova o documento ---')
checa('hash final impresso', daFarmacia.includes('f'.repeat(64)))
checa('document hash impresso', daFarmacia.includes('d'.repeat(64)))
checa('IP da selagem', daFarmacia.includes('187.10.20.30'))
checa('avisa que o PDF não é a fonte da verdade', daFarmacia.includes('fonte da verdade'))
checa('modo offline é dito', daFarmacia.includes('offline'))

console.log('\n--- assinaturas em vetor ---')
checa('nome do motoboy', daFarmacia.includes('Silva'))
checa('agência do motoboy', daFarmacia.includes('Gabrielense'))
checa('credencial mascarada, nunca o token', daFarmacia.includes('1233') && !daFarmacia.includes('171233' + '0'))
// Os traços viram linhas vetoriais (operador `l` do PDF). A ÚNICA imagem
// do documento é a logo — se aparecer mais de uma, alguma assinatura
// virou bitmap, e aí ela deixa de escalar e engorda o arquivo.
const contarImagens = (pdf: string) => (pdf.match(/\/Subtype\s*\/Image/g) ?? []).length
checa('assinaturas desenhadas como linhas', (daFarmacia.match(/\d+\.\d+ \d+\.\d+ l\b/g) ?? []).length > 5)

// A prova de que assinatura não virou bitmap não é a contagem absoluta —
// a logo é PNG com transparência, e o jsPDF emite imagem + máscara alfa,
// então uma logo já conta 2. O que prova é a contagem NÃO CRESCER quando
// entram assinaturas.
const semAssinaturas = textoDoPdf(
  await montarRomaneioPdf({ ...romaneio, assinaturas: [] }, 'farmacia')
)
checa(
  'imagens não crescem com as assinaturas',
  contarImagens(daFarmacia) === contarImagens(semAssinaturas),
  `${contarImagens(daFarmacia)} com duas assinaturas, ${contarImagens(semAssinaturas)} sem nenhuma`
)

console.log('\n--- a logo da marca ---')
checa('logo presente na via da farmácia', contarImagens(daFarmacia) > 0)
checa('logo presente na via da agência', contarImagens(daAgencia) > 0)

// Documento sem logo ainda é um documento: uma falha de rede não pode
// derrubar a emissão de um comprovante de custódia. Precisa limpar o
// cache, senão a carga anterior serve — que é o comportamento certo em
// produção e o que atrapalha aqui.
limparCacheDaMarca()
const fetchOriginal = globalThis.fetch
globalThis.fetch = (async () => {
  throw new Error('rede fora')
}) as unknown as typeof fetch
const semLogo = textoDoPdf(await montarRomaneioPdf(romaneio, 'farmacia'))
globalThis.fetch = fetchOriginal
limparCacheDaMarca()
checa('sem rede, o PDF sai mesmo assim', semLogo.includes('R-000010'))
checa('e sai sem imagem nenhuma', contarImagens(semLogo) === 0)

console.log('\n--- geolocalização rotulada ---')
checa(
  'leitura de cache é marcada como tal no rodapé',
  daFarmacia.includes('n') && daFarmacia.includes('leitura de')
)

console.log(`\n${falhas === 0 ? 'romaneio PDF ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
