import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { sha256Hex } from '@/lib/hash'
import { montarCanonico, type EntradaCanonica, type ValeCanonico } from '@/lib/canonico'
import type { EnvelopeSelado } from '@/lib/envelope'

// Romaneio de Saída — o documento selado da retirada.
//
// A forma canônica (a parte delicada) mora em `@/lib/canonico`, sem
// dependência nenhuma, pra poder ser testada isolada contra o lado SQL.
// Aqui ficam só as chamadas de RPC e a captura de geolocalização.

export type { EntradaCanonica, ValeCanonico, PagamentoPrevistoCanonico } from '@/lib/canonico'
export { montarCanonico } from '@/lib/canonico'

export function documentHashLocal(entrada: EntradaCanonica): Promise<string> {
  return sha256Hex(montarCanonico(entrada))
}

// =====================================================================
// RPCs
// =====================================================================

export type RomaneioPreparado = {
  payload: unknown
  canonico: string
  documentHash: string
}

// Função PURA do lado do servidor: não grava nada. Devolve o canônico
// inteiro (não só o hash) justamente pra permitir a comparação byte a
// byte com `montarCanonico`.
export async function prepararRomaneio(input: {
  lojaId: string
  agenciaId: string | null
  motoboyId: string
  entregaIds: string[]
}): Promise<RomaneioPreparado> {
  const { data, error } = await supabase.rpc('preparar_romaneio', {
    p_loja_id: input.lojaId,
    p_agencia_id: input.agenciaId,
    p_motoboy_id: input.motoboyId,
    p_entrega_ids: input.entregaIds,
  })
  if (error) throw error

  const linhas = data as unknown as Array<{
    payload: unknown
    canonico: string
    document_hash: string
  }>
  if (!linhas || linhas.length === 0) throw new Error('preparar_romaneio não devolveu nada.')

  return {
    payload: linhas[0].payload,
    canonico: linhas[0].canonico,
    documentHash: linhas[0].document_hash,
  }
}

// O teste que prova que as duas implementações do canônico concordam.
// Vale chamar isto sempre que alguém tocar em qualquer um dos dois lados
// — é a única defesa real contra a divergência silenciosa.
export function conferirCanonico(
  entrada: EntradaCanonica,
  preparado: RomaneioPreparado
): { iguais: boolean; local: string; servidor: string; primeiraDiferenca: number } {
  const local = montarCanonico(entrada)
  const servidor = preparado.canonico

  let primeiraDiferenca = -1
  const limite = Math.max(local.length, servidor.length)
  for (let i = 0; i < limite; i++) {
    if (local[i] !== servidor[i]) {
      primeiraDiferenca = i
      break
    }
  }

  return { iguais: primeiraDiferenca === -1, local, servidor, primeiraDiferenca }
}

export type ResultadoSelo =
  | { ok: true; jaExistia: boolean; romaneioId: string; numero: string; finalHash: string | null }
  | {
      ok: false
      motivo: 'conflito'
      jaExistia: boolean
      romaneioId: string
      numero: string | null
      conflitos: unknown
    }

// Conflito NÃO é exceção: a transação grava o registro do conflito e
// commita, porque uma retirada física aconteceu de verdade e essa prova
// não pode sumir num rollback. Erro de verdade (autorização inválida,
// romaneio sem vale) continua vindo como `throw`.

// Recusa do SERVIDOR, e não falha de rede. A diferença decide o que a
// tela faz: rede caiu é caso de fila (a retirada física aconteceu e a
// operação sincroniza depois); o servidor ter recusado NÃO é — precisa
// aparecer na hora, porque insistir só repete o mesmo resultado, e a
// tela dizendo "registrada offline" mandaria o caixa embora achando que
// deu certo.
//
// O PostgREST devolve erro com `code` (o SQLSTATE); uma falha de fetch
// não tem. É o que separa os dois.
export class ErroDoServidor extends Error {
  codigo: string | undefined
  constructor(mensagem: string, codigo?: string) {
    super(mensagem)
    this.name = 'ErroDoServidor'
    this.codigo = codigo
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ehRecusaDoServidor(error: any): boolean {
  return typeof error?.code === 'string' && error.code.length > 0
}

export async function selarRomaneio(input: {
  romaneioId: string
  corridaId: string
  lojaId: string
  agenciaId: string | null
  motoboyId: string
  entregaIds: string[]
  documentHash: string
  autorizacaoId: string
  caixaStrokes: unknown
  motoboyStrokes: unknown
  ocorridoEmLocal: string
  geolocalizacao: unknown | null
}): Promise<ResultadoSelo> {
  const { data, error } = await supabase.rpc('selar_romaneio', {
    p_romaneio_id: input.romaneioId,
    p_corrida_id: input.corridaId,
    p_loja_id: input.lojaId,
    p_agencia_id: input.agenciaId,
    p_motoboy_id: input.motoboyId,
    p_entrega_ids: input.entregaIds,
    p_document_hash: input.documentHash,
    p_autorizacao_id: input.autorizacaoId,
    p_caixa_strokes: input.caixaStrokes,
    p_motoboy_strokes: input.motoboyStrokes,
    p_ocorrido_em_local: input.ocorridoEmLocal,
    p_geolocalizacao: input.geolocalizacao,
  })
  if (error) {
    if (ehRecusaDoServidor(error)) throw new ErroDoServidor(error.message, error.code)
    throw error
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = data as any
  if (r?.ok) {
    return {
      ok: true,
      jaExistia: !!r.ja_existia,
      romaneioId: r.romaneio_id,
      numero: r.numero,
      finalHash: r.final_hash ?? null,
    }
  }
  return {
    ok: false,
    motivo: 'conflito',
    jaExistia: !!r?.ja_existia,
    romaneioId: r?.romaneio_id,
    numero: r?.numero ?? null,
    conflitos: r?.conflitos,
  }
}

export type ResultadoAutorizacao =
  | { ok: true; autorizacaoId: string; expiraEm: string }
  | { ok: false; motivo: string }

// Amarra cartão + PIN a ESTE document_hash. Se os vales mudarem depois, o
// hash muda e esta autorização deixa de servir — sem precisar de nenhuma
// lógica que "perceba" a mudança.
export async function autorizarSaida(
  token: string,
  pin: string,
  documentHash: string
): Promise<ResultadoAutorizacao> {
  const { data, error } = await supabase.rpc('autorizar_saida', {
    p_token: token,
    p_pin: pin,
    p_document_hash: documentHash,
  })
  if (error) throw error

  const linhas = data as unknown as Array<{
    ok: boolean
    motivo: string | null
    autorizacao_id: string | null
    expira_em: string | null
  }>
  const linha = linhas?.[0]
  if (!linha) throw new Error('autorizar_saida não devolveu resposta.')

  if (linha.ok && linha.autorizacao_id && linha.expira_em) {
    return { ok: true, autorizacaoId: linha.autorizacao_id, expiraEm: linha.expira_em }
  }
  return { ok: false, motivo: linha.motivo ?? 'credencial_invalida' }
}

// =====================================================================
// Saída registrada offline
//
// A tela sela o envelope SEMPRE (online ou não) e tenta o caminho online
// primeiro; qualquer falha cai aqui. Por isso `modo` de tudo que passa
// pela fila é 'offline_sincronizada': o que ele descreve não é se havia
// internet, e sim se a validação do servidor aconteceu no momento da
// retirada ou depois.
// =====================================================================

export type SaidaOfflineInput = {
  romaneioId: string
  corridaId: string
  lojaId: string
  agenciaId: string | null
  motoboyId: string
  entregaIds: string[]
  documentHash: string
  caixaStrokes: unknown
  motoboyStrokes: unknown
  ocorridoEmLocal: string
  geolocalizacao: unknown | null
  // Guarda PIN e token do cartão. O navegador sela e não reabre — quem
  // abre é a Edge Function, com a chave privada. Ver src/lib/envelope.ts.
  envelope: EnvelopeSelado
  // Vai no corpo pra a Edge Function conferir contra o JWT. É verificação
  // de servidor, não de tela: a fila do caixa A não sela em nome do B.
  userId: string
}

// Recusa que não melhora com repetição: conflito de vale, PIN que não
// confere, envelope de outra operação, payload alterado depois de
// assinado. Retentar só gastaria tentativa — e no caso do PIN,
// bloquearia o motoboy. A fila marca como terminal e chama gente.
export class ErroTerminalDeSaida extends Error {
  detalhe: unknown
  constructor(mensagem: string, detalhe: unknown) {
    super(mensagem)
    this.name = 'ErroTerminalDeSaida'
    this.detalhe = detalhe
  }
}

const MOTIVOS_TERMINAIS = ['conflito', 'envelope', 'envelope_trocado', 'payload_alterado']

export async function sincronizarSaidaOffline(input: SaidaOfflineInput): Promise<void> {
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new Error('Sem sessão para sincronizar.')

  // O header vai explícito. `functions.invoke` manda a anon key e não o
  // JWT da sessão — foi o bug de 403 que custou uma sessão inteira no
  // painel de usuários. Se alguém "simplificar" removendo isto, a
  // sincronização quebra com 403 e o motivo não é óbvio.
  const { data, error } = await supabase.functions.invoke('sync-romaneio', {
    headers: { Authorization: `Bearer ${token}` },
    body: {
      userId: input.userId,
      romaneioId: input.romaneioId,
      corridaId: input.corridaId,
      lojaId: input.lojaId,
      agenciaId: input.agenciaId,
      motoboyId: input.motoboyId,
      entregaIds: input.entregaIds,
      documentHash: input.documentHash,
      caixaStrokes: input.caixaStrokes,
      motoboyStrokes: input.motoboyStrokes,
      ocorridoEmLocal: input.ocorridoEmLocal,
      geolocalizacao: input.geolocalizacao,
      envelope: input.envelope,
    },
  })

  if (error) {
    // A Edge Function devolve o motivo no corpo mesmo quando o status é
    // 4xx; sem ler o corpo, uma recusa definitiva viraria retry eterno.
    const corpo = await lerCorpoDoErro(error)
    if (corpo?.motivo && MOTIVOS_TERMINAIS.includes(corpo.motivo)) {
      throw new ErroTerminalDeSaida(corpo.error ?? error.message, corpo)
    }
    throw new Error(corpo?.error ?? error.message)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = data as any
  if (r && r.ok === false) {
    throw new ErroTerminalDeSaida(
      `Romaneio ${r.numero ?? ''} não pôde ser selado: conflito de sincronização.`.trim(),
      r
    )
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lerCorpoDoErro(error: any): Promise<{ error?: string; motivo?: string } | null> {
  try {
    if (error?.context?.json) return await error.context.json()
    if (typeof error?.context?.text === 'function') return JSON.parse(await error.context.text())
  } catch {
    // corpo ausente ou não-JSON: cai no caminho de erro genérico, que é
    // retentável — a resposta certa quando não dá pra saber.
  }
  return null
}

// =====================================================================
// Os vales disponíveis para uma saída
//
// Traz TODOS os campos que entram no canônico, e não só os que a tela
// mostra: offline o navegador precisa montar o mesmo texto que o servidor
// montaria, e um campo faltando aqui vira hash diferente lá — recusado
// como "documento alterado", sem pista de por quê.
//
// Se alguém acrescentar coluna ao canônico (SQL) e esquecer desta query,
// é aqui que quebra. Os dois andam juntos.
// =====================================================================


const LIMITE_VALES_SAIDA = 500

type LinhaVale = {
  id: string
  numero_vale: string
  tipo: 'cliente' | 'transferencia'
  cliente_nome: string
  cliente_endereco: string
  quantidade_vales: number
  valor_compra_cents: number
  valor_entrega_cents: number
  entrega_paga_cliente_cents: number
  loja_origem_id: string | null
  convenio_id: string | null
  pagamentos: Array<{
    id: string
    momento: string
    forma: string
    valor_cents: number
    troco_cents: number
  }> | null
}

async function buscarValesParaSaida(lojaId: string): Promise<ValeCanonico[]> {
  const { data, error } = await supabase
    .from('entregas')
    .select(
      'id, numero_vale, tipo, cliente_nome, cliente_endereco, quantidade_vales, ' +
        'valor_compra_cents, valor_entrega_cents, entrega_paga_cliente_cents, ' +
        'loja_origem_id, convenio_id, pagamentos(id, momento, forma, valor_cents, troco_cents)'
    )
    .eq('status_entrega', 'pendente')
    // Filtro de filial NO CLIENTE, e não é redundância com a RLS.
    //
    // Pro caixa e pro gerente a RLS já prende à própria loja, então isto
    // não muda nada. Pro ADMIN ela devolve o tenant inteiro de propósito
    // — e aí a tela oferecia vale de outra filial numa saída que o
    // servidor recusa sempre, porque `selar_romaneio_interno` exige
    // `e.loja_id = p_loja_id` e devolve 'outra_filial'.
    //
    // O preço de descobrir isso é alto: duas assinaturas colhidas, o
    // motoboy já foi embora e um romaneio de conflito pra gestão resolver.
    // Aconteceu de verdade no teste da saída offline (V-000032, um vale de
    // transferência de outra filial, no R-000009).
    //
    // Não é "confiar em filtro de cliente" — o servidor continua sendo
    // quem recusa. É não OFERECER o que nunca poderia dar certo.
    .eq('loja_id', lojaId)
    .is('corrida_id', null)
    // Mais novo primeiro: o vale que o caixa acabou de lançar é o que ele
    // vai mandar sair agora, então ele tem que estar no topo — não no fim
    // de uma lista que precisa rolar.
    //
    // Isso inverte a regra geral das filas de trabalho deste projeto (que
    // ordenam ascendente pra que truncar perca o mais NOVO, a direção
    // benigna). Aqui o teto de 500 está muito acima do real: vale pendente
    // sem corrida sai no mesmo dia, então a lista vive perto de dezenas.
    // Se algum dia encostar em 500, o problema não é a ordenação — é que
    // tem vale parado há semanas.
    .order('registrado_em', { ascending: false })
    .limit(LIMITE_VALES_SAIDA)

  if (error) throw error

  return (data as unknown as LinhaVale[]).map((row) => ({
    entregaId: row.id,
    numeroVale: row.numero_vale,
    tipo: row.tipo,
    clienteNome: row.cliente_nome,
    clienteEndereco: row.cliente_endereco,
    quantidadeVales: row.quantidade_vales,
    valorCompraCents: row.valor_compra_cents,
    valorEntregaCents: row.valor_entrega_cents,
    entregaPagaClienteCents: row.entrega_paga_cliente_cents,
    lojaOrigemId: row.loja_origem_id,
    convenioId: row.convenio_id,
    // Filtra por momento aqui, e não no embed: com filtro no embed o
    // PostgREST vira inner join e o vale SEM pagamento (transferência)
    // sumiria da lista inteira.
    pagamentosPrevistos: (row.pagamentos ?? [])
      .filter((p) => p.momento === 'previsto')
      .map((p) => ({
        pagamentoId: p.id,
        forma: p.forma,
        valorCents: p.valor_cents,
        trocoCents: p.troco_cents,
      })),
  }))
}

// A chave carrega a loja, mas a invalidação continua sendo por
// `['vales-para-saida']` em toda a fila — o TanStack Query casa por
// PREFIXO, então a chave composta é alcançada do mesmo jeito. Mesmo
// mecanismo de `['entregas-hoje', pagina]`.
export function useValesParaSaida(lojaId: string) {
  return useQuery({
    queryKey: ['vales-para-saida', lojaId],
    queryFn: () => buscarValesParaSaida(lojaId),
    // `staleTime: 0` de propósito, contra o padrão do resto do app.
    //
    // Esta lista decide o que sai fisicamente da farmácia. Mostrar um vale
    // que já saiu faz o caixa mandá-lo de novo, e aí o servidor recusa por
    // conflito — corretamente, mas depois de colher duas assinaturas e com
    // um romaneio de conflito pra alguém resolver. A tela é aberta
    // deliberadamente, uma vez por saída; buscar de novo custa nada perto
    // disso.
    staleTime: 0,
    // O cache longo é pro caso de a internet cair com a tela aberta: o
    // dado anterior continua servindo. Recarregar a página offline é outro
    // caso, e aí não há lista.
    gcTime: 30 * 60_000,
  })
}

// =====================================================================
// Custódia — o que aconteceu com o vale na saída
//
// A estrutura é Vale → Romaneio → Assinaturas, e não Vale → Assinaturas.
// Um romaneio pode conter vários vales, e copiar as mesmas duas
// assinaturas em cada linha duplicaria dado sem ganhar nada; a tela mostra
// as assinaturas "dentro do vale" navegando por essa relação.
// =====================================================================

export type AssinaturaDoRomaneio = {
  tipoSignatario: 'caixa' | 'motoboy'
  strokes: unknown
  nome: string
  agenciaNome: string | null
  // Só os 4 últimos aparecem na tela. Nunca o token, nunca hash de
  // segredo — esses nem chegam ao navegador, o grant por coluna barra.
  credencialPublicId: string | null
  authMethod: string | null
  assinadoEm: string
  assinadoEmLocal: string | null
  ip: string | null
  geolocalizacao: unknown
  signatureHash: string | null
  /**
   * O cargo de quem assinou NO INSTANTE da assinatura — nulo nas
   * assinaturas anteriores a 2026-08-19, que nunca tiveram o dado.
   *
   * Não confundir com `tipoSignatario`, que é o SLOT ("o lado da
   * farmácia") e está dentro do hash. Um romaneio pode legitimamente ter
   * `tipoSignatario: 'caixa'` com `papelNoMomento: 'admin'` — foi o que
   * aconteceu no `R-000013`.
   */
  papelNoMomento: 'caixa' | 'gerente' | 'admin' | null
}

export type CustodiaDoVale = {
  romaneioId: string
  numero: string
  status: 'selado' | 'conflito'
  modo: 'online' | 'offline_sincronizada'
  seladoEm: string | null
  ocorridoEmLocal: string | null
  recebidoEmServidor: string
  finalHash: string | null
  assinaturas: AssinaturaDoRomaneio[]
}

type LinhaAssinatura = {
  romaneio_id: string
  tipo_signatario: 'caixa' | 'motoboy'
  strokes: unknown
  auth_method: string | null
  signature_hash: string | null
  assinado_em_local: string | null
  capturado_em: string
  ip: string | null
  geolocalizacao: unknown
  profiles: { nome: string } | null
  mototaxistas: { nome: string; agencias: { nome: string } | null } | null
  motoboy_credenciais: { public_id: string } | null
  papel_no_momento: 'caixa' | 'gerente' | 'admin' | null
}

// Cada tabela alvo tem exatamente UMA FK vinda de `assinaturas`, então o
// embed sem hint é inequívoco. O PGRST201 que já mordeu este projeto duas
// vezes acontece quando há DUAS FKs pro mesmo alvo (caso de entregas →
// lojas). Se alguém acrescentar outra FK aqui, este select passa a
// precisar de hint.
const SELECT_ASSINATURAS =
  'romaneio_id, tipo_signatario, strokes, auth_method, signature_hash, ' +
  'assinado_em_local, capturado_em, ip, geolocalizacao, papel_no_momento, ' +
  'profiles(nome), mototaxistas(nome, agencias(nome)), motoboy_credenciais(public_id)'

function mapAssinatura(linha: LinhaAssinatura): AssinaturaDoRomaneio {
  return {
    tipoSignatario: linha.tipo_signatario,
    strokes: linha.strokes,
    nome:
      linha.tipo_signatario === 'caixa'
        ? (linha.profiles?.nome ?? '—')
        : (linha.mototaxistas?.nome ?? '—'),
    agenciaNome: linha.mototaxistas?.agencias?.nome ?? null,
    credencialPublicId: linha.motoboy_credenciais?.public_id ?? null,
    authMethod: linha.auth_method,
    assinadoEm: linha.capturado_em,
    assinadoEmLocal: linha.assinado_em_local,
    ip: linha.ip,
    geolocalizacao: linha.geolocalizacao,
    signatureHash: linha.signature_hash,
    papelNoMomento: linha.papel_no_momento,
  }
}

// Caixa antes de motoboy, sempre — é a ordem em que a saída aconteceu.
function ordemDeAssinatura(a: AssinaturaDoRomaneio): number {
  return a.tipoSignatario === 'caixa' ? 0 : 1
}

// Uma query pra todos os vales da tela, nunca uma por linha: a lista de
// "Hoje" pagina de 100 em 100, e cem requisições travariam o PC do caixa
// antes de o dado ser o problema.
async function buscarCustodias(entregaIds: string[]): Promise<Map<string, CustodiaDoVale>> {
  if (entregaIds.length === 0) return new Map()

  const { data: vinculos, error: erroVinculo } = await supabase
    .from('romaneio_entregas')
    .select(
      'entrega_id, romaneios(id, numero, status, modo, selado_em, ocorrido_em_local, recebido_em_servidor, final_hash)'
    )
    .in('entrega_id', entregaIds)

  if (erroVinculo) throw erroVinculo

  const linhas = vinculos as unknown as Array<{
    entrega_id: string
    romaneios: {
      id: string
      numero: string
      status: 'selado' | 'conflito'
      modo: 'online' | 'offline_sincronizada'
      selado_em: string | null
      ocorrido_em_local: string | null
      recebido_em_servidor: string
      final_hash: string | null
    } | null
  }>

  const romaneioIds = [...new Set(linhas.map((l) => l.romaneios?.id).filter(Boolean))] as string[]
  if (romaneioIds.length === 0) return new Map()

  const { data: assinaturas, error: erroAssinatura } = await supabase
    .from('assinaturas')
    .select(SELECT_ASSINATURAS)
    .in('romaneio_id', romaneioIds)

  if (erroAssinatura) throw erroAssinatura

  const porRomaneio = new Map<string, AssinaturaDoRomaneio[]>()
  for (const linha of assinaturas as unknown as LinhaAssinatura[]) {
    const lista = porRomaneio.get(linha.romaneio_id) ?? []
    lista.push(mapAssinatura(linha))
    porRomaneio.set(linha.romaneio_id, lista)
  }

  const resultado = new Map<string, CustodiaDoVale>()
  for (const linha of linhas) {
    const r = linha.romaneios
    if (!r) continue
    resultado.set(linha.entrega_id, {
      romaneioId: r.id,
      numero: r.numero,
      status: r.status,
      modo: r.modo,
      seladoEm: r.selado_em,
      ocorridoEmLocal: r.ocorrido_em_local,
      recebidoEmServidor: r.recebido_em_servidor,
      finalHash: r.final_hash,
      assinaturas: (porRomaneio.get(r.id) ?? []).sort(
        (a, b) => ordemDeAssinatura(a) - ordemDeAssinatura(b)
      ),
    })
  }
  return resultado
}

export function useCustodiaDosVales(entregaIds: string[]) {
  // Chave ordenada: sem isso a query refaz só porque a lista veio noutra
  // ordem, e a lista muda de ordem a cada invalidação do Realtime.
  const chave = [...entregaIds].sort().join(',')
  return useQuery({
    queryKey: ['custodia-vales', chave],
    queryFn: () => buscarCustodias(entregaIds),
    enabled: entregaIds.length > 0,
    staleTime: 60_000,
  })
}

export type RomaneioCompleto = CustodiaDoVale & {
  lojaNome: string | null
  documentHash: string
  canonico: string | null
  payload: unknown
  conflito: unknown
  criadoPorNome: string | null
  ip: string | null
  geolocalizacao: unknown
  /** Os quatro relógios da corrida. Servidor manda; dispositivo acompanha. */
  corrida: {
    saidaEm: string | null
    saidaEmLocal: string | null
    retornoEm: string | null
    retornoEmLocal: string | null
    status: string | null
  } | null
}

// As colunas que `RomaneioCompleto` exige, num lugar só. A página do
// romaneio e a sangria do dia montam o PDF pelo mesmo
// `montarRomaneioPdf`, então precisam exatamente do mesmo formato — duas
// listas de colunas que precisam concordar é a classe de divergência que
// este projeto já paga caro nos gêmeos do canônico.
const SELECT_ROMANEIO =
  'id, numero, status, modo, selado_em, ocorrido_em_local, recebido_em_servidor, ' +
  'final_hash, document_hash, canonico, payload, conflito, ip, geolocalizacao, ' +
  // Os quatro relógios da corrida. Existem desde 2026-08-10 e nunca
  // tiveram tela: são eles que dão retirada, retorno e, mais pra frente,
  // tempo médio de entrega. O do SERVIDOR é o que vale como fato
  // (`saida_em`/`retorno_em`, carimbados por trigger); o do dispositivo
  // fica ao lado porque o PC do balcão pode estar errado e a regra 8
  // manda guardar os dois.
  'corridas(saida_em, saida_em_local, retorno_em, retorno_em_local, status), ' +
  'lojas(nome), profiles(nome)'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRomaneio(r: any, assinaturas: AssinaturaDoRomaneio[]): RomaneioCompleto {
  return {
    romaneioId: r.id,
    numero: r.numero,
    status: r.status,
    modo: r.modo,
    seladoEm: r.selado_em,
    ocorridoEmLocal: r.ocorrido_em_local,
    recebidoEmServidor: r.recebido_em_servidor,
    finalHash: r.final_hash,
    documentHash: r.document_hash,
    canonico: r.canonico,
    payload: r.payload,
    conflito: r.conflito,
    lojaNome: r.lojas?.nome ?? null,
    criadoPorNome: r.profiles?.nome ?? null,
    ip: r.ip,
    geolocalizacao: r.geolocalizacao,
    corrida: r.corridas
      ? {
          saidaEm: r.corridas.saida_em,
          saidaEmLocal: r.corridas.saida_em_local,
          retornoEm: r.corridas.retorno_em,
          retornoEmLocal: r.corridas.retorno_em_local,
          status: r.corridas.status,
        }
      : null,
    assinaturas: [...assinaturas].sort((a, b) => ordemDeAssinatura(a) - ordemDeAssinatura(b)),
  }
}

async function buscarRomaneio(romaneioId: string): Promise<RomaneioCompleto | null> {
  const { data, error } = await supabase
    .from('romaneios')
    .select(SELECT_ROMANEIO)
    .eq('id', romaneioId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const { data: assinaturas, error: erroAssinatura } = await supabase
    .from('assinaturas')
    .select(SELECT_ASSINATURAS)
    .eq('romaneio_id', romaneioId)
  if (erroAssinatura) throw erroAssinatura

  return mapRomaneio(data, (assinaturas as unknown as LinhaAssinatura[]).map(mapAssinatura))
}

export function useRomaneio(romaneioId: string | null) {
  return useQuery({
    queryKey: ['romaneio', romaneioId],
    queryFn: () => buscarRomaneio(romaneioId as string),
    enabled: !!romaneioId,
  })
}

// Teto explícito, como toda query deste projeto desde o item 13: o
// `max-rows` do PostgREST cortaria em silêncio. Um dia com mais de 200
// saídas numa filial não existe; se existir, a tela avisa em vez de
// arquivar metade sem ninguém notar.
export const TETO_SANGRIA = 200

/**
 * Os romaneios que o servidor RECEBEU na data escolhida, com tudo que o
 * PDF precisa.
 *
 * **Varre por `recebido_em_servidor`, arquiva por `ocorrido_em_local`** —
 * e a assimetria é o ponto, não descuido:
 *
 * - varrer pelo recebimento garante que **nada é perdido**. Cada romaneio
 *   chega ao servidor exatamente uma vez, num dia só, então a sangria
 *   daquele dia o alcança. Varrer pelo `ocorrido_em_local` abriria um
 *   buraco permanente: uma saída offline de segunda que sincroniza terça
 *   não entraria na sangria de terça (a data dela é segunda) e a de
 *   segunda já rodou sem ela — ninguém a pegaria nunca mais.
 * - arquivar pelo `ocorrido_em_local` põe o documento no dia em que a
 *   retirada aconteceu no balcão, que é o dia que alguém procura.
 *
 * O efeito prático é que a sangria de hoje pode subir um romaneio pra
 * pasta de ontem. Isso é o certo, e a tela diz quando acontece.
 *
 * É também a coluna do índice `(tenant_id, loja_id, recebido_em_servidor)`.
 */
async function buscarRomaneiosRecebidosEm(filtro: {
  data: string
  lojaId: string
}): Promise<RomaneioCompleto[]> {
  const inicio = new Date(`${filtro.data}T00:00:00`)
  const fim = new Date(`${filtro.data}T00:00:00`)
  fim.setDate(fim.getDate() + 1)

  let q = supabase
    .from('romaneios')
    .select(SELECT_ROMANEIO)
    .gte('recebido_em_servidor', inicio.toISOString())
    .lt('recebido_em_servidor', fim.toISOString())
    .order('recebido_em_servidor', { ascending: true })
    .limit(TETO_SANGRIA)

  // A RLS já prende caixa e gerente à própria filial; o filtro existe pro
  // ADMIN, que enxerga o tenant inteiro e precisa escolher de qual filial
  // está fazendo a sangria. Mesmo motivo do filtro em `Fechamento`.
  if (filtro.lojaId) q = q.eq('loja_id', filtro.lojaId)

  const { data, error } = await q
  if (error) throw error
  if (!data || data.length === 0) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas = data as any[]

  // Uma consulta pras assinaturas de todos, não uma por romaneio: a
  // sangria de um dia movimentado abriria dezenas de round-trips.
  const { data: assinaturas, error: erroAssinatura } = await supabase
    .from('assinaturas')
    .select(SELECT_ASSINATURAS)
    .in(
      'romaneio_id',
      linhas.map((r) => r.id)
    )
  if (erroAssinatura) throw erroAssinatura

  const porRomaneio = new Map<string, AssinaturaDoRomaneio[]>()
  for (const linha of assinaturas as unknown as LinhaAssinatura[]) {
    const lista = porRomaneio.get(linha.romaneio_id) ?? []
    lista.push(mapAssinatura(linha))
    porRomaneio.set(linha.romaneio_id, lista)
  }

  return linhas.map((r) => mapRomaneio(r, porRomaneio.get(r.id) ?? []))
}

export function useRomaneiosRecebidosEm(filtro: { data: string; lojaId: string }) {
  return useQuery({
    queryKey: ['romaneios-do-dia', filtro.data, filtro.lojaId],
    queryFn: () => buscarRomaneiosRecebidosEm(filtro),
  })
}

/**
 * O instante que decide em que pasta do dia o romaneio é arquivado.
 *
 * `ocorrido_em_local` primeiro porque a saída pertence ao dia em que ela
 * aconteceu no balcão. Ele é nullable, e `recebido_em_servidor` é a única
 * coluna garantida — por isso a cadeia termina nele.
 */
export function quandoAconteceu(r: RomaneioCompleto): string {
  return r.ocorridoEmLocal ?? r.seladoEm ?? r.recebidoEmServidor
}

export const AUTH_METHOD_LABEL: Record<string, string> = {
  sessao_autenticada: 'Sessão autenticada',
  physical_card_pin_server_verified: 'Cartão físico + PIN',
  physical_card_pin_offline_then_verified: 'Cartão físico + PIN, validado após sincronizar',
}
