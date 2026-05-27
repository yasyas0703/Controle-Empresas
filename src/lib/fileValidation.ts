// Validação centralizada de uploads. Antes, cada função em db.ts repetia
// "checa tamanho + checa extensão" sem magic-byte ou deny-list. Resultado:
// arquivo `.exe` renomeado `.xlsx` passava silenciosamente.
//
// IMPORTANTE — limitações conhecidas:
//
// 1. As validações client-side (browser) são DEFESA EM PROFUNDIDADE, não
//    segurança real. Um atacante usando DevTools pode pular essas checks
//    e mandar qualquer arquivo direto pro Supabase Storage. Pra defesa
//    real, o ideal é mover uploads pra rotas /api/upload/* server-side
//    com a mesma validação rodando antes do `storage.upload`.
//
// 2. Pra uploads que JÁ passam por rota API (enviar-anexo, enviar-guia),
//    chamar `validarMagicBytePdf` no buffer recebido — aí sim é defesa
//    server-side. Já implementado em
//    `src/app/api/checklist-fiscal/_shared.ts:temAssinaturaPdf`.

/** Magic bytes (primeiros bytes do arquivo) por formato. */
export const MAGIC_BYTES = {
  PDF: [0x25, 0x50, 0x44, 0x46], // %PDF
  // Office 2007+ (xlsx, docx, pptx) e qualquer .zip puro começam com `PK\x03\x04`
  ZIP: [0x50, 0x4b, 0x03, 0x04],
  // Office 97-2003 (xls, doc, ppt) — Compound File Binary Format
  OLE: [0xd0, 0xcf, 0x11, 0xe0],
  // Imagens comuns
  PNG: [0x89, 0x50, 0x4e, 0x47],
  JPEG: [0xff, 0xd8, 0xff],
} as const;

/**
 * Extensões EXPLICITAMENTE bloqueadas mesmo se aparecerem na allow-list
 * (defesa contra config errada). Inclui executáveis e arquivos que
 * navegadores renderizam (XSS via storage publicada acidentalmente).
 */
export const EXTENSOES_PERIGOSAS = new Set<string>([
  'exe', 'bat', 'cmd', 'com', 'msi', 'sh', 'bash', 'ps1', 'psm1',
  'app', 'dmg', 'pkg', 'deb', 'rpm',
  'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx',
  'html', 'htm', 'xhtml', 'shtml',
  'svg', // pode conter <script>
  'php', 'phtml', 'phar', 'asp', 'aspx', 'jsp',
  'py', 'rb', 'pl',
  'jar', 'war', 'ear',
  'dll', 'so', 'dylib',
]);

/** Extrai a extensão (lowercase, sem ponto) do nome do arquivo. */
export function extrairExtensao(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? (parts.pop() ?? '') : '';
}

/**
 * Confere que a extensão está na allow-list E NÃO está na deny-list de
 * perigosas. Ainda valida o nome contra extensão dupla (`foo.pdf.exe`).
 */
export function validarExtensaoSegura(
  filename: string,
  allowList: readonly string[],
): { ok: true } | { ok: false; motivo: string } {
  // Procura QUALQUER extensão perigosa no nome — defende contra `arquivo.pdf.exe`
  // onde extrairExtensao só pega a última (.exe).
  const partes = filename.toLowerCase().split('.').slice(1);
  for (const p of partes) {
    if (EXTENSOES_PERIGOSAS.has(p)) {
      return { ok: false, motivo: `Extensão "${p}" não é permitida por segurança.` };
    }
  }

  const ext = extrairExtensao(filename);
  if (!allowList.includes(ext)) {
    return { ok: false, motivo: `Tipo de arquivo não permitido (.${ext}). Permitidos: ${allowList.join(', ')}` };
  }
  return { ok: true };
}

/** Lê os primeiros N bytes de um File (browser) como Buffer-like Uint8Array. */
export async function lerPrimeirosBytes(file: File, n: number): Promise<Uint8Array> {
  const slice = file.slice(0, n);
  const buffer = await slice.arrayBuffer();
  return new Uint8Array(buffer);
}

/** True se o buffer começa com a sequência de bytes esperada. */
export function temMagicByte(bytes: Uint8Array, esperado: readonly number[]): boolean {
  if (bytes.length < esperado.length) return false;
  for (let i = 0; i < esperado.length; i += 1) {
    if (bytes[i] !== esperado[i]) return false;
  }
  return true;
}

/**
 * Confere se o conteúdo do arquivo bate com a extensão declarada.
 * Aceita qualquer um dos `formatos` (ex: PDF pode ser apenas %PDF; xlsx
 * pode ser ZIP ou OLE pra .xls antigo).
 *
 * Retorna `ok: true` se nenhum dos formatos exige magic byte conhecido
 * (ex: .csv, .txt — não têm assinatura padrão).
 */
export async function validarMagicByteFile(
  file: File,
  formatos: ReadonlyArray<keyof typeof MAGIC_BYTES>,
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  if (formatos.length === 0) return { ok: true };
  const bytes = await lerPrimeirosBytes(file, 8);
  for (const f of formatos) {
    if (temMagicByte(bytes, MAGIC_BYTES[f])) return { ok: true };
  }
  return {
    ok: false,
    motivo: `Conteúdo do arquivo não corresponde ao formato declarado (verifique se o arquivo não está corrompido ou renomeado).`,
  };
}

/**
 * Mapping ext → magic bytes esperados. Usado por `validarUploadCompleto`
 * pra escolher automaticamente quais magic bytes checar baseado na
 * extensão. Extensões textuais (csv, txt) não estão aqui — passam.
 */
const EXT_MAGIC_MAP: Record<string, ReadonlyArray<keyof typeof MAGIC_BYTES>> = {
  pdf: ['PDF'],
  xlsx: ['ZIP'],
  docx: ['ZIP'],
  pptx: ['ZIP'],
  xls: ['OLE'],
  doc: ['OLE'],
  ppt: ['OLE'],
  zip: ['ZIP'],
  png: ['PNG'],
  jpg: ['JPEG'],
  jpeg: ['JPEG'],
};

/** Tamanho + extensão segura (allow+deny-list) + magic-byte se aplicável. */
export async function validarUploadCompleto(
  file: File,
  opts: { maxSize: number; allowExt: readonly string[] },
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  if (file.size > opts.maxSize) {
    const mb = (opts.maxSize / 1024 / 1024).toFixed(0);
    return { ok: false, motivo: `O arquivo excede o limite de ${mb}MB.` };
  }
  const extOk = validarExtensaoSegura(file.name, opts.allowExt);
  if (!extOk.ok) return extOk;

  const ext = extrairExtensao(file.name);
  const magic = EXT_MAGIC_MAP[ext];
  if (magic) {
    const magicOk = await validarMagicByteFile(file, magic);
    if (!magicOk.ok) return magicOk;
  }
  return { ok: true };
}
