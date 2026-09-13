import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  criarPagamentoPrevisto,
  situacaoDoPagamento,
  type FormaPagamento,
  type FormaComValor,
  type PagamentoLido,
  type SituacaoDoPagamento,
} from '@/data/pagamentos'
import { inserirEventoIdempotente } from '@/data/eventos'
import { centsFromDigits } from '@/lib/money'
import { normalizarParaBusca } from '@/lib/texto'

/**
 * As formas que geram PAPEL FÍSICO — o que sai com o motoboy e tem que
 * voltar assinado pra filial.
 *
 * É a mesma regra que `romaneio_documentos_esperados` aplica no servidor
 * pra derivar quais linhas `d` o Romaneio de Retorno tem que trazer. As
 * duas precisam continuar concordando: divergindo, o retorno recusa
 * `documentos_nao_conferem` depois de colhidas as duas assinaturas.
 *
 * `convcard` NÃO entra — nele o cliente manda os dados do cartão e a
 * farmácia processa a compra, sem papel saindo com ninguém. Ele parece
 * convênio e não é.
 */
const GERAM_DOCUMENTO_FISICO: FormaPagamento[] = ['convenio', 'crediario']

/**
 * Uma forma de pagamento PREVISTA no cadastro — E4.
 *
 * O `pagamentoId` é cunhado por quem monta o payload, antes de
 * enfileirar, e nunca dentro de `criarEntrega` — é a regra do E3.C, e o
 * motivo continua o mesmo: `criarPagamentoPrevisto` insere e trata
 * `23505` como sucesso, o que só é idempotente se o id for O MESMO a
 * cada reenvio. Cunhado dentro da função, cada oscilação de rede criaria
 * um previsto novo.
 *
 * Antes do E3 o id era derivado da entrega, e era essa derivação que
 * fazia a segunda forma colidir na PK. O E3 tirou a premissa do modelo;
 * este tipo é quem passa a usar.
 */
export type FormaPrevistaDoCadastro = {
  pagamentoId: string
  forma: FormaPagamento
  /** Parte da compra paga por esta forma — o líquido; a soma bate com a compra. */
  valorCents: number
  /**
   * Troco a levar — 2026-09-12. "Troco para" menos o valor em dinheiro, e 0
   * quando não há troco. O "troco para" em si não é guardado: ele é
   * `valorCents + trocoCents`, e não aumenta a compra.
   *
   * Um item enfileirado antes desta mudança não traz o campo; quem lê a fila
   * (`criarEntrega`) trata a ausência como 0, que é o que aquele cadastro
   * afirmava.
   */
  trocoCents: number
}

export type NovaEntrega = {
  id: string
  /**
   * As formas previstas — UMA OU MAIS, e a soma tem que bater com
   * `valorCompraCents`.
   *
   * Era `formaPagamento: FormaPagamento` + `pagamentoPrevistoId: string`,
   * que juntos só sabiam descrever um previsto valendo a compra inteira.
   *
   * **A validação NÃO acontece aqui nem em `criarEntrega`**, e isso é
   * deliberado: quem valida é a tela, ANTES de enfileirar
   * (`validarFormasPrevistas`). Revalidar na sincronização poderia
   * recusar uma operação que já foi aceita no balcão — e o item iria
   * pra `erro` e pro backoff pra sempre, que é o pior sintoma conhecido
   * do projeto (§50.4).
   */
  formasPrevistas: FormaPrevistaDoCadastro[]
  tenantId: string
  lojaId: string
  criadoPor: string
  clienteNome: string
  clienteEndereco: string
  valorCompraCents: number
  // total da entrega: tarifa da loja × quantidadeVales
  valorEntregaCents: number
  // 1 normal, 2 em endereço distante. Guardado explícito porque se a
  // tarifa mudar, dividir valor por tarifa daria contagem errada em vale
  // antigo (ver migration 20260810180000).
  quantidadeVales: number
  // parte do valorEntregaCents que o cliente paga em mãos ao motoboy e
  // que portanto NÃO entra no acerto da farmácia com a agência. É o vale
  // extra do endereço distante — zero quando o convênio banca tudo.
  entregaPagaClienteCents: number
  ocorridoEmLocal: string
  convenioId: string | null
  temReceita: boolean
}

// numero_vale não vem do caixa — o banco gera (ver migration
// numero_vale_automatico). O insert devolve o valor gerado pra mostrar
// na confirmação.
//
// upsert (não insert): a fila offline pode chamar isso de novo pro mesmo
// id depois de uma falha parcial (ex: entrega gravou, pagamento não) —
// reenvio tem que virar no-op na entrega, não erro de chave duplicada.
// numero_vale só é gerado pelo default na PRIMEIRA vez; num upsert que já
// existe, o valor antigo é preservado (não regenera).
export async function criarEntrega(input: NovaEntrega): Promise<{ numeroVale: string }> {
  // A JANELA DA FILA — E4, e ela é só de desenvolvimento.
  //
  // Um item enfileirado ANTES do E4 traz `formaPagamento` +
  // `pagamentoPrevistoId` (ou nem isso, se for anterior ao E3.C) e não
  // traz `formasPrevistas`. O tipo governa o que se escreve de agora em
  // diante; o `??` tolera o que já está no IndexedDB de alguém.
  //
  // Ela sobe pro TOPO da função porque `status_documental` agora depende
  // dela — antes o previsto só era tocado depois do upsert.
  //
  // Morre no corte pré-V1, que apaga a fila.
  const legado = input as unknown as {
    formaPagamento?: FormaPagamento
    pagamentoPrevistoId?: string
  }
  const formas: FormaPrevistaDoCadastro[] =
    input.formasPrevistas ??
    (legado.formaPagamento
      ? [
          {
            pagamentoId: legado.pagamentoPrevistoId ?? input.id,
            forma: legado.formaPagamento,
            valorCents: input.valorCompraCents,
            trocoCents: 0,
          },
        ]
      : [])

  const { data, error } = await supabase
    .from('entregas')
    .upsert({
      id: input.id,
      tenant_id: input.tenantId,
      loja_id: input.lojaId,
      criado_por: input.criadoPor,
      cliente_nome: input.clienteNome,
      cliente_endereco: input.clienteEndereco,
      valor_compra_cents: input.valorCompraCents,
      valor_entrega_cents: input.valorEntregaCents,
      quantidade_vales: input.quantidadeVales,
      entrega_paga_cliente_cents: input.entregaPagaClienteCents,
      ocorrido_em_local: input.ocorridoEmLocal,
      convenio_id: input.convenioId,
      // CREDIÁRIO TAMBÉM GERA PAPEL, e até 2026-08-20 nascia
      // `nao_aplica`. Não era só implementação antiga: com o processo
      // real levantado, virou semanticamente errado — convênio e
      // crediário geram, cada um, um documento físico que acompanha a
      // entrega e tem que voltar assinado pra filial.
      //
      // Sem isto, o primeiro Romaneio de Retorno com crediário criaria
      // uma contradição: o documento assinado dizendo `d ... faltante` e
      // o banco dizendo que não há questão documental aplicável.
      //
      // `convcard` fica de fora de propósito — nele o cliente manda os
      // dados do cartão e a farmácia processa a compra, sem papel saindo
      // com ninguém. A regra é a mesma que
      // `romaneio_documentos_esperados` usa no servidor, e as duas
      // precisam continuar concordando.
      //
      // `.some()` e não `.includes()` — E4. BASTA UMA das formas
      // previstas gerar papel pra o vale nascer com pendência
      // documental: um pagamento metade convênio, metade dinheiro emite
      // o documento do convênio do mesmo jeito.
      //
      // É exatamente o que o servidor faz. `romaneio_documentos_esperados`
      // varre TODAS as linhas `p` do canônico assinado e devolve
      // `distinct (entrega_id, tipo_documento)` — as duas regras
      // continuam concordando, e divergirem faria o retorno recusar
      // `documentos_nao_conferem` depois de colhidas duas assinaturas.
      status_documental: formas.some((f) => GERAM_DOCUMENTO_FISICO.includes(f.forma))
        ? 'pendente'
        : 'nao_aplica',
      tem_receita: input.temReceita,
    })
    .select('numero_vale')
    .single()

  if (error) throw error
  const row = data as unknown as { numero_vale: string }

  // SEQUENCIAL, não `Promise.all` — E4.
  //
  // Não é medo de concorrência: cada insert é independente e idempotente
  // por id próprio. É que uma falha no meio de um lote paralelo deixa um
  // subconjunto ARBITRÁRIO gravado, e o reenvio da fila teria que
  // reconciliar isso; em série o estado parcial é sempre um PREFIXO, e
  // reenviar completa de onde parou. O volume é 1 a 3 linhas.
  for (const forma of formas) {
    await criarPagamentoPrevisto({
      id: forma.pagamentoId,
      tenantId: input.tenantId,
      entregaId: input.id,
      forma: forma.forma,
      valorCents: forma.valorCents,
      // `?? 0`: item enfileirado antes do "troco para" não tem o campo, e o
      // que aquele cadastro afirmava era "sem troco". Os ids e os valores
      // congelados na fila não mudam no reenvio.
      trocoCents: forma.trocoCents ?? 0,
      registradoPor: input.criadoPor,
      registradoEmLocal: input.ocorridoEmLocal,
    })
  }

  return { numeroVale: row.numero_vale }
}

export type NovaTransferencia = {
  id: string
  tenantId: string
  // filial que PEDE o produto: é ela que opera a tela, recebe a entrega,
  // assina o vale na chegada e paga a tele. Dona do vale, e o que a RLS e
  // o relatório usam pra escopar.
  lojaId: string
  lojaSolicitanteNome: string
  // filial que FORNECE: o motoboy passa nela primeiro pra pegar o produto.
  lojaOrigemId: string
  lojaOrigemNome: string
  criadoPor: string
  ocorridoEmLocal: string
  // tarifa da filial que pede, que é quem paga a tele. Capturado aqui, no
  // momento do cadastro,
  // e não lido no sync: se a tarifa mudar enquanto o vale espera na fila
  // offline, o certo é gravar o valor de quando o vale foi criado.
  valorEntregaCents: number
}

// Mesmo vale/sequência da entrega de cliente, só que sem cliente e sem
// valor de VENDA — ver migration transferencia_entre_filiais. Não cria
// pagamento nenhum (não é venda), mas tem valor de ENTREGA: quem leva o
// produto de uma filial pra outra é um motoboy da agência, e ela cobra a
// tarifa normal por isso.
//
// Sempre 1 vale: a variação de 2 vales é endereço distante do cliente, e
// transferência é entre filiais nossas. `entrega_paga_cliente_cents` fica
// no default 0 — não há cliente pra pagar em mãos, então a farmácia deve
// o valor inteiro à agência.
//
// upsert (não insert): mesmo motivo do criarEntrega — a fila offline pode
// reenviar pelo mesmo id depois de uma falha parcial, e isso precisa virar
// no-op, não erro de chave duplicada.
export async function criarTransferencia(input: NovaTransferencia): Promise<{ numeroVale: string }> {
  const { data, error } = await supabase
    .from('entregas')
    .upsert({
      id: input.id,
      tenant_id: input.tenantId,
      loja_id: input.lojaId,
      loja_origem_id: input.lojaOrigemId,
      tipo: 'transferencia',
      criado_por: input.criadoPor,
      // "cliente" é quem recebe, igual no vale normal — aqui, a filial que
      // pediu. A rota diz o caminho do produto: sai de quem fornece.
      cliente_nome: input.lojaSolicitanteNome,
      cliente_endereco: `${input.lojaOrigemNome} para ${input.lojaSolicitanteNome}`,
      valor_entrega_cents: input.valorEntregaCents,
      quantidade_vales: 1,
      ocorrido_em_local: input.ocorridoEmLocal,
    })
    .select('numero_vale')
    .single()

  if (error) throw error
  const row = data as unknown as { numero_vale: string }
  return { numeroVale: row.numero_vale }
}

export type CancelarEntregaInput = {
  tenantId: string
  entregaId: string
  numeroVale: string
  motivo: string
  canceladoPor: string
  autorNome: string
  ocorridoEmLocal: string
  eventoIdempotencyKey: string
}

// Cancelar é a única forma de "apagar" um vale (regra 4: DELETE em
// entregas é proibido). Só vale PENDENTE pode ser cancelado — depois que
// entra numa corrida o papel está fisicamente com o motoboy, e o
// desfecho certo passa a ser insucesso no retorno, não cancelamento.
//
// Mutation direta, sem fila offline: é ação corretiva e rara, e enfileirar
// criaria uma ordem delicada com a entrega que talvez ainda esteja na
// própria fila esperando sincronizar.
export async function cancelarEntrega(input: CancelarEntregaInput): Promise<void> {
  const { data, error } = await supabase
    .from('entregas')
    .update({
      status_entrega: 'cancelada',
      motivo_cancelamento: input.motivo,
      cancelado_por: input.canceladoPor,
      // cancelado_em (relógio do servidor) vem da trigger
      // fn_entrega_registrar_cancelamento
      cancelado_em_local: input.ocorridoEmLocal,
    })
    .eq('id', input.entregaId)
    .eq('status_entrega', 'pendente')
    .select('id')

  if (error) throw error

  // Zero linhas não vem como erro no PostgREST. Acontece em dois casos
  // reais: o vale saiu de 'pendente' entre abrir o dialog e confirmar
  // (outro caixa pôs numa corrida), ou ele ainda está na fila offline e
  // nem existe no banco. Sem isso, o cancelamento falharia calado e o
  // caixa acharia que deu certo.
  if (!data || data.length === 0) {
    throw new Error(
      'Não consegui cancelar: o vale já saiu de pendente ou ainda não sincronizou. Recarrega a lista e confere.'
    )
  }

  await inserirEventoIdempotente({
    tenantId: input.tenantId,
    entregaId: input.entregaId,
    tipo: 'entrega_cancelada',
    idempotencyKey: input.eventoIdempotencyKey,
    payload: {
      numero_vale: input.numeroVale,
      motivo: input.motivo,
      autor_nome: input.autorNome,
    },
    registradoPor: input.canceladoPor,
    ocorridoEmLocal: input.ocorridoEmLocal,
  })
}

export function useCancelarEntrega() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: cancelarEntrega,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entregas-hoje'] })
      // transferência também pode ser cancelada, e ela vive na aba própria
      queryClient.invalidateQueries({ queryKey: ['transferencias'] })
      queryClient.invalidateQueries({ queryKey: ['entregas-historico'] })
      queryClient.invalidateQueries({ queryKey: ['entregas-pendentes-sem-corrida'] })
      // O Registro de Auditoria fica sempre montado (o componente é quem
      // desenha o botão do cabeçalho), então a query dele carrega junto
      // com a página e não recarrega sozinha. Sem invalidar aqui, o
      // cancelamento não aparece lá até dar refresh.
      queryClient.invalidateQueries({ queryKey: ['eventos-auditoria'] })
    },
  })
}

export type EntregaRecente = {
  id: string
  numeroVale: string
  tipo: 'cliente' | 'transferencia'
  clienteNome: string
  clienteEndereco: string
  valorCompraCents: number
  valorEntregaCents: number
  statusEntrega: string
  ocorridoEmLocal: string
  /**
   * TODAS as formas previstas — E4. Era `formaPrevista`, singular, via
   * `.find(p => p.momento === 'previsto')`, e essa era a dívida que o
   * E3 registrou como BLOQUEANTE: ela só passa a mentir quando existe um
   * segundo previsto, e quem cria o segundo é o E4.
   *
   * `FormaComValor` (snake_case) e não um tipo camelCase próprio, contra
   * a convenção do projeto e de propósito: esta lista alimenta o `de` do
   * evento `pagamento_alterado`, que é jsonb com essa forma exata.
   * Converter na fronteira criaria mais uma cópia do mesmo conversor —
   * o defeito que o §65 documentou tendo achado TRÊS.
   */
  formasPrevistas: FormaComValor[]
  /** Com valor aplicado e troco — 2026-09-12. Era só a forma. */
  formasRealizadas: PagamentoLido[]
  /**
   * O que a lista pode afirmar sobre o pagamento — ver `situacaoDoPagamento`.
   * Era `formasRealizadas.length > 0`, e todo vale que passava pelo retorno
   * aparecia como "(divergiu)".
   */
  situacaoPagamento: SituacaoDoPagamento
  temReceita: boolean
  receitaRecebidaEm: string | null
  // quem lançou o vale. Cada caixa tem o próprio login, então isso
  // responde "quem fez" direto na lista, sem abrir o Registro de
  // Auditoria. Vem do join, não de snapshot no payload: se a pessoa
  // trocar de nome, a lista acompanha.
  criadoPorNome: string | null
}

// `profiles!entregas_criado_por_fkey` não é preciosismo: entregas tem
// VÁRIAS colunas apontando pra profiles (criado_por, cancelado_por,
// documento_recebido_por, receita_recebida_por), então o embed sem hint
// devolve PGRST201 por ambiguidade — o mesmo erro que o embed de lojas
// deu no Registro de Auditoria.
const ENTREGA_RECENTE_SELECT =
  'id, numero_vale, tipo, cliente_nome, cliente_endereco, valor_compra_cents, valor_entrega_cents, status_entrega, ocorrido_em_local, tem_receita, receita_recebida_em, criado_por, profiles!entregas_criado_por_fkey(nome), pagamentos(forma, momento, valor_cents, troco_cents)'

type EntregaRecenteRow = {
  id: string
  numero_vale: string
  tipo: 'cliente' | 'transferencia'
  cliente_nome: string
  cliente_endereco: string
  valor_compra_cents: number
  valor_entrega_cents: number
  status_entrega: string
  ocorrido_em_local: string
  tem_receita: boolean
  receita_recebida_em: string | null
  criado_por: string
  profiles: { nome: string } | null
  // `valor_cents` entrou no E4: o `de` do evento `pagamento_alterado`
  // carrega valor por forma, e sem ele o dialog de divergência teria que
  // inventar um número ou omiti-lo — e inventar é o defeito que este
  // projeto já pagou três vezes.
  pagamentos: Array<{
    forma: FormaPagamento
    momento: 'previsto' | 'realizado'
    valor_cents: number
    troco_cents: number
  }>
}

function mapEntregaRecente(row: EntregaRecenteRow): EntregaRecente {
  const formasPrevistas = row.pagamentos
    .filter((p) => p.momento === 'previsto')
    .map((p) => ({ forma: p.forma, valor_cents: p.valor_cents }))
  const formasRealizadas = row.pagamentos
    .filter((p) => p.momento === 'realizado')
    .map((p) => ({ forma: p.forma, valor_cents: p.valor_cents, troco_cents: p.troco_cents }))
  return {
    id: row.id,
    numeroVale: row.numero_vale,
    tipo: row.tipo,
    clienteNome: row.cliente_nome,
    clienteEndereco: row.cliente_endereco,
    valorCompraCents: row.valor_compra_cents,
    valorEntregaCents: row.valor_entrega_cents,
    statusEntrega: row.status_entrega,
    ocorridoEmLocal: row.ocorrido_em_local,
    formasPrevistas,
    formasRealizadas,
    situacaoPagamento: situacaoDoPagamento(formasPrevistas, formasRealizadas),
    temReceita: row.tem_receita,
    receitaRecebidaEm: row.receita_recebida_em,
    criadoPorNome: row.profiles?.nome ?? null,
  }
}

// Paginada pelo mesmo motivo do histórico: a ordenação é descendente, e
// pro caixa isso nunca chega perto de teto nenhum (um dia, uma loja) —
// mas admin enxerga as 18 filiais juntas, e num dia movimentado o corte
// silencioso do max-rows derrubaria justamente os vales da manhã.
//
// 25 por página nas duas listas, por pedido do usuário (2026-08-12).
// Antes eram 100 aqui e 50 no histórico; página curta rola menos e
// monta menos dropdown por vez, que é o que pesa nesta tabela.
export const TAMANHO_PAGINA_HOJE = 25

// `tipo = 'cliente'`: transferência tem aba própria desde 2026-08-12.
// São duas leituras diferentes da mesma tabela — o caixa que confere o
// movimento do dia não quer o vale de transferência no meio, e quem
// procura uma transferência não quer varrer as entregas de cliente.
async function buscarEntregasDeHoje(pagina: number): Promise<PaginaEntregas> {
  const inicioDoDia = new Date()
  inicioDoDia.setHours(0, 0, 0, 0)
  const de = (pagina - 1) * TAMANHO_PAGINA_HOJE

  const { data, error, count } = await supabase
    .from('entregas')
    .select(ENTREGA_RECENTE_SELECT, { count: 'exact' })
    .eq('tipo', 'cliente')
    .gte('ocorrido_em_local', inicioDoDia.toISOString())
    .order('registrado_em', { ascending: false })
    .order('id', { ascending: false })
    .range(de, de + TAMANHO_PAGINA_HOJE - 1)

  if (error) throw error

  const total = count ?? 0
  return {
    entregas: (data as unknown as EntregaRecenteRow[]).map(mapEntregaRecente),
    total,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA_HOJE)),
  }
}

export function useEntregasDeHoje(pagina: number) {
  return useQuery({
    queryKey: ['entregas-hoje', pagina],
    queryFn: () => buscarEntregasDeHoje(pagina),
    placeholderData: keepPreviousData,
  })
}

export type FiltrosHistorico = {
  numeroVale: string
  clienteNome: string
  clienteEndereco: string
  valorCompra: string
  dataInicio: string
  dataFim: string
  // '' = todas as filiais. Só admin/gerente escolhe: pra caixa a RLS já
  // restringe à própria loja, então um select aqui não mudaria nada.
  // Filtra por loja_id (origem), mesma semântica do Registro de
  // Auditoria — vale de transferência aparece na filial que o criou,
  // não na de destino.
  lojaId: string
}

export const FILTROS_HISTORICO_VAZIOS: FiltrosHistorico = {
  numeroVale: '',
  clienteNome: '',
  clienteEndereco: '',
  valorCompra: '',
  dataInicio: '',
  dataFim: '',
  lojaId: '',
}

// Uma página por vez, com o total real vindo do banco. Antes isso era um
// `limit` (200 sem filtro, 5000 com filtro) e o resultado vinha truncado
// em silêncio: a farmácia precisa achar um vale de 3 meses atrás, e o
// corte por `registrado_em desc` derrubava justamente os mais antigos —
// exatamente os procurados. Paginando não há teto nenhum, e ainda carrega
// menos por vez (a tabela não virtualiza e monta um dropdown por linha).
// Mesmo tamanho da aba "Hoje" — ver comentário lá.
export const TAMANHO_PAGINA_HISTORICO = 25

// Mesma forma pras duas listas paginadas (Hoje e Histórico).
export type PaginaEntregas = {
  entregas: EntregaRecente[]
  total: number
  totalPaginas: number
}

async function buscarHistoricoEntregas(
  filtros: FiltrosHistorico,
  pagina: number
): Promise<PaginaEntregas> {
  const de = (pagina - 1) * TAMANHO_PAGINA_HISTORICO

  // count: 'exact' junto do range — é o total que alimenta "X vales" e o
  // número de páginas. Sem ele não dá pra saber se existe página seguinte.
  let query = supabase
    .from('entregas')
    .select(ENTREGA_RECENTE_SELECT, { count: 'exact' })
    // só entrega de cliente — transferência tem aba própria
    .eq('tipo', 'cliente')
    .order('registrado_em', { ascending: false })
    .order('id', { ascending: false })
    .range(de, de + TAMANHO_PAGINA_HISTORICO - 1)

  // `numero_vale` continua no `ilike` cru: "V-000046" não tem acento
  // nem caixa pra ignorar, e uma coluna de busca pra ele seria peso sem
  // ganho.
  if (filtros.numeroVale.trim()) query = query.ilike('numero_vale', `%${filtros.numeroVale.trim()}%`)

  // NOME E ENDEREÇO VÃO PELA COLUNA DERIVADA (E1.1, migration
  // 20260825130000), e os DOIS LADOS são normalizados.
  //
  // `ilike` ignora caixa e NÃO ignora acento — então, até 2026-08-25,
  // procurar "joao" aqui não achava "João da Silva", e o resultado vazio
  // era indistinguível de "não existe cadastro".
  //
  // Normalizar só um dos lados reintroduz o mesmo defeito com outra
  // cara: a coluna já perdeu o acento, então um termo cru com acento
  // ("João") não casaria com "joao". É por isso que `casaComBusca`
  // existe no front — aqui a mesma regra é escrita à mão porque o filtro
  // é do PostgREST.
  //
  // `like`, e não `ilike`: a coluna já é minúscula por construção, e
  // `normalizarParaBusca` também baixa a caixa do termo. Um `ilike`
  // aqui seria trabalho repetido por precaução contra o que não pode
  // acontecer.
  const nomeBusca = normalizarParaBusca(filtros.clienteNome)
  if (nomeBusca) query = query.like('cliente_nome_busca', `%${nomeBusca}%`)

  const enderecoBusca = normalizarParaBusca(filtros.clienteEndereco)
  if (enderecoBusca) query = query.like('cliente_endereco_busca', `%${enderecoBusca}%`)
  if (filtros.valorCompra) query = query.eq('valor_compra_cents', centsFromDigits(filtros.valorCompra))
  if (filtros.lojaId) query = query.eq('loja_id', filtros.lojaId)
  // intervalo — "De" sozinho é "a partir de", "Até" sozinho é "até", os dois
  // juntos fecham o período (ex: mês inteiro).
  if (filtros.dataInicio) {
    query = query.gte('ocorrido_em_local', new Date(`${filtros.dataInicio}T00:00:00`).toISOString())
  }
  if (filtros.dataFim) {
    const fim = new Date(`${filtros.dataFim}T00:00:00`)
    fim.setDate(fim.getDate() + 1)
    query = query.lt('ocorrido_em_local', fim.toISOString())
  }

  const { data, error, count } = await query
  if (error) throw error

  const total = count ?? 0
  return {
    entregas: (data as unknown as EntregaRecenteRow[]).map(mapEntregaRecente),
    total,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA_HISTORICO)),
  }
}

// Lista de transferências — todas, não só as de hoje. O volume é baixo
// (uma filial pede produto pra outra algumas vezes por semana), então uma
// lista paginada única serve de "hoje" e de histórico ao mesmo tempo, sem
// precisar de filtro de período nem de busca própria.
async function buscarTransferencias(pagina: number): Promise<PaginaEntregas> {
  const de = (pagina - 1) * TAMANHO_PAGINA_HOJE

  const { data, error, count } = await supabase
    .from('entregas')
    .select(ENTREGA_RECENTE_SELECT, { count: 'exact' })
    .eq('tipo', 'transferencia')
    .order('registrado_em', { ascending: false })
    .order('id', { ascending: false })
    .range(de, de + TAMANHO_PAGINA_HOJE - 1)

  if (error) throw error

  const total = count ?? 0
  return {
    entregas: (data as unknown as EntregaRecenteRow[]).map(mapEntregaRecente),
    total,
    totalPaginas: Math.max(1, Math.ceil(total / TAMANHO_PAGINA_HOJE)),
  }
}

export function useTransferencias(pagina: number) {
  return useQuery({
    queryKey: ['transferencias', pagina],
    queryFn: () => buscarTransferencias(pagina),
    placeholderData: keepPreviousData,
  })
}

export function useHistoricoEntregas(filtros: FiltrosHistorico, pagina: number) {
  return useQuery({
    queryKey: ['entregas-historico', filtros, pagina],
    queryFn: () => buscarHistoricoEntregas(filtros, pagina),
    // mantém a página anterior na tela enquanto a próxima carrega — sem
    // isso a tabela pisca vazia a cada clique de página.
    placeholderData: keepPreviousData,
  })
}

// PC ↔ tablet: qualquer INSERT/UPDATE em entregas (RLS já filtra por
// tenant/loja) invalida a lista, que refaz o fetch. Publication já
// habilitada no schema inicial (alter publication supabase_realtime add
// table entregas) — só faltava assinar do lado do cliente.
export function useEntregasRealtime() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('entregas-hoje-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'entregas' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['entregas-hoje'] })
          // a aba de transferências vive da mesma tabela e também precisa
          // acompanhar ao vivo (PC ↔ tablet)
          queryClient.invalidateQueries({ queryKey: ['transferencias'] })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}
