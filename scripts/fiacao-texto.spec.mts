// npx tsx scripts/fiacao-texto.spec.mts
//
// O GATE DA FIAÇÃO DO E1.
//
// `texto.spec.mts` prova o que a biblioteca FAZ. Este prova ONDE ela é
// chamada — e, principalmente, onde ela NÃO é.
//
// A fronteira congelada:
//
//     DIGITAÇÃO → normalização → validação → persistência → snapshot
//
// e nunca:
//
//     dado salvo/assinado → normalização posterior
//
// A segunda metade não dá pra testar chamando função: ela é uma
// afirmação sobre o CÓDIGO. Por isso este spec lê o fonte, no mesmo
// método de `despacho-sync-romaneio.spec.mts`, que lê o texto da Edge
// Function em vez de invocá-la.
//
// Sem isto, a idempotência provada na biblioteca não diz nada sobre o
// app: ela garante que DUAS passadas dão o mesmo resultado, não que o
// app faça uma só.

import { readFileSync } from 'node:fs'
import {
  normalizarLinha,
  normalizarNome,
  normalizarParagrafo,
  normalizarEndereco,
} from '../src/lib/texto.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

/**
 * TODA ASSERÇÃO DE FIAÇÃO LÊ O CÓDIGO, NUNCA A PROSA — por isso `ler`
 * tira os comentários antes de devolver o fonte.
 *
 * Isto entrou no E4 (2026-08-27), depois de a armadilha morder de dois
 * jeitos no mesmo dia:
 *
 *   - uma asserção NEGATIVA falhou casando com o comentário que
 *     explicava a regra recém-removida — barulho, mas inofensivo;
 *   - uma asserção POSITIVA do E3.C **passou depois de o campo que ela
 *     protegia ter sido removido**, casando com o comentário que
 *     explicava a remoção. Um teste afirmando que uma proteção existe
 *     depois de ela sair é pior que um teste que grita à toa.
 *
 * E o incentivo estava do lado errado, que é o que mais importa num
 * projeto que comenta tanto quanto este: **quanto melhor documentada a
 * regra, mais provável o falso resultado.** Documentar não pode custar
 * um teste.
 *
 * Nenhuma asserção deste arquivo pergunta sobre comentário. Se um dia
 * alguma precisar, ela usa `lerBruto` e diz por quê.
 */
const lerBruto = (caminho: string) => readFileSync(caminho, 'utf8')
const semComentarios = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const ler = (caminho: string) => semComentarios(lerBruto(caminho))
const importa = (fonte: string) => /from '@\/lib\/texto'/.test(fonte)
const CHAMADA = /normalizar(Linha|Nome|Paragrafo)\s*\(/g

// ---------------------------------------------------------------------
// (0) O CONTROLE NEGATIVO DO PRÓPRIO INSTRUMENTO
//
// Ligar o `semComentarios` não mudou uma linha da saída deste spec —
// medido. Só que saída idêntica prova que nada QUEBROU, não que a
// proteção MORDE. Sem isto, um `semComentarios` que devolvesse o fonte
// intacto passaria despercebido pra sempre, e a armadilha voltaria a
// ficar armada com um comentário tranquilizador por cima.
// ---------------------------------------------------------------------
console.log('\n--- (0) o instrumento: comentário não conta como código ---')
{
  const comLinha = "const x = 1\n// aqui alguém explica que normalizarNome(nome) saiu\n"
  const comBloco = "const y = 2\n{/* normalizarNome(nome) foi removido daqui */}\n"

  checa('o fonte CRU acusaria a chamada num comentário de linha',
    /normalizarNome\(/.test(comLinha))
  checa('e o limpo NÃO', !/normalizarNome\(/.test(semComentarios(comLinha)))

  checa('idem no bloco JSX, que é como as telas comentam',
    /normalizarNome\(/.test(comBloco) && !/normalizarNome\(/.test(semComentarios(comBloco)))

  // E o que ele NÃO pode fazer: comer código de verdade.
  checa('mas o código em volta continua inteiro',
    semComentarios(comLinha).includes('const x = 1') &&
      semComentarios(comBloco).includes('const y = 2'))
  checa('e a chamada de VERDADE continua sendo vista',
    /normalizarNome\(/.test(semComentarios('const n = normalizarNome(nome)')))
}

// ---------------------------------------------------------------------
// (1) OS PONTOS DE ENTRADA — todos ligados
//
// A lista é explícita, e não um `glob`: uma tela de entrada nova tem que
// aparecer AQUI pra alguém decidir qual função ela usa. Um glob a
// aceitaria em silêncio.
// ---------------------------------------------------------------------
console.log('\n--- (1) toda tela de entrada passa pela biblioteca ---')
{
  const entradas: Array<[string, string]> = [
    ['src/pages/CadastroEntrega.tsx', 'cliente e endereço'],
    ['src/components/AgenciasCadastro.tsx', 'nome da agência'],
    ['src/components/MototaxistasCadastro.tsx', 'nome do motoboy'],
    // ConveniosCadastro saiu no passo 1 (2026-09-08): o convênio deixou
    // de ser identificado, então não há mais nome de empresa a normalizar.
    ['src/components/UsuariosCadastro.tsx', 'nome do usuário'],
    ['src/components/CancelarValeDialog.tsx', 'motivo do cancelamento'],
    ['src/components/NotificarOcorrenciaDialog.tsx', 'justificativa'],
    ['src/pages/DocumentosPendentes.tsx', 'justificativa do papel'],
    ['src/pages/RetornoCorrida.tsx', 'detalhe do insucesso'],
  ]
  for (const [arquivo, campo] of entradas) {
    checa(`${campo}`, importa(ler(arquivo)), arquivo)
  }
}

// ---------------------------------------------------------------------
// (2) A FRONTEIRA — quem NÃO pode chamar
//
// Canônico: tem gêmeo em SQL, e uma normalização que só existe em
// TypeScript faria os dois lados divergirem em silêncio.
//
// Snapshot/PDF/tela: leem dado já gravado — e possivelmente já ASSINADO.
// Normalizar na leitura mudaria os bytes que as duas partes assinaram, e
// o romaneio deixaria de bater com o próprio hash.
// ---------------------------------------------------------------------
console.log('\n--- (2) a fronteira: quem NUNCA pode normalizar ---')
{
  const proibidos: Array<[string, string]> = [
    ['src/lib/canonico.ts', 'o canônico da saída tem gêmeo em SQL'],
    ['src/lib/canonicoRetorno.ts', 'idem, o do retorno'],
    ['src/lib/congelarRetorno.ts', 'congela o que já foi digitado'],
    ['src/lib/romaneioPdf.ts', 'desenha o SNAPSHOT, não o dado de hoje'],
    ['src/pages/Romaneio.tsx', 'exibe documento selado'],
    ['src/components/Custodia.tsx', 'exibe assinatura e hash'],
    ['src/components/EntregasTable.tsx', 'exibe o que está gravado'],
    ['src/data/contextoRetorno.ts', 'os fatos antigos, do documento assinado'],
    ['src/lib/exportarAcerto.ts', 'exporta o que está gravado'],
    ['src/lib/exportarAcertoPdf.ts', 'idem'],
    ['src/data/auditoria.ts', 'o registro é o que foi, não o que ficaria bonito'],
  ]
  for (const [arquivo, porque] of proibidos) {
    const fonte = ler(arquivo)
    checa(arquivo.replace('src/', ''), !importa(fonte) && !CHAMADA.test(fonte), porque)
    CHAMADA.lastIndex = 0
  }
}

// ---------------------------------------------------------------------
// (3) O QUE NUNCA PASSA POR AQUI
//
// Senha, PIN, token, hash, uuid, username e o e-mail técnico não são
// linguagem humana. Normalizar um PIN mudaria o segredo; normalizar um
// token de cartão o tornaria irreconhecível; NFC num hash é absurdo.
//
// A checagem é textual e conservadora: procura a chamada com um desses
// nomes como argumento.
// ---------------------------------------------------------------------
console.log('\n--- (3) segredo e identificador não são linguagem humana ---')
{
  const proibidoComoArgumento = [
    'senha', 'pin', 'token', 'hash', 'uuid', 'username', 'email',
    'credentialToken', 'publicId', 'documentHash', 'barcode', 'codigo',
  ]
  const arquivos = [
    'src/pages/CadastroEntrega.tsx',
    'src/components/UsuariosCadastro.tsx',
    'src/components/CredenciaisCadastro.tsx',
    'src/pages/Login.tsx',
    'src/pages/NovaCorrida.tsx',
    'src/pages/RetornoCorrida.tsx',
  ]
  // AS FUNÇÕES DE `texto.ts`, ENUMERADAS — e não `normalizar\w*`.
  //
  // O regex era `normalizar\w*\(`, e ele estava largo demais: a regra é
  // *"isto nunca passa por `lib/texto.ts`"*, não *"isto nunca é
  // normalizado por nada"*.
  //
  // O E5 provou a diferença. `normalizarUsername(username)` é o
  // normalizador PRÓPRIO do username, em `lib/username.ts`, com regra
  // oposta à de `normalizarNome` (aquele preserva acento, este tira). O
  // spec o acusou como violação — verdadeiro pela letra, falso pela
  // intenção.
  //
  // Deixar o regex largo cobraria um preço crescente: todo campo que
  // ganhasse normalização própria — PIN formatado, token exibido — seria
  // acusado, e a saída seria enfraquecer a regra ou encher de exceção.
  const DE_TEXTO_TS = ['Linha', 'Paragrafo', 'Nome', 'Endereco', 'ParaBusca']

  let achados: string[] = []
  for (const arquivo of arquivos) {
    const fonte = ler(arquivo)
    for (const proibido of proibidoComoArgumento) {
      const re = new RegExp(`normalizar(${DE_TEXTO_TS.join('|')})\\(\\s*${proibido}\\b`, 'i')
      if (re.test(fonte)) achados.push(`${arquivo}: ${proibido}`)
    }
  }
  checa('nenhum segredo/identificador normalizado', achados.length === 0, achados.join(' | '))

  // CONTROLE NEGATIVO DO ESTREITAMENTO.
  //
  // Trocar `normalizar\w*` por uma lista fechada corre o risco de
  // desligar a regra em vez de afiná-la — e o sintoma seria este bloco
  // passando para sempre, sem nunca mais acusar nada. Então ele prova as
  // duas metades sobre fonte sintético: o que TEM que pegar, e o que
  // não pode mais pegar.
  const pega = (fonte: string, alvo: string) =>
    new RegExp(`normalizar(${DE_TEXTO_TS.join('|')})\\(\\s*${alvo}\\b`, 'i').test(fonte)

  checa('ainda pega `normalizarNome(senha)`', pega('const x = normalizarNome(senha)', 'senha'))
  checa('ainda pega `normalizarLinha(token)`', pega('normalizarLinha(token)', 'token'))
  checa(
    'ainda pega `normalizarParaBusca(email)`',
    pega('normalizarParaBusca(email)', 'email')
  )
  checa(
    'e NAO pega mais o normalizador proprio do username',
    !pega('const u = normalizarUsername(username)', 'username'),
    'ele mora em lib/username.ts e tem regra OPOSTA à de normalizarNome'
  )

  // E o caso específico que mais preocupa: o painel de usuários mexe em
  // nome, e-mail e senha na MESMA tela.
  const usuarios = ler('src/components/UsuariosCadastro.tsx')
  checa(
    'no painel de usuários, só o NOME é normalizado',
    /normalizarNome\(nome\)/.test(usuarios) &&
      !/normalizar\w*\(\s*email/i.test(usuarios) &&
      !/normalizar\w*\(\s*senha/i.test(usuarios)
  )
}

// ---------------------------------------------------------------------
// (4) A ORDEM: normaliza ANTES de validar
//
// Se a validação rodasse sobre o texto cru, um campo com só invisíveis
// passaria por "preenchido" e chegaria vazio no banco.
// ---------------------------------------------------------------------
console.log('\n--- (4) a validação vê o valor JÁ normalizado ---')
{
  const cadastro = ler('src/pages/CadastroEntrega.tsx')
  const iNorm = cadastro.indexOf('normalizarNome(nome)')
  const iValida = cadastro.indexOf('if (!nomeTrim')
  checa('cadastro de entrega: normaliza antes de validar', iNorm >= 0 && iValida > iNorm)

  // A prova de que isso importa: um campo só com invisíveis.
  const ZWSP = String.fromCodePoint(0x200b)
  checa(
    'e um nome só de invisíveis vira vazio, logo é RECUSADO',
    normalizarNome(ZWSP + ' ' + ZWSP) === '',
    'sem normalizar antes, o `.trim()` deixaria passar'
  )
}

// ---------------------------------------------------------------------
// (5) REABRIR E SALVAR SEM ALTERAR não muda um byte
//
// A idempotência da biblioteca garante f(f(x)) === f(x). Aqui a pergunta
// é outra: o valor que VOLTA DO BANCO, passado de novo pela mesma
// função, continua igual? Se não, todo salvamento faria o dado derivar.
// ---------------------------------------------------------------------
console.log('\n--- (5) o valor que volta do banco não deriva ---')
{
  // CADA AMOSTRA COM A FUNÇÃO QUE É DONA DAQUELE CAMPO.
  //
  // A primeira versão conferia toda amostra contra as TRÊS funções e
  // acusou `'cliente ausente\nvoltou 18h'` — corretamente, porque
  // `normalizarLinha` achata a quebra. Só que aquele texto é de um campo
  // de PARÁGRAFO; passá-lo pela função de linha não é o que o app faz.
  //
  // O defeito era do teste, e é o mesmo padrão do §78: um teste que não
  // diz de qual campo está falando responde a pergunta errada com
  // confiança.
  const gravados: Array<[string, (t: string) => string, string]> = [
    ['José da Silva', normalizarNome, 'cliente'],
    ['Maria de Fátima', normalizarNome, 'cliente com partícula'],
    ['Farmácia JBS Ltda', normalizarNome, 'sigla preservada'],
    ["D'Ávila", normalizarNome, 'apóstrofo'],
    ['Matriz', normalizarNome, 'nome de loja'],
    ['Rua XV de Novembro, 1018', normalizarEndereco, 'endereço com romano'],
    ['Rua Dom Pedro II, 300', normalizarEndereco, 'romano antes de vírgula'],
    ['Propicio Menna, 1018', normalizarEndereco, 'endereço real do banco'],
    ['cliente ausente\nvoltou 18h', normalizarParagrafo, 'justificativa multilinha'],
    ['um\n\ndois', normalizarParagrafo, 'parágrafo com linha em branco'],
  ]
  const derivaram = gravados
    .filter(([valor, funcao]) => funcao(valor) !== valor)
    .map(([valor, , rotulo]) => `${rotulo}: ${JSON.stringify(valor)}`)
  checa(
    'nenhuma amostra gravada muda ao ser reprocessada',
    derivaram.length === 0,
    derivaram.join(' | ')
  )
}

console.log('\n--- (6) BUSCA: os dois lados normalizados, e a chave nunca sai do banco ---')
{
  const entregas = ler('src/data/entregas.ts')

  // OS DOIS LADOS. Normalizar só o termo reintroduz o defeito com
  // outra cara: a coluna derivada já perdeu o acento, então um termo
  // cru COM acento ("João") não casaria com "joao".
  checa(
    'o filtro do histórico normaliza o TERMO',
    entregas.includes('normalizarParaBusca(filtros.clienteNome)') &&
      entregas.includes('normalizarParaBusca(filtros.clienteEndereco)')
  )
  checa(
    'e consulta a COLUNA derivada, não a original',
    entregas.includes("like('cliente_nome_busca'") &&
      entregas.includes("like('cliente_endereco_busca'")
  )
  checa(
    'o filtro antigo por cliente_nome cru sumiu',
    !entregas.includes("ilike('cliente_nome'") &&
      !entregas.includes("ilike('cliente_endereco'"),
    'senão a busca continuaria cega a acento por um caminho paralelo'
  )

  // A CHAVE DE BUSCA NÃO É DADO DE NEGÓCIO: ela filtra e nunca é
  // lida. Se entrar num `select`, alguém vai acabar exibindo — e aí a
  // tela mostra "joao da silva" no lugar do nome da pessoa.
  const selects = entregas.match(/_SELECT\s*=\s*[\s\S]*?\n\n/g) ?? []
  checa(
    'a chave derivada NUNCA é selecionada',
    !selects.some((s) => s.includes('_busca')),
    'derivada é pra comparar, não pra mostrar'
  )

  // `numero_vale` fica de fora de propósito.
  checa(
    'numero_vale continua no ilike cru',
    entregas.includes("ilike('numero_vale'"),
    'V-000046 não tem acento nem caixa; coluna derivada seria peso sem ganho'
  )
}

console.log(falhas === 0 ? '\nfiação ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
