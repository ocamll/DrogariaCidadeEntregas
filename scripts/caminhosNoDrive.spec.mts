// Onde cada documento é arquivado no Drive.
//
// Roda com:  npx tsx scripts/caminhosNoDrive.spec.mts
//
// O envio em si não é testável aqui: depende de consentimento OAuth, que
// é autenticação e não se faz em nome do usuário. O que É testável, e o
// que de fato decide se um romaneio some, é a regra que escolhe as
// pastas — e ela mora num módulo que não importa nada justamente pra
// caber neste teste.
import {
  caminhoDoAcerto,
  caminhoDoRomaneio,
  nomeDaSubpasta,
  PASTA_ACERTOS,
  PASTA_ROMANEIOS,
  SEM_FILIAL,
  PASTA_DA_VIA,
} from '../src/lib/caminhosNoDrive.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

console.log('--- o acerto ---')
checa(
  'raiz própria e subpasta do período',
  igual(caminhoDoAcerto({ dataInicio: '2026-02-01', dataFim: '2026-03-01' }), [
    PASTA_ACERTOS,
    'Acertos 01-02-2026 a 01-03-2026',
  ])
)
checa(
  'a data vira dd-mm-aaaa, como o usuário lê',
  nomeDaSubpasta('2026-08-16', '2026-08-31') === 'Acertos 16-08-2026 a 31-08-2026'
)
checa(
  'o mesmo período dá o mesmo nome — é isso que evita duplicar a pasta',
  nomeDaSubpasta('2026-08-16', '2026-08-31') === nomeDaSubpasta('2026-08-16', '2026-08-31')
)

// Instantes montados a partir de uma data LOCAL, e não de uma string
// UTC: assim o teste vale em qualquer fuso, e é justamente o fuso que
// esta função tem que acertar.
const local = (ano: number, mes: number, dia: number, hora = 12, min = 0) =>
  new Date(ano, mes - 1, dia, hora, min).toISOString()

console.log('\n--- o romaneio ---')
const destino = caminhoDoRomaneio('Matriz', local(2026, 8, 18), 'farmacia')
checa(
  'raiz, filial, mês, dia, via',
  igual(destino, [
    PASTA_ROMANEIOS,
    'Matriz',
    '2026-08',
    '2026-08-18',
    PASTA_DA_VIA.farmacia,
  ])
)
checa('cinco níveis, nem mais nem menos', destino.length === 5, `${destino.length}`)
checa(
  'a pasta do dia se explica sozinha (repete ano e mês)',
  destino[3].startsWith(destino[2]),
  `${destino[2]} › ${destino[3]}`
)
// Nome de pasta com barra é renomeado pelo Google Drive para Desktop ao
// sincronizar pro disco, e `01/2027` cairia entre `01/2026` e `02/2026`
// na ordenação por nome. Por isso o formato não é `08/2026` e `18/08`.
checa('nenhum nível tem barra', destino.every((n) => !n.includes('/')), destino.join(' › '))
checa(
  'a raiz do romaneio NÃO é a do acerto',
  PASTA_ROMANEIOS !== PASTA_ACERTOS,
  `${PASTA_ROMANEIOS} vs ${PASTA_ACERTOS}`
)
// A primeira versão mandava cada romaneio também pra uma pasta `Geral`
// com todas as filiais juntas. O usuário desfez em 2026-08-19 — pasta que
// acumula tudo não ajuda a achar nada. Sem este caso, "tirei a Geral" e
// "esqueci de tirar" seriam indistinguíveis, que é a mesma razão dos
// casos `v2 não é mais lido` no spec do token.
checa('nenhum nível se chama "Geral"', !destino.includes('Geral'), destino.join(' / '))

console.log('\n--- as duas vias, cada uma na sua pasta ---')
const daFarmacia = caminhoDoRomaneio('Matriz', local(2026, 8, 18), 'farmacia')
const daAgencia = caminhoDoRomaneio('Matriz', local(2026, 8, 18), 'agencia')
checa(
  'só o último nível difere',
  igual(daFarmacia.slice(0, -1), daAgencia.slice(0, -1)),
  daFarmacia.slice(0, -1).join(' › ')
)
checa(
  'e ele difere mesmo',
  daFarmacia.at(-1) !== daAgencia.at(-1),
  `${daFarmacia.at(-1)} vs ${daAgencia.at(-1)}`
)
// "Agência" e não "Tele": o sistema inteiro chama de agência (Cadastros,
// "A pagar à agência", o relatório por agência), e o Drive não é lugar
// pra um segundo vocabulário.
checa(
  'a via da agência não se chama "Tele"',
  !PASTA_DA_VIA.agencia.toLowerCase().includes('tele'),
  PASTA_DA_VIA.agencia
)
checa(
  'os dois nomes de via são distintos e não vazios',
  PASTA_DA_VIA.farmacia !== PASTA_DA_VIA.agencia &&
    PASTA_DA_VIA.farmacia.length > 0 &&
    PASTA_DA_VIA.agencia.length > 0
)

console.log('\n--- o fuso, que é onde a pasta por dia dói ---')
// ESTE É O CASO QUE MOTIVA `lib/datas.ts`. Fatiar a string ISO daria o
// dia em UTC, e às 21h em São Gabriel (UTC-3) o instante já é do dia
// seguinte lá. Toda saída do fim da tarde seria arquivada no dia errado —
// e a sangria daquela noite não a acharia na pasta que acabou de criar.
//
// Com pasta por mês isso errava uma vez por mês; com pasta por dia,
// erraria toda noite.
const noite = caminhoDoRomaneio('Matriz', local(2026, 8, 18, 21, 30), 'farmacia')
checa('saída das 21h30 fica no dia dela', igual(noite.slice(2, 4), ['2026-08', '2026-08-18']), noite[3])
checa('e de madrugada também', caminhoDoRomaneio('Matriz', local(2026, 8, 18, 0, 5), 'farmacia')[3] === '2026-08-18')
// Última noite do mês: o caso em que o erro de fuso atravessa o mês
// inteiro, não só o dia.
const viradaDeMes = caminhoDoRomaneio('Matriz', local(2026, 8, 31, 22, 0), 'farmacia')
checa(
  'a virada de mês não empurra pro mês seguinte',
  igual(viradaDeMes.slice(2, 4), ['2026-08', '2026-08-31']),
  viradaDeMes.slice(2, 4).join(' › ')
)
// E de ano, que erraria ano, mês e dia de uma vez.
const viradaDeAno = caminhoDoRomaneio('Matriz', local(2026, 12, 31, 23, 30), 'farmacia')
checa(
  'a virada de ano também não',
  igual(viradaDeAno.slice(2, 4), ['2026-12', '2026-12-31']),
  viradaDeAno.slice(2, 4).join(' › ')
)

console.log('\n--- o mês ordena ---')
// O Drive lista pasta por NOME. Com nome de mês por extenso, dezembro
// apareceria entre agosto e fevereiro; com AAAA-MM a ordem alfabética é a
// cronológica. É o motivo do formato, então vale um teste.
const meses = [local(2026, 11, 30), local(2026, 8, 1), local(2026, 12, 1)].map(
  (d) => caminhoDoRomaneio('Matriz', d, 'farmacia')[2]
)
checa('formato AAAA-MM', igual(meses, ['2026-11', '2026-08', '2026-12']))
checa(
  'ordem alfabética é a cronológica',
  igual([...meses].sort(), ['2026-08', '2026-11', '2026-12'])
)
checa(
  'a virada de ano não embaralha',
  igual([...['2027-01', '2026-12']].sort(), ['2026-12', '2027-01'])
)

console.log('\n--- os casos que fariam um romaneio sumir ---')
// Romaneio de conflito não tem `selado_em`; quem chama resolve a cadeia
// (`ocorrido_em_local ?? selado_em ?? recebido_em_servidor`) antes de
// chamar. O que não pode acontecer é um nível vir vazio.
checa(
  'filial nula cai em "Sem filial", não numa pasta sem nome',
  igual(caminhoDoRomaneio(null, local(2026, 8, 18), 'farmacia'), [
    PASTA_ROMANEIOS,
    SEM_FILIAL,
    '2026-08',
    '2026-08-18',
    PASTA_DA_VIA.farmacia,
  ])
)
checa(
  'filial só com espaços também',
  caminhoDoRomaneio('   ', local(2026, 8, 18), 'farmacia')[1] === SEM_FILIAL
)
checa(
  'espaço em volta do nome não cria uma segunda pasta "Matriz "',
  caminhoDoRomaneio(' Matriz ', local(2026, 8, 18), 'farmacia')[1] === 'Matriz'
)
checa(
  'nenhum nível sai vazio',
  caminhoDoRomaneio(null, local(2026, 8, 18), 'farmacia').every((n) => n.length > 0)
)
// Acento e til aparecem em nome de filial de verdade ("São Gabriel"), e o
// nome vai dentro de uma query do Drive. Aspas simples são escapadas no
// transporte; aqui o que se garante é que o nome chega inteiro.
checa(
  'acento no nome da filial é preservado',
  caminhoDoRomaneio('Filial São Gabriel', local(2026, 8, 18), 'farmacia')[1] === 'Filial São Gabriel'
)

console.log(`\n${falhas === 0 ? 'caminhos no Drive ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
