// NÃO roda com node. Isto é pra colar no console do navegador (F12 →
// Console), com o app aberto e você LOGADO.
//
// ---------------------------------------------------------------------
// O QUE ELE PROVA — e o que ele NÃO precisa mais provar
// ---------------------------------------------------------------------
//
// Os golden vectors já provaram que os gêmeos concordam: TypeScript
// 60/60 e SQL 36/36 contra a MESMA terceira referência, escrita à mão
// antes de ambos existirem. Aquilo está fechado.
//
// Este script responde outra pergunta, que os vetores não alcançam
// porque rodam dos dois lados DE DENTRO:
//
//     o caminho supabase-js → PostgREST → jsonb → SQL preserva
//     exatamente o input que o navegador assinou?
//
// É onde moram os defeitos de transporte: `undefined` sumindo no
// `JSON.stringify`, string vazia virando nulo, número chegando como
// string, ordem de array mudando, Unicode atravessando quatro camadas, e
// UUID vindo do banco numa representação inesperada.
//
// ---------------------------------------------------------------------
// A REGRA QUE FAZ ELE VALER ALGUMA COISA
// ---------------------------------------------------------------------
//
// O canônico local e o `p_retorno` enviado saem do MESMO objeto de
// domínio, pela mesma função (`paraJsonbRetorno`). Se este script
// montasse o JSON por conta própria, ele provaria que um SCRIPT monta
// certo — e a tela poderia montar outro formato depois, assinando uma
// coisa e mandando outra.
//
// Quando a etapa 2D construir a tela, ela usa as mesmas duas funções.
//
// ---------------------------------------------------------------------
// NÃO SELA NADA. `conferir_canonico_retorno` é read-only: não cria
// romaneio, não toca em entrega, não fecha corrida, não grava
// assinatura. Dá pra rodar em cima de dado de produção sem consequência.
// ---------------------------------------------------------------------

const { supabase } = await import('/src/lib/supabase.ts')
const { montarCanonicoRetorno, paraJsonbRetorno } = await import('/src/lib/canonicoRetorno.ts')
const { uuidv7 } = await import('/src/lib/uuid.ts')

const {
  data: { user },
} = await supabase.auth.getUser()
if (!user) throw new Error('Faça login primeiro.')

// ---------------------------------------------------------------------
// 1. UM ROMANEIO DE SAÍDA REAL, e os vales REAIS dele
//
// Não há romaneio de RETORNO ainda (a etapa 2B nem começou), então o
// dado real disponível é o da saída. Serve: o que este teste exercita é
// o transporte, e os ids e o texto vêm do banco do mesmo jeito.
// ---------------------------------------------------------------------
const { data: saida, error: erroSaida } = await supabase
  .from('romaneios')
  .select('id, numero, document_hash, corrida_id')
  .eq('status', 'selado')
  .order('recebido_em_servidor', { ascending: false })
  .limit(1)
  .maybeSingle()
if (erroSaida) throw erroSaida
if (!saida) throw new Error('Nenhum romaneio de saída selado no alcance da sua RLS.')

const { data: ligacoes, error: erroLig } = await supabase
  .from('romaneio_entregas')
  .select('entrega_id, entregas(numero_vale, cliente_nome)')
  .eq('romaneio_id', saida.id)
if (erroLig) throw erroLig
if (!ligacoes?.length) throw new Error('Romaneio sem vales.')

// ---------------------------------------------------------------------
// 2. UM RETORNO PLAUSÍVEL, e de propósito NÃO o caso mais simples
//
// Os vales reais recebem desfechos diferentes em rodízio, pra o teste
// exercitar de uma vez: entregue com pagamento, insucesso com motivo,
// motivo `outro` com detalhe de verdade, várias formas no mesmo vale,
// string vazia, acento e caractere fora do BMP.
//
// Com um vale só, sai o primeiro caso e o script avisa que a cobertura
// ficou parcial — dizer isso é melhor que deixar alguém achar que
// exercitou tudo.
// ---------------------------------------------------------------------
const DETALHE_ACENTUADO = 'Endereço da Conceição não confere — José confirmou 🛵'

const vales = ligacoes.map((lig, i) => {
  const caso = i % 3
  if (caso === 0) {
    return {
      entregaId: lig.entrega_id,
      desfecho: 'entregue',
      motivo: null,
      detalhe: null,
      pagamentosRealizados: [
        { pagamentoId: uuidv7(), forma: 'pix', valorCents: 12345, trocoCents: 0 },
        // segunda forma no MESMO vale: metade pix, metade dinheiro, com
        // troco — o caso 1:N que a tabela `pagamentos` existe pra
        // suportar, e que o aninhamento tem que atravessar intacto
        { pagamentoId: uuidv7(), forma: 'dinheiro', valorCents: 7000, trocoCents: 1500 },
      ],
    }
  }
  if (caso === 1) {
    return {
      entregaId: lig.entrega_id,
      desfecho: 'insucesso',
      motivo: 'outro',
      detalhe: DETALHE_ACENTUADO,
      pagamentosRealizados: [],
    }
  }
  return {
    entregaId: lig.entrega_id,
    desfecho: 'insucesso',
    motivo: 'ausente',
    // string VAZIA, não nula: o V007 separa os dois, e aqui a distinção
    // atravessa JSON.stringify → PostgREST → jsonb → `->>`
    detalhe: '',
    pagamentosRealizados: [],
  }
})

const { data: perfilMoto } = await supabase
  .from('corridas')
  .select('mototaxista_id')
  .eq('id', saida.corrida_id)
  .maybeSingle()

const entrada = {
  saidaRomaneioId: saida.id,
  saidaDocumentHash: saida.document_hash,
  motoboyId: perfilMoto?.mototaxista_id ?? uuidv7(),
  responsavelId: user.id,
  vales,
}

// ---------------------------------------------------------------------
// 3. OS DOIS LADOS, DO MESMO OBJETO
// ---------------------------------------------------------------------
const canonicoLocal = montarCanonicoRetorno(entrada)
const bytesLocal = new TextEncoder().encode(canonicoLocal).length
const hashLocal = [
  ...new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicoLocal))
  ),
]
  .map((b) => b.toString(16).padStart(2, '0'))
  .join('')

const { data: doServidor, error: erroRpc } = await supabase
  .rpc('conferir_canonico_retorno', {
    p_saida_id: entrada.saidaRomaneioId,
    p_saida_document_hash: entrada.saidaDocumentHash,
    p_motoboy_id: entrada.motoboyId,
    p_responsavel_id: entrada.responsavelId,
    // A MESMA entrada, pela MESMA função que a tela vai usar
    p_retorno: paraJsonbRetorno(entrada),
  })
  .maybeSingle()
if (erroRpc) throw erroRpc

// ---------------------------------------------------------------------
// 4. COMPARAR OS TRÊS, SEPARADOS
//
// Cada lado calculou os seus. Se só o texto divergir, o transporte de
// VOLTA mexeu; se os bytes divergirem, é codificação e não conteúdo; se
// os três divergirem, o input chegou diferente.
// ---------------------------------------------------------------------
const primeiraDiferenca = (a, b) => {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return `pos ${i}: local ${JSON.stringify(a.slice(i - 20 < 0 ? 0 : i - 20, i + 20))} servidor ${JSON.stringify(b.slice(i - 20 < 0 ? 0 : i - 20, i + 20))}`
    }
  }
  return a.length === b.length ? null : `comprimento: ${a.length} vs ${b.length}`
}

const resultado = {
  romaneio: saida.numero,
  vales: vales.length,
  cobertura:
    vales.length >= 3
      ? 'completa (entregue+2 formas, insucesso/outro com acento, insucesso com detalhe vazio)'
      : `PARCIAL — só ${vales.length} vale(s); rode num romaneio com 3 ou mais`,
  texto: canonicoLocal === doServidor.canonico,
  bytes: bytesLocal === doServidor.bytes,
  hash: hashLocal === doServidor.sha256,
  local: { bytes: bytesLocal, sha256: hashLocal },
  servidor: { bytes: doServidor.bytes, sha256: doServidor.sha256 },
  diferenca: canonicoLocal === doServidor.canonico ? null : primeiraDiferenca(canonicoLocal, doServidor.canonico),
}

console.log(resultado)
console.log(
  resultado.texto && resultado.bytes && resultado.hash
    ? '\nTRANSPORTE PRESERVA — os três critérios batem\n'
    : '\nDIVERGIU — ver `diferenca` e o padrão dos três acima\n'
)
console.log(canonicoLocal)
