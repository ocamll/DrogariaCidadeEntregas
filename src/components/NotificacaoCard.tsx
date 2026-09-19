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
      {/* A divergência CALCULADA no selo do retorno não tem justificativa
          de ninguém: o texto gravado é do sistema, e mostrá-lo entre aspas
          como "Justificativa" o faria parecer uma declaração digitada. A
          distinção sai de `origem`, que vem dos marcadores gravados — nunca
          do texto. */}
      {notificacao.origem === 'calculada_no_retorno' ? (
        <p className="mt-1 text-foreground/70">
          Registrada no retorno: o pagamento confirmado não bate com o previsto.
        </p>
      ) : (
        <p className="mt-1 text-muted-foreground">Justificativa: "{notificacao.justificativa}"</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {notificacao.origem === 'calculada_no_retorno'
          ? `Retorno recebido por ${notificacao.autorNome}`
          : notificacao.autorNome}{' '}
        ·{' '}
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
