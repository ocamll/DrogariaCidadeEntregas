import { useTodasAlteracoesPagamento } from '@/data/pagamentos'
import { AlteracaoPagamentoCard } from '@/components/AlteracaoPagamentoCard'

export function DivergenciasEntregas() {
  const { data, isLoading, isError, error } = useTodasAlteracoesPagamento()

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma divergência de pagamento registrada ainda.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((alteracao) => (
        <AlteracaoPagamentoCard key={alteracao.id} alteracao={alteracao} mostrarData />
      ))}
    </div>
  )
}
