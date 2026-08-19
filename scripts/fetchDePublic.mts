// O dublê de `fetch` que os scripts usam pra ler os assets da marca.
//
// No app isso roda no navegador e busca de `/marca/...`; aqui lê o mesmo
// byte direto de `public/`. Existia copiado em cinco scripts, e a cópia
// deixou de ser inofensiva quando a logo de documento entrou como PNG
// solto: os dublês só sabiam devolver `text()`, e um `.png` precisa de
// `arrayBuffer()`. Cinco cópias significariam cinco lugares pra lembrar.
//
// Os dois métodos existem sempre, independentemente da extensão — quem
// consome é que escolhe, exatamente como faz com uma `Response` de
// verdade.
import { readFile } from 'node:fs/promises'

export function instalarFetchDePublic(): void {
  globalThis.fetch = (async (url: string) => {
    const caminho = 'public' + String(url)
    const bytes = await readFile(caminho)
    return {
      ok: true,
      status: 200,
      text: async () => bytes.toString('utf8'),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }) as unknown as typeof fetch
}
