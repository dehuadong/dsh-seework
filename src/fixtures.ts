/** Shared test fixtures: real container headers so MIME sniffing is exercised. */

import { deflateSync } from 'node:zlib'
import type { GenerateRequest } from './protocol.ts'

/** CRC32 (PNG chunk checksum). */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** One PNG chunk: length, type, payload, CRC. */
function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * Build a structurally valid PNG of the requested size (the pixels are a flat
 * colour; only the header and IHDR matter to the code under test).
 */
export function pngBuffer(width = 64, height = 32): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const raw = Buffer.alloc((width * 3 + 1) * height)
  const idat = deflateSync(raw)
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

/** A data URL for a fixture PNG (what a reference image looks like on the wire). */
export function pngDataUrl(width = 64, height = 32): string {
  return `data:image/png;base64,${pngBuffer(width, height).toString('base64')}`
}

/** A normalized request: the shape a settled generation task always carries. */
export function fixtureRequest(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    mode: 'text',
    model: 'seedream-5-0-lite',
    prompt: '雪山下的木屋',
    resolution: '2K',
    aspectRatio: '16:9',
    outputFormat: 'png',
    n: 1,
    imageUrls: [],
    ...overrides,
  }
}
