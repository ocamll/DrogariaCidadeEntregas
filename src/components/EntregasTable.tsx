import type { AuthProfile } from '@/data/auth'
import type { EntregaRecente } from '@/data/entregas'
import { FORMA_PAGAMENTO_LABEL } from '@/data/pagamentos'
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

// Cliente e endereço moram na MESMA coluna, empilhados. Eram duas colunas
// e juntas custavam ~360px pra dizer uma coisa só ("pra quem e onde");
// empilhar devolveu largura pro resto da tabela e é o que pagou a coluna
// "Registrado por" sem trazer a rolagem de volta.
export function EntregasTable({
  entregas,
  profile,
  mostrarData = false,
}: {
  entregas: EntregaRecente[]
  profile: AuthProfile
  mostrarData?: boolean
}) {
  if (entregas.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum vale encontrado.</p>
  }

  return (
    <Table>
      <TableHeader>
        {/* Cabeçalho centralizado junto com o corpo. Centralizar só um dos
            dois deixaria o título à esquerda e o dado no meio, que é a
            mesma sensação de desalinho, só invertida. A TableHead do
            shadcn nasce `text-left`, daí o override. */}
        <TableRow className="[&>th]:text-center">
          <TableHead>Vale</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Compra</TableHead>
          <TableHead>Entrega</TableHead>
          <TableHead>Pagamento</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Usuário</TableHead>
          <TableHead>{mostrarData ? 'Data' : 'Horário'}</TableHead>
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
          return (
            /* `align-top` em toda célula da linha: a TableCell do shadcn é
               `align-middle`, e numa linha onde Cliente e Data ocupam duas
               linhas e Compra/Entrega/Status ocupam uma, os de uma linha
               ficavam centralizados — uns 8px abaixo do nome do cliente.
               Cada coluna começava numa altura diferente e a linha inteira
               parecia torta. Alinhados pelo topo, todos partem do mesmo Y. */
            <TableRow key={entrega.id} className="[&>td]:align-top [&>td]:text-center">
              {/* nunca quebra: o selo fica ao lado do número, não embaixo */}
              <TableCell className="font-medium tabular-nums">
                {entrega.numeroVale}
                {transferencia && (
                  <Badge variant="secondary" className="ml-2 px-1.5 text-[10px]">
                    Transferência
                  </Badge>
                )}
              </TableCell>
              <TableCell className={COLUNA_TEXTO}>
                <div className="font-medium">{entrega.clienteNome}</div>
                <div className={TEXTO_SECUNDARIO}>{entrega.clienteEndereco}</div>
              </TableCell>
              {/* Transferência não tem venda (compra fica '—'), mas TEM valor
                  de entrega: quem leva o produto entre filiais é o motoboy da
                  agência, e ela cobra a tarifa por isso. */}
              <TableCell className="tabular-nums">
                {transferencia ? '—' : formatBRL(entrega.valorCompraCents)}
              </TableCell>
              <TableCell className="tabular-nums">{formatBRL(entrega.valorEntregaCents)}</TableCell>
              <TableCell className={COLUNA_TEXTO}>
                {textoPagamento}
                {divergiu && <span className="ml-1 text-xs text-muted-foreground">(divergiu)</span>}
              </TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className={STATUS_CLASSE[entrega.statusEntrega] ?? ''}
                >
                  {STATUS_LABEL[entrega.statusEntrega] ?? entrega.statusEntrega}
                </Badge>
              </TableCell>
              <TableCell className={COLUNA_TEXTO}>{entrega.criadoPorNome ?? '—'}</TableCell>
              {/* Data em cima, hora embaixo, sempre — duas linhas explícitas
                  em vez de deixar a célula quebrar sozinha, que era o que
                  fazia um vale mostrar "10/08/26, 23:22" numa linha e o
                  vizinho em duas, dependendo da largura sobrando. */}
              <TableCell className="tabular-nums">
                {mostrarData ? (
                  <div className="flex flex-col leading-tight">
                    <span>{dia}</span>
                    <span className={TEXTO_SECUNDARIO}>{hora}</span>
                  </div>
                ) : (
                  hora
                )}
              </TableCell>
              <TableCell>
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
          )
        })}
      </TableBody>
    </Table>
  )
}
