import type { Notificacao } from '@/data/notificacoes'

export function NotificacaoCard({
  notificacao,
  mostrarData = false,
}: {
  notificacao: Notificacao
  mostrarData?: boolean
}) {
  const quando = new Date(notificacao.ocorridoEm)

  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className="font-medium">
        Vale {notificacao.numeroVale ?? '—'}
        {notificacao.clienteNome ? ` — ${notificacao.clienteNome}` : ''}
      </p>
      <p className="mt-1">{notificacao.resumo}</p>
      <p className="mt-1 text-muted-foreground">Justificativa: "{notificacao.justificativa}"</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {notificacao.autorNome} ·{' '}
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
