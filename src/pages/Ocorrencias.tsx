import { useTodasNotificacoes } from '@/data/notificacoes'
import { NotificacaoCard } from '@/components/NotificacaoCard'

export function Ocorrencias() {
  const { data, isLoading, isError, error } = useTodasNotificacoes()

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada ainda.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((notificacao) => (
        <NotificacaoCard key={notificacao.id} notificacao={notificacao} mostrarData />
      ))}
    </div>
  )
}
