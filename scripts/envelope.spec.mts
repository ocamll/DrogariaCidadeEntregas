// npx tsx scripts/envelope.spec.mts
//
// O CONTRATO CRIPTOGRÁFICO DO ENVELOPE, nos dois lados.
//
// O cliente sela com a pública; a Edge Function abre com a privada. Este
// spec faz os dois papéis: gera um par de chaves, chama `selarSegredosCom`
// (o de produção) e abre com `crypto.subtle` exatamente como a função
// abre. Se o formato divergir, ele não abre — que é o ponto.
//
// ---------------------------------------------------------------------
// O QUE ELE TRAVA, E POR QUE CADA UM
//
//   PIN e token ausentes da forma serializada  — o envelope existe pra
//     proteger o PIN EM REPOUSO, e uma fila espera horas
//   `tipo` DENTRO do conteúdo decifrado        — fora dele seria um campo
//     que alguém troca no caminho; dentro, o servidor COMPARA
//   `tipo` AUSENTE do lado de fora             — se vazasse pro envelope
//     externo, a amarração seria decorativa
//   chave errada não abre                      — o par é o que sustenta
//     "o navegador sela e não reabre"
//   ciphertext adulterado não abre             — AES-GCM é autenticado;
//     sem esta asserção, "não abre" poderia ser sorte de padding
//
// Até 2026-09-12 havia um sétimo: os três hashes da versão 1 do evento
// offline, congelados antes do rename da 2C.5. A versão 1 saiu dos dois
// lados com os traços, e a regressão saiu junto — as fórmulas de hoje são
// travadas por `offline-hash-v2.spec.mts`.
//
// A resolução de `tipo` do lado do servidor é EXTRAÍDA de
// `supabase/functions/sync-romaneio/index.ts`, nunca reescrita aqui —
// mesma disciplina do `offline-hash-v2.spec.mts`. Reescrever faria deste
// spec uma segunda implementação da regra que ele deveria conferir.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  selarSegredosCom,
  type SegredosDoRomaneio,
} from '../src/lib/envelope.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// ---- extrai a resolução de tipo da Edge Function ----
const fonte = readFileSync('supabase/functions/sync-romaneio/index.ts', 'utf8')
const inicio = fonte.indexOf('function resolverTipoDoRomaneio')
const fim = fonte.indexOf('\n}', inicio) + 2
if (inicio < 0 || fim < 2) throw new Error('não achei resolverTipoDoRomaneio na Edge Function')
const dir = mkdtempSync(join(tmpdir(), 'envelope-'))
const arquivo = join(dir, 'tipo.mts')
writeFileSync(
  arquivo,
  `type Segredos = { tipo?: string }\n${fonte.slice(inicio, fim)}\nexport { resolverTipoDoRomaneio }\n`,
  'utf8'
)
const resolverTipoDoRomaneio = (
  (await import(pathToFileURL(arquivo).href)) as {
    resolverTipoDoRomaneio: (s: { tipo?: string }) => 'saida' | 'retorno' | null
  }
).resolverTipoDoRomaneio

// ---- um par de chaves, como o gerar-chaves-offline.mjs produz ----
const paraBase64 = (b: ArrayBuffer) =>
  Buffer.from(new Uint8Array(b)).toString('base64')

const par = await crypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['encrypt', 'decrypt']
)
const spki = paraBase64(await crypto.subtle.exportKey('spki', par.publicKey))
const config = { keyId: 'k-teste', spki }

const outroPar = await crypto.subtle.generateKey(
  { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['encrypt', 'decrypt']
)

// ---- o lado do servidor: abrir, exatamente como abrirEnvelope faz ----
async function abrir(env: { k: string; iv: string; ct: string }, privada: CryptoKey) {
  const de = (t: string) => new Uint8Array(Buffer.from(t, 'base64'))
  const chaveAesCrua = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privada, de(env.k))
  const chaveAes = await crypto.subtle.importKey('raw', chaveAesCrua, { name: 'AES-GCM' }, false, [
    'decrypt',
  ])
  const claro = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: de(env.iv) },
    chaveAes,
    de(env.ct)
  )
  return JSON.parse(new TextDecoder().decode(claro)) as SegredosDoRomaneio
}

const PIN = '918273'
const TOKEN = '3777777777777777777777'
const segredosBase: SegredosDoRomaneio = {
  pin: PIN,
  credentialToken: TOKEN,
  operationId: '01a00d9d-af9a-71c3-a15f-9b1f5967f599',
  documentHash: 'a'.repeat(64),
  offlineEventHash: 'b'.repeat(64),
}

console.log('\n--- os segredos não vazam ---')
{
  const env = await selarSegredosCom(config, { ...segredosBase, tipo: 'saida' })
  const fora = JSON.stringify(env)
  checa('PIN ausente da forma serializada', !fora.includes(PIN))
  checa('token ausente da forma serializada', !fora.includes(TOKEN))
  // (4) do pedido: o tipo é EFETIVAMENTE de dentro, não de fora.
  checa('a palavra "saida" não aparece fora do envelope', !fora.includes('saida'))
  checa('a palavra "retorno" não aparece fora do envelope', !fora.includes('retorno'))
  checa('keyId viaja em claro, e só ele', env.keyId === 'k-teste')
}

console.log('\n--- o tipo atravessa e é resolvido pelo servidor ---')
{
  // (1) SEM TIPO NÃO RESOLVE MAIS NADA, e a mudança é de 2026-08-25.
  //
  // Este caso afirmava `resolve como saida` — a compatibilidade com os
  // envelopes selados antes da 2C.5. O corte pré-V1 zera o Supabase e a
  // Dexie v7 apaga a fila local, então não existe envelope antigo em
  // lugar nenhum, e a frouxidão passou a não proteger dado.
  //
  // **Repare no que continua verdadeiro:** o envelope sem tipo ABRE
  // normalmente. A recusa é da conciliação, não da criptografia — e as
  // duas coisas não podem se confundir, senão um erro de chave pareceria
  // um erro de protocolo.
  const legado = await selarSegredosCom(config, segredosBase)
  const abertoLegado = await abrir(legado, par.privateKey)
  checa('envelope sem tipo ainda ABRE', abertoLegado.pin === PIN, 'a recusa é do protocolo, não do RSA')
  checa('mas não resolve tipo nenhum', resolverTipoDoRomaneio(abertoLegado) === null)

  // (2) novo, explícito
  const saida = await selarSegredosCom(config, { ...segredosBase, tipo: 'saida' })
  const abertaSaida = await abrir(saida, par.privateKey)
  checa('tipo=saida recuperado exatamente', abertaSaida.tipo === 'saida')
  checa('tipo=saida resolve como saida', resolverTipoDoRomaneio(abertaSaida) === 'saida')

  // (3) retorno
  const retorno = await selarSegredosCom(config, { ...segredosBase, tipo: 'retorno' })
  const abertoRetorno = await abrir(retorno, par.privateKey)
  checa('tipo=retorno recuperado exatamente', abertoRetorno.tipo === 'retorno')
  checa('tipo=retorno resolve como retorno', resolverTipoDoRomaneio(abertoRetorno) === 'retorno')

  // valor desconhecido é RECUSADO, não vira saída por omissão
  checa(
    'tipo desconhecido não vira saida',
    resolverTipoDoRomaneio({ tipo: 'romaneio_de_algo_futuro' }) === null
  )
}

console.log('\n--- (5) o que não pode abrir ---')
{
  const env = await selarSegredosCom(config, { ...segredosBase, tipo: 'retorno' })

  let abriuComOutra = false
  try {
    await abrir(env, outroPar.privateKey)
    abriuComOutra = true
  } catch {
    /* esperado */
  }
  checa('chave privada errada não abre', !abriuComOutra)

  // Adulterar o ciphertext. AES-GCM é autenticado, então isto tem que
  // falhar na verificação da tag, não produzir plaintext estranho.
  const bytes = Buffer.from(env.ct, 'base64')
  bytes[Math.floor(bytes.length / 2)] ^= 0xff
  let abriuAdulterado = false
  try {
    await abrir({ ...env, ct: bytes.toString('base64') }, par.privateKey)
    abriuAdulterado = true
  } catch {
    /* esperado */
  }
  checa('ciphertext adulterado não abre', !abriuAdulterado)

  // E o iv trocado também não.
  const ivOutro = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64')
  let abriuIv = false
  try {
    await abrir({ ...env, iv: ivOutro }, par.privateKey)
    abriuIv = true
  } catch {
    /* esperado */
  }
  checa('iv trocado não abre', !abriuIv)
}

console.log(falhas === 0 ? '\nenvelope ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
