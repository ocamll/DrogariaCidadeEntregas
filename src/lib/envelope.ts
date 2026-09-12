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

import type { MotivoExcecao, ValidacaoDaSaida } from './excecaoDoGerente'

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
type SegredosComuns = {
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
   * **OBRIGATÓRIO desde 2026-08-25.** Ele era opcional, e a ausência
   * significava `saida` — compatibilidade com os envelopes selados antes
   * da 2C.5, quando o retorno não existia.
   *
   * Essa compatibilidade deixou de ter objeto no corte para a V1: o
   * Supabase é zerado e a Dexie v7 apaga a fila local, então não existe
   * envelope antigo em lugar nenhum. Mantê-la seria carregar
   * permissividade permanente por causa de dados que nunca vão existir.
   *
   * Sendo obrigatório no TIPO, "envelope sem tipo" deixa de ser algo que
   * se possa escrever por engano — o compilador cobra, e nenhum teste
   * precisa lembrar de checar. A regra do §59 outra vez: tornar o erro
   * impossível de representar vale mais que rejeitá-lo.
   *
   * NÃO confundir com `versaoDocumento` (`DCRR1`), que é a versão do
   * canônico e vive no payload da fila, em claro. Este aqui é o tipo de
   * documento, é selado, e é verificado.
   */
  tipo: 'saida' | 'retorno'
}

/**
 * UNIÃO desde o 4B (2026-09-12), e a assimetria é o estado real:
 *
 *   saída    versão 2 — sem traço; carrega QUEM validou e POR QUÊ
 *   retorno  versão 1 — ainda com os traços, até a etapa dele
 *
 * `validacao` e `motivoExcecao` vão DENTRO do envelope pelo mesmo motivo
 * que `tipo` foi: o cliente não consegue reabrir nem reescrever o
 * envelope, então a Edge Function COMPARA com o corpo em vez de
 * acreditar. Fora dele, trocar "motoboy" por "gerente" no caminho seria
 * editar um campo em claro.
 *
 * Sendo união, "saída sem modo de validação" não compila — a mesma
 * escolha do `tipo` obrigatório da 2D.6.
 */
export type SegredosDoRomaneio =
  | (SegredosComuns & {
      tipo: 'saida'
      validacao: ValidacaoDaSaida
      motivoExcecao: MotivoExcecao | null
    })
  | (SegredosComuns & { tipo: 'retorno' })

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

// Hash que amarra a operação offline inteira — snapshot, assinaturas e
// relógio. Vai DENTRO do envelope, então o cliente não
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
  // VESTIGIAL DE PROPÓSITO, e não é descuido. A geolocalização saiu do
  // sistema, e todo chamador passa `null` daqui em diante — mas o campo
  // fica, porque ele entra na FÓRMULA logo abaixo.
  //
  // A Edge Function tem a cópia gêmea deste hash e faz
  // `corpo.geolocalizacao ?? null`, ou seja, ela já resolve a ausência
  // como `null` e serializa o mesmo `-`. Removendo o campo daqui, a
  // fórmula mudaria de UM LADO SÓ, e o sintoma seria o pior do projeto:
  // a saída offline deixaria de sincronizar, sem erro legível.
  //
  // Ele some junto com o envelope inteiro, que é a etapa seguinte da
  // limpeza — aí os dois lados caem na mesma sessão.
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

// =====================================================================
// O HASH DO EVENTO OFFLINE DA SAÍDA — versão 2 (4B, 2026-09-12)
//
//   OEV2|documentHash|romaneioId|saida|validacao|motivoExcecao ou '-'|
//        motoboyId|ocorridoEmLocal
//
// SAEM os traços, que não existem mais na saída, e a geolocalização, que
// era vestigial desde 2026-09-04. FICAM o relógio do balcão e a
// modalidade de autorização: o que viaja no corpo da requisição e NÃO
// está no canônico, e que por isso precisa estar preso ao envelope.
//
// O motoboy entra porque, na exceção, ele é ESCOLHIDO na tela e não sai
// do cartão — trocá-lo no corpo mantendo o envelope tem que ser recusado
// como payload alterado.
//
// GÊMEA de uma função com o mesmo nome em
// `supabase/functions/sync-romaneio/index.ts`. Os tipos da assinatura são
// primitivos DE PROPÓSITO, iguais nos dois arquivos: o spec extrai o
// texto da Edge Function e o compila sozinho, e um tipo importado não
// existiria lá. Mexeu numa, mexe na outra — `scripts/offline-hash-v2.spec.mts`
// confere as duas contra digests congelados antes delas.
//
// A versão 1, logo acima, FICA: o retorno ainda sela com traços até a
// etapa dele, e trocar as duas de uma vez quebraria a sincronização do
// retorno offline sem motivo.
// =====================================================================
export async function calcularOfflineEventHashSaidaV2(entrada: {
  documentHash: string
  romaneioId: string
  validacao: string
  motivoExcecao: string | null
  motoboyId: string
  ocorridoEmLocal: string
}): Promise<string> {
  const partes = [
    'OEV2',
    entrada.documentHash,
    entrada.romaneioId.toLowerCase(),
    'saida',
    entrada.validacao,
    entrada.motivoExcecao ?? '-',
    entrada.motoboyId.toLowerCase(),
    entrada.ocorridoEmLocal,
  ]
  const bytes = new TextEncoder().encode(partes.join('|'))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
