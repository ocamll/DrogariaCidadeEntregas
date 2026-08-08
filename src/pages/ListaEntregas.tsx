import type { AuthProfile } from '@/data/auth'
import { useEntregasDeHoje, useEntregasRealtime } from '@/data/entregas'
import { EntregasTable } from '@/components/EntregasTable'

export function ListaEntregas({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useEntregasDeHoje()
  useEntregasRealtime()

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>

  return <EntregasTable entregas={data ?? []} profile={profile} />
}
