// NORMALIZAÇÃO DE TEXTO LIVRE — a função central, e só ela.
//
// Mora em `lib/` e não importa nada, como `money.ts` e `canonico.ts`. É o
// que permite testá-la isolada, que é a única defesa contra cada tela
// resolver espaço em branco do seu jeito.
//
// =====================================================================
// A FRONTEIRA, E ELA É A REGRA MAIS IMPORTANTE DESTE ARQUIVO
//
//     ENTRADA          normaliza    antes de gravar
//     EXIBIÇÃO         nunca        mostra o que está gravado
//     CANÔNICO         NUNCA        `textoCanonico` é outro contrato
//
// **Nada aqui pode ser chamado por `montarCanonico`, por
// `montarCanonicoRetorno`, nem por `texto_para_canonico` do lado SQL.**
// Aqueles sanitizam TAB/CR/LF e mais nada, de propósito, e o CLAUDE.md
// diz por quê: *"nada de trim, nada de normalizar Unicode — normalização
// é justamente a 'melhoria' que faria os dois lados divergirem em
// silêncio"*.
//
// A diferença não é de estilo. O canônico roda em DOIS lugares (o
// navegador e o Postgres) e precisa produzir os mesmos bytes; uma função
// de normalização em TypeScript não tem gêmeo em SQL, e nunca vai ter.
// Já a entrada roda num lugar só — antes de o dado existir.
//
// E há uma consequência temporal: **nada que já foi assinado pode passar
// por aqui.** Renormalizar o snapshot de um romaneio selado mudaria os
// bytes que as duas partes assinaram. Isto vale para dado NOVO, no
// instante em que ele é digitado.
//
// =====================================================================
// O QUE ELA NÃO FAZ, E NÃO VAI FAZER
//
// Não corrige ortografia, não expande abreviatura, não adivinha
// logradouro, não troca "R." por "Rua". Nome e endereço de cliente são
// dado que alguém vai conferir na porta — "melhorar" o conteúdo é
// exatamente o tipo de ajuda que faz o motoboy tocar a campainha errada.
// =====================================================================

/**
 * Caracteres INVISIVEIS que sobrevivem a um `trim()` ingenuo.
 *
 * Medido em 2026-08-25, e o resultado e o motivo desta lista existir:
 *
 *     regex \s pega NBSP (U+00A0)   -> true
 *     regex \s pega ZWSP (U+200B)   -> FALSE
 *     "Jose" + ZWSP === "Jose"      -> false
 *
 * Ou seja: colar um nome do WhatsApp ou do Excel pode trazer um
 * caractere de largura zero e criar DOIS CLIENTES VISUALMENTE IDENTICOS
 * no banco — que nenhuma busca casa e que ninguem enxerga na tela.
 *
 * NBSP nao entra nesta lista, de proposito: ele SEPARA palavras, entao o
 * certo e virar espaco comum, e o colapso de `sanear` faz isso porque a
 * classe \s o alcanca. Os daqui nao separam nada — sao sujeira.
 *
 * Este bloco esta sem acento de proposito: ele descreve caracteres, e
 * um comentario sobre bytes invisiveis nao deve depender de bytes.
 */
// Os code points, um por linha, com o nome de cada um.
//
// A classe do regex e MONTADA a partir desta lista em vez de escrita
// com os caracteres dentro. Duas razoes, e a segunda so aparece na
// pratica: caractere invisivel no fonte nao e revisavel numa leitura de
// codigo, e a primeira versao disto QUEBROU O PARSER — um invisivel
// inutilizando justamente a linha que existe para remove-los.
//
// Nenhum deles e metacaractere de regex, entao a montagem e segura.
const CODIGOS_INVISIVEIS = [
  0x00ad, // hifen suave (soft hyphen)
  0x200b, // espaco de largura zero
  0x200c, // nao-juntador de largura zero
  0x200d, // juntador de largura zero
  0x200e, // marca esquerda-para-direita
  0x200f, // marca direita-para-esquerda
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // controles bidirecionais
  0x2060, // juntador de palavra
  0x2061, 0x2062, 0x2063, 0x2064, // invisiveis matematicos
  0xfeff, // BOM / espaco sem quebra de largura zero
]

const INVISIVEIS = new RegExp(
  '[' + CODIGOS_INVISIVEIS.map((c) => String.fromCodePoint(c)).join('') + ']',
  'g'
)

/**
 * Preposições e artigos que ficam em minúscula NO MEIO de um nome.
 *
 * Só se aplica quando a caixa está sendo ajustada (ver `normalizarNome`),
 * e nunca no primeiro token: "Da Silva Comércio" começa com "Da".
 */
const PARTICULAS = new Set([
  'da', 'das', 'de', 'del', 'di', 'do', 'dos', 'du',
  'e', 'y',
  'la', 'le', 'van', 'von', 'der', 'den', 'ter',
])

/**
 * O saneamento que TODO campo livre recebe.
 *
 * Em ordem, e a ordem importa:
 *
 *   1. NFC          "José" tem duas formas em Unicode, e elas não são
 *                   iguais como string. Sem isto, dois cadastros com o
 *                   mesmo nome podem não casar numa busca — e, pior, o
 *                   canônico assina bytes diferentes para o que a tela
 *                   mostra igual.
 *   2. invisíveis   removidos, não substituídos por espaço: eles não
 *                   representam separação, representam sujeira de
 *                   copiar-e-colar.
 *   3. colapso      qualquer corrida de espaços vira um só.
 *   4. trim         pontas.
 *
 * NFC ANTES do resto porque a decomposição pode gerar sequências que só
 * se resolvem depois de compostas.
 *
 * `[^\S\n]` é "espaço em branco que não seja quebra de linha" — é o que
 * permite a mesma função servir campo de uma linha e parágrafo.
 */
function sanear(texto: string): string {
  return texto
    .normalize('NFC')
    .replace(INVISIVEIS, '')
    .replace(/[^\S\n]+/g, ' ')
    // Espaço ANTES de pontuação. Achado no uso real em 2026-08-25:
    // "  av.  brasil   , 90 " saía como "av. brasil , 90". Colapsar
    // corridas de espaço não resolve — o espaço é UM só, e está no lugar
    // errado. Remover não muda significado em português nenhum.
    .replace(/[^\S\n]+([,;:.!?])/g, '$1')
    .trim()
}

/**
 * Campo de UMA linha: cliente, logradouro, complemento, referência,
 * nome de agência, de convênio, de motoboy.
 *
 * Quebra de linha vira espaço — num campo de uma linha ela só pode ter
 * vindo de colagem, e preservá-la quebraria o layout de quem imprime.
 */
export function normalizarLinha(texto: string): string {
  return sanear(texto.replace(/[\r\n]+/g, ' '))
}

/**
 * Campo de VÁRIAS linhas: observações, justificativa, motivo do
 * insucesso.
 *
 * Preserva a quebra de linha porque ali ela é do autor — alguém
 * escrevendo três motivos em três linhas está organizando, não sujando.
 * O que some é o excesso: espaço nas pontas de cada linha, e mais de uma
 * linha em branco seguida.
 */
export function normalizarParagrafo(texto: string): string {
  return texto
    .normalize('NFC')
    .replace(INVISIVEIS, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((linha) => linha.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Nome próprio — e a regra de caixa é DELIBERADAMENTE tímida.
 *
 * **A caixa só é ajustada quando o texto está inteiro numa caixa só.**
 *
 *     "maria de fátima"   → "Maria de Fátima"   ajusta
 *     "MARIA DE FÁTIMA"   → "Maria de Fátima"   ajusta
 *     "Maria DE fátima"   → intocado            o autor escolheu
 *     "João MacArthur"    → intocado
 *
 * O motivo: caixa mista é informação. Quem digitou "MacArthur",
 * "JBS" ou "AABB" fez uma escolha, e um title-case ingênuo a destrói sem
 * perguntar. Já quem digitou tudo em minúsculo (pressa) ou tudo em
 * maiúsculo (Caps Lock) não escolheu nada.
 *
 * **E ela NÃO se aplica a endereço em E1.** Medido:
 *
 *     "rua xv de novembro"  →  "Rua Xv de Novembro"
 *
 * "XV" é numeral romano, e não há como um title-case saber disso sem
 * inventar um dicionário. Endereço só ganha caixa quando estiver
 * ESTRUTURADO (E9): aí o `logradouro` é campo próprio, sem número nem
 * complemento no meio, e a decisão fica menos arriscada. Até lá, endereço
 * recebe `normalizarLinha` e nada mais.
 */
export function normalizarNome(texto: string): string {
  const limpo = normalizarLinha(texto)
  if (!limpo) return limpo

  const temMinuscula = limpo !== limpo.toUpperCase()
  const temMaiuscula = limpo !== limpo.toLowerCase()
  // Caixa mista: o autor escolheu. Sai como entrou.
  if (temMinuscula && temMaiuscula) return limpo

  return limpo
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((palavra, indice) =>
      indice > 0 && PARTICULAS.has(palavra) ? palavra : capitalizar(palavra)
    )
    .join(' ')
}

/**
 * NUMERAL ROMANO ESTRITO — a guarda que destrava a caixa do endereço.
 *
 * "Rua XV de Novembro" é um dos nomes de rua mais comuns do Brasil, e um
 * title-case ingênuo o destrói ("Rua Xv"). Foi por isso que o E1 nasceu
 * SEM caixa no endereço.
 *
 * O uso real desmentiu a decisão em 2026-08-25: com o nome sendo
 * corrigido e o endereço não, a tela fica visivelmente inconsistente.
 *
 * O que torna a guarda segura é ela ser ESTRITA — não "só tem letras
 * romanas", que aceitaria palavra de verdade. Medido:
 *
 *     xv ix xxi iii vi xx    -> romano      (o que queremos)
 *     mil vil civil id       -> NAO romano  (a regra frouxa erraria)
 *     di li mi mix           -> romano      <- falso positivo
 *
 * Dos falsos positivos, `di` é o único que aparece de verdade em
 * endereço ("Rua Di Cavalcanti") — e ele já está em `PARTICULAS`, que é
 * consultada ANTES. Os outros três exigiriam uma rua chamada "Li", "Mi"
 * ou "Mix" digitada inteira em caixa única.
 *
 * E é aí que a timidez da regra faz o resto do trabalho: **a caixa só
 * dispara quando o texto está inteiro numa caixa só.** Quem digitar
 * "Rua Mix Center" com as maiúsculas certas nunca é tocado.
 */
const ROMANO = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i

/**
 * Endereço — limpeza estrutural E a caixa tímida, com a guarda acima.
 *
 * A ordem de decisão por token importa, e é esta:
 *
 *   1. não começa com letra   ("1018", "nº")  → intocado
 *   2. é partícula, no meio   ("de", "di")    → minúscula
 *   3. é numeral romano       ("xv", "ii")    → MAIÚSCULA
 *   4. o resto                                → Capitalizado
 *
 * Partícula ANTES de romano é o que protege "Di Cavalcanti".
 */
export function normalizarEndereco(texto: string): string {
  const limpo = normalizarLinha(texto)
  if (!limpo) return limpo

  const temMinuscula = limpo !== limpo.toUpperCase()
  const temMaiuscula = limpo !== limpo.toLowerCase()
  if (temMinuscula && temMaiuscula) return limpo

  return limpo
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((palavra, indice) => {
      // O MIOLO, sem a pontuação colada — e esta linha nasceu de um
      // defeito medido: "rua dom pedro ii, 300" tem o token "ii," com a
      // vírgula junto, e `ROMANO.test('ii,')` é falso. Saía
      // "Rua Dom Pedro Ii", que é justamente o erro que a guarda existe
      // pra impedir, uma vírgula mais adiante.
      const [, antes = '', miolo = '', depois = ''] =
        palavra.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u) ?? []

      if (indice > 0 && PARTICULAS.has(miolo)) return palavra
      if (miolo && ROMANO.test(miolo)) {
        return antes + miolo.toLocaleUpperCase('pt-BR') + depois
      }
      return capitalizar(palavra)
    })
    .join(' ')
}

/**
 * Primeira letra de cada pedaço, onde "pedaço" também quebra em `'` e
 * `-`: "d'ávila" → "D'Ávila", "maria-josé" → "Maria-José".
 *
 * Token que não começa com letra sai intocado — "1º", "12b" e "2ª" não
 * têm o que capitalizar, e mexer neles só produziria surpresa.
 */
function capitalizar(palavra: string): string {
  return palavra.replace(
    /(^|['-])(\p{L})/gu,
    (_, antes: string, letra: string) => antes + letra.toLocaleUpperCase('pt-BR')
  )
}

// =====================================================================
// BUSCA — o contrato OPOSTO, e é por isso que ele mora numa função à
// parte com nome que não deixa dúvida.
//
//     normalizarNome()        melhora a ENTRADA, preserva semântica
//     normalizarParaBusca()   melhora a PESQUISA, ignora diferença
//                             visual irrelevante
//
// A regra que os separa:
//
//     persistência preserva o que foi digitado
//     busca é tolerante
//
// `normalizarNome('Joao')` continua `'Joao'` porque mudar o dado seria
// inventar um nome que ninguém digitou. Já o filtro pode ignorar acento
// porque ele não altera nada — só decide quais registros correspondem.
//
// ---------------------------------------------------------------------
// O RESULTADO DESTA FUNÇÃO NUNCA VOLTA PRO CAMPO
//
// Ela é agressiva de propósito: tira acento, baixa a caixa, achata tudo.
// Gravar a saída dela seria destruir o nome da pessoa.
//
// O spec tem um caso que existe SÓ pra impedir isso, e ele não é
// decorativo: daqui a alguns meses alguém vai pensar "já temos uma
// função que tira acento" e usá-la pra salvar. O caso afirma, lado a
// lado, que as duas funções discordam de propósito sobre a MESMA
// entrada.
// =====================================================================

/**
 * A chave de comparação de um texto. Nunca o texto.
 *
 * A ordem importa: NFD ANTES de tirar as marcas, senão os acentos ainda
 * estão fundidos na letra e não há o que remover. `\p{M}` pega tudo que
 * é marca combinante — inclusive a cedilha, que decompõe em `c` + marca.
 *
 * O que ela DELIBERADAMENTE não faz: equivalência fonética. `Luis` e
 * `Luiz` continuam diferentes, e isso é decisão — busca fonética inventa
 * equivalência, e um cadastro que aparece porque "soa parecido" é pior
 * que um que não aparece.
 */
export function normalizarParaBusca(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(INVISIVEIS, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * O predicado de filtro, num lugar só.
 *
 * Existe pra nenhuma tela escrever `.includes()` por conta própria e
 * esquecer de normalizar um dos dois lados — que é o defeito silencioso
 * aqui: normalizar só a pesquisa faz "joao" não achar "João", e o
 * sintoma é indistinguível de "não existe cadastro".
 *
 * Pesquisa vazia casa com tudo: filtro sem termo não é filtro.
 */
export function casaComBusca(valor: string | null | undefined, pesquisa: string): boolean {
  const termo = normalizarParaBusca(pesquisa)
  if (!termo) return true
  return normalizarParaBusca(valor ?? '').includes(termo)
}
