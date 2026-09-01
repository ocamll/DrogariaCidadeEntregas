import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import { useTransferencias, useEntregasRealtime, TAMANHO_PAGINA_HOJE } from '@/data/entregas'
import { EntregasTable } from '@/components/EntregasTable'
import { Paginacao, ResumoPagina } from '@/components/Paginacao'
import { Consulta } from '@/components/Consulta'
import { derivarEstado } from '@/lib/estadoDeConsulta'

// Aba própria das transferências entre filiais. Diferente de "Hoje", aqui
// não há corte por dia: o volume é baixo (uma filial pede produto pra
// outra algumas vezes por semana), então a mesma lista paginada serve pro
// movimento do dia e pra procurar uma transferência antiga.
//
// Gêmea da `ListaEntregas`, e tinha o mesmo defeito: com a query pausada,
// `data?.entregas ?? []` entregava lista vazia e a `EntregasTable`
// concluía "Nenhum vale encontrado". Foi uma das duas telas que serviram
// de CONTROLE NEGATIVO quando as outras quatro foram migradas — offline,
// no mesmo instante, ela mentia enquanto as migradas diziam a verdade.
export function ListaTransferencias({ profile }: { profile: AuthProfile }) {
  const [pagina, setPagina] = useState(1)
  const consulta = useTransferencias(pagina)
  const estado = derivarEstado(consulta)
  // mesma assinatura de Realtime da lista de entregas: o hook invalida
  // ['transferencias'] junto, então a página aberta se atualiza sozinha.
  useEntregasRealtime()

  return (
    <div className="flex flex-col gap-3">
      {/* Fora do `<Consulta>` de propósito: isto explica o que a ABA é, e
          continua verdadeiro mesmo sem resposta do servidor. */}
      <p className="text-sm text-muted-foreground">
        Vales de transferência entre filiais. A filial que pede é quem recebe o produto, assina
        o vale e paga a tele — a filial da rota é a que fornece.
      </p>

      <Consulta estado={estado} aoRecarregar={() => void consulta.refetch()}>
        {(resultado) => (
          <>
            {resultado.total > TAMANHO_PAGINA_HOJE && (
              <ResumoPagina
                pagina={pagina}
                tamanhoPagina={TAMANHO_PAGINA_HOJE}
                total={resultado.total}
                atualizando={consulta.isFetching}
              />
            )}
            {/* sem as colunas de venda: transferência não tem compra nem forma de
                pagamento, e as duas apareciam como "—" em toda linha */}
            <EntregasTable
              entregas={resultado.entregas}
              profile={profile}
              mostrarData
              ocultarVenda
            />
            <Paginacao pagina={pagina} totalPaginas={resultado.totalPaginas} onIr={setPagina} />
          </>
        )}
      </Consulta>
    </div>
  )
}
