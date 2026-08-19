// Confere os GOLDEN VECTORS contra a especificação do DCRR1.
//
// Roda com:  npx tsx scripts/dcrr1-vetores.spec.mts
//
// ATENÇÃO AO QUE ESTE TESTE É E AO QUE ELE NÃO É.
//
// Ele NÃO testa implementação nenhuma — quando roda, ainda não existe
// canônico de retorno em TypeScript nem em SQL. Ele testa os VETORES:
// que o texto que eu escrevi à mão de fato obedece as regras do formato,
// e que o sha256 gravado corresponde àquele texto.
//
// Isso importa porque um vetor errado é pior que vetor nenhum: as duas
// implementações seriam escritas pra bater com ele, os três testes
// passariam, e o formato congelado estaria errado desde o primeiro
// romaneio selado.
//
// A verificação verdadeiramente independente é outra, e está no rodapé
// do `dcrr1-vetores.mts`: colar o texto no SQL Editor e conferir o
// digest lá. Caminho totalmente fora do Node.
import { createHash } from 'node:crypto'
import { VETORES } from './dcrr1-vetores.mts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HEX64 = /^[0-9a-f]{64}$/
const DESFECHOS = ['entregue', 'insucesso']
const MOTIVOS = ['ausente', 'endereco_errado', 'recusou', 'outro', '-']
const FORMAS = ['dinheiro', 'credito', 'debito', 'pix', 'convenio', 'vale', 'outro']

for (const vetor of VETORES) {
  console.log(`\n--- ${vetor.nome} ---`)
  const linhas = vetor.canonico.split('\n')

  // ---- o hash corresponde ao texto -------------------------------------
  // Circular de propósito, e vale mesmo assim: impede que alguém edite um
  // canônico e esqueça de refazer o hash.
  const calculado = createHash('sha256').update(vetor.canonico, 'utf8').digest('hex')
  checa('sha256 corresponde ao texto', calculado === vetor.sha256, calculado.slice(0, 16) + '…')

  // ---- o cabeçalho ------------------------------------------------------
  checa('abre com DCRR1', linhas[0] === 'DCRR1')
  checa(
    'as quatro linhas de cabeçalho, na ordem',
    ['saida', 'saida_hash', 'motoboy', 'responsavel'].every(
      (rotulo, i) => linhas[i + 1]?.split('\t')[0] === rotulo
    ),
    linhas.slice(1, 5).map((l) => l.split('\t')[0]).join(', ')
  )
  checa('saida é uuid minúsculo', UUID.test(linhas[1].split('\t')[1]))
  checa('saida_hash é sha256 hex', HEX64.test(linhas[2].split('\t')[1]))
  checa(
    'o cabeçalho reflete a entrada',
    linhas[1].split('\t')[1] === vetor.entrada.saidaRomaneioId &&
      linhas[2].split('\t')[1] === vetor.entrada.saidaDocumentHash &&
      linhas[3].split('\t')[1] === vetor.entrada.motoboyId &&
      linhas[4].split('\t')[1] === vetor.entrada.responsavelId
  )

  // ---- estrutura --------------------------------------------------------
  const corpo = linhas.slice(5)
  checa(
    'só linhas v e pr depois do cabeçalho',
    corpo.every((l) => l.startsWith('v\t') || l.startsWith('pr\t')),
    `${corpo.length} linhas`
  )
  const iPrimeiroPr = corpo.findIndex((l) => l.startsWith('pr\t'))
  const iUltimoV = corpo.map((l) => l.startsWith('v\t')).lastIndexOf(true)
  checa(
    'TODOS os pagamentos depois de TODOS os vales',
    iPrimeiroPr === -1 || iPrimeiroPr > iUltimoV,
    iPrimeiroPr === -1 ? 'sem pagamento' : `último v em ${iUltimoV}, primeiro pr em ${iPrimeiroPr}`
  )
  checa('não termina em quebra de linha', !vetor.canonico.endsWith('\n'))
  checa(
    'nenhuma linha tem TAB, CR ou LF cru no último campo',
    !corpo.some((l) => /[\r\n]/.test(l))
  )

  // ---- as linhas de vale ------------------------------------------------
  const vs = corpo.filter((l) => l.startsWith('v\t')).map((l) => l.split('\t'))
  checa('uma linha v por vale da entrada', vs.length === vetor.entrada.vales.length)
  checa('toda linha v tem 5 campos', vs.every((c) => c.length === 5))
  checa('desfecho é do domínio', vs.every((c) => DESFECHOS.includes(c[2])))
  checa('motivo é do domínio (ou -)', vs.every((c) => MOTIVOS.includes(c[3])))

  // A REGRA MAIS IMPORTANTE: normalização é do canônico. Entregue não
  // carrega motivo nem detalhe, MESMO que a entrada traga (ver V004).
  checa(
    'entregue tem motivo e detalhe em "-"',
    vs.filter((c) => c[2] === 'entregue').every((c) => c[3] === '-' && c[4] === '-')
  )
  checa(
    'insucesso tem motivo preenchido',
    vs.filter((c) => c[2] === 'insucesso').every((c) => c[3] !== '-')
  )

  const ordenados = [...vs.map((c) => c[1])]
  checa(
    'vales ordenados por entrega_id (code unit)',
    JSON.stringify(ordenados) === JSON.stringify([...ordenados].sort()),
    ordenados.map((u) => u.slice(-2)).join(' ')
  )

  // ---- as linhas de pagamento -------------------------------------------
  const prs = corpo.filter((l) => l.startsWith('pr\t')).map((l) => l.split('\t'))
  const esperados = vetor.entrada.vales.flatMap((v) =>
    // O canônico só carrega pagamento de vale ENTREGUE; insucesso não
    // gera dinheiro. Se um vetor tiver pagamento em insucesso, isto pega.
    v.desfecho === 'entregue' ? v.pagamentosRealizados : []
  )
  checa('uma linha pr por pagamento de vale entregue', prs.length === esperados.length)
  checa('toda linha pr tem 6 campos', prs.every((c) => c.length === 6))
  checa('forma é do domínio', prs.every((c) => FORMAS.includes(c[3])))
  checa(
    'valor e troco são inteiros sem sinal nem separador',
    prs.every((c) => /^\d+$/.test(c[4]) && /^\d+$/.test(c[5]))
  )
  const chaves = prs.map((c) => c[1] + '|' + c[2])
  checa(
    'pagamentos ordenados por (entrega_id, pagamento_id)',
    JSON.stringify(chaves) === JSON.stringify([...chaves].sort()),
    chaves.map((k) => k.slice(34, 36) + '/' + k.slice(-2)).join(' ')
  )
  checa(
    'todo pagamento aponta pra um vale presente',
    prs.every((c) => vs.some((v) => v[1] === c[1]))
  )
}

// ---- entre vetores -----------------------------------------------------
console.log('\n--- o conjunto ---')
const hashes = VETORES.map((v) => v.sha256)
checa(
  'nenhum vetor repete o hash de outro',
  new Set(hashes).size === hashes.length,
  `${new Set(hashes).size} distintos de ${hashes.length}`
)
const textos = VETORES.map((v) => v.canonico)
checa('nenhum vetor repete o texto de outro', new Set(textos).size === textos.length)
checa(
  'todo vetor explica por que existe',
  VETORES.every((v) => v.porque.trim().length > 40)
)

console.log(`\n${falhas === 0 ? 'vetores DCRR1 ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
