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
// 1. O ROMANEIO DE SAÍDA REAL COM MAIS VALES, e os vales dele
//
// Não há romaneio de RETORNO ainda (a etapa 2B nem começou), então o
// dado real disponível é o da saída. Serve: o que este teste exercita é
// o transporte, e os ids e o texto vêm do banco do mesmo jeito.
// ---------------------------------------------------------------------
// ESCOLHE O ROMANEIO COM MAIS VALES, não o mais recente.
//
// A versão anterior pegava o mais recente e caiu num de UM vale só.
// Todos os cenários rodaram com um `v` no documento, então nunca
// atravessou o fio um documento com VÁRIOS vales — nem a ordenação entre
// eles, nem o bloco `pr` convivendo com vales sem pagamento.
//
// "Mais recente" é conveniência; "mais vales" é o que este teste precisa.
const { data: todas, error: erroLig } = await supabase
  .from('romaneio_entregas')
  .select('entrega_id, romaneios!inner(id, numero, document_hash, corrida_id, status)')
  .eq('romaneios.status', 'selado')
if (erroLig) throw erroLig
if (!todas?.length) throw new Error('Nenhum romaneio de saída selado no alcance da sua RLS.')

const porRomaneio = new Map()
for (const lig of todas) {
  const r = lig.romaneios
  const grupo = porRomaneio.get(r.id) ?? { romaneio: r, entregas: [] }
  grupo.entregas.push(lig.entrega_id)
  porRomaneio.set(r.id, grupo)
}
const escolhido = [...porRomaneio.values()].sort(
  (a, b) => b.entregas.length - a.entregas.length
)[0]

const saida = escolhido.romaneio
const ligacoes = escolhido.entregas.map((entrega_id) => ({ entrega_id }))

// ---------------------------------------------------------------------
// 2. UM CENÁRIO POR FORMA, e não um documento com N vales
//
// A primeira versão distribuía os casos entre os vales do romaneio, em
// rodízio — e num romaneio de UM vale só o primeiro caso atravessava o
// fio. Justamente os dois que motivaram o teste (acento fora do BMP e
// string vazia) ficavam sem cobertura.
//
// O erro estava em amarrar a cobertura ao tamanho do documento. O
// TRANSPORTE não precisa de três vales num documento: precisa de três
// FORMAS cruzando o fio. Então cada forma vira um cenário próprio, com
// os mesmos vales reais, e cada cenário faz sua ida e volta.
//
// Assim a cobertura é a mesma com 1 vale ou com 10.
// ---------------------------------------------------------------------
const DETALHE_ACENTUADO = 'Endereço da Conceição não confere — José confirmou 🛵'

const { data: corrida } = await supabase
  .from('corridas')
  .select('mototaxista_id')
  .eq('id', saida.corrida_id)
  .maybeSingle()

const cabecalho = {
  saidaRomaneioId: saida.id,
  saidaDocumentHash: saida.document_hash,
  motoboyId: corrida?.mototaxista_id ?? uuidv7(),
  responsavelId: user.id,
}
const ids = ligacoes.map((l) => l.entrega_id)

const cenarios = [
  {
    nome: 'entregue · duas formas no mesmo vale, com troco',
    // O caso 1:N que a tabela `pagamentos` existe pra suportar (metade
    // pix, metade dinheiro), e que o aninhamento tem que atravessar.
    vales: ids.map((id) => ({
      entregaId: id,
      desfecho: 'entregue',
      motivo: null,
      detalhe: null,
      pagamentosRealizados: [
        { pagamentoId: uuidv7(), forma: 'pix', valorCents: 12345, trocoCents: 0 },
        { pagamentoId: uuidv7(), forma: 'dinheiro', valorCents: 7000, trocoCents: 1500 },
      ],
    })),
  },
  {
    nome: 'insucesso · motivo outro, detalhe com acento e fora do BMP',
    // O caso que mais justifica testar transporte: quatro camadas
    // (navegador → JSON → PostgREST → PostgreSQL) e um par substituto
    // UTF-16 no meio.
    vales: ids.map((id) => ({
      entregaId: id,
      desfecho: 'insucesso',
      motivo: 'outro',
      detalhe: DETALHE_ACENTUADO,
      pagamentosRealizados: [],
    })),
  },
  {
    nome: 'insucesso · detalhe STRING VAZIA (não nulo)',
    // A distinção do V007 atravessando o fio: `''` tem que continuar
    // vazio e virar linha terminada em TAB, não `-`.
    vales: ids.map((id) => ({
      entregaId: id,
      desfecho: 'insucesso',
      motivo: 'ausente',
      detalhe: '',
      pagamentosRealizados: [],
    })),
  },
  {
    nome: 'insucesso · detalhe NULO (o par do anterior)',
    // Só faz sentido ao lado do de cima: os dois juntos provam que o
    // transporte não confunde vazio com ausente. `null` sobrevive ao
    // JSON; `undefined` sumiria, e os dois lados tratam ausente como
    // nulo — por isso o par testa a fronteira, não cada um sozinho.
    vales: ids.map((id) => ({
      entregaId: id,
      desfecho: 'insucesso',
      motivo: 'ausente',
      detalhe: null,
      pagamentosRealizados: [],
    })),
  },
]

// Com mais de um vale dá pra exercitar também o documento MISTO, que é
// como um retorno de verdade se parece.
if (ids.length > 1) {
  cenarios.push({
    nome: 'misto · entregue e insucesso no mesmo documento',
    vales: ids.map((id, i) =>
      i % 2 === 0
        ? {
            entregaId: id,
            desfecho: 'entregue',
            motivo: null,
            detalhe: null,
            pagamentosRealizados: [
              { pagamentoId: uuidv7(), forma: 'pix', valorCents: 900, trocoCents: 0 },
            ],
          }
        : {
            entregaId: id,
            desfecho: 'insucesso',
            motivo: 'recusou',
            detalhe: DETALHE_ACENTUADO,
            pagamentosRealizados: [],
          }
    ),
  })
}

// ---------------------------------------------------------------------
// 3. CADA CENÁRIO: os dois lados, do MESMO objeto
// ---------------------------------------------------------------------
const sha256Local = async (texto) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const primeiraDiferenca = (a, b) => {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const janela = (s) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 20))
      return `pos ${i}: local ${janela(a)} servidor ${janela(b)}`
    }
  }
  return a.length === b.length ? null : `comprimento: ${a.length} vs ${b.length}`
}

const linhas = []
let ultimoCanonico = null

for (const cenario of cenarios) {
  const entrada = { ...cabecalho, vales: cenario.vales }

  const local = montarCanonicoRetorno(entrada)
  const bytesLocal = new TextEncoder().encode(local).length
  const hashLocal = await sha256Local(local)

  const { data: servidor, error } = await supabase
    .rpc('conferir_canonico_retorno', {
      p_saida_id: entrada.saidaRomaneioId,
      p_saida_document_hash: entrada.saidaDocumentHash,
      p_motoboy_id: entrada.motoboyId,
      p_responsavel_id: entrada.responsavelId,
      // A MESMA entrada, pela MESMA função que a tela vai usar
      p_retorno: paraJsonbRetorno(entrada),
    })
    .maybeSingle()
  if (error) throw error

  linhas.push({
    cenario: cenario.nome,
    texto: local === servidor.canonico,
    bytes: bytesLocal === servidor.bytes,
    hash: hashLocal === servidor.sha256,
    bytesLocal,
    bytesServidor: servidor.bytes,
    diferenca: local === servidor.canonico ? null : primeiraDiferenca(local, servidor.canonico),
  })
  ultimoCanonico = local
}

// ---------------------------------------------------------------------
// 4. O VEREDITO
//
// Se só o texto divergir, o transporte de VOLTA mexeu; se os bytes
// divergirem, é codificação e não conteúdo; se os três divergirem, o
// input chegou diferente ao servidor.
// ---------------------------------------------------------------------
console.log(
  `romaneio ${saida.numero} (o com mais vales dos ${porRomaneio.size} selados), ` +
    `${ids.length} vale(s), ${cenarios.length} cenários` +
    (ids.length > 1 ? ' — inclui documento com vários v' : ' — SEM cenário misto: nenhum romaneio tem 2+ vales')
)
console.table(linhas)

const todosOk = linhas.every((l) => l.texto && l.bytes && l.hash)
console.log(
  todosOk
    ? `\nTRANSPORTE PRESERVA — ${linhas.length} cenários, três critérios cada\n`
    : '\nDIVERGIU — ver a coluna `diferenca` e o padrão dos três\n'
)
console.log('último canônico, pra conferir a olho:\n' + ultimoCanonico)
