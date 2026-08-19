// Envio de documentos para o Google Drive do usuário.
//
// Esta é a única integração externa do projeto, e o desenho foi escolhido
// pra ser o menos invasivo possível:
//
//   * escopo `drive.file`, não `drive`. Com ele o app enxerga SÓ os
//     arquivos que ele mesmo criou — não consegue ler o resto do Drive de
//     ninguém. É por isso também que procurar a pasta funciona: a busca
//     devolve a pasta que este app criou, e nada mais.
//   * token só na MEMÓRIA, sem refresh token. Vale cerca de uma hora e
//     morre ao recarregar a página. Guardar refresh token no navegador
//     seria expor credencial de longa duração no cliente.
//   * o Client ID é identificador público (vai no bundle, por isso mora em
//     VITE_GOOGLE_CLIENT_ID). O "client secret" NÃO é usado neste fluxo e
//     não deve existir em lugar nenhum deste projeto.

// QUE pastas é decidido em `caminhosNoDrive.ts`, que não importa nada e
// por isso roda num teste sem rede. Aqui fica só o transporte: token,
// busca, criação e upload. As funções de nomeação são reexportadas pra
// quem envia continuar precisando de um import só.
import { PASTA_ACERTOS, PASTA_ROMANEIOS } from '@/lib/caminhosNoDrive'
export { nomeDaSubpasta, caminhoDoAcerto, caminhoDoRomaneio } from '@/lib/caminhosNoDrive'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const ESCOPO = 'https://www.googleapis.com/auth/drive.file'

const MIME_PASTA = 'application/vnd.google-apps.folder'

type RespostaToken = { access_token?: string; error?: string; error_description?: string }
type TokenClient = { requestAccessToken: (opcoes?: { prompt?: string }) => void }

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (resposta: RespostaToken) => void
            error_callback?: (erro: { type?: string }) => void
          }) => TokenClient
        }
      }
    }
  }
}

export function driveConfigurado(): boolean {
  return !!CLIENT_ID
}

// Carrega o script do Google ANTES de alguém clicar. Sem isso, o clique
// gasta o "crédito de gesto do usuário" esperando o script baixar, e o
// navegador bloqueia o pop-up de autorização por não reconhecê-lo mais
// como ação direta de quem clicou.
export function prepararDrive(): void {
  if (!CLIENT_ID) return
  void carregarGoogleIdentity().catch(() => {
    // silencioso de propósito: se falhar aqui, o clique tenta de novo e
    // aí sim o erro aparece pro usuário, com contexto.
  })
}

// Pedir o token é a PRIMEIRA coisa depois do clique, antes de gerar
// qualquer arquivo. Gerar a planilha e o PDF leva centenas de
// milissegundos, e o pop-up aberto depois disso já não conta como
// resposta ao gesto do usuário — o navegador bloqueia.
export async function autorizarDrive(): Promise<void> {
  await obterToken()
}

let scriptCarregado: Promise<void> | null = null

function carregarGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  // uma promessa só, reaproveitada: dois cliques seguidos não podem
  // injetar duas tags de script
  if (scriptCarregado) return scriptCarregado
  scriptCarregado = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      scriptCarregado = null
      reject(new Error('Não consegui carregar o login do Google. Verifica a conexão.'))
    }
    document.head.appendChild(script)
  })
  return scriptCarregado
}

// token em memória, com a validade que o Google devolveu
let tokenEmMemoria: { valor: string; expiraEm: number } | null = null

async function obterToken(): Promise<string> {
  if (!CLIENT_ID) {
    throw new Error('VITE_GOOGLE_CLIENT_ID não está configurado neste ambiente.')
  }
  if (tokenEmMemoria && Date.now() < tokenEmMemoria.expiraEm) return tokenEmMemoria.valor

  await carregarGoogleIdentity()
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new Error('Login do Google indisponível.')

  return new Promise<string>((resolve, reject) => {
    const cliente = oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: ESCOPO,
      callback: (resposta) => {
        if (!resposta.access_token) {
          reject(new Error(resposta.error_description ?? resposta.error ?? 'Autorização negada.'))
          return
        }
        // margem de 1 min: token quase vencendo não serve pra um upload
        tokenEmMemoria = { valor: resposta.access_token, expiraEm: Date.now() + 59 * 60 * 1000 }
        resolve(resposta.access_token)
      },
      // Mensagem por tipo: "não consegui autorizar" sozinho não diz o que
      // fazer, e os três casos abaixo pedem ações diferentes.
      error_callback: (erro) => {
        const tipo = erro?.type ?? 'desconhecido'
        const mensagens: Record<string, string> = {
          popup_closed: 'Você fechou a janela do Google antes de autorizar.',
          popup_failed_to_open:
            'O navegador bloqueou a janela do Google. Libera o pop-up para este site e tenta de novo.',
          unknown: 'O Google recusou a autorização. Confere se sua conta está em "Usuários de teste" no console.',
        }
        reject(new Error(mensagens[tipo] ?? `Não consegui autorizar no Google (${tipo}).`))
      },
    })
    cliente.requestAccessToken({ prompt: '' })
  })
}

async function chamarDrive(url: string, opcoes: RequestInit, token: string) {
  const resposta = await fetch(url, {
    ...opcoes,
    headers: { ...(opcoes.headers ?? {}), Authorization: `Bearer ${token}` },
  })
  if (!resposta.ok) {
    const corpo = await resposta.text()
    // token vencido no meio do caminho: derruba o cache pra próxima
    // tentativa pedir autorização de novo em vez de repetir o erro
    if (resposta.status === 401) tokenEmMemoria = null
    throw new Error(`Drive respondeu ${resposta.status}: ${corpo.slice(0, 200)}`)
  }
  return resposta.json()
}

// Procura uma pasta pelo nome (dentro do pai, quando informado) e cria se
// não existir. Com `drive.file` a busca só alcança o que este app criou,
// então não há risco de "adotar" uma pasta homônima do usuário — e é o
// que permite reaproveitar a mesma pasta em envios seguintes em vez de
// encher o Drive de duplicatas.
async function garantirPasta(nome: string, token: string, paiId?: string): Promise<string> {
  // aspas simples no nome quebrariam a query do Drive
  const nomeSeguro = nome.replace(/'/g, "\\'")
  const condicoes = [
    `name = '${nomeSeguro}'`,
    `mimeType = '${MIME_PASTA}'`,
    'trashed = false',
    paiId ? `'${paiId}' in parents` : null,
  ].filter(Boolean)

  const busca = new URL('https://www.googleapis.com/drive/v3/files')
  busca.searchParams.set('q', condicoes.join(' and '))
  busca.searchParams.set('fields', 'files(id, name)')
  const resultado = await chamarDrive(busca.toString(), { method: 'GET' }, token)
  const existente = (resultado.files as Array<{ id: string }> | undefined)?.[0]
  if (existente) return existente.id

  const criada = await chamarDrive(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nome,
        mimeType: MIME_PASTA,
        ...(paiId ? { parents: [paiId] } : {}),
      }),
    },
    token
  )
  return criada.id as string
}

/**
 * Ids de pasta já resolvidos, compartilhados por um envio.
 *
 * O cache é do CHAMADOR e não do módulo, de propósito: id de pasta
 * memorizado indefinidamente vira id de pasta que o usuário apagou, e aí
 * o envio pousaria dentro da lixeira sem reclamar. Vivendo só durante uma
 * sangria (segundos), essa janela não existe na prática.
 *
 * Sem ele a sangria seria cara: cada romaneio tem dois destinos que só
 * diferem no último nível, e um dia com 20 saídas refaria a busca de
 * raiz/filial/mês/dia 40 vezes. Medido com o Drive falso: 6 buscas de
 * pasta contra 30, pros mesmos 3 romaneios em duas vias.
 *
 * **Envios que compartilham um cache têm que ser SEQUENCIAIS.** Duas
 * chamadas simultâneas errariam o cache juntas — as duas veriam a pasta
 * ausente e as duas a criariam. Por isso quem envia usa `for … await` e
 * não `Promise.all`.
 */
export type CachePastas = Map<string, string>
export const novoCachePastas = (): CachePastas => new Map()

// Percorre um caminho de pastas a partir da raiz do Drive, criando o que
// faltar.
async function garantirCaminho(
  caminho: string[],
  token: string,
  cache: CachePastas
): Promise<string> {
  let paiId: string | undefined
  let percorrido = ''
  for (const nome of caminho) {
    percorrido += '/' + nome
    const guardado = cache.get(percorrido)
    if (guardado) {
      paiId = guardado
      continue
    }
    paiId = await garantirPasta(nome, token, paiId)
    cache.set(percorrido, paiId)
  }
  // `caminho` nunca é vazio: quem chama sempre passa ao menos a raiz.
  return paiId as string
}

// Procura um arquivo pelo nome exato dentro da pasta. É o que faz reenviar
// SUBSTITUIR em vez de acumular cópias — o Drive aceita alegremente cinco
// arquivos com o mesmo nome na mesma pasta, e num documento de custódia
// isso é pior que inútil: quem abrisse a pasta teria que adivinhar qual
// dos cinco vale.
async function acharArquivo(
  nome: string,
  pastaId: string,
  token: string
): Promise<string | null> {
  const nomeSeguro = nome.replace(/'/g, "\\'")
  const busca = new URL('https://www.googleapis.com/drive/v3/files')
  busca.searchParams.set(
    'q',
    `name = '${nomeSeguro}' and '${pastaId}' in parents and trashed = false`
  )
  busca.searchParams.set('fields', 'files(id)')
  const resultado = await chamarDrive(busca.toString(), { method: 'GET' }, token)
  return (resultado.files as Array<{ id: string }> | undefined)?.[0]?.id ?? null
}

export type ArquivoParaEnviar = { nome: string; blob: Blob }
export type ArquivoEnviado = { nome: string; link: string; atualizado: boolean }

// Uma subpasta por período, dentro da pasta raiz do app:
//
//   Drogaria Cidade Entregas - Acertos
//     └── Acertos 01-02-2026 a 01-03-2026
//           ├── acerto-....xlsx
//           └── acerto-....pdf
//
// Reenviar o mesmo período cai na mesma subpasta (a busca acha a que já
// existe), então o histórico fica organizado por quinzena em vez de virar
// um monte de arquivo solto na raiz — e, desde que o envio passou a
// procurar o arquivo antes de criar, também sem duas versões do mesmo
// acerto lado a lado.
/**
 * Sobe os arquivos para um caminho de pasta, criando o que faltar.
 *
 * Um destino por chamada. Chegou a aceitar vários, enquanto o romaneio ia
 * também pra uma pasta "Geral" com todas as filiais juntas; o usuário
 * desfez isso em 2026-08-19 ("ninguém vai preferir procurar agulha no
 * palheiro"). Quando a pasta por via voltou a criar dois destinos, a
 * resposta foi o `cache` compartilhado e não a lista de destinos: as duas
 * vias levam arquivos DIFERENTES, então uma lista de caminhos com uma
 * lista de arquivos não descreveria mais o que acontece.
 */
export async function enviarAoDrive(
  arquivos: ArquivoParaEnviar[],
  caminho: string[],
  cache: CachePastas = novoCachePastas()
): Promise<ArquivoEnviado[]> {
  const token = await obterToken()
  const pastaId = await garantirCaminho(caminho, token, cache)

  const enviados: ArquivoEnviado[] = []
  for (const arquivo of arquivos) {
    const existente = await acharArquivo(arquivo.nome, pastaId, token)

    // Já existe: substitui só o CONTEÚDO (`uploadType=media` num PATCH),
    // preservando id, nome e link. Quem tiver o link de antes continua
    // chegando no arquivo certo.
    if (existente) {
      const resposta = await chamarDrive(
        `https://www.googleapis.com/upload/drive/v3/files/${existente}?uploadType=media&fields=id,name,webViewLink`,
        { method: 'PATCH', body: arquivo.blob },
        token
      )
      enviados.push({
        nome: resposta.name as string,
        link: resposta.webViewLink as string,
        atualizado: true,
      })
      continue
    }

    const metadados = { name: arquivo.nome, parents: [pastaId] }
    const form = new FormData()
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadados)], { type: 'application/json' })
    )
    form.append('file', arquivo.blob)

    const resposta = await chamarDrive(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      { method: 'POST', body: form },
      token
    )
    enviados.push({
      nome: resposta.name as string,
      link: resposta.webViewLink as string,
      atualizado: false,
    })
  }
  return enviados
}

export const NOME_DA_PASTA = PASTA_ACERTOS
export const NOME_DA_PASTA_ROMANEIOS = PASTA_ROMANEIOS
