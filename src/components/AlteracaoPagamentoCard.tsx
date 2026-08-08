import { FORMA_PAGAMENTO_LABEL, type AlteracaoPagamento } from '@/data/pagamentos'
import { formatBRL } from '@/lib/money'

export function AlteracaoPagamentoCard({
  alteracao,
  mostrarData = false,
}: {
  alteracao: AlteracaoPagamento
  mostrarData?: boolean
}) {
  const quando = new Date(alteracao.ocorridoEm)

  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className="font-medium">
        Vale {alteracao.numeroVale ?? '—'}
        {alteracao.clienteNome ? ` — ${alteracao.clienteNome}` : ''}
      </p>
      <p className="mt-1">
        Era: {FORMA_PAGAMENTO_LABEL[alteracao.de]}. Virou:{' '}
        {alteracao.para
          .map((p) => `${FORMA_PAGAMENTO_LABEL[p.forma]} (${formatBRL(p.valorCents)})`)
          .join(' + ')}
        .
      </p>
      <p className="mt-1 text-muted-foreground">Justificativa: "{alteracao.justificativa}"</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {alteracao.autorNome} ·{' '}
        {mostrarData
          ? quando.toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </p>
    </div>
  )
}
