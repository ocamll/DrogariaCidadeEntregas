// Envio do acerto para o Google Drive do usuário.
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

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const ESCOPO = 'https://www.googleapis.com/auth/drive.file'
const PASTA = 'Drogaria Cidade Entregas - Acertos'

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
      error_callback: (erro) => {
        reject(
          new Error(
            erro?.type === 'popup_closed'
              ? 'Você fechou a janela do Google antes de autorizar.'
              : 'Não consegui autorizar no Google.'
          )
        )
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

export type ArquivoParaEnviar = { nome: string; blob: Blob }
export type ArquivoEnviado = { nome: string; link: string }

// Uma subpasta por período, dentro da pasta raiz do app:
//
//   Drogaria Cidade Entregas - Acertos
//     └── Acertos 01-02-2026 a 01-03-2026
//           ├── acerto-....xlsx
//           └── acerto-....pdf
//
// Reenviar o mesmo período cai na mesma subpasta (a busca acha a que já
// existe), então o histórico fica organizado por quinzena em vez de virar
// um monte de arquivo solto na raiz.
export function nomeDaSubpasta(dataInicio: string, dataFim: string): string {
  const br = (iso: string) => iso.split('-').reverse().join('-')
  return `Acertos ${br(dataInicio)} a ${br(dataFim)}`
}

export async function enviarAoDrive(
  arquivos: ArquivoParaEnviar[],
  periodo: { dataInicio: string; dataFim: string }
): Promise<ArquivoEnviado[]> {
  const token = await obterToken()
  const raizId = await garantirPasta(PASTA, token)
  const pastaId = await garantirPasta(
    nomeDaSubpasta(periodo.dataInicio, periodo.dataFim),
    token,
    raizId
  )

  const enviados: ArquivoEnviado[] = []
  for (const arquivo of arquivos) {
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
    enviados.push({ nome: resposta.name as string, link: resposta.webViewLink as string })
  }
  return enviados
}

export const NOME_DA_PASTA = PASTA
