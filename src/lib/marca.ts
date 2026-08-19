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
//
// DUAS RESOLUÇÕES, E A ESCOLHA É POR DESTINO
//
// Documento impresso não precisa da mesma resolução que a tela. A logo
// de 2008 × 320 desenhada com 56mm de largura no romaneio dá ~900 dpi —
// quatro vezes mais do que qualquer impressora aproveita, e o PDF pagava
// 130 kB por isso. A de 502 × 80, a MESMA ARTE em um quarto da
// resolução, dá ~226 dpi nos mesmos 56mm e derruba o arquivo pra ~10 kB.
//
// Isso importa porque o PDF do romaneio sobe pro Drive nas duas vias, a
// cada saída — e uma saída acontece várias vezes por dia.
//
// Quem fica na de alta resolução é quem é visto em tela ou ampliado — o
// cabeçalho do app, o login e a credencial do motoboy.

export const LOGO_URL = '/marca/logo-drogaria-cidade.svg'
export const CRUZ_URL = '/marca/cruz-drogaria-cidade.svg'

/**
 * A mesma logo em 502 × 80, para documentos impressos. É PNG solto, não
 * SVG com PNG embutido: não há o que extrair, e o arquivo é o próprio
 * bitmap que o jsPDF vai gravar.
 */
export const LOGO_DOCUMENTO_URL = '/marca/logo-drogaria-cidade-documento.png'

/**
 * Proporção da logo, pra quem precisa calcular altura a partir da
 * largura. Vale para as DUAS resoluções — é o que permitiu trocar uma
 * pela outra sem tocar em layout nenhum.
 */
export const LOGO_PROPORCAO = 2008 / 320

/**
 * O vermelho da marca (`--primary`, #ed1d24) — o mesmo do app, da
 * planilha e dos dois PDFs. Em RGB porque é assim que o jsPDF pinta;
 * converter cor de marca pra CMYK é decisão de identidade visual, não de
 * código (ver a nota da credencial no CLAUDE.md).
 *
 * Ele importa mais do que parece: o letreiro da logo é BRANCO, então
 * documento que desenha a logo sem uma faixa desta cor atrás perde o nome
 * da farmácia e fica só com a cruz.
 */
export const COR_MARCA: [number, number, number] = [237, 29, 36]

// Buscado uma vez por sessão. Sem isto, gerar credencial e PDF do acerto
// na mesma sessão baixaria ~1,8 MB duas vezes.
const cache = new Map<string, Promise<string>>()

/**
 * O PNG como data URI. É a forma que o jsPDF aceita e a que a credencial
 * cola dentro do SVG final — assim o arquivo entregue não depende de nada
 * externo pra abrir na gráfica.
 *
 * Dois formatos de origem, um retorno só: do `.svg` do designer o PNG é
 * extraído de dentro; um `.png` solto já é o próprio bitmap. Quem chama
 * não precisa saber a diferença, e o cache é o mesmo pros dois.
 */
export function carregarImagemDaMarca(url: string): Promise<string> {
  const emCache = cache.get(url)
  if (emCache) return emCache

  const promessa = (async () => {
    const resposta = await fetch(url)
    if (!resposta.ok) throw new Error(`Não consegui carregar ${url} (${resposta.status}).`)
    if (url.endsWith('.png')) return await pngComoDataUri(resposta)
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
 * Um `.png` solto vira data URI aqui. `String.fromCharCode(...bytes)` num
 * arquivo inteiro estoura a pilha de argumentos, então a conversão vai em
 * blocos — a logo de documento tem 8,5 kB e passaria, mas quem trocar o
 * arquivo por um maior não deveria descobrir isso do jeito difícil.
 */
async function pngComoDataUri(resposta: Response): Promise<string> {
  const bytes = new Uint8Array(await resposta.arrayBuffer())
  let binario = ''
  const BLOCO = 8192
  for (let i = 0; i < bytes.length; i += BLOCO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + BLOCO))
  }
  return `data:image/png;base64,${btoa(binario)}`
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
