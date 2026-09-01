import { useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import { useEntregasDeHoje, useEntregasRealtime, TAMANHO_PAGINA_HOJE } from '@/data/entregas'
import { EntregasTable } from '@/components/EntregasTable'
import { Paginacao, ResumoPagina } from '@/components/Paginacao'
import { Consulta } from '@/components/Consulta'
import { derivarEstado } from '@/lib/estadoDeConsulta'

// A TELA PÓS-LOGIN DO CAIXA — e por isso o defeito daqui era o mais caro
// dos nove.
//
// Ela dizia **"Nenhum vale encontrado"** com a query PAUSADA: offline e
// sem cache, `isLoading` vem `false` (é `isPending && isFetching`, e
// pausada não está fetching), então os dois early returns não pegavam, e
// `data?.entregas ?? []` entregava uma lista vazia pra `EntregasTable`,
// que concluía o que lhe pediram pra concluir.
//
// O caixa abria o sistema de manhã, com fila no balcão, e via o dia
// zerado.
//
// Repare que os dois `??` sumiram junto. Eles eram a mesma coisa numa
// outra sintaxe: inventar um valor pra quando não se sabe. Dentro do
// `ready` não há o que inventar — o dado está lá.
export function ListaEntregas({ profile }: { profile: AuthProfile }) {
  const [pagina, setPagina] = useState(1)
  const consulta = useEntregasDeHoje(pagina)
  const estado = derivarEstado(consulta)
  // Realtime invalida ['entregas-hoje'], que casa por prefixo com
  // ['entregas-hoje', pagina] — a página aberta se atualiza sozinha.
  useEntregasRealtime()

  return (
    // Sem `vazio` de propósito: quem é dono da frase "Nenhum vale
    // encontrado" é a `EntregasTable`, e ela continua sendo. O que muda é
    // que agora essa frase só é ALCANÇÁVEL de dentro do `ready` — o
    // `children` é função e só roda com dado em mãos. Duplicar o texto
    // aqui criaria a segunda cópia que sempre é a que envelhece.
    <Consulta estado={estado} aoRecarregar={() => void consulta.refetch()}>
      {(resultado) => (
        <div className="flex flex-col gap-3">
          {resultado.total > TAMANHO_PAGINA_HOJE && (
            <ResumoPagina
              pagina={pagina}
              tamanhoPagina={TAMANHO_PAGINA_HOJE}
              total={resultado.total}
              atualizando={consulta.isFetching}
            />
          )}
          <EntregasTable entregas={resultado.entregas} profile={profile} />
          <Paginacao pagina={pagina} totalPaginas={resultado.totalPaginas} onIr={setPagina} />
        </div>
      )}
    </Consulta>
  )
}
