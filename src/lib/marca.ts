// Os assets da marca, num lugar só.
//
// A logo e a cruz vieram do designer como SVG com um PNG embutido. Quatro
// coisas as usam — o cabeçalho do app, a credencial do motoboy, o PDF do
// acerto e o PDF do romaneio — e antes disto havia duas cópias da mesma
// extração espalhadas pelos geradores. Agora é uma.
//
// **O `<img>` do cabeçalho aponta direto pro arquivo**; quem precisa do
// data URI é o jsPDF, que não busca URL sozinho.
//
// POR QUE OS ORIGINAIS FICAM INTACTOS
//
// Os dois arquivos carregam o PNG DUAS vezes, byte a byte idêntico:
// `href` e `xlink:href`, que é o fallback de renderizadores antigos. Dava
// pra cortar pela metade removendo a duplicata — mas são os arquivos que
// o designer entregou, e o dia em que alguém comparar o que está no repo
// com o que ele mandou vale mais que os 137 kB. A extração pega a
// primeira ocorrência e ignora a segunda.
//
// A logo é 2008 × 320 (a antiga era 502 × 80 — mesma proporção, quatro
// vezes a resolução). A proporção idêntica é o que permitiu trocar sem
// mexer em nenhum layout.

export const LOGO_URL = '/marca/logo-drogaria-cidade.svg'
export const CRUZ_URL = '/marca/cruz-drogaria-cidade.svg'

/** Proporção da logo, pra quem precisa calcular altura a partir da largura. */
export const LOGO_PROPORCAO = 2008 / 320

// Buscado uma vez por sessão. Sem isto, gerar credencial e PDF do acerto
// na mesma sessão baixaria ~1,8 MB duas vezes.
const cache = new Map<string, Promise<string>>()

/**
 * O PNG embutido, como data URI. É a forma que o jsPDF aceita e a que a
 * credencial cola dentro do SVG final — assim o arquivo entregue não
 * depende de nada externo pra abrir na gráfica.
 */
export function carregarImagemDaMarca(url: string): Promise<string> {
  const emCache = cache.get(url)
  if (emCache) return emCache

  const promessa = (async () => {
    const resposta = await fetch(url)
    if (!resposta.ok) throw new Error(`Não consegui carregar ${url} (${resposta.status}).`)
    const fonte = await resposta.text()
    const achado = fonte.match(/href="(data:image\/png;base64,[^"]+)"/)
    if (!achado) throw new Error(`Imagem incorporada não encontrada em ${url}`)
    return achado[1]
  })()

  // Só entra no cache se der certo: uma falha de rede não pode fixar o
  // erro pro resto da sessão.
  promessa.catch(() => cache.delete(url))
  cache.set(url, promessa)
  return promessa
}

/**
 * Esvazia o cache. Existe para os testes: sem isto não há como exercitar
 * "a rede caiu e a logo não veio", porque a primeira carga bem-sucedida
 * serve todas as seguintes — que é justamente o comportamento desejado em
 * produção.
 */
export function limparCacheDaMarca(): void {
  cache.clear()
}

export type AssetsDaMarca = { logo: string; cruz: string }

export async function carregarAssetsDaMarca(): Promise<AssetsDaMarca> {
  const [logo, cruz] = await Promise.all([
    carregarImagemDaMarca(LOGO_URL),
    carregarImagemDaMarca(CRUZ_URL),
  ])
  return { logo, cruz }
}
