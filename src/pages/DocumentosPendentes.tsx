import type { AuthProfile } from '@/data/auth'
import {
  useDocumentosConvenioPendentes,
  useMarcarDocumentoConvenioRecebido,
  useReceitasPendentes,
  useMarcarReceitaRecebida,
} from '@/data/documentos'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

// A lista tem teto — se bateu nele, diz na cara em vez de deixar o caixa
// achar que acabou. Aparece só quando realmente há mais pendência.
function AvisoTemMais({ mostrar }: { mostrar: boolean }) {
  if (!mostrar) return null
  return (
    <p className="text-sm text-destructive">
      Há mais pendências do que cabe nesta lista — vai limpando as mais antigas (que aparecem
      primeiro) que o resto aparece.
    </p>
  )
}

function DocumentosConvenio({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useDocumentosConvenioPendentes()
  const marcarRecebido = useMarcarDocumentoConvenioRecebido()

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
  if (!data || data.itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum documento de convênio pendente.</p>
  }

  return (
    <>
    <AvisoTemMais mostrar={data.temMais} />
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vale</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Convênio</TableHead>
          <TableHead>Desde</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.itens.map((doc) => (
          <TableRow key={doc.id}>
            <TableCell>{doc.numeroVale}</TableCell>
            <TableCell>{doc.clienteNome}</TableCell>
            <TableCell>{doc.convenioNome ?? '—'}</TableCell>
            <TableCell>{formatarData(doc.ocorridoEmLocal)}</TableCell>
            <TableCell>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  marcarRecebido.mutate({
                    entregaId: doc.id,
                    recebidoPor: profile.id,
                    ocorridoEmLocal: new Date().toISOString(),
                  })
                }
              >
                Marcar recebido
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </>
  )
}

function ReceitasPendentes({ profile }: { profile: AuthProfile }) {
  const { data, isLoading, isError, error } = useReceitasPendentes()
  const marcarRecebida = useMarcarReceitaRecebida()

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>
  if (isError) return <p className="text-sm text-destructive">Não consegui carregar: {error.message}</p>
  if (!data || data.itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma receita pendente de devolução.</p>
  }

  return (
    <>
    <AvisoTemMais mostrar={data.temMais} />
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Vale</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Desde</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.itens.map((receita) => (
          <TableRow key={receita.id}>
            <TableCell>{receita.numeroVale}</TableCell>
            <TableCell>{receita.clienteNome}</TableCell>
            <TableCell>{formatarData(receita.ocorridoEmLocal)}</TableCell>
            <TableCell>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  marcarRecebida.mutate({
                    entregaId: receita.id,
                    recebidoPor: profile.id,
                    ocorridoEmLocal: new Date().toISOString(),
                  })
                }
              >
                Marcar devolvida
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </>
  )
}

export function DocumentosPendentes({ profile }: { profile: AuthProfile }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Documentos de convênio</h3>
        <DocumentosConvenio profile={profile} />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Receitas</h3>
        <ReceitasPendentes profile={profile} />
      </div>
    </div>
  )
}
