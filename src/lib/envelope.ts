// Envelope selado para os segredos da saída offline.
//
// O PROBLEMA
//
// Offline, o navegador precisa guardar o PIN do motoboy e o token do
// cartão até a rede voltar — podem ser horas. Cifrar com chave simétrica
// local não resolve nada: a chave teria que ficar acessível à própria
// página, então quem controla a página decifra também. Vira ofuscação.
//
// A SAÍDA
//
// Cifrar com a chave PÚBLICA do servidor. O navegador sela e **não tem
// como reabrir** — não existe chave privada nele. Não é "difícil", é
// impossível. Quem abre é a Edge Function, no momento da sincronização.
//
// O que isto NÃO resolve: JavaScript malicioso rodando na página no
// instante em que o PIN é digitado. Nenhum esquema criptográfico em
// navegador resolve isso. O que ele resolve é o PIN **em repouso**, que é
// o risco real de uma fila que espera horas.
//
// POR QUE HÍBRIDO E NÃO RSA DIRETO
//
// RSA-OAEP com chave de 2048 bits cifra no máximo 190 bytes. Os segredos
// mais as três amarrações dão ~300 bytes em JSON — não cabe. RSA-4096
// caberia hoje com 446, mas quebraria no dia em que alguém somasse um
// campo, e o erro apareceria só na hora de selar, offline, no balcão.
//
// Então: AES-GCM-256 cifra o conteúdo (sem limite de tamanho) e o RSA
// envolve só a chave AES de 32 bytes. É o desenho padrão pra isto.
//
// A chave AES existe por milissegundos na memória e é descartada; o que
// fica gravado é só a versão envolvida pelo RSA.

const ALGORITMO_RSA = { name: 'RSA-OAEP', hash: 'SHA-256' } as const

export type EnvelopeSelado = {
  v: 1
  keyId: string
  // chave AES envolvida pela pública do servidor
  k: string
  iv: string
  ct: string
}

/**
 * O que vai selado. Chamava-se `SegredosDaSaida` até a 2C.5; o retorno
 * usa o MESMO envelope, então o nome deixou de dizer a verdade.
 */
export type SegredosDoRomaneio = {
  // o que é de fato secreto
  pin: string
  credentialToken: string
  // amarrações: sem elas, um envelope roubado serviria pra outra operação
  operationId: string
  documentHash: string
  offlineEventHash: string
  /**
   * QUAL DOCUMENTO ESTE ENVELOPE AUTORIZA. Entrou na 2C.5.
   *
   * Ele vai AQUI DENTRO e não no corpo do request, e a diferença é a
   * única que importa: o cliente não consegue reabrir nem reescrever o
   * envelope, então o servidor **compara** em vez de acreditar. Fora
   * dele seria só um campo que alguém pode trocar no caminho.
   *
   * Sem isto, um corpo poderia dizer `saida` carregando o envelope de um
   * retorno. As amarrações que já existiam (`operationId`,
   * `documentHash`) impedem reaproveitar um envelope em OUTRA operação
   * concreta, mas não impediriam trocar de CAMINHO com o envelope certo.
   *
   * **Ausente = saída**, e isso é compatibilidade histórica exclusiva:
   * todo envelope selado antes da 2C.5 é de saída, por construção — o
   * retorno não existia. Não é permissividade pra operação nova; o
   * retorno exige o valor explícito, aqui e no corpo.
   *
   * NÃO confundir com `versaoDocumento` (`DCRR1`), que é a versão do
   * canônico e vive no payload da fila, em claro. Este aqui é o tipo de
   * documento, é selado, e é verificado.
   */
  tipo?: 'saida' | 'retorno'
}

function paraBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binario = ''
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i])
  return btoa(binario)
}

function deBase64(texto: string): Uint8Array {
  const binario = atob(texto)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

// A pública mora numa variável de build, igual ao VITE_GOOGLE_CLIENT_ID.
// Isso é melhor que buscá-la ao logar: estando embutida no bundle, ela
// está disponível offline por construção — não existe o caso "caiu a
// internet antes de eu ter a chave".
function chavePublicaConfigurada(): { keyId: string; spki: string } | null {
  const keyId = import.meta.env.VITE_ROMANEIO_KEY_ID
  const spki = import.meta.env.VITE_ROMANEIO_PUBKEY
  if (!keyId || !spki) return null
  return { keyId, spki }
}

export function envelopeDisponivel(): boolean {
  return chavePublicaConfigurada() !== null
}

// Cache POR CHAVE, e não uma única global. A global bastava enquanto só
// existia a do ambiente; com `selarSegredosCom` recebendo a chave, ela
// devolveria a primeira importada para qualquer spki seguinte — o teste
// selaria com uma chave e acharia que selou com outra, e o sintoma seria
// "a privada não abre" apontando pro lugar errado.
const chavesImportadas = new Map<string, CryptoKey>()

async function carregarChavePublica(spki: string): Promise<CryptoKey> {
  const jaImportada = chavesImportadas.get(spki)
  if (jaImportada) return jaImportada
  const chaveImportada = await crypto.subtle.importKey(
    'spki',
    deBase64(spki) as unknown as ArrayBuffer,
    ALGORITMO_RSA,
    false,
    ['encrypt']
  )
  chavesImportadas.set(spki, chaveImportada)
  return chaveImportada
}

export async function selarSegredos(segredos: SegredosDoRomaneio): Promise<EnvelopeSelado> {
  const configurada = chavePublicaConfigurada()
  if (!configurada) {
    // Erro explícito, nunca um envelope vazio ou um PIN em claro. Quem
    // chama trata isto bloqueando só o fluxo de saída offline — ver
    // envelopeDisponivel().
    throw new Error(
      'Chave pública do romaneio não configurada (VITE_ROMANEIO_KEY_ID / VITE_ROMANEIO_PUBKEY).'
    )
  }
  return selarSegredosCom(configurada, segredos)
}

/**
 * O selo em si, com a chave RECEBIDA em vez de lida do ambiente.
 *
 * Separado de `selarSegredos` na 2C.5 pelo mesmo motivo que
 * `caminhosNoDrive.ts` foi separado de `googleDrive.ts`: quem lê
 * `import.meta.env` não roda em `npx tsx`, e o formato do envelope — que
 * é contrato criptográfico com a Edge Function — precisa ser testável
 * sem navegador e sem build.
 *
 * `selarSegredos` continua sendo o caminho do app; ninguém mais deveria
 * chamar esta com chave própria fora de teste.
 */
export async function selarSegredosCom(
  configurada: { keyId: string; spki: string },
  segredos: SegredosDoRomaneio
): Promise<EnvelopeSelado> {
  const publica = await carregarChavePublica(configurada.spki)

  const chaveAes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
  ])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const claro = new TextEncoder().encode(JSON.stringify(segredos))

  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chaveAes, claro)
  const chaveAesCrua = await crypto.subtle.exportKey('raw', chaveAes)
  const chaveEnvolvida = await crypto.subtle.encrypt(ALGORITMO_RSA, publica, chaveAesCrua)

  // A partir daqui nada mais no navegador consegue reabrir isto: a chave
  // AES sai de escopo e só existe envolvida pela pública.
  return {
    v: 1,
    keyId: configurada.keyId,
    k: paraBase64(chaveEnvolvida),
    iv: paraBase64(iv.buffer as ArrayBuffer),
    ct: paraBase64(cifrado),
  }
}

// Hash que amarra a operação offline inteira — snapshot, assinaturas,
// relógio e geolocalização. Vai DENTRO do envelope, então o cliente não
// consegue alterá-lo depois; a Edge Function recalcula a partir do
// payload público e compara. É assim que alteração acidental (ou não) do
// payload entre assinar e sincronizar aparece.
//
// Este é TypeScript dos dois lados (aqui e na Edge Function), então o
// risco de divergência é bem menor que o do canônico do romaneio, que é
// TypeScript contra SQL. Ainda assim: mexeu aqui, mexe lá.
export // OS NOMES DOS PARÂMETROS SÃO NEUTROS DESDE A 2C.5, e a fórmula NÃO
// mudou um byte — ela concatena VALORES, não chaves.
//
//     saída:   caixaStrokes       ┐
//     retorno: responsavelStrokes ┴→ assinaturaInternaStrokes
//
// Renomear no FIO seria quebra (corpos já gravados dizem caixaStrokes);
// renomear aqui dentro não é. E o nome antigo mentiria no retorno, onde
// quem assina é o responsável da loja e pode ser gerente ou admin — a
// armadilha do tipo_signatario outra vez.
//
// O spec do envelope congela três hashes calculados ANTES deste
// refactor e exige que continuem idênticos. A intenção era "só renomeei
// parâmetro"; a asserção é quem prova.
async function calcularOfflineEventHash(entrada: {
  documentHash: string
  romaneioId: string
  assinaturaInternaStrokes: unknown
  assinaturaMotoboyStrokes: unknown
  ocorridoEmLocal: string
  geolocalizacao: unknown | null
}): Promise<string> {
  const partes = [
    entrada.documentHash,
    entrada.romaneioId.toLowerCase(),
    JSON.stringify(entrada.assinaturaInternaStrokes),
    JSON.stringify(entrada.assinaturaMotoboyStrokes),
    entrada.ocorridoEmLocal,
    entrada.geolocalizacao === null ? '-' : JSON.stringify(entrada.geolocalizacao),
  ]
  const bytes = new TextEncoder().encode(partes.join('|'))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
