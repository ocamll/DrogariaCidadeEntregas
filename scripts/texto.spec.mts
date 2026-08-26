// npx tsx scripts/texto.spec.mts
//
// O GATE DO E1.
//
// Roda sem navegador porque `src/lib/texto.ts` não importa nada. Uma
// função que toca TODO campo livre do sistema precisa ser exercitável
// fora do app — senão a única forma de saber o que ela faz com um nome
// colado do WhatsApp é colar um nome do WhatsApp.

import {
  normalizarLinha,
  normalizarParagrafo,
  normalizarNome,
  normalizarEndereco,
  normalizarParaBusca,
  casaComBusca,
} from '../src/lib/texto.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}
function igual(nome: string, obtido: string, esperado: string) {
  checa(nome, obtido === esperado, obtido === esperado ? '' : `veio ${JSON.stringify(obtido)}`)
}

const NBSP = ' '
const ZWSP = '​'
const BOM = '﻿'

console.log('\n--- (1) o básico ---')
{
  igual('espaço nas pontas', normalizarLinha('  José  '), 'José')
  igual('espaços internos colapsam', normalizarLinha('José   da   Silva'), 'José da Silva')
  igual('tab vira espaço', normalizarLinha('José\t\tSilva'), 'José Silva')
  igual('string vazia continua vazia', normalizarLinha(''), '')
  igual('só espaço vira vazio', normalizarLinha('   '), '')
}

console.log('\n--- (2) os INVISÍVEIS, que o trim não pega ---')
{
  // Medido: /\s/ pega NBSP mas NÃO pega ZWSP. Sem o tratamento, dois
  // clientes visualmente idênticos viram dois registros que nenhuma
  // busca casa e que ninguém enxerga na tela.
  checa('sem tratamento, ZWSP faz dois nomes diferentes', 'Jose' + ZWSP !== 'Jose')
  igual('ZWSP some', normalizarLinha('Jose' + ZWSP), 'Jose')
  igual('ZWSP no meio some', normalizarLinha('Jo' + ZWSP + 'se'), 'Jose')
  igual('BOM some', normalizarLinha(BOM + 'José'), 'José')
  igual('NBSP vira espaço comum', normalizarLinha('José' + NBSP + 'Silva'), 'José Silva')
  checa(
    'e o resultado do NBSP é espaço DE VERDADE',
    !normalizarLinha('José' + NBSP + 'Silva').includes(NBSP)
  )
  // O invisível é REMOVIDO, não virado espaço: ele não separa nada.
  igual('invisível não vira separador', normalizarLinha('Jo' + ZWSP + ' se'), 'Jo se')
}

console.log('\n--- (3) Unicode: mesma aparência, bytes diferentes ---')
{
  const composto = 'José' // José, com é pré-composto
  const decomposto = 'José' // José, com e + acento combinante
  checa('as duas formas NÃO são iguais como string', composto !== decomposto)
  checa(
    'depois de normalizar, são',
    normalizarLinha(composto) === normalizarLinha(decomposto),
    'sem isto, o mesmo nome vira dois cadastros e dois hashes'
  )
  igual('e o resultado é a forma composta', normalizarLinha(decomposto), composto)
}

console.log('\n--- (4) a caixa é TÍMIDA de propósito ---')
{
  igual('tudo minúsculo é ajustado', normalizarNome('maria de fátima'), 'Maria de Fátima')
  igual('TUDO MAIÚSCULO é ajustado', normalizarNome('MARIA DE FÁTIMA'), 'Maria de Fátima')

  // A regra que protege quem escolheu: caixa mista é INFORMAÇÃO.
  igual('caixa mista NÃO é tocada', normalizarNome('Maria DE fátima'), 'Maria DE fátima')
  igual('MacArthur sobrevive', normalizarNome('João MacArthur'), 'João MacArthur')
  igual('sigla no meio sobrevive', normalizarNome('Farmácia JBS Ltda'), 'Farmácia JBS Ltda')

  // Mas a limpeza de espaço vale SEMPRE, mesmo com caixa mista.
  igual('mista ainda perde espaço duplo', normalizarNome('Maria   DE  fátima'), 'Maria DE fátima')
}

console.log('\n--- (5) partículas ---')
{
  igual('partícula no meio fica minúscula', normalizarNome('joão da silva'), 'João da Silva')
  igual('e no COMEÇO não', normalizarNome('da silva comércio'), 'Da Silva Comércio')
  igual('dos/das', normalizarNome('maria dos santos'), 'Maria dos Santos')
  igual('o "e" também', normalizarNome('tereza e silva'), 'Tereza e Silva')
}

console.log('\n--- (6) apóstrofo, hífen e tokens que não são palavra ---')
{
  igual('apóstrofo', normalizarNome("d'ávila"), "D'Ávila")
  igual('hífen', normalizarNome('maria-josé'), 'Maria-José')
  // Token que não começa com letra sai intocado: não há o que
  // capitalizar em "1º", e mexer só produziria surpresa.
  igual('ordinal sobrevive', normalizarNome('joão 2º andar'), 'João 2º Andar')
  igual('número puro sobrevive', normalizarNome('bloco 12'), 'Bloco 12')
}

console.log('\n--- (7) ENDEREÇO: a decisão do E1 foi REVERTIDA pelo uso real ---')
{
  // O E1 nasceu SEM caixa no endereço, por causa de "rua xv de
  // novembro" -> "Rua Xv De Novembro". A primeira medição com uso
  // real, em 2026-08-25, mostrou o outro lado: com o NOME sendo
  // corrigido e o endereço não, a tela fica visivelmente
  // inconsistente. A saída não foi desistir da guarda — foi
  // torná-la ESTRITA.
  igual('o caso que motivou tudo', normalizarEndereco('rua xv de novembro, 1018'), 'Rua XV de Novembro, 1018')
  igual('e em CAPS', normalizarEndereco('RUA XV DE NOVEMBRO, 1018'), 'Rua XV de Novembro, 1018')

  // O DEFEITO QUE A PRIMEIRA VERSÃO TINHA, e que só apareceu medindo:
  // o token é "ii," com a vírgula colada, e o teste de romano falha.
  // Saía "Rua Dom Pedro Ii" — o mesmo erro que a guarda existe pra
  // impedir, uma vírgula mais adiante.
  igual('romano com pontuação colada', normalizarEndereco('rua dom pedro ii, 300'), 'Rua Dom Pedro II, 300')
  igual('romano isolado', normalizarEndereco('rua ix de julho'), 'Rua IX de Julho')

  igual('abreviatura', normalizarEndereco('av. joão pessoa, 90'), 'Av. João Pessoa, 90')
  igual('espaço antes da vírgula some', normalizarEndereco('  av.  brasil   , 90 '), 'Av. Brasil, 90')
  igual('número intocado', normalizarEndereco('travessa sete de setembro, 12 apto 3'), 'Travessa Sete de Setembro, 12 Apto 3')

  // "di" é falso positivo do validador romano — e a única palavra da
  // lista que aparece de verdade em endereço ("Rua Di Cavalcanti").
  // Partícula é consultada ANTES do romano, e é isso que a protege.
  igual('partícula vence o romano', normalizarEndereco('rua di cavalcanti, 45'), 'Rua di Cavalcanti, 45')

  // A timidez continua valendo, e é ela que torna o falso positivo
  // aceitável: caixa mista nunca é tocada.
  igual('caixa mista intocada', normalizarEndereco('Rua Mix Center, 12'), 'Rua Mix Center, 12')

  // E o falso positivo assumido, dito por extenso pra ninguém achar
  // que passou despercebido.
  igual('o falso positivo conhecido', normalizarEndereco('RUA MIX CENTER, 12'), 'Rua MIX Center, 12')
}

console.log('\n--- (8) parágrafo preserva a quebra que é do autor ---')
{
  igual(
    'quebra simples sobrevive',
    normalizarParagrafo('cliente ausente\nvoltou 18h'),
    'cliente ausente\nvoltou 18h'
  )
  igual(
    'espaço nas pontas de cada linha some',
    normalizarParagrafo('  cliente ausente  \n   voltou 18h  '),
    'cliente ausente\nvoltou 18h'
  )
  igual(
    'linha em branco dupla vira simples',
    normalizarParagrafo('um\n\n\n\ndois'),
    'um\n\ndois'
  )
  igual('CRLF vira LF', normalizarParagrafo('um\r\ndois'), 'um\ndois')
  igual('pontas do texto inteiro', normalizarParagrafo('\n\n  um  \n\n'), 'um')

  // E a diferença com `normalizarLinha`, que é o ponto de haver duas.
  igual('linha ACHATA a quebra', normalizarLinha('um\ndois'), 'um dois')
}

console.log('\n--- (9) IDEMPOTÊNCIA: f(f(x)) === f(x) ---')
{
  // Não é elegância: o mesmo valor passa por aqui ao cadastrar e de novo
  // ao editar. Uma função que muda o resultado na segunda passada faria
  // o dado derivar sozinho a cada edição.
  const entradas = [
    '  José   da  Silva ',
    'MARIA DE FÁTIMA',
    'Maria DE fátima',
    "d'ávila",
    'Jose' + ZWSP,
    'José',
    'rua xv, 1018',
    'RUA DOM PEDRO II, 300',
    'av.  brasil , 90',
    '',
    '   ',
    'um\n\n\ndois',
    'JOÃO 2º ANDAR',
  ]
  let instaveis = 0
  for (const entrada of entradas) {
    for (const f of [normalizarLinha, normalizarParagrafo, normalizarNome, normalizarEndereco]) {
      const uma = f(entrada)
      if (f(uma) !== uma) {
        instaveis++
        console.log(`  instável: ${f.name}(${JSON.stringify(entrada)})`)
      }
    }
  }
  checa('nenhuma função deriva na segunda passada', instaveis === 0, `${entradas.length} entradas × 4`)
}

console.log('\n--- (10) a FRONTEIRA: isto não é o canônico ---')
{
  // `textoCanonico` (canonico.ts) troca TAB/CR/LF por espaço e mais
  // NADA — sem trim, sem NFC, sem colapso. As duas funções resolvem
  // problemas diferentes e NÃO podem convergir: o canônico tem um gêmeo
  // em SQL, esta função não tem e nunca vai ter.
  const comEspacos = '  José   Silva  '
  const canonicoIngenuo = comEspacos.replace(/[\t\n\r]/g, ' ')
  checa(
    'o canônico NÃO faz o que esta função faz',
    canonicoIngenuo !== normalizarLinha(comEspacos),
    'se um dia forem iguais, alguém aproximou os dois contratos'
  )
  checa(
    'e o canônico preserva as pontas',
    canonicoIngenuo === comEspacos,
    'é ele que assina o que foi digitado, não o que ficaria bonito'
  )
}

console.log('\n--- (11) BUSCA: o contrato OPOSTO ---')
{
  // A regra: persistência preserva o que foi digitado; busca é
  // tolerante. Ignorar acento no FILTRO não altera dado nenhum — só
  // decide quais registros correspondem.
  igual('tira acento', normalizarParaBusca('João'), 'joao')
  igual('cedilha também', normalizarParaBusca('Conceição'), 'conceicao')
  igual('e caixa', normalizarParaBusca('SÃO GABRIEL'), 'sao gabriel')

  // As quatro formas do mesmo nome colapsam na MESMA chave.
  const formas = ['João da Silva', 'Joao da Silva', 'JOÃO DA SILVA', 'joão da silva']
  const chaves = new Set(formas.map(normalizarParaBusca))
  checa('as quatro grafias viram UMA chave', chaves.size === 1, [...chaves].join(' | '))

  // O predicado, que é o que as telas usam.
  checa('busca sem acento acha o nome com acento', casaComBusca('João da Silva', 'joao'))
  checa('e com acento acha o sem', casaComBusca('Joao da Silva', 'joão'))
  checa('pesquisa vazia casa com tudo', casaComBusca('qualquer', '   '))
  checa('nulo não quebra', casaComBusca(null, 'joao') === false)

  // O QUE ELA DELIBERADAMENTE NÃO FAZ: equivalência fonética.
  // Um cadastro que aparece porque "soa parecido" é pior que um que
  // não aparece — inventa equivalência que ninguém pediu.
  checa('Luis e Luiz continuam DIFERENTES', normalizarParaBusca('Luis') !== normalizarParaBusca('Luiz'))
}

console.log('\n--- (12) A TRAVA: as duas funções discordam de propósito ---')
{
  // Este caso existe SÓ pra impedir um erro futuro previsível: alguém
  // pensa "já temos uma função que tira acento" e a usa pra SALVAR.
  //
  // Sobre a MESMA entrada, as duas respondem coisas diferentes, e as
  // duas estão certas — porque respondem perguntas diferentes.
  igual('entrada: NÃO inventa acento', normalizarNome('Joao'), 'Joao')
  igual('entrada: preserva o acento que veio', normalizarNome('João'), 'João')
  igual('busca: achata os dois', normalizarParaBusca('Joao'), 'joao')
  igual('busca: achata os dois (2)', normalizarParaBusca('João'), 'joao')

  checa(
    'gravar a saída da busca DESTRUIRIA o nome',
    normalizarParaBusca('João da Silva') !== normalizarNome('João da Silva'),
    'se um dia forem iguais, alguém trocou uma pela outra'
  )
}
console.log(falhas === 0 ? '\ntexto ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
