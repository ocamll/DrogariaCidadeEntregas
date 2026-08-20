import { cn } from '@/lib/utils'

/**
 * As três reticências de "sincronizando…", animadas.
 *
 * São três `<span>` de verdade em vez de um `…` com animação em cima, e
 * a razão é de layout: elas pulsam por opacidade e `translateY`, e os
 * três caracteres ficam SEMPRE ocupando o mesmo espaço. Animar aparecendo
 * e sumindo (`.` → `..` → `...`) faria a frase mudar de largura três
 * vezes por segundo, e num aviso que fica ao lado de outro texto isso
 * empurra a linha inteira.
 *
 * `aria-hidden` porque o conteúdo é decorativo — quem usa leitor de tela
 * já ouviu "sincronizando", e três pontos pulsando não acrescentam nada.
 *
 * A animação em si mora no `index.css` (`.reticencia`), inclusive o que
 * acontece sob `prefers-reduced-motion` — onde some o deslocamento, não
 * o sinal.
 */
export function Reticencias({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex', className)} aria-hidden="true">
      <span className="reticencia">.</span>
      <span className="reticencia">.</span>
      <span className="reticencia">.</span>
    </span>
  )
}
