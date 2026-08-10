import { Button } from '@/components/ui/button'

// Quantos números mostrar de cada lado da página atual. Com meses de
// vales a lista passa de 100 páginas — mostrar todas viraria uma parede
// de botões, então é uma janela deslizante com atalho pra primeira e pra
// última (1 … 5 6 [7] 8 9 … 84).
const JANELA_PAGINAS = 2

function paginasVisiveis(atual: number, total: number): number[] {
  const inicio = Math.max(1, atual - JANELA_PAGINAS)
  const fim = Math.min(total, atual + JANELA_PAGINAS)
  const paginas: number[] = []
  for (let p = inicio; p <= fim; p++) paginas.push(p)
  return paginas
}

export function Paginacao({
  pagina,
  totalPaginas,
  onIr,
}: {
  pagina: number
  totalPaginas: number
  onIr: (p: number) => void
}) {
  if (totalPaginas <= 1) return null

  const paginas = paginasVisiveis(pagina, totalPaginas)
  const primeira = paginas[0]
  const ultima = paginas[paginas.length - 1]

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="outline" size="sm" disabled={pagina === 1} onClick={() => onIr(pagina - 1)}>
        Anterior
      </Button>

      {primeira > 1 && (
        <>
          <Button variant="outline" size="sm" onClick={() => onIr(1)}>
            1
          </Button>
          {primeira > 2 && <span className="px-1 text-sm text-muted-foreground">…</span>}
        </>
      )}

      {paginas.map((p) => (
        <Button
          key={p}
          variant={p === pagina ? 'default' : 'outline'}
          size="sm"
          onClick={() => onIr(p)}
          aria-current={p === pagina ? 'page' : undefined}
        >
          {p}
        </Button>
      ))}

      {ultima < totalPaginas && (
        <>
          {ultima < totalPaginas - 1 && <span className="px-1 text-sm text-muted-foreground">…</span>}
          <Button variant="outline" size="sm" onClick={() => onIr(totalPaginas)}>
            {totalPaginas}
          </Button>
        </>
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={pagina === totalPaginas}
        onClick={() => onIr(pagina + 1)}
      >
        Próxima
      </Button>
    </div>
  )
}

// "Mostrando 51–100 de 4.183 vales" — o contador que faltava quando a
// lista era truncada em silêncio.
export function ResumoPagina({
  pagina,
  tamanhoPagina,
  total,
  atualizando = false,
}: {
  pagina: number
  tamanhoPagina: number
  total: number
  atualizando?: boolean
}) {
  if (total === 0) return null

  const primeiro = (pagina - 1) * tamanhoPagina + 1
  const ultimo = Math.min(pagina * tamanhoPagina, total)

  return (
    <p className="text-sm text-muted-foreground">
      Mostrando {primeiro}–{ultimo} de {total} vale{total > 1 ? 's' : ''}
      {atualizando && ' · atualizando…'}
    </p>
  )
}
