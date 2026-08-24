// NÃO roda com node. Cole no console do navegador (F12 → Console), com
// o app aberto e você LOGADO.
//
// ---------------------------------------------------------------------
// O QUE SÓ ESTE TESTE PODE PROVAR
//
// `scripts/despacho-sync-romaneio.spec.mts` roda contra o TEXTO da Edge
// Function e prova a lógica. Ele **não prova qual versão está
// publicada** — e nem o `OPTIONS` prova, porque ele responde `ok` desde
// a primeira versão.
//
// Este aqui fala com a função NO AR, com a chave pública de verdade e o
// seu JWT. O caso (4) é a assinatura da 2C.6: na versão anterior ele
// devolveria `retorno_nao_suportado` (501); aqui ele passa da conciliação
// e morre depois. Se vier 501, o Deploy não pegou.
//
// ---------------------------------------------------------------------
// NADA É SELADO. NENHUM ROMANEIO É CRIADO.
//
// Todo caso é construído pra parar ANTES do despacho, e a ordem do
// handler é o que garante isso:
//
//     dono → envelope aberto → tipo conciliado → operationId →
//     documentHash → vocabulário dos traços → offlineEventHash → RPC
//
// Os casos de tipo param na 3ª etapa. Os de "atravessou a conciliação"
// param na 4ª, porque o `operationId` do envelope é DE PROPÓSITO
// diferente do `romaneioId` do corpo. Os de vocabulário param na 6ª.
// Nenhum chega ao `.rpc(`, então nenhuma corrida, nenhum vale e nenhum
// romaneio são tocados.
//
// Os ids são todos sorteados na hora e não existem no banco — mesmo que
// alguma etapa fosse pulada, não haveria o que selar.
// ---------------------------------------------------------------------

{
const { supabase } = await import('/src/lib/supabase.ts')
const { selarSegredos, envelopeDisponivel } = await import('/src/lib/envelope.ts')
const { uuidv7 } = await import('/src/lib/uuid.ts')

if (!envelopeDisponivel()) throw new Error('VITE_ROMANEIO_PUBKEY não configurada neste build.')

const { data: { user } } = await supabase.auth.getUser()
if (!user) throw new Error('Faça login primeiro.')
const { data: sessao } = await supabase.auth.getSession()
const jwt = sessao.session?.access_token
if (!jwt) throw new Error('Sem sessão.')

const HASH = 'a'.repeat(64)
const linhas = []

// Manda um corpo e devolve só o `motivo` que a função respondeu.
async function tentar({ bodyTipo, envelopeTipo, mesmaOperacao = false, strokes = {} }) {
  const romaneioId = uuidv7()
  const segredos = {
    pin: '000000',
    credentialToken: '3' + '7'.repeat(21),
    // Divergente de propósito, salvo quando o caso quer atravessar.
    operationId: mesmaOperacao ? romaneioId : uuidv7(),
    documentHash: HASH,
    offlineEventHash: 'b'.repeat(64),
  }
  if (envelopeTipo !== undefined) segredos.tipo = envelopeTipo

  const envelope = await selarSegredos(segredos)

  const body = {
    userId: user.id,
    romaneioId,
    documentHash: HASH,
    motoboyStrokes: [],
    ocorridoEmLocal: new Date().toISOString(),
    geolocalizacao: null,
    envelope,
    ...strokes,
  }
  if (bodyTipo !== undefined) body.tipo = bodyTipo

  const { data, error } = await supabase.functions.invoke('sync-romaneio', {
    headers: { Authorization: `Bearer ${jwt}` },
    body,
  })

  if (error) {
    try {
      const corpo = await error.context.json()
      return corpo?.motivo ?? `(sem motivo) ${corpo?.error ?? error.message}`
    } catch {
      return `(corpo ilegível) ${error.message}`
    }
  }
  return `SEM ERRO — ${JSON.stringify(data)}`
}

const check = (caso, obtido, esperado) =>
  linhas.push({ ok: obtido === esperado, caso, esperado, obtido })

// -----------------------------------------------------------------
// 1 a 4 — atravessam a conciliação e morrem no `operationId`
//
// `envelope_trocado` aqui é SUCESSO: quer dizer que o tipo foi aceito e
// a função seguiu pra próxima amarração.
// -----------------------------------------------------------------
check('(1) legado: body sem tipo + envelope sem tipo',
  await tentar({ strokes: { caixaStrokes: [] } }), 'envelope_trocado')

check('(2) ROLLOUT: body saida + envelope sem tipo',
  await tentar({ bodyTipo: 'saida', strokes: { caixaStrokes: [] } }), 'envelope_trocado')

check('(3) body saida + envelope saida',
  await tentar({ bodyTipo: 'saida', envelopeTipo: 'saida', strokes: { caixaStrokes: [] } }),
  'envelope_trocado')

// ESTE é o que prova que a 2C.6 está publicada.
check('(4) body retorno + envelope retorno  ← prova o Deploy',
  await tentar({ bodyTipo: 'retorno', envelopeTipo: 'retorno',
                 strokes: { responsavelStrokes: [] } }),
  'envelope_trocado')

// -----------------------------------------------------------------
// 5 a 9 — recusados NA conciliação, sem chegar às amarrações
// -----------------------------------------------------------------
check('(5) body retorno + envelope sem tipo',
  await tentar({ bodyTipo: 'retorno', strokes: { responsavelStrokes: [] } }), 'tipo_divergente')

check('(6) body sem tipo + envelope retorno',
  await tentar({ envelopeTipo: 'retorno', strokes: { caixaStrokes: [] } }), 'tipo_divergente')

check('(7) body saida + envelope retorno',
  await tentar({ bodyTipo: 'saida', envelopeTipo: 'retorno', strokes: { caixaStrokes: [] } }),
  'tipo_divergente')

check('(8) body retorno + envelope saida',
  await tentar({ bodyTipo: 'retorno', envelopeTipo: 'saida',
                 strokes: { responsavelStrokes: [] } }),
  'tipo_divergente')

check('(9) tipo desconhecido no corpo',
  await tentar({ bodyTipo: 'coisa_nova', envelopeTipo: 'saida', strokes: { caixaStrokes: [] } }),
  'tipo_desconhecido')

check('(9b) tipo desconhecido no envelope',
  await tentar({ bodyTipo: 'saida', envelopeTipo: 'coisa_nova', strokes: { caixaStrokes: [] } }),
  'tipo_desconhecido')

// -----------------------------------------------------------------
// 10 e 11 — vocabulário: atravessam operationId e documentHash e param
// no campo do protocolo errado. Ignorar não é recusar.
// -----------------------------------------------------------------
check('(10) retorno trazendo caixaStrokes',
  await tentar({ bodyTipo: 'retorno', envelopeTipo: 'retorno', mesmaOperacao: true,
                 strokes: { responsavelStrokes: [], caixaStrokes: [] } }),
  'vocabulario_invalido')

check('(11) saída trazendo responsavelStrokes',
  await tentar({ bodyTipo: 'saida', envelopeTipo: 'saida', mesmaOperacao: true,
                 strokes: { caixaStrokes: [], responsavelStrokes: [] } }),
  'vocabulario_invalido')

check('(12) retorno sem responsavelStrokes',
  await tentar({ bodyTipo: 'retorno', envelopeTipo: 'retorno', mesmaOperacao: true, strokes: {} }),
  'vocabulario_invalido')

// -----------------------------------------------------------------
console.table(linhas)

const versaoNova = linhas.find((l) => l.caso.startsWith('(4)'))
console.log(
  versaoNova?.ok
    ? 'VERSÃO PUBLICADA É A DA 2C.6 — o retorno passou da conciliação'
    : versaoNova?.obtido === 'retorno_nao_suportado'
      ? 'A VERSÃO NO AR AINDA É A DA 2C.5 — o Deploy não pegou'
      : `caso (4) inesperado: ${versaoNova?.obtido}`
)

const ok = linhas.every((l) => l.ok)
console.log(ok
  ? `\nDESPACHO CONFERIDO CONTRA A FUNÇÃO NO AR — ${linhas.length} casos\n`
  : '\nDIVERGIU — ver a coluna `obtido`\n')

console.log(
  'Nada foi selado: todos os casos param antes do `.rpc(`, e os ids são ' +
  'sorteados e não existem no banco.'
)
}
