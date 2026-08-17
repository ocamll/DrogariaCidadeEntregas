// Gera o par de chaves que protege o PIN na fila offline.
//
//   node scripts/gerar-chaves-offline.mjs
//
// Escreve DOIS arquivos em .chaves-offline/ (que está no .gitignore).
// A chave privada NUNCA aparece na saída do terminal — nem em scrollback,
// nem em log de sessão, nem em histórico de chat. Sai só em arquivo, e
// você a leva daqui pro secret da Edge Function.
//
// POR QUE ISSO EXISTE
//
// Offline o navegador precisa guardar o PIN do motoboy até a rede voltar.
// Guardá-lo cifrado com chave simétrica local não resolve: quem controla
// a página alcança a chave também. Com chave PÚBLICA, o navegador cifra e
// NÃO CONSEGUE decifrar de volta — não existe chave privada nele.
//
// ROTAÇÃO
//
// O envelope carrega o key_id. Ao trocar a chave, mantenha a privada
// ANTIGA no secret junto com a nova enquanto houver operação offline
// pendente — senão a Edge Function não consegue mais abrir o que foi
// selado antes da troca. Ver ROMANEIO_KEYS na função sync-romaneio.

import { webcrypto as crypto } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PASTA = '.chaves-offline'

function base64(buffer) {
  return Buffer.from(buffer).toString('base64')
}

const agora = new Date()
const keyId = `offline-${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`

const par = await crypto.subtle.generateKey(
  {
    name: 'RSA-OAEP',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['encrypt', 'decrypt']
)

const publica = base64(await crypto.subtle.exportKey('spki', par.publicKey))
const privada = base64(await crypto.subtle.exportKey('pkcs8', par.privateKey))

mkdirSync(PASTA, { recursive: true })

writeFileSync(
  join(PASTA, `${keyId}.publica.txt`),
  [
    '# Vai nas variáveis de ambiente do frontend (.env local e Cloudflare Pages).',
    '# É PÚBLICA: vai no bundle de qualquer jeito, como o VITE_GOOGLE_CLIENT_ID.',
    '# Lembre do rebuild depois de mexer no Cloudflare — o Vite embute no build.',
    '',
    `VITE_ROMANEIO_KEY_ID=${keyId}`,
    `VITE_ROMANEIO_PUBKEY=${publica}`,
    '',
  ].join('\n')
)

writeFileSync(
  join(PASTA, `${keyId}.privada.txt`),
  [
    '# SECRET da Edge Function sync-romaneio.',
    '# Supabase → Edge Functions → Secrets → ROMANEIO_KEYS',
    '#',
    '# O valor é um JSON de key_id -> chave privada. Ao rotacionar, ACRESCENTE',
    '# a chave nova e mantenha a antiga enquanto houver saída offline pendente;',
    '# sem ela, o que foi selado antes da troca não abre mais.',
    '#',
    '# Nunca colar isto em arquivo do projeto, em commit ou em chat.',
    '',
    JSON.stringify({ [keyId]: privada }),
    '',
  ].join('\n')
)

console.log(`key_id gerado: ${keyId}`)
console.log(`pública  → ${join(PASTA, `${keyId}.publica.txt`)}`)
console.log(`privada  → ${join(PASTA, `${keyId}.privada.txt`)}  (não commitar, não colar em lugar nenhum além do secret)`)
console.log('')
console.log('Depois de configurar os dois lados, apague a pasta .chaves-offline/.')
