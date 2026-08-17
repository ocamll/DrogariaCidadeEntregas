// Teste da forma canônica do Romaneio (src/lib/canonico.ts).
//
// Roda com:  npx tsx scripts/canonico.spec.mts
//
// Fica fora de src/ de propósito: nenhum dos dois tsconfig o inclui,
// então ele não entra no build nem exige runner de teste no package.json
// — o projeto não tem um, e a stack é lista fechada.
//
// O que ele NÃO prova: que o lado SQL concorda. Isso só o banco responde,
// e o caminho pra isso é conferirCanonico(), em src/data/romaneios.ts.
import { montarCanonico, type EntradaCanonica } from '../src/lib/canonico.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok  ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const base: EntradaCanonica = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  lojaId: '22222222-2222-2222-2222-222222222222',
  agenciaId: '33333333-3333-3333-3333-333333333333',
  motoboyId: '44444444-4444-4444-4444-444444444444',
  caixaId: '55555555-5555-5555-5555-555555555555',
  vales: [
    {
      entregaId: 'bbbbbbbb-0000-0000-0000-000000000002',
      numeroVale: 'V-000022', tipo: 'cliente',
      clienteNome: 'Maria Silva', clienteEndereco: 'Rua General Câmara, 520',
      quantidadeVales: 2, valorCompraCents: 12399, valorEntregaCents: 1800,
      entregaPagaClienteCents: 900, lojaOrigemId: null, convenioId: null,
      pagamentosPrevistos: [
        { pagamentoId: 'ffffffff-0000-0000-0000-000000000002', forma: 'pix', valorCents: 12399, trocoCents: 0 },
        { pagamentoId: 'ffffffff-0000-0000-0000-000000000001', forma: 'dinheiro', valorCents: 100, trocoCents: 0 },
      ],
    },
    {
      entregaId: 'aaaaaaaa-0000-0000-0000-000000000001',
      numeroVale: 'V-000021', tipo: 'cliente',
      clienteNome: 'João\tSouza', clienteEndereco: 'Av. Brasil\n1000',
      quantidadeVales: 1, valorCompraCents: 5000, valorEntregaCents: 900,
      entregaPagaClienteCents: 0, lojaOrigemId: null, convenioId: null,
      pagamentosPrevistos: [],
    },
  ],
}

const saida = montarCanonico(base)
const linhas = saida.split('\n')

console.log('--- canônico gerado ---')
console.log(saida.replace(/\t/g, '⇥'))
console.log('-----------------------\n')

checa('cabeçalho é DCR1', linhas[0] === 'DCR1')
checa('7 linhas de cabeçalho', linhas.slice(0, 7).every((l, i) => i === 0 || l.includes('\t')))
checa('contagem de vales bate', linhas[6] === 'vales\t2')
checa('sem \n no fim', !saida.endsWith('\n'))
checa('vales ordenados por id (aaaa antes de bbbb)',
  linhas[7].startsWith('v\taaaaaaaa') && linhas[8].startsWith('v\tbbbbbbbb'))
checa('pagamentos vêm depois de TODOS os vales',
  linhas[9].startsWith('p\t') && linhas[10].startsWith('p\t'))
checa('pagamentos ordenados por id dentro da entrega',
  linhas[9].includes('ffffffff-0000-0000-0000-000000000001') &&
  linhas[10].includes('ffffffff-0000-0000-0000-000000000002'))
checa('TAB e LF no texto viraram espaço',
  linhas[7].includes('João Souza') && linhas[7].includes('Av. Brasil 1000'))
checa('nulo vira hífen', linhas[7].split('\t')[10] === '-' && linhas[7].split('\t')[11] === '-')
checa('vale tem exatamente 12 campos', linhas[7].split('\t').length === 12)
checa('pagamento tem exatamente 6 campos', linhas[9].split('\t').length === 6)
checa('acento preservado (sem normalizar)', linhas[8].includes('Câmara'))
checa('dinheiro em inteiro simples', linhas[8].split('\t').slice(6, 10).join(',') === '2,12399,1800,900')

// determinismo: mesma entrada em ordem diferente => mesmos bytes
const embaralhado: EntradaCanonica = { ...base, vales: [...base.vales].reverse() }
checa('ordem de entrada não muda a saída', montarCanonico(embaralhado) === saida)

// uuid maiúsculo tem que virar minúsculo
const maiusculo: EntradaCanonica = { ...base, lojaId: base.lojaId.toUpperCase() }
checa('uuid é normalizado pra minúscula', montarCanonico(maiusculo) === saida)

console.log(`\n${falhas === 0 ? 'TODOS PASSARAM' : falhas + ' FALHA(S)'}`)
process.exit(falhas === 0 ? 0 : 1)
