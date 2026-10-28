// Minimal JPEG byte builders for tests: not decodable images, but a correct segment structure
// (SOI, optional segments, SOS header, entropy-coded data, EOI) which is all the Worker inspects.
const seg = (marker, payload) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload]
const ascii = (s) => [...Buffer.from(s, 'latin1')]

export const APP0 = seg(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0])
export const EXIF = seg(0xe1, [...ascii('Exif\0\0'), ...ascii('GPS-LATITUDE-4.60')]) // APP1: Exif/XMP
export const COMMENT = seg(0xfe, ascii('hello'))

// `parts` go between SOI and SOS; `size` pads the entropy-coded scan so the file is exactly that long.
export function jpeg({ parts = [APP0], size = 0, scan = [] } = {}) {
  const head = [0xff, 0xd8, ...parts.flat(), ...seg(0xda, [1, 1, 0, 0, 63, 0])]
  const tail = [0xff, 0xd9]
  const pad = Math.max(0, size - head.length - scan.length - tail.length)
  return Uint8Array.from([...head, ...scan, ...new Array(pad).fill(0x11), ...tail])
}
