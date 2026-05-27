// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  extrairExtensao,
  validarExtensaoSegura,
  temMagicByte,
  validarMagicByteFile,
  validarUploadCompleto,
  MAGIC_BYTES,
  EXTENSOES_PERIGOSAS,
} from './fileValidation';

function fakeFile(name: string, content: Uint8Array | string, sizeMB?: number): File {
  const buf = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const finalBuf = sizeMB ? new Uint8Array(sizeMB * 1024 * 1024) : buf;
  if (sizeMB) finalBuf.set(buf, 0);
  // `as BlobPart` porque TS estricto não aceita Uint8Array<ArrayBufferLike>
  // direto, mas Uint8Array é BlobPart válido em runtime (browser + node 18+).
  return new File([finalBuf as BlobPart], name, { type: 'application/octet-stream' });
}

describe('extrairExtensao', () => {
  it('extrai a última extensão lowercase', () => {
    expect(extrairExtensao('foo.pdf')).toBe('pdf');
    expect(extrairExtensao('FOO.PDF')).toBe('pdf');
    expect(extrairExtensao('a.b.c.xlsx')).toBe('xlsx');
  });

  it('retorna vazio se sem extensão', () => {
    expect(extrairExtensao('foo')).toBe('');
    expect(extrairExtensao('')).toBe('');
  });
});

describe('validarExtensaoSegura', () => {
  it('aceita extensão na allow-list', () => {
    expect(validarExtensaoSegura('foo.pdf', ['pdf', 'xlsx']).ok).toBe(true);
  });

  it('rejeita extensão fora da allow-list', () => {
    const r = validarExtensaoSegura('foo.txt', ['pdf']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/não permitido/i);
  });

  it('REJEITA extensão dupla com perigosa antes (`foo.pdf.exe`)', () => {
    const r = validarExtensaoSegura('foo.pdf.exe', ['exe']);
    // mesmo se .exe estivesse na allow-list (loucura), .exe está em EXTENSOES_PERIGOSAS
    expect(r.ok).toBe(false);
  });

  it('REJEITA `arquivo.exe.pdf` (perigosa no meio)', () => {
    // pdf na allow, .exe no meio → bloqueia
    const r = validarExtensaoSegura('arquivo.exe.pdf', ['pdf']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/exe/);
  });

  it('REJEITA .svg mesmo se passar na allow-list', () => {
    const r = validarExtensaoSegura('foo.svg', ['svg', 'png']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/svg/);
  });

  it('REJEITA .html, .js, .php (XSS / RCE via storage)', () => {
    expect(validarExtensaoSegura('a.html', ['html']).ok).toBe(false);
    expect(validarExtensaoSegura('a.js', ['js']).ok).toBe(false);
    expect(validarExtensaoSegura('a.php', ['php']).ok).toBe(false);
  });
});

describe('EXTENSOES_PERIGOSAS', () => {
  it('inclui executáveis comuns', () => {
    expect(EXTENSOES_PERIGOSAS.has('exe')).toBe(true);
    expect(EXTENSOES_PERIGOSAS.has('bat')).toBe(true);
    expect(EXTENSOES_PERIGOSAS.has('sh')).toBe(true);
    expect(EXTENSOES_PERIGOSAS.has('msi')).toBe(true);
  });

  it('inclui scripts servidor-side', () => {
    expect(EXTENSOES_PERIGOSAS.has('php')).toBe(true);
    expect(EXTENSOES_PERIGOSAS.has('asp')).toBe(true);
    expect(EXTENSOES_PERIGOSAS.has('jsp')).toBe(true);
  });

  it('inclui HTML/SVG (XSS)', () => {
    expect(EXTENSOES_PERIGOSAS.has('html')).toBe(true);
    expect(EXTENSOES_PERIGOSAS.has('svg')).toBe(true);
  });

  it('NÃO inclui formatos legítimos de planilha/PDF/imagem', () => {
    expect(EXTENSOES_PERIGOSAS.has('pdf')).toBe(false);
    expect(EXTENSOES_PERIGOSAS.has('xlsx')).toBe(false);
    expect(EXTENSOES_PERIGOSAS.has('png')).toBe(false);
    expect(EXTENSOES_PERIGOSAS.has('csv')).toBe(false);
  });
});

describe('temMagicByte', () => {
  it('match correto', () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]);
    expect(temMagicByte(buf, MAGIC_BYTES.PDF)).toBe(true);
  });

  it('match parcial não conta', () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44]);
    expect(temMagicByte(buf, MAGIC_BYTES.PDF)).toBe(false);
  });

  it('bytes diferentes', () => {
    const buf = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
    expect(temMagicByte(buf, MAGIC_BYTES.PDF)).toBe(false);
  });
});

describe('validarMagicByteFile', () => {
  it('PDF real passa em formato PDF', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new Array(20).fill(0)]);
    const file = new File([pdf], 'guia.pdf');
    expect((await validarMagicByteFile(file, ['PDF'])).ok).toBe(true);
  });

  it('xlsx (zip) passa em formato ZIP', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(20).fill(0)]);
    const file = new File([zip], 'planilha.xlsx');
    expect((await validarMagicByteFile(file, ['ZIP'])).ok).toBe(true);
  });

  it('REJEITA conteúdo de texto com extensão de PDF', async () => {
    const file = new File(['hello world'], 'fake.pdf');
    const r = await validarMagicByteFile(file, ['PDF']);
    expect(r.ok).toBe(false);
  });

  it('aceita qualquer dos formatos passados (xlsx ou xls antigo)', async () => {
    const oleFile = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'a.xls');
    expect((await validarMagicByteFile(oleFile, ['ZIP', 'OLE'])).ok).toBe(true);
  });

  it('lista vazia de formatos = sempre OK', async () => {
    const file = new File(['qualquer coisa'], 'foo.csv');
    expect((await validarMagicByteFile(file, [])).ok).toBe(true);
  });
});

describe('validarUploadCompleto', () => {
  it('PDF 1MB com nome .pdf passa', async () => {
    const pdfBytes = new Uint8Array(1024 * 1024);
    pdfBytes.set([0x25, 0x50, 0x44, 0x46], 0);
    const file = new File([pdfBytes], 'guia.pdf');
    const r = await validarUploadCompleto(file, { maxSize: 10 * 1024 * 1024, allowExt: ['pdf'] });
    expect(r.ok).toBe(true);
  });

  it('rejeita arquivo grande demais', async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    big.set([0x25, 0x50, 0x44, 0x46], 0);
    const file = new File([big], 'big.pdf');
    const r = await validarUploadCompleto(file, { maxSize: 10 * 1024 * 1024, allowExt: ['pdf'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/excede/i);
  });

  it('rejeita .exe renomeado .pdf (magic byte não bate)', async () => {
    const fake = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...new Array(100).fill(0)]); // MZ = PE/exe
    const file = new File([fake], 'malware.pdf');
    const r = await validarUploadCompleto(file, { maxSize: 10 * 1024 * 1024, allowExt: ['pdf'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/não corresponde/i);
  });

  it('rejeita arquivo.pdf.exe (deny-list)', async () => {
    const r = await validarUploadCompleto(fakeFile('arq.pdf.exe', new Uint8Array([0x25, 0x50, 0x44, 0x46])), {
      maxSize: 10 * 1024 * 1024,
      allowExt: ['pdf', 'exe'],
    });
    expect(r.ok).toBe(false);
  });

  it('csv passa mesmo sem magic byte mapeado', async () => {
    const file = new File(['col1,col2\nval1,val2'], 'dados.csv');
    const r = await validarUploadCompleto(file, { maxSize: 1024 * 1024, allowExt: ['csv'] });
    expect(r.ok).toBe(true);
  });

  it('extensão fora da allow-list = bloqueia', async () => {
    const file = new File(['hi'], 'foo.txt');
    const r = await validarUploadCompleto(file, { maxSize: 1024 * 1024, allowExt: ['pdf'] });
    expect(r.ok).toBe(false);
  });
});
