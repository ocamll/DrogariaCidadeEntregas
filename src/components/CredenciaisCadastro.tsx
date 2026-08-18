import { useEffect, useState } from 'react'
import type { AuthProfile } from '@/data/auth'
import { useMototaxistasCadastro, useAgenciasCadastro } from '@/data/cadastros'
import {
  useCredenciais,
  useEmitirCredencial,
  useRevogarCredencial,
  useRedefinirPin,
  credencialBloqueada,
  type Credencial,
  type CredencialEmitida,
} from '@/data/credenciais'
import { montarCartaoPdf } from '@/lib/cartaoPdf'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Dimensões do cartão CR80 (85,6 × 54mm), com 5mm de margem física de
// cada lado. As zonas de silêncio de 10X ficam DENTRO desta largura.
const LARGURA_MM = 75
const ALTURA_BARRA_MM = 16

// Piso comum de leitor laser 1D. Com o token v3 (22 dígitos, 156 módulos
// mais 20 de zona de silêncio) dá 0,426mm por módulo — 2,2x o piso. O v2
// dava 0,262mm (1,4x) e o v1 alfanumérico nem cabia: 431 módulos,
// 0,174mm. Ver o cabeçalho da migration 20260817130000.
const MODULO_MINIMO_MM = 0.19

// Faixa abaixo das barras pro token em texto, em unidades do viewBox
// (uma unidade = um módulo, hoje ≈ 0,43mm). Os números foram MEDIDOS, não
// estimados: a primeira tentativa usou fonte 10 e o texto saiu com 81,8mm
// — mais largo que o próprio cartão de 75mm, escapando pra fora do SVG.
//
// Como tudo aqui é medido em MÓDULOS, a faixa acompanha sozinha quando o
// token muda de tamanho: com o v3 a fonte cresceu junto com o módulo e o
// texto ficou com 51,1mm (11,9mm de folga de cada lado), num cartão de
// 22,6mm de altura total — longe dos 54mm do CR80. Conferido por
// `npx tsx scripts/cartao-pdf.spec.mts`, que recalcula os dois a cada
// execução em vez de confiar neste comentário.
const ESPACO_TEXTO_UNIDADES = 16
const FONTE_TOKEN_UNIDADES = 8
const BASE_TEXTO_UNIDADES = 12

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function CredenciaisCadastro({ profile: _profile }: { profile: AuthProfile }) {
  const { data: motoboys, isLoading, isError, error } = useMototaxistasCadastro()
  const { data: agencias } = useAgenciasCadastro()
  // O erro desta query precisa aparecer na tela, e não é zelo: sem isso,
  // uma falha (permissão, tabela fora do ar) renderiza "Sem cartão" em
  // todas as linhas — idêntico a "ninguém tem cartão". Numa tela de
  // segurança, os dois estados não podem se parecer.
  const { data: credenciais, isError: credenciaisComErro, error: erroCredenciais } = useCredenciais()

  const emitir = useEmitirCredencial()
  const revogar = useRevogarCredencial()
  const redefinir = useRedefinirPin()

  const [emitida, setEmitida] = useState<{ dados: CredencialEmitida; motoboyNome: string } | null>(
    null
  )
  const [confirmando, setConfirmando] = useState<
    { acao: 'revogar' | 'redefinir'; credencial: Credencial; motoboyNome: string } | null
  >(null)

  const credencialDe = (motoboyId: string) => credenciais?.find((c) => c.motoboyId === motoboyId)
  const nomeAgencia = (agenciaId: string | null) =>
    agencias?.find((a) => a.id === agenciaId)?.nome ?? '—'

  // Só motoboy ativo: emitir cartão pra quem está desativado seria
  // imprimir papel que o próprio banco recusa (emitir_credencial barra).
  const ativos = motoboys?.filter((m) => m.ativo) ?? []

  async function handleEmitir(motoboyId: string, motoboyNome: string) {
    const dados = await emitir.mutateAsync(motoboyId)
    setEmitida({ dados, motoboyNome })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        O cartão identifica o motoboy; o PIN prova que é ele. O PIN é criado pelo próprio motoboy no
        primeiro uso do cartão — ninguém aqui escolhe nem consegue ver.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>}
      {credenciaisComErro && (
        <p className="text-sm text-destructive">
          Não consegui ler as credenciais: {(erroCredenciais as Error).message} — a coluna “Cartão”
          abaixo não está confiável até isso resolver.
        </p>
      )}
      {!isLoading && !isError && ativos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum motoboy ativo. Cadastra um em Mototaxistas primeiro.
        </p>
      )}

      {ativos.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Motoboy</TableHead>
              <TableHead>Agência</TableHead>
              <TableHead>Cartão</TableHead>
              <TableHead>PIN</TableHead>
              <TableHead>Emitido em</TableHead>
              <TableHead>Último uso</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {ativos.map((motoboy) => {
              const credencial = credencialDe(motoboy.id)
              const bloqueada = credencial ? credencialBloqueada(credencial) : false

              return (
                <TableRow key={motoboy.id}>
                  <TableCell>{motoboy.nome}</TableCell>
                  <TableCell>{nomeAgencia(motoboy.agenciaId)}</TableCell>

                  <TableCell>
                    {credencial ? (
                      // Só os 4 últimos do public_id, nunca o token. É o
                      // suficiente pra casar o papel com a linha da tela.
                      <span className="font-mono text-xs">
                        ••••{credencial.publicId.slice(-4)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Sem cartão</span>
                    )}
                  </TableCell>

                  <TableCell>
                    {!credencial && <span className="text-sm text-muted-foreground">—</span>}
                    {credencial && bloqueada && (
                      <Badge variant="destructive">
                        Bloqueado até {new Date(credencial.bloqueadoAte!).toLocaleTimeString('pt-BR')}
                      </Badge>
                    )}
                    {/* "Aguardando ativação" e não "sem PIN": o cartão
                        existe e está impresso, o que falta é o motoboy
                        criar o dele no primeiro uso. É o estado normal de
                        um cartão recém-emitido, não um problema. */}
                    {credencial && !bloqueada && (
                      <Badge variant={credencial.temPin ? 'secondary' : 'outline'}>
                        {credencial.temPin ? 'Configurado' : 'Aguardando ativação'}
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-foreground/70">
                    {credencial ? new Date(credencial.emitidoEm).toLocaleDateString('pt-BR') : '—'}
                  </TableCell>

                  <TableCell className="text-xs text-foreground/70">
                    {credencial?.ultimoUsoEm
                      ? new Date(credencial.ultimoUsoEm).toLocaleString('pt-BR')
                      : credencial
                        ? 'nunca'
                        : '—'}
                  </TableCell>

                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {credencial && credencial.temPin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setConfirmando({
                              acao: 'redefinir',
                              credencial,
                              motoboyNome: motoboy.nome,
                            })
                          }
                        >
                          Redefinir PIN
                        </Button>
                      )}
                      {credencial && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setConfirmando({
                              acao: 'revogar',
                              credencial,
                              motoboyNome: motoboy.nome,
                            })
                          }
                        >
                          Revogar
                        </Button>
                      )}
                      <Button
                        variant={credencial ? 'ghost' : 'default'}
                        size="sm"
                        disabled={emitir.isPending}
                        onClick={() => void handleEmitir(motoboy.id, motoboy.nome)}
                      >
                        {credencial ? 'Emitir novo' : 'Emitir cartão'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {emitir.isError && (
        <p className="text-sm text-destructive">
          Não consegui emitir: {(emitir.error as Error).message}
        </p>
      )}

      {emitida && (
        <CartaoEmitidoDialog
          emitida={emitida.dados}
          motoboyNome={emitida.motoboyNome}
          onFechar={() => setEmitida(null)}
        />
      )}

      {confirmando && (
        <ConfirmarAcaoDialog
          acao={confirmando.acao}
          motoboyNome={confirmando.motoboyNome}
          pendente={revogar.isPending || redefinir.isPending}
          onConfirmar={async () => {
            if (confirmando.acao === 'revogar') {
              await revogar.mutateAsync(confirmando.credencial.id)
            } else {
              await redefinir.mutateAsync(confirmando.credencial.id)
            }
            setConfirmando(null)
          }}
          onFechar={() => setConfirmando(null)}
        />
      )}
    </div>
  )
}

// =====================================================================
// O cartão recém-emitido
//
// Esta tela é a ÚNICA vez que o token existe fora do papel. O banco
// guarda só o HMAC, então fechar sem salvar significa emitir outro —
// não há "ver de novo".
//
// Dimensionado pro CR80 (85,6 × 54mm), com 5mm de margem física de cada
// lado. Ver a nota de dimensionamento na migration 20260817120000: é ela
// que explica por que o token é numérico.
// =====================================================================

// O token em blocos: 42 dígitos corridos ninguém acompanha com o olho, e
// esse texto existe justamente pro caso de alguém precisar digitá-lo
// quando o leitor falhar.
function tokenLegivel(token: string): string {
  return token.replace(/(.{6})/g, '$1 ').trim()
}

// Compõe o SVG final: código de barras + token, e nada mais.
//
// Sem nome de motoboy e sem filial, a pedido — um cartão perdido não deve
// dizer de quem é nem de onde veio. Quem casa o papel com a pessoa é o
// sistema, pelo public_id.
//
// O `<rect width="100%" height="100%">` que o bwip-js já põe acompanha o
// viewBox, então esticar a altura pra caber o texto mantém o fundo branco
// cobrindo tudo — não precisa de retângulo novo.
function comporCartao(svgDoCodigo: string, token: string, unidadesLargura: number, unidadesAltura: number) {
  const alturaTotal = unidadesAltura + ESPACO_TEXTO_UNIDADES
  // Escala uniforme: a largura física manda, e a altura acompanha o
  // viewBox. Nada é esticado numa direção só.
  const alturaMm = (LARGURA_MM * alturaTotal) / unidadesLargura

  const svg = svgDoCodigo
    .replace(
      `viewBox="0 0 ${unidadesLargura} ${unidadesAltura}"`,
      `viewBox="0 0 ${unidadesLargura} ${alturaTotal}" width="${LARGURA_MM}mm" height="${alturaMm.toFixed(2)}mm"`
    )
    .replace(
      '</svg>',
      `<text x="${unidadesLargura / 2}" y="${unidadesAltura + BASE_TEXTO_UNIDADES}" ` +
        `text-anchor="middle" font-family="Courier New, monospace" ` +
        `font-size="${FONTE_TOKEN_UNIDADES}" fill="#000000">${tokenLegivel(token)}</text>\n</svg>`
    )

  return { svg, alturaMm }
}

function CartaoEmitidoDialog({
  emitida,
  motoboyNome,
  onFechar,
}: {
  emitida: CredencialEmitida
  motoboyNome: string
  onFechar: () => void
}) {
  const [svg, setSvg] = useState<string | null>(null)
  const [erroBarras, setErroBarras] = useState<string | null>(null)
  const [moduloMm, setModuloMm] = useState<number | null>(null)
  const [alturaMm, setAlturaMm] = useState<number | null>(null)
  // Dimensões em MÓDULOS, guardadas porque o PDF desenha a partir delas.
  const [unidades, setUnidades] = useState<{ largura: number; altura: number } | null>(null)
  const [erroPdf, setErroPdf] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false

    async function gerar() {
      try {
        // Import dinâmico, mesmo padrão do exceljs e do jspdf: ~930 kB que
        // só descem quando um admin abre esta tela. Está em
        // optimizeDeps.include do vite.config pra o cache de deps não
        // vencer no meio da sessão em desenvolvimento.
        const bwipjs = await import('bwip-js/browser')
        if (cancelado) return

        const base = {
          bcid: 'code128',
          text: emitida.token,
          includetext: false,
          // 10 módulos de zona de silêncio de cada lado — o mínimo de 10X
          // da especificação, e ela mora DENTRO dos 75mm.
          paddingwidth: 10,
          paddingheight: 0,
          backgroundcolor: 'FFFFFF',
          // scale 1 faz a unidade do viewBox ser o MÓDULO, e não pixel.
          // Sem isso a conta da largura do módulo sairia pela metade, e
          // ela é o número que decide se o leitor lê.
          scale: 1,
        } as const

        // Duas passadas, e não uma: o bwip-js decide a proporção a partir
        // da altura em milímetros, e eu preciso do inverso — dada a
        // largura final de 75mm, qual altura natural faz as barras
        // saírem com 16mm depois do escalonamento UNIFORME.
        const primeira = bwipjs.default.toSVG({ ...base, height: ALTURA_BARRA_MM })
        const vb = primeira.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
        if (!vb) throw new Error('não consegui ler as dimensões do código gerado')

        const unidadesLargura = Number(vb[1])
        const unidadesAltura = Number(vb[2])

        // Quantos módulos INTEIROS cabem nos 16mm de barra. O bwip-js só
        // produz altura em número inteiro de módulos, então o alvo precisa
        // ser explícito e arredondado PRA BAIXO — deixar que ele arredonde
        // sozinho faz a barra estourar a área especificada. Com o token v2
        // isso passava despercebido (módulo pequeno, erro pequeno); com o
        // v3 o módulo é 1,6x maior e a barra saía com 16,19mm.
        const alvoUnidades = Math.floor((ALTURA_BARRA_MM * unidadesLargura) / LARGURA_MM)
        const alturaNatural = (ALTURA_BARRA_MM * alvoUnidades) / unidadesAltura

        const segunda = bwipjs.default.toSVG({ ...base, height: alturaNatural })
        const vb2 = segunda.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
        if (!vb2) throw new Error('não consegui ler as dimensões do código gerado')
        if (cancelado) return

        const composto = comporCartao(segunda, emitida.token, Number(vb2[1]), Number(vb2[2]))

        // Largura do módulo no papel: o número que decide se o leitor lê.
        // As 20 unidades das duas zonas de silêncio entram na conta,
        // porque ocupam largura dentro dos 75mm.
        setModuloMm(LARGURA_MM / unidadesLargura)
        setAlturaMm(composto.alturaMm)
        setUnidades({ largura: Number(vb2[1]), altura: Number(vb2[2]) })
        setSvg(composto.svg)
      } catch (e) {
        if (!cancelado) setErroBarras(e instanceof Error ? e.message : String(e))
      }
    }

    void gerar()
    return () => {
      cancelado = true
    }
  }, [emitida.token])

  function baixarSvg() {
    if (!svg) return
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    // O nome carrega só o public_id, que não é segredo — é o que permite
    // casar o arquivo com a linha da tela sem abri-lo.
    link.download = `cartao-${emitida.publicId}.svg`
    link.click()
    URL.revokeObjectURL(url)
  }

  // O PDF sai do MESMO svg que está na tela — ver a nota no topo de
  // cartaoPdf.ts. É o formato pra mandar pra gráfica: a fonte do token
  // não depende da máquina de quem abre e o preto é 100% K.
  async function baixarPdf() {
    if (!svg || !unidades) return
    setErroPdf(null)
    try {
      const bytes = await montarCartaoPdf(svg, tokenLegivel(emitida.token), {
        larguraMm: LARGURA_MM,
        unidadesLargura: unidades.largura,
        unidadesAltura: unidades.altura,
        espacoTextoUnidades: ESPACO_TEXTO_UNIDADES,
        baseTextoUnidades: BASE_TEXTO_UNIDADES,
        fonteTokenUnidades: FONTE_TOKEN_UNIDADES,
      })
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `cartao-${emitida.publicId}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      // Sem isto a falha seria um clique que não faz nada — e esta tela é
      // a única vez que o token existe fora do papel.
      setErroPdf(e instanceof Error ? e.message : String(e))
    }
  }

  const legivel = moduloMm !== null && moduloMm >= MODULO_MINIMO_MM

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Cartão de {motoboyNome}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">
              <strong>Salva ou imprime agora.</strong> O sistema guarda só uma impressão digital do
              cartão — este código não aparece de novo em lugar nenhum. Se fechar sem salvar, o
              caminho é emitir outro cartão.
            </p>
          </div>

          {/* O que está na tela é byte a byte o que o .svg contém — o token
              vive DENTRO do SVG, não numa linha de HTML ao lado. */}
          <div
            id="print-cartao"
            className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4 text-black"
          >
            {erroBarras ? (
              <div className="text-xs text-red-700">
                <p>Não consegui gerar o código de barras.</p>
                {/* "Failed to fetch dynamically imported module" quase
                    sempre é o cache de deps do Vite vencido, não defeito
                    do app — e a saída é recarregar. */}
                {erroBarras.includes('dynamically imported module') ? (
                  <p className="mt-1">
                    Recarrega a página (Ctrl+Shift+R) e emite de novo — o navegador está com uma
                    versão vencida de um arquivo.
                  </p>
                ) : (
                  <p className="mt-1">{erroBarras}</p>
                )}
              </div>
            ) : svg ? (
              // SVG no tamanho físico, não canvas esticado por CSS: em
              // vetor a escala é exata, sem reamostragem.
              <div dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <p className="text-xs">Gerando…</p>
            )}
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <p>
              Arquivo: <strong>{LARGURA_MM}mm × {alturaMm ? alturaMm.toFixed(1) : '…'}mm</strong>,
              com barras de {ALTURA_BARRA_MM}mm — cabe num CR80 (85,6 × 54mm) com 5mm de margem de
              cada lado.
            </p>
            {moduloMm !== null && (
              <p className={legivel ? 'text-xs text-foreground/70' : 'text-xs text-destructive'}>
                {moduloMm.toFixed(3)}mm por módulo.{' '}
                {legivel
                  ? 'Dentro do que um leitor laser comum lê, com folga.'
                  : `Abaixo de ${MODULO_MINIMO_MM}mm muitos leitores falham.`}
              </p>
            )}
            {/* O arquivo É o cartão: quem tiver ele consegue imprimir uma
                cópia funcional. O desenho todo parte de o token existir só
                no papel, e um .svg no disco (ainda mais dentro do OneDrive)
                estende isso indefinidamente. */}
            {/* Os dois arquivos têm o mesmo código; o que muda é o
                trajeto até a gráfica. Ver a nota no topo de cartaoPdf.ts. */}
            <p className="text-xs text-foreground/70">
              Pra mandar pra gráfica, use o <strong>PDF</strong>: o número embaixo das barras não
              depende de a máquina deles ter a fonte, e o preto já vai como 100% K, sem as outras
              três cores. Peça pra imprimir <strong>a 100%, sem redimensionar</strong>, em cartão
              branco. O .svg continua sendo o mesmo código, pra quem preferir editar em vetor.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Os dois arquivos contêm o código do cartão — quem tiver eles imprime uma cópia que
              funciona. Apaga depois de imprimir.
            </p>
            {erroPdf && (
              <p className="text-xs text-destructive">Não consegui gerar o PDF: {erroPdf}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Já salvei
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!svg}>
            Imprimir
          </Button>
          <Button variant="outline" onClick={baixarSvg} disabled={!svg}>
            Baixar .svg
          </Button>
          <Button onClick={baixarPdf} disabled={!svg || !unidades}>
            Baixar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmarAcaoDialog({
  acao,
  motoboyNome,
  pendente,
  onConfirmar,
  onFechar,
}: {
  acao: 'revogar' | 'redefinir'
  motoboyNome: string
  pendente: boolean
  onConfirmar: () => Promise<void>
  onFechar: () => void
}) {
  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {acao === 'revogar' ? 'Revogar o cartão' : 'Redefinir o PIN'} de {motoboyNome}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm">
          {acao === 'revogar' ? (
            <>
              O cartão para de funcionar na hora e não volta — para usar de novo, é preciso emitir um
              novo. As saídas que ele já assinou continuam intactas e seguem mostrando qual cartão
              foi usado.
            </>
          ) : (
            <>
              O PIN atual deixa de valer. O motoboy cria um novo no próximo uso do cartão, e ninguém
              aqui vê o que ele escolher. As assinaturas antigas não mudam.
            </>
          )}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant={acao === 'revogar' ? 'destructive' : 'default'}
            disabled={pendente}
            onClick={() => void onConfirmar()}
          >
            {pendente ? 'Aplicando…' : acao === 'revogar' ? 'Revogar' : 'Redefinir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
