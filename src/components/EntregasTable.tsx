import { Fragment, useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { AuthProfile } from '@/data/auth'
import type { EntregaRecente } from '@/data/entregas'
import { FORMA_PAGAMENTO_LABEL } from '@/data/pagamentos'
import { useCustodiaDosVales } from '@/data/romaneios'
import { CustodiaDoValeDetalhe } from '@/components/Custodia'
import { formatBRL } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { EntregaAcoesMenu } from '@/components/EntregaAcoesMenu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_rota: 'Em rota',
  entregue: 'Entregue',
  insucesso: 'Insucesso',
  cancelada: 'Cancelada',
}

// Cor por status. O caixa varre essa lista de relance procurando "o que
// ainda está de pé" — a cor faz esse trabalho antes da leitura. Tons
// claros com texto escuro (e o inverso no dark) pra não competir com o
// vermelho da marca, que é a cor do cabeçalho e dos botões de ação.
const STATUS_CLASSE: Record<string, string> = {
  pendente: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  em_rota: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100',
  entregue: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  insucesso: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100',
  cancelada: 'bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100',
}

// A linha inteira — do número do vale ao "⋮" — tem que caber na largura da
// tela, sem rolagem horizontal: o caixa está com fila no balcão e não vai
// arrastar tabela pro lado pra achar o menu de ações.
//
// A `Table` do shadcn põe `whitespace-nowrap` em toda célula, o que faz a
// tabela crescer até o texto mais longo e empurrar as últimas colunas pra
// fora. O orçamento de largura aqui é explícito: só cliente/endereço e
// forma de pagamento podem quebrar linha (é onde o texto é imprevisível);
// vale, dinheiro, status e data ficam inteiros, porque quebrar número é
// pior que apertar texto.
const COLUNA_TEXTO = 'whitespace-normal break-words'

// Linha de apoio (endereço embaixo do cliente, hora embaixo da data).
// NÃO usa `text-muted-foreground`: aquele cinza é claro demais pra
// informação que o caixa precisa ler de fato, e não só notar que existe.
// Continua mais leve que o texto principal, sem sumir.
const TEXTO_SECUNDARIO = 'text-xs text-foreground/70'

// Todas as colunas centralizam, menos **Cliente**: ali são duas linhas de
// texto livre (nome em cima, endereço embaixo) e centralizar deixaria as
// duas com recuo diferente uma da outra, irregular a cada linha da tabela.
// Texto corrido lê melhor a partir de uma margem fixa; número, status e
// data, que são curtos e de largura parecida, leem melhor centralizados.
const COLUNA_CENTRO = 'text-center'

// Cliente e endereço moram na MESMA coluna, empilhados. Eram duas colunas
// e juntas custavam ~360px pra dizer uma coisa só ("pra quem e onde");
// empilhar devolveu largura pro resto da tabela e é o que pagou a coluna
// "Registrado por" sem trazer a rolagem de volta.
export function EntregasTable({
  entregas,
  profile,
  mostrarData = false,
  // Na aba de transferências as colunas de venda (Compra e Pagamento) são
  // "—" em 100% das linhas: transferência não é compra e não cria
  // pagamento. Escondê-las devolve largura pras que dizem alguma coisa.
  ocultarVenda = false,
}: {
  entregas: EntregaRecente[]
  profile: AuthProfile
  mostrarData?: boolean
  ocultarVenda?: boolean
}) {
  // Uma query pra a lista inteira, nunca uma por linha — ver
  // useCustodiaDosVales. Vale sem romaneio simplesmente não aparece no
  // mapa, e aí a linha não ganha chevron.
  const { data: custodias } = useCustodiaDosVales(entregas.map((e) => e.id))
  const [expandido, setExpandido] = useState<string | null>(null)

  // A tabela não pode crescer: do número do vale ao "⋮" tem que caber na
  // tela (ver CLAUDE.md — a rolagem horizontal já foi bug uma vez, e a
  // largura mínima é medida em pixel). Por isso a custódia NÃO ganhou
  // coluna própria: o chevron entra dentro da coluna Vale, que é curta e
  // `nowrap`, e o detalhe abre numa linha inteira abaixo. Custo de
  // largura: ~14px, contra os ~120px que uma coluna custaria.
  const colunas = ocultarVenda ? 7 : 9

  if (entregas.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum vale encontrado.</p>
  }

  return (
    <Table>
      <TableHeader>
        {/* Centralizado coluna a coluna, e não por um seletor na linha:
            Cliente é a exceção (fica à esquerda), e um `[&>th]:text-center`
            na linha teria especificidade maior que um `text-left` na
            célula — a exceção perderia justamente pra regra que ela
            deveria contrariar. Título e conteúdo andam juntos: centralizar
            só um dos dois dá a mesma sensação de desalinho, invertida. */}
        <TableRow>
          <TableHead className={COLUNA_CENTRO}>Vale</TableHead>
          {/* Largura fixa aqui, e só aqui. Cliente é a única coluna
              alinhada à esquerda, então a sobra da tabela se acumulava
              toda de um lado só — o nome ficava colado na borda esquerda e
              o resto da linha longe. Nas outras, que são centralizadas, a
              folga se divide dos dois lados e não incomoda. Fixando esta,
              a sobra vai pras demais em vez de inchar justamente a que
              tem o texto mais comprido. */}
          <TableHead className="w-56">Cliente</TableHead>
          {!ocultarVenda && <TableHead className={COLUNA_CENTRO}>Compra</TableHead>}
          <TableHead className={COLUNA_CENTRO}>Entrega</TableHead>
          {!ocultarVenda && <TableHead className={COLUNA_CENTRO}>Pagamento</TableHead>}
          <TableHead className={COLUNA_CENTRO}>Status</TableHead>
          <TableHead className={COLUNA_CENTRO}>Usuário</TableHead>
          <TableHead className={COLUNA_CENTRO}>
            {mostrarData ? 'Data' : 'Horário'}
          </TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entregas.map((entrega) => {
          const divergiu = entrega.formasRealizadas.length > 0
          const textoPagamento = divergiu
            ? entrega.formasRealizadas.map((f) => FORMA_PAGAMENTO_LABEL[f]).join(' + ')
            : entrega.formaPrevista
              ? FORMA_PAGAMENTO_LABEL[entrega.formaPrevista]
              : '—'
          const transferencia = entrega.tipo === 'transferencia'
          const quando = new Date(entrega.ocorridoEmLocal)
          const dia = quando.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
          })
          const hora = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          const custodia = custodias?.get(entrega.id)
          const aberto = expandido === entrega.id
          return (
            <Fragment key={entrega.id}>
            {/* `align-top` em toda célula da linha: a TableCell do shadcn é
               `align-middle`, e numa linha onde Cliente e Data ocupam duas
               linhas e Compra/Entrega/Status ocupam uma, os de uma linha
               ficavam centralizados — uns 8px abaixo do nome do cliente.
               Cada coluna começava numa altura diferente e a linha inteira
               parecia torta. Alinhados pelo topo, todos partem do mesmo Y. */}
            <TableRow className="[&>td]:align-top">
              {/* só o número. O selo de transferência vive na coluna
                  Cliente: aqui ele dobrava a largura mínima da coluna por
                  causa de poucas linhas, e todo vale normal herdava esse
                  espaço vazio. */}
              <TableCell className={`font-medium tabular-nums ${COLUNA_CENTRO}`}>
                {custodia ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 hover:underline"
                    onClick={() => setExpandido(aberto ? null : entrega.id)}
                    title={`Custódia — romaneio ${custodia.numero}`}
                  >
                    {aberto ? (
                      <ChevronDown className="size-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0" />
                    )}
                    {entrega.numeroVale}
                  </button>
                ) : (
                  entrega.numeroVale
                )}
              </TableCell>
              {/* A largura vem do `w-56` no cabeçalho desta coluna — o
                  endereço longo quebra em duas linhas em vez de esticar a
                  coluna.

                  Na transferência o selo ocupa a primeira linha, no lugar
                  do nome do cliente: ali `cliente_nome` guarda só a filial
                  de destino, que já está dita por extenso na rota logo
                  abaixo ("Matriz para Filial 02"). Trocar um pelo outro
                  não esconde nada e ainda tira o selo da coluna Vale. */}
              <TableCell className={COLUNA_TEXTO}>
                {transferencia ? (
                  // `flex` e não bloco comum: como item de linha de texto, o
                  // selo herda o espaço de baseline e deixava a linha da
                  // transferência 2px mais alta que as demais.
                  <div className="flex">
                    {/* mesmo corpo de texto do nome do cliente (`text-sm
                        font-medium`), que é a linha que ele substitui —
                        `h-auto` porque a altura fixa do Badge foi feita
                        pro text-xs e cortaria o texto maior. */}
                    <Badge variant="secondary" className="h-auto py-0.5 text-sm font-medium">
                      Transferência
                    </Badge>
                  </div>
                ) : (
                  <div className="font-medium">{entrega.clienteNome}</div>
                )}
                <div className={TEXTO_SECUNDARIO}>{entrega.clienteEndereco}</div>
              </TableCell>
              {/* Transferência não tem venda (compra fica '—'), mas TEM valor
                  de entrega: quem leva o produto entre filiais é o motoboy da
                  agência, e ela cobra a tarifa por isso. */}
              {!ocultarVenda && (
                <TableCell className={`tabular-nums ${COLUNA_CENTRO}`}>
                  {transferencia ? '—' : formatBRL(entrega.valorCompraCents)}
                </TableCell>
              )}
              <TableCell className={`tabular-nums ${COLUNA_CENTRO}`}>
                {formatBRL(entrega.valorEntregaCents)}
              </TableCell>
              {!ocultarVenda && (
                <TableCell className={`${COLUNA_TEXTO} ${COLUNA_CENTRO}`}>
                  {textoPagamento}
                  {divergiu && (
                    <span className="ml-1 text-xs text-muted-foreground">(divergiu)</span>
                  )}
                </TableCell>
              )}
              <TableCell className={COLUNA_CENTRO}>
                <Badge
                  variant="secondary"
                  className={STATUS_CLASSE[entrega.statusEntrega] ?? ''}
                >
                  {STATUS_LABEL[entrega.statusEntrega] ?? entrega.statusEntrega}
                </Badge>
              </TableCell>
              <TableCell className={`${COLUNA_TEXTO} ${COLUNA_CENTRO}`}>
                {entrega.criadoPorNome ?? '—'}
              </TableCell>
              {/* Data em cima, hora embaixo, sempre — duas linhas explícitas
                  em vez de deixar a célula quebrar sozinha, que era o que
                  fazia um vale mostrar "10/08/26, 23:22" numa linha e o
                  vizinho em duas, dependendo da largura sobrando. */}
              <TableCell className={`tabular-nums ${COLUNA_CENTRO}`}>
                {mostrarData ? (
                  <div className="flex flex-col leading-tight">
                    <span>{dia}</span>
                    <span className={TEXTO_SECUNDARIO}>{hora}</span>
                  </div>
                ) : (
                  hora
                )}
              </TableCell>
              <TableCell className={COLUNA_CENTRO}>
                <EntregaAcoesMenu
                  entregaId={entrega.id}
                  numeroVale={entrega.numeroVale}
                  clienteNome={entrega.clienteNome}
                  tipo={entrega.tipo}
                  statusEntrega={entrega.statusEntrega}
                  formaEsperadaAtual={entrega.formaPrevista}
                  valorCents={entrega.valorCompraCents}
                  temReceita={entrega.temReceita}
                  profile={profile}
                />
              </TableCell>
            </TableRow>
            {aberto && custodia && (
              <TableRow>
                {/* Linha inteira, sem `whitespace-nowrap` e sem competir
                    por largura com as colunas de cima — é o que permite
                    mostrar assinatura, IP, geolocalização e hash sem
                    reabrir a discussão de largura da tabela. */}
                <TableCell colSpan={colunas} className="whitespace-normal p-2">
                  <CustodiaDoValeDetalhe custodia={custodia} />
                </TableCell>
              </TableRow>
            )}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}
