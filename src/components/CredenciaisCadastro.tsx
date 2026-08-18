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
import {
  generateMotoboyCredential,
  formatTokenForDisplay,
  type MotoboyCredentialData,
  type GeneratedCredential,
} from '@/lib/credencialMotoboy'
import { baixarSvg, baixarArquivo } from '@/lib/credencialDownload'
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

  const [emitida, setEmitida] = useState<{
    dados: CredencialEmitida
    motoboyNome: string
    agenciaNome: string
  } | null>(null)
  const [confirmando, setConfirmando] = useState<
    { acao: 'revogar' | 'redefinir'; credencial: Credencial; motoboyNome: string } | null
  >(null)

  const credencialDe = (motoboyId: string) => credenciais?.find((c) => c.motoboyId === motoboyId)
  const nomeAgencia = (agenciaId: string | null) =>
    agencias?.find((a) => a.id === agenciaId)?.nome ?? '—'

  // Só motoboy ativo: emitir cartão pra quem está desativado seria
  // imprimir papel que o próprio banco recusa (emitir_credencial barra).
  const ativos = motoboys?.filter((m) => m.ativo) ?? []

  // A agência entra aqui porque ela aparece IMPRESSA na credencial. Vem
  // do cadastro do motoboy, resolvida no mesmo lugar que a coluna da
  // tabela — uma fonte só.
  async function handleEmitir(motoboyId: string, motoboyNome: string, agenciaNome: string) {
    const dados = await emitir.mutateAsync(motoboyId)
    setEmitida({ dados, motoboyNome, agenciaNome })
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
                        onClick={() => void handleEmitir(motoboy.id, motoboy.nome, nomeAgencia(motoboy.agenciaId))}
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
        <CredencialEmitidaDialog
          emitida={emitida.dados}
          motoboyNome={emitida.motoboyNome}
          agenciaNome={emitida.agenciaNome}
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
// A credencial recém-emitida
//
// Esta tela é a ÚNICA vez que o token existe fora do papel. O banco
// guarda só o HMAC, então fechar sem salvar significa emitir outra —
// não há "ver de novo".
//
// O DESENHO NÃO MORA AQUI. Frente e verso vêm prontos de
// `src/lib/credencialMotoboy.ts`, que só substitui token, código de
// barras, nome e agência num modelo fixo. Este componente não desenha,
// não posiciona e não escolhe cor: ele mostra e entrega.
//
// A credencial substituiu o cartão de 75 × 20,2mm que só tinha código e
// token. Cartões daquele formato já impressos continuam válidos — o que
// autentica é o token, e ele não mudou.
// =====================================================================

function CredencialEmitidaDialog({
  emitida,
  motoboyNome,
  agenciaNome,
  onFechar,
}: {
  emitida: CredencialEmitida
  motoboyNome: string
  agenciaNome: string
  onFechar: () => void
}) {
  const [gerada, setGerada] = useState<GeneratedCredential | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const dados: MotoboyCredentialData = {
    tokenDisplay: formatTokenForDisplay(emitida.token),
    // O valor EXATO que o leitor precisa devolver. Nunca o formatado —
    // os espaços são só pro olho humano.
    barcodeValue: emitida.token,
    fullName: motoboyNome,
    agency: agenciaNome,
  }

  useEffect(() => {
    let cancelado = false
    generateMotoboyCredential(dados)
      .then((r) => {
        if (!cancelado) setGerada(r)
      })
      .catch((e) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emitida.token, motoboyNome, agenciaNome])

  async function baixarPdf() {
    if (!gerada) return
    setErro(null)
    setOcupado(true)
    try {
      // Só o PDF entra por import dinâmico: é ele que puxa os ~400 kB do
      // jspdf. O módulo de download é estático — misturar os dois estilos
      // no mesmo arquivo faz o Rolldown desistir de separar o chunk.
      const { montarCredencialPdf, carregarAssetsCredencial } = await import('@/lib/credencialPdf')
      const bytes = await montarCredencialPdf(dados, await carregarAssetsCredencial())
      baixarArquivo(
        new Blob([bytes], { type: 'application/pdf' }),
        `credencial-${emitida.publicId}.pdf`,
        'application/pdf'
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Credencial de {motoboyNome}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">
              <strong>Salva ou imprime agora.</strong> O sistema guarda só uma impressão digital do
              cartão — este código não aparece de novo em lugar nenhum. Se fechar sem salvar, o
              caminho é emitir outra credencial.
            </p>
          </div>

          {/* O que está na tela é byte a byte o que os arquivos contêm. */}
          {erro ? (
            <div className="text-xs text-red-700">
              <p>Não consegui gerar a credencial.</p>
              {erro.includes('dynamically imported module') ? (
                <p className="mt-1">
                  Recarrega a página (Ctrl+Shift+R) e emite de novo — o navegador está com uma
                  versão vencida de um arquivo.
                </p>
              ) : (
                <p className="mt-1">{erro}</p>
              )}
            </div>
          ) : gerada ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div
                className="w-full [&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: gerada.frontSvg }}
              />
              <div
                className="w-full [&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: gerada.backSvg }}
              />
            </div>
          ) : (
            <p className="text-xs">Gerando…</p>
          )}

          <div className="flex flex-col gap-1 text-sm">
            <p>
              Cartão <strong>85,6 × 54mm</strong> (CR80), com o código de barras em 75 × 15,767mm —
              0,426mm por módulo, mais que o dobro do que um leitor laser comum exige.
            </p>
            <p className="text-xs text-foreground/70">
              Pra gráfica, use o <strong>PDF</strong>: nele as fontes são as padrão do formato, não
              dependem de a máquina deles ter Consolas ou Arial, e o preto das barras vai como 100%
              K. Peça pra imprimir <strong>a 100%, sem redimensionar</strong>. Diga também qual
              vermelho vocês querem (Pantone ou CMYK) — o arquivo leva o da tela, em RGB.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Os arquivos contêm o código do cartão — quem tiver eles imprime uma cópia que
              funciona. Apaga depois de imprimir.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={onFechar}>
            Já salvei
          </Button>
          {/* Dois botões separados de propósito: alguns navegadores
              bloqueiam o segundo download disparado no mesmo gesto. */}
          <Button
            variant="outline"
            disabled={!gerada}
            onClick={() => gerada && baixarSvg(gerada.frontSvg, `credencial-${emitida.publicId}-frente.svg`)}
          >
            Baixar frente
          </Button>
          <Button
            variant="outline"
            disabled={!gerada}
            onClick={() => gerada && baixarSvg(gerada.backSvg, `credencial-${emitida.publicId}-verso.svg`)}
          >
            Baixar verso
          </Button>
          <Button onClick={() => void baixarPdf()} disabled={!gerada || ocupado}>
            {ocupado ? 'Gerando PDF…' : 'Baixar PDF'}
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
