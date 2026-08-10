import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import { useEntregasDeHoje, useEntregasRealtime, TAMANHO_PAGINA_HOJE } from '@/data/entregas'
import { EntregasTable } from '@/components/EntregasTable'
import { Paginacao, ResumoPagina } from '@/components/Paginacao'

export function ListaEntregas({ profile }: { profile: AuthProfile }) {
  const [pagina, setPagina] = useState(1)
  const { data, isLoading, isError, error, isFetching } = useEntregasDeHoje(pagina)
  // Realtime invalida ['entregas-hoje'], que casa por prefixo com
  // ['entregas-hoje', pagina] — a página aberta se atualiza sozinha.
  useEntregasRealtime()

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>

  const total = data?.total ?? 0

  return (
    <div className="flex flex-col gap-3">
      {total > TAMANHO_PAGINA_HOJE && (
        <ResumoPagina
          pagina={pagina}
          tamanhoPagina={TAMANHO_PAGINA_HOJE}
          total={total}
          atualizando={isFetching}
        />
      )}
      <EntregasTable entregas={data?.entregas ?? []} profile={profile} />
      <Paginacao pagina={pagina} totalPaginas={data?.totalPaginas ?? 1} onIr={setPagina} />
    </div>
  )
}
