// NÃO roda com node. Isto é pra colar no console do navegador (F12 →
// Console), com o app aberto. **Não precisa estar logado** e **não fala
// com o Google**: tudo aqui é dublê.
//
// O QUE ELE PROVA
//
// Que `enviarAoDrive` monta a árvore de pastas certa e que reenviar o
// mesmo romaneio SUBSTITUI o arquivo em vez de criar uma segunda cópia.
//
// Por que não virou um spec em `npx tsx`: `googleDrive.ts` lê
// `import.meta.env.VITE_GOOGLE_CLIENT_ID`, que só existe dentro do Vite.
// A parte que dá pra testar em Node — QUAIS pastas — foi separada em
// `src/lib/caminhosNoDrive.ts` e tem spec próprio
// (`npx tsx scripts/caminhosNoDrive.spec.mts`). O que sobra aqui é o
// transporte: percorrer o caminho, achar o que já existe, POST ou PATCH.
//
// O envio de VERDADE continua sem teste automatizado, e continuará: ele
// depende de consentimento OAuth, que é autenticação e não se faz em nome
// do usuário. Este dublê cobre tudo menos a chamada que sai da máquina.
//
// Vale rodar de novo sempre que alguém mexer em `enviarAoDrive`,
// `garantirCaminho` ou `acharArquivo`.

const gd = await import('/src/lib/googleDrive.ts')

// ---------------------------------------------------------------------
// Drive falso, em memória
// ---------------------------------------------------------------------
const arquivos = new Map() // id -> { id, name, mimeType, parents, conteudo }
let seq = 0
let buscasDePasta = 0

const fetchOriginal = window.fetch
const googleOriginal = window.google

window.fetch = async (url, opcoes = {}) => {
  const u = new URL(String(url))
  const metodo = opcoes.method ?? 'GET'
  const responder = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => '' })

  // busca de pasta ou de arquivo
  if (metodo === 'GET' && u.pathname === '/drive/v3/files') {
    const q = u.searchParams.get('q')
    const nome = /name = '((?:[^'\\]|\\')*)'/.exec(q)[1].replace(/\\'/g, "'")
    const pai = /'([^']+)' in parents/.exec(q)?.[1]
    const ehPasta = q.includes('vnd.google-apps.folder')
    if (ehPasta) buscasDePasta++
    const achado = [...arquivos.values()].find(
      (f) =>
        f.name === nome &&
        (f.parents?.[0] ?? undefined) === pai &&
        (ehPasta
          ? f.mimeType === 'application/vnd.google-apps.folder'
          : f.mimeType !== 'application/vnd.google-apps.folder')
    )
    return responder({ files: achado ? [{ id: achado.id, name: achado.name }] : [] })
  }

  // criar pasta
  if (metodo === 'POST' && u.pathname === '/drive/v3/files') {
    const meta = JSON.parse(opcoes.body)
    const id = 'pasta-' + ++seq
    arquivos.set(id, { id, ...meta })
    return responder({ id })
  }

  // criar arquivo (multipart)
  if (metodo === 'POST' && u.pathname === '/upload/drive/v3/files') {
    const meta = JSON.parse(await opcoes.body.get('metadata').text())
    const conteudo = await opcoes.body.get('file').text()
    const id = 'arq-' + ++seq
    arquivos.set(id, { id, ...meta, mimeType: 'application/pdf', conteudo })
    return responder({ id, name: meta.name, webViewLink: 'https://drive/' + id })
  }

  // substituir conteúdo
  if (metodo === 'PATCH') {
    const f = arquivos.get(u.pathname.split('/').pop())
    f.conteudo = await opcoes.body.text()
    return responder({ id: f.id, name: f.name, webViewLink: 'https://drive/' + f.id })
  }

  throw new Error('rota não prevista: ' + metodo + ' ' + u.pathname)
}

// token sem rede e sem pop-up: `carregarGoogleIdentity` sai na primeira
// linha quando `window.google.accounts.oauth2` já existe.
window.google = {
  accounts: {
    oauth2: {
      initTokenClient: (c) => ({
        requestAccessToken: () => c.callback({ access_token: 'token-de-teste' }),
      }),
    },
  },
}

// ---------------------------------------------------------------------
const pdf = (nome, versao) => ({
  nome,
  blob: new Blob([nome + ' ' + versao], { type: 'application/pdf' }),
})
const contar = (tipo) =>
  [...arquivos.values()].filter((f) =>
    tipo === 'pasta'
      ? f.mimeType === 'application/vnd.google-apps.folder'
      : f.mimeType === 'application/pdf'
  ).length

// Instante montado a partir de data LOCAL: é o fuso local que decide a
// pasta do dia, e uma string UTC fixa daria resultado diferente conforme
// a máquina.
const local = (a, m, d, h = 12) => new Date(a, m - 1, d, h).toISOString()

// Um romaneio = dois envios, um por via, cada uma na sua subpasta.
//
// SEQUENCIAL, e não `Promise.all`: as duas vias compartilham os quatro
// níveis de cima, e duas chamadas simultâneas errariam o cache juntas —
// as duas veriam a pasta ausente e as duas a criariam. O app faz assim
// pelo mesmo motivo; este script tem que espelhá-lo pra provar o que o
// app faz, não o que seria bonito aqui.
async function enviarRomaneio(numero, quando, versao, filial = 'Matriz', cache) {
  const enviados = []
  for (const via of ['farmacia', 'agencia']) {
    enviados.push(
      ...(await gd.enviarAoDrive(
        [pdf(`romaneio-${numero}-${via}.pdf`, versao)],
        gd.caminhoDoRomaneio(filial, quando, via),
        cache
      ))
    )
  }
  return enviados
}

const dia18 = local(2026, 8, 18)

const primeira = await enviarRomaneio('R-000010', dia18, 'v1')
console.log('1ª vez  — pastas:', contar('pasta'), 'arquivos:', contar('pdf'),
  'atualizados:', primeira.filter((e) => e.atualizado).length, '(esperado: 6, 2, 0)')

const segunda = await enviarRomaneio('R-000010', dia18, 'v2')
console.log('2ª vez  — arquivos:', contar('pdf'),
  'atualizados:', segunda.filter((e) => e.atualizado).length, '(esperado: 2, 2 — sem duplicata)')

const substituido = [...arquivos.values()].find(
  (f) => f.name === 'romaneio-R-000010-farmacia.pdf'
).conteudo
console.log('conteúdo agora:', substituido, '(esperado: terminar em v2)')

// Outro DIA, mesma filial: nascem o dia e as duas vias dele — raiz,
// filial e mês são reaproveitados. É o caso de toda sangria diária.
await enviarRomaneio('R-000012', local(2026, 8, 19), 'v1')
console.log('3ª vez  — pastas:', contar('pasta'), '(esperado: 9 — o dia novo e suas 2 vias)')

// Outra filial: nascem filial, mês, dia e as duas vias. A raiz não duplica.
await enviarRomaneio('R-000011', dia18, 'v1', 'Filial 02')
console.log('4ª vez  — pastas:', contar('pasta'), '(esperado: 14 — a raiz não duplicou)')

// O CACHE compartilhado é o que torna a sangria barata: sem ele, cada
// romaneio refaz a busca de raiz/filial/mês/dia duas vezes.
buscasDePasta = 0
const cache = gd.novoCachePastas()
for (const n of ['R-000030', 'R-000031', 'R-000032']) await enviarRomaneio(n, dia18, 'v1', 'Matriz', cache)
const comCache = buscasDePasta
buscasDePasta = 0
for (const n of ['R-000040', 'R-000041', 'R-000042']) await enviarRomaneio(n, dia18, 'v1')
console.log('buscas de pasta — com cache:', comCache, '| sem:', buscasDePasta, '(esperado: 6 vs 30)')

// A saída das 21h30 pertence ao DIA DELA, não ao dia seguinte em UTC.
console.log('saída 18/08 21h30 vai pra:',
  gd.caminhoDoRomaneio('Matriz', local(2026, 8, 18, 21), 'farmacia').join(' / '))

const caminhoDe = (f) => {
  const partes = []
  for (let atual = f; atual; atual = arquivos.get(atual.parents?.[0])) partes.unshift(atual.name)
  return partes.join(' / ')
}
console.log(
  [...arquivos.values()]
    .filter((f) => f.mimeType === 'application/pdf')
    .map(caminhoDe)
    .sort()
    .join('\n')
)

window.fetch = fetchOriginal
window.google = googleOriginal
console.log('\ndublês desfeitos — recarregue a página antes de usar o app de verdade')
