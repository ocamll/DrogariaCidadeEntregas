import { useEffect, useRef, useState } from 'react'
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

// Code 128 gasta 11 módulos por caractere mais 35 de start/checksum/stop.
// O token tem 36 caracteres — DCM1(4) + . + public_id(10) + . + segredo(20)
// —, então são 431 módulos, e é isso que decide a largura física do papel.
// Conferido contra o `bwipjs.raw()` de verdade, não só pela fórmula. Ver a
// nota de dimensionamento na migration 20260816130000: foi essa conta que
// fez o segredo ser de 20 caracteres e não de 32.
const MODULOS_DO_CARTAO = 36 * 11 + 35

// 0,19mm por módulo é o piso comum de leitores laser 1D. Abaixo disso o
// código imprime bonito e não lê, que é a pior falha possível aqui —
// alguém descobre no balcão, com o motoboy esperando.
const MODULO_MINIMO_MM = 0.19

export function CredenciaisCadastro({ profile }: { profile: AuthProfile }) {
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
          farmaciaNome={profile.lojaNome ?? 'Drogaria Cidade'}
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
// guarda só o HMAC, então fechar sem imprimir significa emitir outro —
// não há "ver de novo". O aviso na tela diz isso com todas as letras.
// =====================================================================

function CartaoEmitidoDialog({
  emitida,
  motoboyNome,
  farmaciaNome,
  onFechar,
}: {
  emitida: CredencialEmitida
  motoboyNome: string
  farmaciaNome: string
  onFechar: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [erroBarras, setErroBarras] = useState<string | null>(null)
  const [larguraMm, setLarguraMm] = useState(90)

  const moduloMm = larguraMm / MODULOS_DO_CARTAO
  const legivel = moduloMm >= MODULO_MINIMO_MM

  useEffect(() => {
    let cancelado = false

    async function desenhar() {
      try {
        // Import dinâmico, mesmo padrão do exceljs e do jspdf: são ~197 kB
        // que só descem quando alguém abre esta tela, e o caixa nunca abre.
        const bwipjs = await import('bwip-js/browser')
        if (cancelado || !canvasRef.current) return

        bwipjs.default.toCanvas(canvasRef.current, {
          bcid: 'code128',
          text: emitida.token,
          scale: 3,
          height: 14,
          includetext: false,
          paddingwidth: 4,
          paddingheight: 4,
          // Sem isto o fundo sai transparente (conferido no navegador), e
          // aí o que aparece atrás das barras depende do tema e de o
          // usuário ter "imprimir cor de fundo" ligado. Branco explícito
          // tira as duas variáveis: leitor de código de barras precisa de
          // contraste, não de sorte.
          backgroundcolor: 'FFFFFF',
        })
      } catch (e) {
        if (!cancelado) setErroBarras(e instanceof Error ? e.message : String(e))
      }
    }

    void desenhar()
    return () => {
      cancelado = true
    }
  }, [emitida.token])

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cartão de {motoboyNome}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">
              <strong>Imprime agora.</strong> O sistema guarda só uma impressão digital do cartão —
              este código não aparece de novo em lugar nenhum. Se fechar sem imprimir, o caminho é
              emitir outro cartão.
            </p>
          </div>

          {/* O que vai pro papel. `print-cartao` é o que a folha imprime;
              o resto da tela é escondido pelo @media print no index.css. */}
          <div
            id="print-cartao"
            className="flex flex-col items-center gap-2 rounded-lg border bg-white p-4 text-black"
          >
            <p className="text-xs font-semibold tracking-wide uppercase">{farmaciaNome}</p>
            <p className="text-base font-semibold">{motoboyNome}</p>
            {erroBarras ? (
              <p className="text-xs text-red-700">
                Não consegui gerar o código de barras: {erroBarras}
              </p>
            ) : (
              <canvas ref={canvasRef} style={{ width: `${larguraMm}mm`, maxWidth: '100%' }} />
            )}
            {/* O token em texto embaixo do código não é enfeite: se o
                leitor falhar no balcão, ele pode ser digitado à mão. O
                alfabeto foi escolhido sem I, L, O e U justamente pra isso. */}
            <p className="font-mono text-[10px] tracking-tight break-all">{emitida.token}</p>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="largura" className="text-sm font-medium">
              Largura do código impresso: {larguraMm}mm
            </label>
            <input
              id="largura"
              type="range"
              min={70}
              max={120}
              step={1}
              value={larguraMm}
              onChange={(e) => setLarguraMm(Number(e.target.value))}
            />
            <p className={legivel ? 'text-xs text-foreground/70' : 'text-xs text-destructive'}>
              {moduloMm.toFixed(3)}mm por módulo.{' '}
              {legivel
                ? 'Dentro do que um leitor laser comum lê.'
                : `Abaixo de ${MODULO_MINIMO_MM}mm muitos leitores falham — aumenta a largura ou usa um cartão maior.`}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Já imprimi
          </Button>
          <Button onClick={() => window.print()}>Imprimir</Button>
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
