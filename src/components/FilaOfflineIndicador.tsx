import { useFilaOperacoesPendentes, processarFilaOperacoes } from '@/data/filaOffline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function FilaOfflineIndicador() {
  const pendentes = useFilaOperacoesPendentes()

  if (pendentes.length === 0) return null

  const comErro = pendentes.some((item) => item.status === 'erro')

  return (
    <Button
      variant="outline"
      onClick={() => void processarFilaOperacoes()}
      className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
      title={
        comErro
          ? 'Alguns itens não sincronizaram ainda — clica pra tentar de novo.'
          : 'Gravado localmente, sincronizando…'
      }
    >
      {comErro ? 'Não sincronizado' : 'Sincronizando'}
      <Badge variant={comErro ? 'destructive' : 'secondary'} className="ml-1">
        {pendentes.length}
      </Badge>
    </Button>
  )
}
