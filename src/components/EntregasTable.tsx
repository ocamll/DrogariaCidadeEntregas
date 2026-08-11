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
              <TableCell>
                {entrega.numeroVale}
                {transferencia && (
                  <Badge variant="secondary" className="ml-2">
                    Transferência
                  </Badge>
                )}
              </TableCell>
              <TableCell>{entrega.clienteNome}</TableCell>
              <TableCell>{entrega.clienteEndereco}</TableCell>
              <TableCell>{transferencia ? '—' : formatBRL(entrega.valorCompraCents)}</TableCell>
              <TableCell>{transferencia ? '—' : formatBRL(entrega.valorEntregaCents)}</TableCell>
              <TableCell>
                {textoPagamento}
                {divergiu && <span className="ml-1 text-xs text-muted-foreground">(divergiu)</span>}
              </TableCell>
              <TableCell>{STATUS_LABEL[entrega.statusEntrega] ?? entrega.statusEntrega}</TableCell>
              <TableCell>
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
