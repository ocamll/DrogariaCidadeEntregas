// npx tsx scripts/congelar-retorno.spec.mts
//
// O guard do congelamento — a metade de CLIENTE da invariante que a
// migration `20260820200000` fecha no banco.
//
// O caso que dá nome a tudo isto é o (2): forçar o `pagamentoId` do
// realizado a ser o do previsto. Em produção esse payload sela um
// documento que afirma um pagamento inexistente, porque o servidor
// engole o insert com `on conflict do nothing` — e o banco agora aborta,
// mas só DEPOIS de cartão, PIN e duas assinaturas. Este guard existe pra
// o caixa nunca chegar lá.

import {
  conferirIdsDePagamento,
  congelarRetorno,
  RetornoNaoCongelavel,
} from '../src/lib/congelarRetorno.ts'
import { validarRetorno, type EntradaRetorno } from '../src/lib/canonicoRetorno.ts'

let falhas = 0
function checa(nome: string, condicao: boolean, extra = '') {
  console.log(`${condicao ? 'ok   ' : 'FALHA'}  ${nome}${extra ? '  — ' + extra : ''}`)
  if (!condicao) falhas++
}

// O caso real: o id do PREVISTO é o uuid da entrega.
const E1 = '01a00d0c-add7-7420-87ce-1f8abf2092c3'
const E2 = '01a0155c-47ed-723a-89f4-e209a84178a1'
const PREVISTOS = [E1, E2]

let n = 0
const novoId = () => `01a09999-0000-7000-8000-${String(++n).padStart(12, '0')}`

function entrada(pagamentos: Array<{ entregaId: string; pagamentoId: string }>): EntradaRetorno {
  const porVale = new Map<string, Array<{ pagamentoId: string }>>()
  for (const p of pagamentos) {
    porVale.set(p.entregaId, [...(porVale.get(p.entregaId) ?? []), { pagamentoId: p.pagamentoId }])
  }
  return {
    saidaRomaneioId: '01a00d9d-af9a-71c3-a15f-9b1f5967f599',
    saidaDocumentHash: 'a'.repeat(64),
    motoboyId: 'b986e60f-e3e7-4f13-8c61-1401e8000956',
    responsavelId: '8c5e64d3-a6f4-405b-8d29-9a30cb33a124',
    vales: [E1, E2].map((id) => ({
      entregaId: id,
      desfecho: 'entregue' as const,
      motivo: null,
      detalhe: null,
      pagamentosRealizados: (porVale.get(id) ?? []).map((p) => ({
        pagamentoId: p.pagamentoId,
        forma: 'pix' as const,
        valorCents: 10000,
        trocoCents: 0,
      })),
      documentos: [],
    })),
  }
}

console.log('\n--- (1) o caminho normal: ids novos ---')
{
  const e = entrada([
    { entregaId: E1, pagamentoId: '01a09999-1111-7000-8000-000000000001' },
    { entregaId: E2, pagamentoId: '01a09999-1111-7000-8000-000000000002' },
  ])
  checa('nenhuma colisão', conferirIdsDePagamento(e.vales, PREVISTOS).length === 0)

  const congelado = await congelarRetorno(e, PREVISTOS, novoId)
  checa('congelou', congelado.documentHash.length === 64)
  checa('romaneioId veio do gerador', congelado.romaneioId.startsWith('01a09999-0000'))
  checa('jsonb tem um item por vale', congelado.retornoJsonb.length === 2)
  checa('canônico é DCRR1', congelado.canonico.startsWith('DCRR1\n'))
}

console.log('\n--- (2) O CASO: realizado com o id do previsto ---')
{
  // Exatamente o que um pré-preenchimento que copia o objeto inteiro faz.
  const e = entrada([{ entregaId: E1, pagamentoId: E1 }])

  const colisoes = conferirIdsDePagamento(e.vales, PREVISTOS)
  checa('acusa 1 colisão', colisoes.length === 1, JSON.stringify(colisoes))
  checa('motivo é colide_com_previsto', colisoes[0]?.motivo === 'colide_com_previsto')
  checa('aponta o vale certo', colisoes[0]?.entregaId === E1)

  let recusou = false
  let colisoesDoErro: unknown = null
  try {
    await congelarRetorno(e, PREVISTOS, novoId)
  } catch (erro) {
    recusou = erro instanceof RetornoNaoCongelavel
    if (erro instanceof RetornoNaoCongelavel) colisoesDoErro = erro.colisoes
  }
  checa('CONGELAMENTO RECUSA', recusou)
  checa('e o erro carrega as colisões', Array.isArray(colisoesDoErro))
}

console.log('\n--- (3) o previsto do OUTRO vale também colide ---')
{
  // O `Set` é do documento inteiro, não por vale: um id de previsto é
  // uma linha que já existe em `pagamentos`, e a colisão no INSERT não
  // se importa com qual vale mandou.
  const e = entrada([{ entregaId: E1, pagamentoId: E2 }])
  const colisoes = conferirIdsDePagamento(e.vales, PREVISTOS)
  checa('acusa', colisoes.length === 1 && colisoes[0].motivo === 'colide_com_previsto')
}

console.log('\n--- (4) repetido dentro do documento ---')
{
  const repetido = '01a09999-2222-7000-8000-000000000001'
  const e = entrada([
    { entregaId: E1, pagamentoId: repetido },
    { entregaId: E2, pagamentoId: repetido },
  ])
  const colisoes = conferirIdsDePagamento(e.vales, PREVISTOS)
  checa('acusa 1', colisoes.length === 1, JSON.stringify(colisoes))
  checa('motivo é repetido_no_documento', colisoes[0]?.motivo === 'repetido_no_documento')
  checa('aponta a SEGUNDA ocorrência', colisoes[0]?.entregaId === E2)

  // AS DUAS CAMADAS PEGAM, E O GUARD FALA PRIMEIRO.
  //
  // O canônico também recusa isto, por `pagamento_duplicado` — mas com
  // um motivo só pro documento inteiro, sem dizer QUAL linha. Por isso o
  // guard duplica a checagem: ele aponta o vale.
  //
  // Medido chamando `validarRetorno` DIRETO, e não por
  // `congelarRetorno`: ali o guard roda antes e o canônico nunca chega a
  // opinar. Foi o que essa asserção afirmava errado na primeira versão.
  checa(
    'o canônico também recusaria, como pagamento_duplicado',
    validarRetorno(e) === 'pagamento_duplicado',
    String(validarRetorno(e))
  )

  let nomeDoErro: string | null = null
  try {
    await congelarRetorno(e, [], novoId)
  } catch (erro) {
    nomeDoErro = (erro as Error).name
  }
  checa(
    'mas quem fala primeiro é o guard, que aponta a linha',
    nomeDoErro === 'RetornoNaoCongelavel',
    String(nomeDoErro)
  )
}

console.log('\n--- (5) um id que colide E se repete conta UMA vez ---')
{
  const e = entrada([
    { entregaId: E1, pagamentoId: E1 },
    { entregaId: E2, pagamentoId: E1 },
  ])
  const colisoes = conferirIdsDePagamento(e.vales, PREVISTOS)
  // Duas ocorrências do mesmo id ruim: a primeira colide com o previsto,
  // a segunda é repetição. Duas queixas sobre o mesmo id seriam ruído.
  checa('duas queixas, uma por linha', colisoes.length === 2, JSON.stringify(colisoes.map((c) => c.motivo)))
  checa('a primeira é colide_com_previsto', colisoes[0]?.motivo === 'colide_com_previsto')
  checa('a segunda é colide_com_previsto também', colisoes[1]?.motivo === 'colide_com_previsto')
}

console.log('\n--- (6) bordas ---')
{
  const e = entrada([])
  checa(
    'documento sem pagamento nenhum passa',
    conferirIdsDePagamento(e.vales, PREVISTOS).length === 0
  )
  checa(
    'lista de previstos vazia não bloqueia nada',
    conferirIdsDePagamento(
      entrada([{ entregaId: E1, pagamentoId: E1 }]).vales,
      []
    ).length === 0
  )
  checa('não muta a entrada', JSON.stringify(entrada([]).vales[0].pagamentosRealizados) === '[]')
}

console.log('\n--- (7) a ordem: valida ANTES de converter ---')
{
  // Se o guard rodasse depois, um `documentHash` existiria por um
  // instante pra um documento que não pode ser assinado. O gerador de id
  // é a testemunha: ele não pode ter sido chamado.
  let chamou = 0
  const contando = () => {
    chamou++
    return '01a09999-3333-7000-8000-000000000001'
  }
  try {
    await congelarRetorno(entrada([{ entregaId: E1, pagamentoId: E1 }]), PREVISTOS, contando)
  } catch {
    /* esperado */
  }
  checa('nenhum romaneioId foi cunhado na recusa', chamou === 0, `chamou ${chamou}x`)
}

console.log(falhas === 0 ? '\ncongelamento ok\n' : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
