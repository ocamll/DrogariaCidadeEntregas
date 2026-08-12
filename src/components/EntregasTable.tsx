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

// A linha inteira — do número do vale ao "⋮" — tem que caber na largura da
// tela, sem rolagem horizontal: o caixa está com fila no balcão e não vai
// arrastar tabela pro lado pra achar o menu de ações.
//
// A `Table` do shadcn põe `whitespace-nowrap` em toda célula, o que faz a
// tabela crescer até o tamanho do texto mais longo (endereço, quase
// sempre) e empurrar as últimas colunas pra fora. Aqui as colunas de texto
// livre voltam a poder quebrar linha: como a `<table>` é `w-full`, o
// layout automático encolhe justamente essas e o resto continua inteiro.
// Nada fica escondido — o endereço ocupa duas linhas em vez de sumir, que
// é o oposto do que truncar faria.
const COLUNA_TEXTO = 'whitespace-normal break-words'

const STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente',
  em_rota: 'Em rota',
  entregue: 'Entregue',
  insucesso: 'Insucesso',
  cancelada: 'Cancelada',
}

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
        <TableRow>
          <TableHead>Vale</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Endereço</TableHead>
          <TableHead>Compra</TableHead>
          <TableHead>Entrega</TableHead>
          <TableHead>Pagamento</TableHead>
          <TableHead>Status</TableHead>
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
          return (
            <TableRow key={entrega.id}>
              <TableCell className={COLUNA_TEXTO}>
                {entrega.numeroVale}
                {transferencia && (
                  <Badge variant="secondary" className="ml-2">
                    Transferência
                  </Badge>
                )}
              </TableCell>
              <TableCell className={COLUNA_TEXTO}>{entrega.clienteNome}</TableCell>
              <TableCell className={COLUNA_TEXTO}>{entrega.clienteEndereco}</TableCell>
              {/* Transferência não tem venda (compra fica '—'), mas TEM valor
                  de entrega: quem leva o produto entre filiais é o motoboy da
                  agência, e ela cobra a tarifa por isso. */}
              <TableCell>{transferencia ? '—' : formatBRL(entrega.valorCompraCents)}</TableCell>
              <TableCell>{formatBRL(entrega.valorEntregaCents)}</TableCell>
              <TableCell className={COLUNA_TEXTO}>
                {textoPagamento}
                {divergiu && <span className="ml-1 text-xs text-muted-foreground">(divergiu)</span>}
              </TableCell>
              <TableCell>{STATUS_LABEL[entrega.statusEntrega] ?? entrega.statusEntrega}</TableCell>
              {/* No histórico vem "10/08/26, 23:22" — a maior célula fixa da
                  tabela depois do endereço. Deixando quebrar, ela ocupa uma
                  linha só enquanto couber e vira data em cima / hora embaixo
                  quando a tela aperta, em vez de empurrar o "⋮" pra fora. */}
              <TableCell className={COLUNA_TEXTO}>
                {mostrarData
                  ? quando.toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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
