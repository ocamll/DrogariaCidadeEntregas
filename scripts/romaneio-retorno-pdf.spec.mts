// Testes do Romaneio de Retorno lido para página e PDF
// (src/lib/documentoDoRetorno.ts e o ramo de retorno de src/lib/romaneioPdf.ts).
//
// Roda com:  npx tsx scripts/romaneio-retorno-pdf.spec.mts
//
// Os casos que justificam este arquivo:
//   1. o retorno NUNCA sai com o layout da saída — era `R$ NaN` na tela;
//   2. os documentos vêm das linhas `d` do CANÔNICO assinado, não do estado
//      atual do vale;
//   3. quem recebeu pela farmácia aparece pelo nome — com `=== 'caixa'` o
//      slot `responsavel_loja` saía como "—";
//   4. a via da agência não leva como o cliente pagou.
import { inflateSync } from 'node:zlib'
import { montarRomaneioPdf } from '../src/lib/romaneioPdf.ts'
import { documentosDoCanonicoRetorno, lerRetorno } from '../src/lib/documentoDoRetorno.ts'
import type { RomaneioCompleto } from '../src/data/romaneios.ts'
import { instalarFetchDePublic } from './fetchDePublic.mts'
instalarFetchDePublic()

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

const E1 = '01a00d0c-0000-7000-8000-000000000001'
const E2 = '01a00d0c-0000-7000-8000-000000000002'
const E3 = '01a00d0c-0000-7000-8000-000000000003'
const T = '\t'

const canonico = [
  'DCRR1',
  `saida${T}01a00d0c-0000-7000-8000-0000000000aa`,
  `saida_hash${T}${'e'.repeat(64)}`,
  `motoboy${T}01a00d0c-0000-7000-8000-0000000000bb`,
  `responsavel${T}01a00d0c-0000-7000-8000-0000000000cc`,
  `v${T}${E1}${T}entregue${T}-${T}-`,
  `v${T}${E2}${T}insucesso${T}ausente${T}-`,
  `v${T}${E3}${T}entregue${T}-${T}-`,
  `pr${T}${E1}${T}p1${T}dinheiro${T}6000${T}4000`,
  `pr${T}${E1}${T}p2${T}pix${T}4000${T}0`,
  `pr${T}${E3}${T}p3${T}dinheiro${T}9000${T}0`,
  `d${T}${E2}${T}convenio${T}faltante`,
  `d${T}${E3}${T}crediario${T}recebido`,
].join('\n')

const payload = {
  versao: 'DCRR1',
  saida_romaneio_id: '01a00d0c-0000-7000-8000-0000000000aa',
  loja_nome: 'Matriz',
  vales: [
    {
      entrega_id: E1,
      numero_vale: 'V-000071',
      tipo: 'cliente',
      cliente_nome: 'Maria Pagou Misto',
      desfecho: 'entregue',
      motivo: null,
      detalhe: null,
      pagamentos_previstos: [
        { pagamento_id: 'x1', forma: 'dinheiro', valor_cents: 6000, troco_cents: 4000 },
        { pagamento_id: 'x2', forma: 'pix', valor_cents: 4000, troco_cents: 0 },
      ],
      pagamentos_realizados: [
        { pagamento_id: 'p1', forma: 'dinheiro', valor_cents: 6000, troco_cents: 4000 },
        { pagamento_id: 'p2', forma: 'pix', valor_cents: 4000, troco_cents: 0 },
      ],
    },
    {
      entrega_id: E2,
      numero_vale: 'V-000072',
      tipo: 'cliente',
      cliente_nome: 'Jose Ausente',
      desfecho: 'insucesso',
      motivo: 'ausente',
      detalhe: null,
      pagamentos_previstos: [
        { pagamento_id: 'x3', forma: 'convenio', valor_cents: 5000, troco_cents: 0 },
      ],
      pagamentos_realizados: [],
    },
    {
      entrega_id: E3,
      numero_vale: 'V-000073',
      tipo: 'cliente',
      cliente_nome: 'Ana Pagou Menos',
      desfecho: 'entregue',
      motivo: null,
      detalhe: null,
      pagamentos_previstos: [
        { pagamento_id: 'x4', forma: 'dinheiro', valor_cents: 10000, troco_cents: 0 },
      ],
      pagamentos_realizados: [
        { pagamento_id: 'p3', forma: 'dinheiro', valor_cents: 9000, troco_cents: 0 },
      ],
    },
  ],
}

console.log('\n--- documentos vêm das linhas `d` do canônico ---')
const docs = documentosDoCanonicoRetorno(canonico)
checa('dois vales com documento', docs.size === 2)
checa('convênio faltante no E2', docs.get(E2)?.[0]?.tipo === 'convenio' && docs.get(E2)?.[0]?.situacao === 'faltante')
checa('crediário recebido no E3', docs.get(E3)?.[0]?.situacao === 'recebido')
checa('E1 sem documento', !docs.has(E1))
checa('canônico da SAÍDA não é lido como retorno', documentosDoCanonicoRetorno('DCR1\nd\ta\tb\tc').size === 0)
checa('canônico nulo não inventa documento', documentosDoCanonicoRetorno(null).size === 0)
checa('linha `d` com colunas a menos é ignorada', documentosDoCanonicoRetorno('DCRR1\nd\tx\tconvenio').size === 0)

console.log('\n--- a leitura ---')
const leitura = lerRetorno(payload, canonico)
checa('não é declarado', leitura.declarado === false)
checa('2 entregues, 1 insucesso', leitura.entregues === 2 && leitura.insucessos === 1)
checa('1 documento recebido, 1 faltante', leitura.documentosRecebidos === 1 && leitura.documentosFaltantes === 1)
checa('misto certo CONFERE', leitura.vales[0].situacaoPagamento === 'confere')
checa('dinheiro a menos DIVERGE', leitura.vales[2].situacaoPagamento === 'divergiu')
checa('insucesso sem realizado não é divergência', leitura.vales[1].situacaoPagamento === 'sem_realizado')
checa('um pagamento divergente no total', leitura.pagamentosDivergentes === 1)

// O documento é o canônico: um payload que dissesse outra coisa sobre
// documentos não muda o que foi assinado — e o payload nem guarda documentos.
const semCanonico = lerRetorno(payload, null)
checa('sem canônico, nenhum documento é inventado', semCanonico.documentosRecebidos + semCanonico.documentosFaltantes === 0)

// Entregue não tem motivo, mesmo que o payload cru traga um.
const entregueComMotivo = lerRetorno(
  { vales: [{ ...payload.vales[0], motivo: 'ausente', detalhe: 'lixo' }] },
  canonico
)
checa('entregue não carrega motivo nem detalhe', entregueComMotivo.vales[0].motivo === null && entregueComMotivo.vales[0].detalhe === null)

console.log('\n--- retorno em conflito: o que foi DECLARADO ---')
const conflito = lerRetorno(
  {
    retorno_declarado: [
      {
        entrega_id: E2,
        desfecho: 'insucesso',
        motivo: 'outro',
        detalhe: 'portão trancado',
        pagamentos_realizados: [],
        documentos: [{ tipo: 'convenio', situacao: 'recebido' }],
      },
    ],
  },
  null
)
checa('é declarado', conflito.declarado === true)
checa('sem número de vale inventado', conflito.vales[0].numeroVale === null)
checa('documentos da própria declaração', conflito.documentosRecebidos === 1)
checa('detalhe do insucesso preservado', conflito.vales[0].detalhe === 'portão trancado')

function textoDoPdf(bytes: ArrayBuffer): string {
  const pdf = Buffer.from(bytes)
  let conteudo = pdf.toString('latin1')
  for (const m of conteudo.matchAll(/stream\r?\n/g)) {
    const ini = m.index! + m[0].length
    const fim = conteudo.indexOf('endstream', ini)
    try {
      conteudo += '\n' + inflateSync(Buffer.from(conteudo.slice(ini, fim), 'latin1')).toString('latin1')
    } catch {
      /* nem todo stream é deflate */
    }
  }
  return conteudo
}

const retorno = {
  romaneioId: '01a00d0c-0000-7000-8000-0000000000dd',
  numero: 'R-000042',
  tipo: 'retorno',
  saidaRomaneioId: '01a00d0c-0000-7000-8000-0000000000aa',
  saidaNumero: 'R-000038',
  status: 'selado',
  modo: 'offline_sincronizada',
  seladoEm: '2026-09-12T20:10:00.000Z',
  ocorridoEmLocal: '2026-09-12T20:05:00.000Z',
  recebidoEmServidor: '2026-09-12T20:10:01.000Z',
  finalHash: 'f'.repeat(64),
  documentHash: 'd'.repeat(64),
  canonico,
  conflito: null,
  lojaNome: 'Matriz',
  criadoPorNome: 'Nome Do Criador',
  ip: '187.10.20.30',
  corrida: {
    saidaEm: '2026-09-12T18:00:00.000Z',
    saidaEmLocal: '2026-09-12T17:59:00.000Z',
    retornoEm: '2026-09-12T20:10:00.000Z',
    retornoEmLocal: '2026-09-12T20:05:00.000Z',
    status: 'fechada',
  },
  payload,
  assinaturas: [
    {
      tipoSignatario: 'responsavel_loja',
      strokes: null,
      nome: 'Ana Souza',
      agenciaNome: null,
      credencialPublicId: null,
      authMethod: 'sessao_confirmacao_explicita',
      assinadoEm: '2026-09-12T20:10:00.000Z',
      assinadoEmLocal: '2026-09-12T20:05:00.000Z',
      ip: '187.10.20.30',
      signatureHash: 'a'.repeat(64),
      papelNoMomento: 'gerente',
      versaoEvidencia: 2,
      validadorNome: null,
      motivoExcecao: null,
    },
    {
      tipoSignatario: 'motoboy',
      strokes: null,
      nome: 'João Silva',
      agenciaNome: 'Gabrielense Tele',
      credencialPublicId: '003588',
      authMethod: 'gerente_card_pin_offline_then_verified',
      assinadoEm: '2026-09-12T20:10:00.000Z',
      assinadoEmLocal: '2026-09-12T20:05:00.000Z',
      ip: '187.10.20.30',
      signatureHash: 'b'.repeat(64),
      papelNoMomento: null,
      versaoEvidencia: 2,
      validadorNome: 'Camilo Gerente',
      motivoExcecao: 'pin_esquecido',
    },
  ],
} as unknown as RomaneioCompleto

const daFarmacia = textoDoPdf(await montarRomaneioPdf(retorno, 'farmacia'))
const daAgencia = textoDoPdf(await montarRomaneioPdf(retorno, 'agencia'))

console.log('\n--- o retorno tem layout próprio ---')
checa('título de retorno', daFarmacia.includes('Romaneio de retorno'))
checa('não é o título da saída', !daFarmacia.includes('Romaneio de sa'))
checa('referencia a saída pelo número', daFarmacia.includes('R-000038'))
checa('nenhum NaN', !daFarmacia.includes('NaN') && !daAgencia.includes('NaN'))
checa('nenhum undefined', !daFarmacia.includes('undefined') && !daAgencia.includes('undefined'))
checa('os três vales', ['V-000071', 'V-000072', 'V-000073'].every((n) => daFarmacia.includes(n)))

console.log('\n--- desfecho e documentos ---')
checa('insucesso aparece', daFarmacia.includes('Insucesso'))
checa('motivo rotulado', daFarmacia.includes('Cliente ausente'))
checa('convênio faltante', daFarmacia.includes('faltante'))
checa('crediário recebido', daFarmacia.includes('recebido'))

console.log('\n--- pagamento só na via da farmácia ---')
checa('farmácia mostra o pix', daFarmacia.includes('Pix'))
checa('farmácia mostra o troco', daFarmacia.includes('troco'))
checa('farmácia aponta a divergência', daFarmacia.includes('diverge do previsto'))
checa('agência NÃO mostra o pix', !daAgencia.includes('Pix'))
checa('agência NÃO mostra valores de pagamento', !daAgencia.includes('60,00') && !daAgencia.includes('90,00'))
checa('agência continua com desfecho e documentos', daAgencia.includes('Cliente ausente') && daAgencia.includes('faltante'))

console.log('\n--- quem recebeu e quem autorizou ---')
checa('quem recebeu aparece pelo nome', daFarmacia.includes('Ana Souza'))
checa('o slot interno não vira criador genérico', !daFarmacia.includes('Nome Do Criador'))
checa('cargo no instante', daFarmacia.includes('Gerente'))
checa('exceção dita: PIN esquecido', daFarmacia.includes('PIN esquecido'))
checa('quem autorizou', daFarmacia.includes('autorizado por Camilo Gerente'))
checa('motoboy continua o responsável', daFarmacia.includes('Silva'))

console.log('\n--- o que prova o documento ---')
checa('hash final', daFarmacia.includes('f'.repeat(64)))
checa('document hash', daFarmacia.includes('d'.repeat(64)))
checa('não é a fonte da verdade', daFarmacia.includes('fonte da verdade'))

console.log(`\n${falhas === 0 ? 'romaneio de retorno ok' : falhas + ' FALHA(S)'}\n`)
process.exit(falhas === 0 ? 0 : 1)
