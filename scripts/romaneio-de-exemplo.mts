// Gera um romaneio de exemplo em PDF, nas duas vias.
//
// Roda com:  npx tsx scripts/romaneio-de-exemplo.mts [destino]
//
// Dado fictício, pra conferir o desenho sem depender de ter um romaneio
// real no banco nem de estar logado. Serve também de referência do que
// cada via mostra: a da farmácia leva o valor da compra, a da agência
// não.
import { writeFileSync } from 'node:fs'
import { montarRomaneioPdf } from '../src/lib/romaneioPdf.ts'
import type { RomaneioCompleto } from '../src/data/romaneios.ts'

import { readFile } from 'node:fs/promises'
// A logo é buscada por fetch, porque no app isso roda no navegador. Aqui
// o fetch lê de public/ — é o mesmo byte que o app serve.
globalThis.fetch = (async (url: string) => {
  const texto = await readFile('public' + String(url), 'utf8')
  return { ok: true, status: 200, text: async () => texto }
}) as unknown as typeof fetch

const traco = (pontos: [number, number][]) => [
  { points: pontos.map(([x, y]) => ({ x, y, time: 0, pressure: 0.5 })) },
]

const romaneio = {
  romaneioId: '019fe83f-1d58-70e9-8dd8-62b04e40d5ea',
  numero: 'R-000010',
  status: 'selado',
  modo: 'offline_sincronizada',
  seladoEm: '2026-08-18T14:35:00.000Z',
  ocorridoEmLocal: '2026-08-18T14:30:00.000Z',
  recebidoEmServidor: '2026-08-18T14:35:01.000Z',
  finalHash: 'c3f1a9e4b7d2058e6a1c4f8b0d3e7295a6b4c8d1e0f2a3b5c7d9e1f3a5b7c9d1',
  documentHash: 'd41f8a2c6b0e5937a1d4c8f2b6e0a3947c5d1e8f2a6b0c4d8e2f6a0b4c8d2e6f',
  canonico: 'DCR1\n…',
  conflito: null,
  lojaNome: 'Matriz',
  criadoPorNome: 'Camilo',
  ip: '187.10.20.30',
  geolocalizacao: {
    lat: -30.336,
    lon: -54.32,
    precisao_m: 34,
    obtida_em: '2026-08-18T14:29:00.000Z',
    origem: 'cache',
  },
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
        cliente_nome: 'Maria Aparecida do Nascimento',
        cliente_endereco: 'Rua Assinada, 100 — Centro',
        quantidade_vales: 1,
        valor_compra_cents: 12345,
        valor_entrega_cents: 900,
        entrega_paga_cliente_cents: 0,
      },
      {
        entrega_id: 'b',
        numero_vale: 'V-000043',
        tipo: 'cliente',
        cliente_nome: 'José Antônio da Conceição',
        cliente_endereco: 'Av. Distante, 4500 — Bairro Alto',
        quantidade_vales: 2,
        valor_compra_cents: 8790,
        valor_entrega_cents: 1800,
        entrega_paga_cliente_cents: 900,
      },
      {
        entrega_id: 'c',
        numero_vale: 'V-000044',
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
      strokes: traco([
        [10, 30], [18, 12], [26, 34], [34, 10], [42, 32], [55, 18], [70, 26], [85, 14],
      ]),
      nome: 'Camilo Ferreira',
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
      strokes: traco([
        [5, 40], [14, 8], [22, 42], [31, 12], [40, 38], [52, 16], [64, 40], [78, 10], [92, 30],
      ]),
      nome: 'João Silva',
      agenciaNome: 'Gabrielense Tele',
      authMethod: 'physical_card_pin_offline_then_verified',
      credencialPublicId: '171233',
      signatureHash: 'b'.repeat(64),
      assinadoEm: '2026-08-18T14:35:00.000Z',
      assinadoEmLocal: '2026-08-18T14:30:00.000Z',
      ip: '187.10.20.30',
      geolocalizacao: {
        lat: -30.336,
        lon: -54.32,
        precisao_m: 34,
        obtida_em: '2026-08-18T14:30:00.000Z',
        origem: 'fresca',
      },
    },
  ],
} as unknown as RomaneioCompleto

const destino = process.argv[2] ?? 'romaneio-exemplo'

writeFileSync(
  `${destino}-farmacia.pdf`,
  Buffer.from(
    await montarRomaneioPdf(romaneio, 'farmacia', [
      {
        quando: '2026-08-18T15:12:00.000Z',
        autor: 'Camilo Ferreira',
        resumo:
          'Endereço do V-000042: "Rua Assinada, 100 — Centro" para "Rua Corrigida Depois, 999 — Centro". Cliente informou número errado no balcão.',
      },
    ])
  )
)

writeFileSync(`${destino}-agencia.pdf`, Buffer.from(await montarRomaneioPdf(romaneio, 'agencia')))

console.log(`
  ${destino}-farmacia.pdf   com valor de compra e uma correção posterior
  ${destino}-agencia.pdf    sem valor de compra
`)
