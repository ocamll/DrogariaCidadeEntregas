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
// E mais um, que não é hipotético: **um campo do domínio simplesmente
// não entrar no payload.** Aconteceu em 2026-08-20 com `documentos`,
// quando o bloco `d` entrou no canônico e `paraJsonbRetorno` ficou pra
// trás. O lado local assina linhas `d`, o servidor reconstrói o DCRR1
// sem elas, chega noutro hash, e recusa `documento_alterado` DEPOIS de
// colhidas as duas assinaturas, com o motoboy no balcão.
//
// Quem pegou foi a conferência dos golden vectors contra o banco. Este
// script NÃO pegou, e o motivo importa mais que o defeito: **nenhum
// cenário dele tinha bloco `d`.** A cobertura estava no comentário e não
// no código — o mesmo defeito que as três revisões de 19/08 corrigiram,
// de volta por outra porta.
//
// Por isso os cenários abaixo trazem `d`, e por isso a tabela imprime
// quantas linhas de cada bloco cada cenário produziu: "rodei e passou"
// não pode mais esconder "não exercitou".
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

// ---------------------------------------------------------------------
// TUDO DENTRO DE UM BLOCO, e não é estética.
//
// `const` de topo no console do Chrome PERSISTE entre colagens: rodar
// este script duas vezes na mesma aba dava
// "Identifier ... has already been declared" e nada rodava. Repetir um
// teste é o uso normal, não a exceção.
//
// Com o bloco, cada colagem tem escopo próprio e pode ser repetida à
// vontade sem F5.
// ---------------------------------------------------------------------
{
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

// COMPLETA ATÉ TRÊS VALES COM ENTREGAS REAIS QUAISQUER, e isso é legítimo
// aqui — não é fabricar dado pra o teste passar.
//
// Nenhum romaneio selado deste banco tem mais de um vale, então esperar
// por dado que não existe deixaria o documento com VÁRIOS `v` sem nunca
// atravessar o fio: a ordenação entre vales e o bloco `pr` convivendo com
// vale sem pagamento ficariam cobertos só pelos vetores, dos dois lados
// de dentro.
//
// `conferir_canonico_retorno` é PURA: reconstrói o DCRR1 e devolve, sem
// validar pertencimento. Quem confere se o vale é daquela saída é
// `selar_romaneio_retorno`, na etapa 2B — lá isso seria erro, aqui é o
// ponto. O que este teste precisa que seja real são os UUID vindos do
// banco e o texto atravessando as camadas, não a relação de negócio.
const ids = [...escolhido.entregas]
if (ids.length < 3) {
  const { data: extras } = await supabase
    .from('entregas')
    .select('id')
    .not('id', 'in', `(${ids.join(',')})`)
    .limit(3 - ids.length)
  for (const e of extras ?? []) ids.push(e.id)
}

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
//
// OS QUATRO PRIMEIROS CENÁRIOS NÃO DECLARAM `documentos`, E ISSO FICA.
// Não é sobra de antes do bloco `d`: é o formato que um item PARADO NA
// FILA tem: gravado no IndexedDB antes de o campo existir, lido de volta
// depois. `paraJsonbRetorno` resolve `undefined` pra `[]` e o canônico
// local faz `?? []`, então os dois lados têm que concordar em "nenhuma
// linha `d`" — e é o fio que prova isso, não a leitura do código.
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

  // -------------------------------------------------------------------
  // O BLOCO `d` — daqui pra baixo é 2026-08-20
  //
  // Cada um exercita uma propriedade que os outros não alcançam. Se
  // algum parecer redundante, é porque a propriedade dele não está no
  // nome do cenário: está no comentário.
  // -------------------------------------------------------------------
  {
    nome: 'entregue · crediário: `pr` e `d` no MESMO vale',
    // O par com que o contrato explica por que os dois blocos existem
    // separados — `pr` diz o que aconteceu com o DINHEIRO, `d` diz o
    // que aconteceu com o PAPEL, e um não fala pelo outro:
    //
    //     pr  E1  P1  crediario  12000  0
    //     d   E1      crediario  recebido
    //
    // É o único cenário com os TRÊS blocos cheios ao mesmo tempo, que é
    // o layout de um retorno de crediário de verdade. E `crediario` como
    // FORMA só é aceito desde a correção do domínio de 20/08 — se a
    // migration `20260820120000` não estiver aplicada, é aqui que
    // aparece.
    vales: ids.map((id) => ({
      entregaId: id,
      desfecho: 'entregue',
      motivo: null,
      detalhe: null,
      pagamentosRealizados: [
        { pagamentoId: uuidv7(), forma: 'crediario', valorCents: 12000, trocoCents: 0 },
      ],
      documentos: [{ tipo: 'crediario', situacao: 'recebido' }],
    })),
  },
  {
    nome: 'insucesso · papel voltou EM BRANCO (`d` sem `pr`)',
    // O V014, e o cenário que mais parece contraditório visto de fora: a
    // entrega falhou e o documento voltou assim mesmo, em branco.
    // `recebido` é PRESENÇA FÍSICA e nada além — o papel saiu sob
    // custódia do motoboy, então o destino dele é declarado de qualquer
    // jeito.
    //
    // A assimetria que ele põe no fio: `pr` É filtrado por desfecho
    // (pagamento em insucesso é RECUSADO), `d` não é. Bloco `pr` vazio
    // com bloco `d` cheio é uma combinação que só este cenário produz.
    vales: ids.map((id) => ({
      entregaId: id,
      desfecho: 'insucesso',
      motivo: 'ausente',
      detalhe: null,
      pagamentosRealizados: [],
      documentos: [{ tipo: 'crediario', situacao: 'recebido' }],
    })),
  },
  {
    nome: 'convênio + crediário no mesmo vale, FORA DE ORDEM no input',
    // A identidade da linha `d` é o PAR (entrega_id, tipo), então um
    // vale pode ter os dois. Vão ao contrário de propósito — `crediario`
    // primeiro no input, `convenio` primeiro na saída dos dois lados. Se
    // um deles serializasse na ordem de chegada, é este que acusa; com
    // um documento só por vale a diferença seria indistinguível.
    //
    // Leva também o único `faltante` do conjunto. O outro valor do
    // domínio precisa atravessar o fio, e ele é o que descreve pendência
    // aberta em vez de desfecho — o que alguém vai querer "consertar"
    // daqui a seis meses.
    vales: ids.map((id) => ({
      entregaId: id,
      desfecho: 'entregue',
      motivo: null,
      detalhe: null,
      pagamentosRealizados: [
        { pagamentoId: uuidv7(), forma: 'convenio', valorCents: 4500, trocoCents: 0 },
      ],
      documentos: [
        { tipo: 'crediario', situacao: 'faltante' },
        { tipo: 'convenio', situacao: 'recebido' },
      ],
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

  cenarios.push({
    nome: 'multi-vale · `d` em DOIS de três vales, e os vales INVERTIDOS no input',
    // Duas propriedades numa tacada, e as duas só existem com mais de um
    // vale:
    //
    //   1. vale sem papel não gera linha nenhuma. Bloco vazio é
    //      AUSÊNCIA de linha, nunca placeholder — é essa propriedade que
    //      fez acrescentar o bloco `d` não mover um byte dos dez hashes
    //      que já existiam. Um `-` por vale, como um placeholder faria,
    //      teria movido todos. Quem fica sem é o vale do meio DO INPUT
    //      (`i === 1`) — que não é o do meio do documento: os ids não
    //      chegam ordenados do banco, então a posição canônica dele
    //      depende do sorteio. Na passada de 20/08 ele saiu em primeiro;
    //
    //   2. os vales vão INVERTIDOS no input, então o bloco `d` só sai na
    //      ordem certa se os dois lados reordenarem por entrega_id ANTES
    //      de achatar os dois laços.
    //
    // DOIS documentos, e não um. A primeira versão punha um só, e uma
    // linha não discrimina ordenação nenhuma — ela é a mesma em qualquer
    // ordem, então o cenário passaria provando metade do que o
    // comentário afirmava. Com dois em vales diferentes, o par sai no
    // canônico na ordem INVERSA à que entrou, e as situações são
    // diferentes de propósito: trocá-las de lugar muda o TEXTO, não só a
    // posição. É o método do §22 e do §49 — sem a forma errada ao lado,
    // a certa passa sem provar.
    //
    // (O cenário do convênio + crediário cobre a outra ordenação, a de
    // TIPO dentro do vale. São eixos diferentes: um mesmo achatamento
    // errado pode acertar um e errar o outro.)
    vales: [...ids].reverse().map((id, i) => ({
      entregaId: id,
      desfecho: 'entregue',
      motivo: null,
      detalhe: null,
      pagamentosRealizados: [
        { pagamentoId: uuidv7(), forma: 'pix', valorCents: 900, trocoCents: 0 },
      ],
      documentos:
        i === 1
          ? []
          : [{ tipo: 'convenio', situacao: i === 0 ? 'faltante' : 'recebido' }],
    })),
  })
}

// ---------------------------------------------------------------------
// 3. CADA CENÁRIO: os dois lados, do MESMO objeto
// ---------------------------------------------------------------------
const sha256Local = async (texto) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

// Quantas linhas de cada bloco o canônico ASSINADO tem.
//
// Existe pra a cobertura morar no RESULTADO e não no comentário. Um
// cenário que devia trazer bloco `d` e não traz aparece como `d: 0` na
// tabela, em vez de passar nos três critérios e parecer saudável — que
// foi exatamente a assinatura do defeito de 20/08: tudo verde, nada
// exercitado.
const TAB = '\t'
const contarBlocos = (canonico) => {
  const l = canonico.split('\n')
  const conta = (prefixo) => l.filter((linha) => linha.startsWith(prefixo + TAB)).length
  return { v: conta('v'), pr: conta('pr'), d: conta('d') }
}

// E quantos itens o payload ENVIADO carrega. Comparar os dois transforma
// "os bytes divergiram" em "o payload não levou o campo" — a diferença
// entre uma investigação e uma linha.
//
// Os três critérios já pegariam o defeito (o servidor reconstrói de
// menos e o hash muda). O que isto acrescenta é o NOME dele: assinar uma
// coisa e mandar outra é o único defeito desta cadeia que se paga com
// duas assinaturas colhidas.
const contarPayload = (payload) => ({
  v: payload.length,
  pr: payload.reduce((n, vale) => n + (vale.pagamentos_realizados?.length ?? 0), 0),
  d: payload.reduce((n, vale) => n + (vale.documentos?.length ?? 0), 0),
})

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

  // A MESMA entrada, pela MESMA função que a tela vai usar. Guardada
  // numa variável pra poder ser CONTADA antes de ir — se ela for montada
  // dentro da chamada, não há o que comparar com o que foi assinado.
  const enviado = paraJsonbRetorno(entrada)
  const assinado = contarBlocos(local)
  const mandado = contarPayload(enviado)

  const { data: servidor, error } = await supabase
    .rpc('conferir_canonico_retorno', {
      p_saida_id: entrada.saidaRomaneioId,
      p_saida_document_hash: entrada.saidaDocumentHash,
      p_motoboy_id: entrada.motoboyId,
      p_responsavel_id: entrada.responsavelId,
      p_retorno: enviado,
    })
    .maybeSingle()
  if (error) throw error

  linhas.push({
    cenario: cenario.nome,
    texto: local === servidor.canonico,
    bytes: bytesLocal === servidor.bytes,
    hash: hashLocal === servidor.sha256,
    // `false` aqui quer dizer: o canônico assinado tem N linhas de um
    // bloco e o payload enviado tem outra quantidade. É o defeito do
    // `paraJsonbRetorno`, dito pelo nome.
    payload:
      assinado.v === mandado.v && assinado.pr === mandado.pr && assinado.d === mandado.d,
    v: assinado.v,
    pr: assinado.pr,
    d: assinado.d,
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
    `${ids.length} vale(s) no documento, ${cenarios.length} cenários` +
    (ids.length > 1
      ? ` — documento multi-vale exercitado`
      : ` — SEM documento multi-vale: não achei entregas suficientes`)
)
console.table(linhas)

// A COBERTURA DO BLOCO `d`, DITA EM NÚMERO.
//
// Sem esta linha, um conjunto de cenários que perdesse os documentos
// (alguém edita, alguém copia a versão antiga do script) voltaria
// "TRANSPORTE PRESERVA" com a mesma cara de sempre. É a lição de 20/08
// escrita como código: o que não aparece no resultado não está coberto.
const cenariosComD = linhas.filter((l) => l.d > 0).length
const linhasD = linhas.reduce((n, l) => n + l.d, 0)
console.log(
  cenariosComD > 0
    ? `bloco \`d\`: ${cenariosComD} de ${linhas.length} cenários, ${linhasD} linhas no total`
    : 'bloco `d`: SEM COBERTURA — os três critérios não afirmam nada sobre documentos'
)

const todosOk = linhas.every((l) => l.texto && l.bytes && l.hash && l.payload)
console.log(
  todosOk && cenariosComD > 0
    ? `\nTRANSPORTE PRESERVA — ${linhas.length} cenários, quatro critérios cada\n`
    : todosOk
      ? '\nOS CRITÉRIOS PASSARAM, MAS SEM BLOCO `d` — cobertura incompleta\n'
      : '\nDIVERGIU — comece pela coluna `payload`: se ela for false, o\n' +
        'canônico assinado e o payload enviado têm contagens diferentes, e\n' +
        'o resto é consequência. Sendo true, é transporte de verdade: veja\n' +
        '`diferenca` e o padrão dos três primeiros critérios.\n'
)
console.log('último canônico, pra conferir a olho:\n' + ultimoCanonico)
}
