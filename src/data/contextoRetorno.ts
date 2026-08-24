import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { db, type ContextoRetornoEmCache } from '@/lib/db'

// =====================================================================
// O CONTEXTO DO RETORNO — os fatos ANTIGOS, selados na saída
//
// Tipo PRÓPRIO, e a separação de `EntradaRetorno` é o ponto:
//
//     ContextoRetorno   fatos antigos, do documento assinado, SÓ LEITURA
//     EntradaRetorno    fatos novos, que VÃO ser assinados
//
// Elas nunca se misturam. Um `{ ...contexto, ...entrada }` colocaria
// cliente, endereço e valor da compra dentro do DCRR1 — e o contrato do
// retorno diz, com todas as letras, que ele **assina só o que
// ACRESCENTA**: repetir o que a saída já selou criaria uma segunda fonte
// para o mesmo fato, capaz de discordar da primeira.
//
// Por isso nada daqui tem forma parecida com o que `paraJsonbRetorno`
// consome. Se um dia parecer conveniente espalhar um contexto dentro de
// uma entrada, é sinal de que os dois tipos precisam ficar ainda mais
// diferentes, não mais parecidos.
// =====================================================================

export type PagamentoPrevistoDoContexto = {
  pagamentoId: string
  forma: string
  valorCents: number
  trocoCents: number
}

export type ValeDoContexto = {
  entregaId: string
  /** Só exibição — o DCRR1 não pode ter a capacidade de afirmar o número. */
  numeroVale: string
  tipo: 'cliente' | 'transferencia'
  /** Do SNAPSHOT da saída, não de `entregas`. Ver a migration. */
  clienteNome: string
  clienteEndereco: string
  valorCompraCents: number
  valorEntregaCents: number
  /** Referência de conferência. O realizado é fato NOVO, e mora na entrada. */
  pagamentosPrevistos: PagamentoPrevistoDoContexto[]
  /** Exatamente os papéis que ESTA saída espera. A tela não cria outros. */
  documentosEsperados: Array<'convenio' | 'crediario'>
}

export type ContextoRetorno = {
  versao: 'CTXR1'
  corridaId: string
  saidaRomaneioId: string
  saidaNumero: string
  saidaDocumentHash: string
  motoboyId: string
  motoboyNome: string | null
  agenciaNome: string | null
  saidaEm: string | null
  vales: ValeDoContexto[]
}

// A forma crua que a RPC devolve. Tipo `Row` manual e estreito, mesmo
// padrão do resto de `src/data/*` até `supabase gen types` existir.
type ContextoRow = {
  versao: string
  corrida_id: string
  saida_romaneio_id: string
  saida_numero: string
  saida_document_hash: string
  motoboy_id: string
  motoboy_nome: string | null
  agencia_nome: string | null
  saida_em: string | null
  vales: Array<{
    entrega_id: string
    numero_vale: string
    tipo: 'cliente' | 'transferencia'
    cliente_nome: string
    cliente_endereco: string
    valor_compra_cents: number
    valor_entrega_cents: number
    pagamentos_previstos: Array<{
      pagamento_id: string
      forma: string
      valor_cents: number
      troco_cents: number
    }>
    documentos_esperados: Array<'convenio' | 'crediario'>
  }>
}

const VERSAO_SUPORTADA = 'CTXR1'

/**
 * Um contexto guardado por uma versão antiga do app é DESCARTADO, não
 * adivinhado. Montar o DCRR1 a partir de um formato que esta versão não
 * entende é a definição de assinar uma coisa e mandar outra.
 */
function converter(row: ContextoRow): ContextoRetorno | null {
  if (row.versao !== VERSAO_SUPORTADA) return null
  return {
    versao: VERSAO_SUPORTADA,
    corridaId: row.corrida_id,
    saidaRomaneioId: row.saida_romaneio_id,
    saidaNumero: row.saida_numero,
    saidaDocumentHash: row.saida_document_hash,
    motoboyId: row.motoboy_id,
    motoboyNome: row.motoboy_nome,
    agenciaNome: row.agencia_nome,
    saidaEm: row.saida_em,
    vales: row.vales.map((v) => ({
      entregaId: v.entrega_id,
      numeroVale: v.numero_vale,
      tipo: v.tipo,
      clienteNome: v.cliente_nome,
      clienteEndereco: v.cliente_endereco,
      valorCompraCents: v.valor_compra_cents,
      valorEntregaCents: v.valor_entrega_cents,
      pagamentosPrevistos: (v.pagamentos_previstos ?? []).map((p) => ({
        pagamentoId: p.pagamento_id,
        forma: p.forma,
        valorCents: p.valor_cents,
        trocoCents: p.troco_cents,
      })),
      documentosEsperados: v.documentos_esperados ?? [],
    })),
  }
}

async function buscarDoServidor(corridaId: string): Promise<ContextoRetorno | null> {
  const { data, error } = await supabase.rpc('obter_contexto_retorno', {
    p_corrida_id: corridaId,
  })
  if (error) throw error
  if (!data) return null
  return converter(data as unknown as ContextoRow)
}

// =====================================================================
// O CACHE, e por que ele não é otimização
//
// A 2C permite registrar retorno SEM INTERNET. Então a tela não pode
// depender de consultar o servidor no instante em que o motoboy volta —
// e esse instante é justamente o fim da tarde, no balcão.
//
// O contexto é imutável por construção (sai de um romaneio selado), o
// que o torna cacheável sem nenhuma das dúvidas de invalidação que um
// cache de dado vivo teria: ele não pode ficar velho, só pode não
// existir.
//
// **Sem contexto cacheado e sem rede, o retorno offline é BLOQUEADO com
// a razão dita.** Nada de montar o documento a partir do que houver em
// tabela local: seria inventar o que o motoboy recebeu. É a mesma
// decisão do §50.1 — a tela diz o que falta em vez de deixar o caixa
// concluir que o sistema perdeu alguma coisa.
// =====================================================================

export async function guardarContextoLocal(contexto: ContextoRetorno): Promise<void> {
  const registro: ContextoRetornoEmCache = {
    corridaId: contexto.corridaId,
    versao: contexto.versao,
    contexto,
    atualizadoEm: new Date().toISOString(),
  }
  await db.contextosRetorno.put(registro)
}

export async function lerContextoLocal(corridaId: string): Promise<ContextoRetorno | null> {
  const registro = await db.contextosRetorno.get(corridaId)
  if (!registro || registro.versao !== VERSAO_SUPORTADA) return null
  // O cast mora AQUI, e só aqui, porque é aqui que a versão foi
  // conferida. `ContextoRetornoEmCache.contexto` é `unknown` de
  // propósito: o tipo do banco local não deve depender do tipo de
  // domínio (senão `db.ts` passaria a importar `data/`), e um formato
  // antigo precisa ser REPRESENTÁVEL pra poder ser descartado. Tipá-lo
  // como `ContextoRetorno` lá em cima faria o TypeScript afirmar sobre
  // bytes que outra versão do app escreveu.
  return registro.contexto as ContextoRetorno
}

/**
 * Baixa e guarda o contexto de várias corridas de uma vez, pra o retorno
 * offline ter o que usar depois.
 *
 * Chamada quando a lista de corridas abertas carrega COM rede — mesmo
 * lugar e mesmo espírito de `aquecerGeolocalizacao()` e do cache de
 * credenciais da Nova Corrida: preparar enquanto dá, porque na hora não
 * vai dar.
 *
 * Falha de uma corrida não derruba as outras. Um contexto a menos é uma
 * corrida que não poderá ser fechada offline; um `throw` aqui seria uma
 * tela de erro por causa de uma preparação que ninguém pediu.
 */
export async function aquecerContextosDeRetorno(corridaIds: string[]): Promise<number> {
  let guardados = 0
  for (const id of corridaIds) {
    try {
      const contexto = await buscarDoServidor(id)
      if (contexto) {
        await guardarContextoLocal(contexto)
        guardados++
      }
    } catch {
      // Preparação é best-effort por definição.
    }
  }
  return guardados
}

export type ResultadoContexto =
  | { estado: 'carregando' }
  | { estado: 'pronto'; contexto: ContextoRetorno; origem: 'servidor' | 'cache' }
  /** Offline e sem cache: o retorno desta corrida não pode ser montado. */
  | { estado: 'indisponivel_offline' }
  | { estado: 'nao_encontrado' }
  | { estado: 'erro'; erro: Error }

/**
 * O contexto de UMA corrida, com o servidor primeiro e o cache como
 * rede de segurança.
 *
 * A `origem` sai no resultado de propósito. A tela não muda o que faz
 * com ela — o contexto é imutável dos dois jeitos —, mas quem estiver
 * depurando "por que este vale não aparece" precisa saber se está
 * olhando o que o servidor respondeu agora ou o que ficou guardado.
 */
export function useContextoRetorno(corridaId: string | null) {
  return useQuery({
    queryKey: ['contexto-retorno', corridaId],
    enabled: corridaId !== null,
    // Imutável por construção: não há o que revalidar.
    staleTime: Infinity,
    queryFn: async (): Promise<ResultadoContexto> => {
      if (!corridaId) return { estado: 'carregando' }

      const temRede = typeof navigator === 'undefined' || navigator.onLine
      if (temRede) {
        try {
          const contexto = await buscarDoServidor(corridaId)
          if (contexto) {
            await guardarContextoLocal(contexto)
            return { estado: 'pronto', contexto, origem: 'servidor' }
          }
          // O servidor respondeu e não há saída selada pra esta corrida.
          // Isso é resposta, não falta de dado — não vale cair no cache.
          return { estado: 'nao_encontrado' }
        } catch (erro) {
          // Rede prometida e não entregue: o cache ainda pode salvar.
          const local = await lerContextoLocal(corridaId)
          if (local) return { estado: 'pronto', contexto: local, origem: 'cache' }
          return { estado: 'erro', erro: erro instanceof Error ? erro : new Error(String(erro)) }
        }
      }

      const local = await lerContextoLocal(corridaId)
      if (local) return { estado: 'pronto', contexto: local, origem: 'cache' }
      return { estado: 'indisponivel_offline' }
    },
  })
}
