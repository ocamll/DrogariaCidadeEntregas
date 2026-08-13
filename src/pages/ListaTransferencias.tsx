import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import { useTransferencias, useEntregasRealtime, TAMANHO_PAGINA_HOJE } from '@/data/entregas'
import { EntregasTable } from '@/components/EntregasTable'
import { Paginacao, ResumoPagina } from '@/components/Paginacao'

// Aba própria das transferências entre filiais. Diferente de "Hoje", aqui
// não há corte por dia: o volume é baixo (uma filial pede produto pra
// outra algumas vezes por semana), então a mesma lista paginada serve pro
// movimento do dia e pra procurar uma transferência antiga.
export function ListaTransferencias({ profile }: { profile: AuthProfile }) {
  const [pagina, setPagina] = useState(1)
  const { data, isLoading, isError, error, isFetching } = useTransferencias(pagina)
  // mesma assinatura de Realtime da lista de entregas: o hook invalida
  // ['transferencias'] junto, então a página aberta se atualiza sozinha.
  useEntregasRealtime()

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>

  const total = data?.total ?? 0

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Vales de transferência entre filiais. A filial que pede é quem recebe o produto, assina
        o vale e paga a tele — a filial da rota é a que fornece.
      </p>
      {total > TAMANHO_PAGINA_HOJE && (
        <ResumoPagina
          pagina={pagina}
          tamanhoPagina={TAMANHO_PAGINA_HOJE}
          total={total}
          atualizando={isFetching}
        />
      )}
      {/* sem as colunas de venda: transferência não tem compra nem forma de
          pagamento, e as duas apareciam como "—" em toda linha */}
      <EntregasTable entregas={data?.entregas ?? []} profile={profile} mostrarData ocultarVenda />
      <Paginacao pagina={pagina} totalPaginas={data?.totalPaginas ?? 1} onIr={setPagina} />
    </div>
  )
}
