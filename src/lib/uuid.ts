// UUID v7 (RFC 9562): timestamp (ms) ordenável + aleatoriedade.
// Gerado no cliente para dar idempotência à fila offline — reenvio vira
// upsert, não duplicata. Sem dependência nova: é só bit-shuffling de bytes
// aleatórios do próprio navegador.
export function uuidv7(): string {
  const unixTsMs = BigInt(Date.now())
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((unixTsMs >> BigInt(40 - i * 8)) & 0xffn)
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x70 // versão 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variante RFC 4122

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
