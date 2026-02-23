'use client';

import React, { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, X, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { Empresa } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';
import { api } from '@/app/utils/api';
import * as db from '@/lib/db';

/**
 * Colunas fixas do export Domínio (0-indexed):
 *  0: Id (skip)
 *  1: Código
 *  2: Nome
 *  3: CNPJ / CPF
 *  4: Inscrição estadual
 *  5: Ativo/Inativo (skip)
 *  6: Regime federal
 *  7: Regime estadual
 *  8: Regime municipal
 *  9: CCM (skip)
 * 10+: Departamentos/responsáveis — detectados dinamicamente pelo cabeçalho
 */

/** Apenas esses departamentos serão importados (comparação case-insensitive) */
const CANONICAL_DEPTS = [
  'Cadastro',
  'Contábil',
  'Declarações',
  'Fiscal',
  'Parcelamentos',
  'Pessoal',
] as const;

type CanonicalDept = (typeof CANONICAL_DEPTS)[number];

/** Normaliza o Regime Federal vindo de CSV (ALL CAPS) para Title Case que o dropdown espera */
function normalizeRegimeFederal(raw: string): string {
  const val = raw.trim().toUpperCase();
  const map: Record<string, string> = {
    'SIMPLES NACIONAL': 'Simples Nacional',
    'LUCRO PRESUMIDO': 'Lucro Presumido',
    'LUCRO REAL': 'Lucro Real',
    'MEI': 'MEI',
  };
  return map[val] ?? raw.trim();
}

interface ParsedRow {
  codigo: string;
  razao_social: string;
  cnpj: string;
  inscricao_estadual: string;
  regime_federal: string;
  regime_estadual: string;
  regime_municipal: string;
  responsaveis: Record<string, string>; // dept name -> person name
}

function cleanQuotes(val: string): string {
  return val.replace(/^["']+|["']+$/g, '').trim();
}

function normalizeForMatch(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitDelimitedLine(line: string, separator: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // handle escaped quotes "" inside quoted fields
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === separator) {
      out.push(current);
      current = '';
      continue;
    }

    current += ch;
  }
  out.push(current);
  return out;
}

function canonicalDeptFromHeader(header: string): CanonicalDept | null {
  // IMPORTANTE: normalização LEVE — só remove acentos, NÃO remove ², ª, etc.
  // Isso é crucial para distinguir "Contábil" de "Contábil ²ª".
  const h = String(header || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  if (!h) return null;

  // IMPORTANTE: só aceitar a coluna PRINCIPAL do departamento.
  // Ex.: "Fiscal Guias", "Contábil ²ª", "Pessoal Guias" devem ser REJEITADAS.
  if (h === 'cadastro') return 'Cadastro';
  if (h === 'contabil') return 'Contábil';
  if (h === 'declaracoes' || h === 'declaracao') return 'Declarações';
  if (h === 'fiscal') return 'Fiscal';
  if (h === 'parcelamentos' || h === 'parcelamento') return 'Parcelamentos';
  if (h === 'pessoal') return 'Pessoal';

  return null;
}

function formatCnpjCpf(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return raw;
}

function parseFile(text: string): ParsedRow[] {
  // Detect separator: pick the one that produces the most columns in the header
  const firstLine = text.split(/\r?\n/)[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  let separator: string;
  if (semiCount >= tabCount && semiCount >= commaCount) {
    separator = ';';
  } else if (tabCount >= commaCount) {
    separator = '\t';
  } else {
    separator = ',';
  }
  console.log('[PARSE DEBUG] Separator counts — tab:', tabCount, 'semi:', semiCount, 'comma:', commaCount, '→ using:', JSON.stringify(separator));

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 1) return [];

  // Detectar colunas de departamento/responsáveis dinamicamente pelo cabeçalho
  // Observação: alguns exports trazem colunas variantes (ex.: "Fiscal Guias", "Contábil ²ª").
  // A pedido, aqui importamos SOMENTE as colunas principais (sem Guias/2ª).

  // ── Detectar se a primeira linha é cabeçalho ou dados ──
  // Se a primeira linha contém nomes de departamentos conhecidos (Cadastro, Contábil, Fiscal, etc.)
  // ou palavras-chave de cabeçalho (Id, Código, Nome, CNPJ), é um cabeçalho.
  // Caso contrário, o CSV não tem cabeçalho e usamos posições fixas do Gestta.
  const rawHeaderCols = splitDelimitedLine(lines[0], separator).map(cleanQuotes);
  const headerLower = rawHeaderCols.map((h) => (h || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const HEADER_KEYWORDS = ['id', 'codigo', 'nome', 'cnpj', 'inscricao estadual', 'ativo/inativo', 'cadastro', 'contabil', 'fiscal', 'pessoal', 'declaracoes', 'parcelamentos'];
  const headerHits = headerLower.filter((h) => HEADER_KEYWORDS.some((kw) => h === kw || h.startsWith(kw))).length;
  const hasHeader = headerHits >= 3; // se pelo menos 3 colunas parecem cabeçalho

  console.log(`%c[PARSE] DETECÇÃO DE CABEÇALHO: ${hasHeader ? '✅ TEM cabeçalho' : '⚠️ SEM cabeçalho — usando posições fixas do Gestta'}`, hasHeader ? 'color: green; font-weight: bold' : 'color: orange; font-weight: bold; font-size: 14px');
  console.log(`[PARSE] Header keyword hits: ${headerHits} de ${HEADER_KEYWORDS.length} (threshold: 3)`);

  // Posições fixas do formato Gestta (quando CSV não tem cabeçalho):
  // [0]=Id [1]=Código [2]=Nome [3]=CNPJ [4]=InscEst [5]=Ativo [6]=RegFed [7]=RegEst [8]=RegMun [9]=CCM [10]=Administrativo
  // [11]=Cadastro [12]=Contábil [13]=Contábil Guias [14]=Contábil ²ª [15]=Declarações [16]=Financeiro
  // [17]=Fiscal [18]=Fiscal Guias [19]=Fiscal Guias ²ª [20]=Parcelamentos
  // [21]=Pessoal [22]=Pessoal Guias [23]=Pessoal Guias 2ª [24]=Solicitação Fiscal Guias [25]=Teste [26]=Treinamento
  const GESTTA_DEPT_POSITIONS: Record<CanonicalDept, number[]> = {
    'Cadastro': [11],
    'Contábil': [12],
    'Declarações': [15],
    'Fiscal': [17],
    'Parcelamentos': [20],
    'Pessoal': [21],
  };

  let headerCols: string[];
  const deptColsByCanonical = new Map<CanonicalDept, number[]>();
  const rejectedHeaders: Array<{ col: number; name: string; reason: string }> = [];
  let dataLines: string[];

  if (hasHeader) {
    // CSV COM cabeçalho: detectar colunas dinamicamente
    headerCols = rawHeaderCols;
    for (let i = 0; i < headerCols.length; i++) {
      const name = headerCols[i]?.trim() ?? '';
      if (!name) continue;
      const canonical = canonicalDeptFromHeader(name);
      if (canonical) {
        const arr = deptColsByCanonical.get(canonical) ?? [];
        arr.push(i);
        deptColsByCanonical.set(canonical, arr);
      } else if (i >= 10) {
        rejectedHeaders.push({ col: i, name, reason: 'não é departamento canônico' });
      }
    }
    dataLines = lines.slice(1);
  } else {
    // CSV SEM cabeçalho: usar posições fixas do Gestta
    headerCols = [
      'Id', 'Código', 'Nome', 'CNPJ', 'Inscrição estadual', 'Ativo/inativo',
      'Regime federal', 'Regime estadual', 'Regime municipal', 'CCM', 'Administrativo',
      'Cadastro', 'Contábil', 'Contábil Guias', 'Contábil ²ª', 'Declarações', 'Financeiro',
      'Fiscal', 'Fiscal Guias', 'Fiscal Guias ²ª', 'Parcelamentos',
      'Pessoal', 'Pessoal Guias', 'Pessoal Guias 2ª', 'Solicitação Fiscal Guias', 'Teste', 'Treinamento',
    ];
    for (const [canonical, positions] of Object.entries(GESTTA_DEPT_POSITIONS)) {
      deptColsByCanonical.set(canonical as CanonicalDept, positions);
    }
    // Rejeitar as colunas de variantes
    const fixedRejected = [
      { col: 10, name: 'Administrativo' }, { col: 13, name: 'Contábil Guias' }, { col: 14, name: 'Contábil ²ª' },
      { col: 16, name: 'Financeiro' }, { col: 18, name: 'Fiscal Guias' }, { col: 19, name: 'Fiscal Guias ²ª' },
      { col: 22, name: 'Pessoal Guias' }, { col: 23, name: 'Pessoal Guias 2ª' },
      { col: 24, name: 'Solicitação Fiscal Guias' }, { col: 25, name: 'Teste' }, { col: 26, name: 'Treinamento' },
    ];
    for (const rj of fixedRejected) {
      rejectedHeaders.push({ col: rj.col, name: rj.name, reason: 'não é departamento canônico (posição fixa)' });
    }
    // SEM cabeçalho: TODAS as linhas são dados
    dataLines = lines;
  }

  console.log('%c═══════════════════════════════════════════════════════════', 'color: magenta; font-weight: bold');
  console.log('%c[PARSE] CABEÇALHO DO CSV', 'color: magenta; font-weight: bold; font-size: 14px');
  console.log('%c═══════════════════════════════════════════════════════════', 'color: magenta; font-weight: bold');
  console.log('[PARSE] Separador:', JSON.stringify(separator));
  console.log('[PARSE] Total de colunas no cabeçalho:', headerCols.length);
  console.log('[PARSE] TODAS as colunas (índice → nome):');
  headerCols.forEach((h, i) => console.log(`  [${i}] ${JSON.stringify(h)}`));
  console.log('%c[PARSE] COLUNAS ACEITAS (departamentos canônicos):', 'color: green; font-weight: bold');
  for (const [canonical, indices] of deptColsByCanonical) {
    console.log(`  ✅ ${canonical} → colunas [${indices.join(', ')}] (headers: ${indices.map(i => JSON.stringify(headerCols[i])).join(', ')})`);
  }
  console.log('%c[PARSE] COLUNAS REJEITADAS (NÃO importadas):', 'color: orange; font-weight: bold');
  for (const rj of rejectedHeaders) {
    console.log(`  ❌ [${rj.col}] ${JSON.stringify(rj.name)} — ${rj.reason}`);
  }

  let rowsWithNoResp = 0;
  let rowsWithPartialResp = 0;
  const problematicRows: Array<{ codigo: string; nome: string; deptsSemResp: string[]; colsRaw: Record<string, string> }> = [];

  const result = dataLines
    .map((line, lineIdx) => {
      const cols = splitDelimitedLine(line, separator).map(cleanQuotes);
      const codigo = cols[1] || '';
      const nome = cols[2] || '';
      const cnpj = cols[3] || '';

      if (!codigo && !nome && !cnpj) return null;

      const responsaveis: Record<string, string> = {};
      const deptsSemResp: string[] = [];
      const colsRawForDebug: Record<string, string> = {};

      for (const canonical of CANONICAL_DEPTS) {
        const indices = deptColsByCanonical.get(canonical) ?? [];
        let picked = '';
        for (const col of indices) {
          const val = String(cols[col] || '').trim();
          colsRawForDebug[`${canonical}[col${col}]`] = val || '(vazio)';
          if (val) { picked = val; break; }
        }
        if (picked) {
          responsaveis[canonical] = picked;
        } else if (indices.length > 0) {
          // Tem coluna mapeada mas valor vazio → departamento sem responsável
          // Incluir como string vazia para que a importação saiba que deve limpar
          responsaveis[canonical] = '';
          deptsSemResp.push(canonical);
        }
      }

      // Checar se existem valores nas colunas NÃO-mapeadas (Guias, ²ª, etc.) — para detectar se o CSV tem dados que estamos ignorando
      const allColsAfter10: Record<string, string> = {};
      for (let ci = 10; ci < cols.length; ci++) {
        const val = (cols[ci] || '').trim();
        if (val) allColsAfter10[`[${ci}]${headerCols[ci] || '?'}`] = val;
      }

      const totalDeptsCsv = Object.keys(responsaveis).length;
      if (totalDeptsCsv === 0 && Object.keys(allColsAfter10).length > 0) {
        rowsWithNoResp++;
        problematicRows.push({ codigo: codigo.trim(), nome: nome.trim(), deptsSemResp, colsRaw: allColsAfter10 });
      } else if (deptsSemResp.length > 0) {
        rowsWithPartialResp++;
      }

      // LOG DETALHADO PARA TODA EMPRESA
      console.log(
        `%c[PARSE ROW ${lineIdx + 1}] Cod=${codigo.trim()} | ${nome.trim().slice(0, 40)}`,
        totalDeptsCsv === 0 ? 'color: red; font-weight: bold' : deptsSemResp.length > 0 ? 'color: orange' : 'color: green',
        `| Responsáveis: ${JSON.stringify(responsaveis)}`,
        deptsSemResp.length > 0 ? `| DEPTS SEM RESP: [${deptsSemResp.join(', ')}]` : '',
      );

      return {
        codigo: codigo.trim(),
        razao_social: nome.trim(),
        cnpj: formatCnpjCpf(cnpj),
        inscricao_estadual: (cols[4] || '').trim(),
        regime_federal: normalizeRegimeFederal(cols[6] || ''),
        regime_estadual: (cols[7] || '').trim(),
        regime_municipal: (cols[8] || '').trim(),
        responsaveis,
      } satisfies ParsedRow;
    })
    .filter(Boolean) as ParsedRow[];

  // RESUMO FINAL DO PARSE
  console.log('%c═══════════════════════════════════════════════════════════', 'color: magenta; font-weight: bold');
  console.log('%c[PARSE] RESUMO DO PARSING', 'color: magenta; font-weight: bold; font-size: 14px');
  console.log('%c═══════════════════════════════════════════════════════════', 'color: magenta; font-weight: bold');
  console.log(`[PARSE] Total de linhas parseadas: ${result.length}`);
  console.log(`[PARSE] Empresas com TODOS os depts sem responsável (mas tem dados em cols não-mapeadas): ${rowsWithNoResp}`);
  console.log(`[PARSE] Empresas com ALGUNS depts sem responsável: ${rowsWithPartialResp}`);
  if (problematicRows.length > 0) {
    console.log('%c[PARSE] ⚠️ EMPRESAS PROBLEMÁTICAS (0 responsáveis mapeados, mas tem dados em colunas rejeitadas):', 'color: red; font-weight: bold; font-size: 13px');
    for (const pr of problematicRows) {
      console.log(`  🔴 Cod=${pr.codigo} | ${pr.nome}`);
      console.log(`     Depts canônicos sem valor: [${pr.deptsSemResp.join(', ')}]`);
      console.log(`     Colunas com valor (não-mapeadas):`, pr.colsRaw);
    }
  }

  // Log de todos os responsáveis únicos encontrados
  const allPeopleInParse = new Set<string>();
  for (const row of result) {
    for (const person of Object.values(row.responsaveis)) {
      if (person) allPeopleInParse.add(person);
    }
  }
  console.log(`[PARSE] Total de responsáveis únicos encontrados: ${allPeopleInParse.size}`);
  console.log('[PARSE] Lista:', Array.from(allPeopleInParse).sort().join(', '));

  return result;
}

interface ModalImportarPlanilhaProps {
  onClose: () => void;
}

export default function ModalImportarPlanilha({ onClose }: ModalImportarPlanilhaProps) {
  const { empresas, departamentos, criarDepartamento, usuarios, mostrarAlerta, reloadData } = useSistema();

  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, phase: '' });
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: number; deptCreated: string[] } | null>(null);

  const existingCodigos = new Set(empresas.map((e) => e.codigo));
  const empresaByCodigo = new Map(empresas.map((e) => [e.codigo, e]));

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setResult(null);

    // Tentar UTF-8 primeiro; se o resultado tiver caracteres corrompidos (�), retenta com Windows-1252
    const tryRead = (encoding: string) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (encoding === 'UTF-8' && text.includes('\uFFFD')) {
          console.log('[PARSE DEBUG] UTF-8 produziu caracteres corrompidos, tentando Windows-1252...');
          tryRead('windows-1252');
          return;
        }
        console.log('[PARSE DEBUG] Encoding usado:', encoding, '| Primeiros 200 chars:', text.slice(0, 200));
        const rows = parseFile(text);
        setParsed(rows);
      };
      reader.readAsText(file, encoding);
    };
    tryRead('UTF-8');
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleImport = async () => {
    setImporting(true);
    const newRows = parsed.filter((r) => !existingCodigos.has(r.codigo));
    const existingRows = parsed.filter((r) => existingCodigos.has(r.codigo));
    const deptCreated: string[] = [];

    const norm = (s: string) =>
      String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
    const slug = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '');

    const randomPassword = () => {
      const a = Math.random().toString(36).slice(2, 10);
      const b = Math.random().toString(36).slice(2, 10);
      return `${a}${b}`;
    };

    const onlyDigits = (s: string) => String(s || '').replace(/\D/g, '');

    const debugResolution = (
      row: ParsedRow,
      deptIdByName: Map<string, string>,
      userIdByName: Map<string, string>,
      normFn: (s: string) => string
    ) => {
      const issues: Array<{ deptName: string; personName: string; reason: string }> = [];
      const resolved: Record<string, string | null> = {};

      for (const [deptName, personName] of Object.entries(row.responsaveis)) {
        const deptKey = normFn(deptName);
        const deptId = deptIdByName.get(deptKey);
        if (!deptId) {
          issues.push({ deptName, personName, reason: 'departamento não encontrado (deptIdByName)' });
          continue;
        }
        // Se o CSV tem a coluna mas o valor está vazio, marcar como null (limpar responsável)
        if (!personName.trim()) {
          resolved[deptId] = null;
          continue;
        }
        const personKey = normFn(personName);
        const userId = userIdByName.get(personKey);
        if (!userId) {
          issues.push({ deptName, personName, reason: 'usuário não encontrado (userIdByName)' });
          resolved[deptId] = null;
          continue;
        }
        resolved[deptId] = userId;
      }

      return { resolved, issues };
    };

    // Ensure all departments from responsáveis exist (and keep a local name -> id map)
    // Coletar de TODAS as rows (novas + existentes) para poder atualizar responsáveis das existentes também
    const deptIdByName = new Map(departamentos.map((d) => [norm(d.nome), d.id]));
    const allDeptNames = new Set<string>();
    for (const row of parsed) {
      for (const deptName of Object.keys(row.responsaveis)) {
        allDeptNames.add(deptName);
      }
    }
    for (const deptName of allDeptNames) {
      const key = norm(deptName);
      if (!deptIdByName.has(key)) {
        const id = await criarDepartamento(deptName);
        if (id) deptIdByName.set(key, id);
        deptCreated.push(deptName);
      }
    }

    // Build a map: person name -> which department they appear in most (to auto-assign departamentoId)
    const personDeptCount = new Map<string, Map<string, number>>(); // norm(person) -> Map(norm(dept) -> count)
    for (const row of parsed) {
      for (const [deptName, personName] of Object.entries(row.responsaveis)) {
        const p = String(personName || '').trim();
        if (!p) continue;
        const pKey = norm(p);
        if (!personDeptCount.has(pKey)) personDeptCount.set(pKey, new Map());
        const dKey = norm(deptName);
        const counts = personDeptCount.get(pKey)!;
        counts.set(dKey, (counts.get(dKey) || 0) + 1);
      }
    }

    // For each person, find the department they appear in most
    const personBestDept = new Map<string, string>(); // norm(person) -> deptId
    for (const [pKey, deptCounts] of personDeptCount) {
      let best = '';
      let bestCount = 0;
      for (const [dKey, count] of deptCounts) {
        if (count > bestCount) { best = dKey; bestCount = count; }
      }
      const deptId = deptIdByName.get(best);
      if (deptId) personBestDept.set(pKey, deptId);
    }

    // Ensure all users referenced in responsáveis exist (local name -> id map)
    const userIdByName = new Map(usuarios.map((u) => [norm(u.nome), u.id]));
    const usedEmails = new Set(usuarios.map((u) => u.email.toLowerCase().trim()));

    // Map de primeiro nome → id (só quando único — evita ambiguidade)
    const userIdByFirstName = new Map<string, string>();
    for (const u of usuarios) {
      const firstName = norm(u.nome).split(' ')[0];
      if (!firstName) continue;
      if (userIdByFirstName.has(firstName)) {
        userIdByFirstName.set(firstName, '__ambiguo__');
      } else {
        userIdByFirstName.set(firstName, u.id);
      }
    }

    // Resolve nome da planilha → userId: primeiro tenta exato, depois pelo primeiro nome
    const resolveUserId = (nome: string): string | null => {
      const key = norm(nome);
      if (userIdByName.has(key)) return userIdByName.get(key)!;
      const firstName = key.split(' ')[0];
      if (firstName) {
        const id = userIdByFirstName.get(firstName);
        if (id && id !== '__ambiguo__') return id;
      }
      return null;
    };

    const allPeople = new Set<string>();
    for (const row of parsed) {
      for (const personName of Object.values(row.responsaveis)) {
        const p = String(personName || '').trim();
        if (p) allPeople.add(p);
      }
    }
    console.log('%c[IMPORT] CRIAÇÃO DE USUÁRIOS', 'color: yellow; font-weight: bold; font-size: 13px');
    console.log(`[IMPORT] Total de pessoas únicas no CSV: ${allPeople.size}`);
    const existingUserNames = new Set<string>();
    const newUserNames: string[] = [];
    const failedUserCreations: Array<{ name: string; key: string; reason: string }> = [];

    const peopleArray = Array.from(allPeople);
    // ── Separar quem já existe de quem precisa criar ──
    const usersToCreate: Array<{ nome: string; key: string; email: string; autoDeptId: string | null }> = [];
    for (const personName of peopleArray) {
      const key = norm(personName);
      const existingId = resolveUserId(personName);
      if (existingId !== null) {
        existingUserNames.add(personName);
        // Garantir que a chave exata também resolve corretamente
        if (!userIdByName.has(key)) userIdByName.set(key, existingId);
        continue;
      }

      const base = slug(personName) || 'usuario';
      let email = `${base}@importado.local`;
      let i = 2;
      while (usedEmails.has(email.toLowerCase())) {
        email = `${base}.${i}@importado.local`;
        i++;
      }
      usedEmails.add(email.toLowerCase());
      const autoDeptId = personBestDept.get(key) ?? null;
      usersToCreate.push({ nome: personName, key, email, autoDeptId });
    }

    console.log(`[IMPORT][USER] Já existem: ${existingUserNames.size} | A criar via batch: ${usersToCreate.length}`);

    // ── BATCH: criar todos os usuários de uma vez no servidor ──
    if (usersToCreate.length > 0) {
      setImportProgress({ done: 0, total: 1, phase: `Criando ${usersToCreate.length} usuários...` });
      try {
        const batchPayload = usersToCreate.map((u) => ({
          nome: u.nome,
          email: u.email,
          senha: randomPassword(),
          role: 'usuario' as const,
          departamentoId: u.autoDeptId,
          ativo: true,
        }));

        const batchResult = await db.insertUsuariosBatch(batchPayload);
        console.log('%c[IMPORT][USER] Resultado do batch:', 'color: cyan; font-weight: bold', batchResult.summary);

        for (const r of batchResult.results) {
          const key = norm(r.nome);
          if (r.id) {
            userIdByName.set(key, r.id);
            newUserNames.push(r.nome);
            console.log(`  ✅ ${r.status === 'created' ? 'Criado' : 'Existente'}: "${r.nome}" → ID ${r.id}`);
          } else {
            failedUserCreations.push({ name: r.nome, key, reason: r.error || 'Falha desconhecida' });
            console.error(`  ❌ FALHOU: "${r.nome}" — ${r.error}`);
          }
        }
      } catch (batchErr) {
        console.error('%c[IMPORT][USER] BATCH FALHOU! Tentando criação individual...', 'color: red; font-weight: bold', batchErr);

        // Fallback: criar um a um (para os que ainda não estão no mapa)
        for (let pi = 0; pi < usersToCreate.length; pi++) {
          const { nome: personName, key, email, autoDeptId } = usersToCreate[pi];
          if (userIdByName.has(key)) continue; // já criou no batch parcial

          if (pi > 0) await new Promise((r) => setTimeout(r, 800));

          let id: string | null = null;
          for (let attempt = 0; attempt < 5 && !id; attempt++) {
            if (attempt > 0) {
              await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 8000)));
            }
            try {
              const user = await db.insertUsuario({
                nome: personName,
                email,
                senha: randomPassword(),
                role: 'usuario' as const,
                departamentoId: autoDeptId,
                ativo: true,
              });
              id = user.id;
            } catch {
              id = null;
            }
          }
          if (id) {
            userIdByName.set(key, id);
            newUserNames.push(personName);
          } else {
            failedUserCreations.push({ name: personName, key, reason: 'Fallback individual falhou após 5 tentativas' });
          }
        }
      }
    }

    // ── FETCH FRESCO: recapturar TODOS os usuários do banco ──
    // Pega qualquer usuário criado no Auth+DB que não voltou corretamente na resposta.
    console.log('%c[IMPORT][USER] 🔄 Fazendo fetch fresco de todos os usuários...', 'color: cyan; font-weight: bold');
    try {
      const freshUsers = await db.fetchUsuariosAdmin();
      let recovered = 0;
      for (const u of freshUsers) {
        const uKey = norm(u.nome);
        if (!userIdByName.has(uKey)) {
          userIdByName.set(uKey, u.id);
          recovered++;
        }
      }
      console.log(`[IMPORT][USER] Fetch fresco: ${freshUsers.length} usuários no DB. Recuperados ${recovered} que faltavam no mapa.`);
      if (recovered > 0) {
        for (let fi = failedUserCreations.length - 1; fi >= 0; fi--) {
          if (userIdByName.has(failedUserCreations[fi].key)) {
            failedUserCreations.splice(fi, 1);
          }
        }
      }
    } catch (fetchErr) {
      console.error('[IMPORT][USER] Erro no fetch fresco de usuários (continuando com mapa parcial):', fetchErr);
    }

    console.log(`[IMPORT][USER] Resumo: ${existingUserNames.size} já existiam, ${newUserNames.length} criados, ${failedUserCreations.length} FALHARAM`);
    if (failedUserCreations.length > 0) {
      console.error('%c[IMPORT][USER] ⚠️ USUÁRIOS QUE NÃO FORAM CRIADOS:', 'color: red; font-weight: bold; font-size: 13px');
      for (const f of failedUserCreations) {
        console.error(`  🔴 "${f.name}" (key="${f.key}") — ${f.reason}`);
      }
    }

    let created = 0;
    let errors = 0;
    let failedUsers = 0;

    // Coletar todos os dept IDs para usar no insert
    const allDeptIds = Array.from(deptIdByName.values());

    console.log('%c═══════════════════════════════════════════════════════════', 'color: cyan; font-weight: bold');
    console.log('%c[IMPORT] INÍCIO DA IMPORTAÇÃO', 'color: cyan; font-weight: bold; font-size: 14px');
    console.log('%c═══════════════════════════════════════════════════════════', 'color: cyan; font-weight: bold');
    console.log('[IMPORT] Departamentos no sistema (nome normalizado → ID):');
    for (const [name, id] of deptIdByName) {
      console.log(`  📁 "${name}" → ${id}`);
    }
    console.log('[IMPORT] Usuários no sistema (nome normalizado → ID):');
    for (const [name, id] of userIdByName) {
      console.log(`  👤 "${name}" → ${id}`);
    }
    console.log(`[IMPORT] Novas empresas: ${newRows.length} | Existentes (atualizar): ${existingRows.length}`);

    const totalOps = newRows.length + existingRows.length;
    setImportProgress({ done: 0, total: totalOps, phase: 'Criando empresas...' });

    // ── Helper: retry com backoff (até 3 tentativas) ──
    const withRetry = async <T,>(fn: () => Promise<T>, label: string): Promise<T> => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await fn();
        } catch (err) {
          console.warn(`[IMPORT] ${label} falhou (tentativa ${attempt + 1}/3):`, err);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          else throw err;
        }
      }
      throw new Error('unreachable');
    };

    // ── CRIAR novas empresas (direct DB, sem log/notif individual) ──
    console.log('%c═══════════════════════════════════════════════════════════', 'color: lime; font-weight: bold');
    console.log('%c[IMPORT] CRIANDO NOVAS EMPRESAS', 'color: lime; font-weight: bold; font-size: 14px');
    console.log('%c═══════════════════════════════════════════════════════════', 'color: lime; font-weight: bold');
    const empresasComProblema: Array<{ codigo: string; nome: string; csvResp: Record<string, string>; resolved: Record<string, string | null>; issues: Array<{ deptName: string; personName: string; reason: string }> }> = [];

    for (let i = 0; i < newRows.length; i++) {
      const row = newRows[i];
      const { resolved: responsaveis, issues } = debugResolution(row, deptIdByName, userIdByName, norm);
      for (const iss of issues) {
        if (iss.reason.includes('usuário')) failedUsers++;
      }

      const hadRespInCsv = Object.keys(row.responsaveis).length > 0;
      const hasAnyResolved = Object.values(responsaveis).some((v) => !!v);
      const resolvedCount = Object.values(responsaveis).filter((v) => !!v).length;

      // LOG DETALHADO POR EMPRESA
      const logColor = !hadRespInCsv ? 'color: gray' : hasAnyResolved ? (issues.length > 0 ? 'color: orange' : 'color: green') : 'color: red; font-weight: bold';
      console.log(
        `%c[IMPORT][NEW ${i + 1}/${newRows.length}] Cod=${row.codigo} | ${row.razao_social.slice(0, 40)}`,
        logColor,
        `| CSV depts: ${JSON.stringify(row.responsaveis)}`,
        `| Resolvidos: ${resolvedCount}/${Object.keys(row.responsaveis).length}`,
        issues.length > 0 ? `| PROBLEMAS: ${issues.map(iss => `${iss.deptName}→"${iss.personName}": ${iss.reason}`).join('; ')}` : '',
      );

      if (issues.length > 0) {
        empresasComProblema.push({ codigo: row.codigo, nome: row.razao_social, csvResp: row.responsaveis, resolved: responsaveis, issues });
      }

      if (hadRespInCsv && !hasAnyResolved) {
        console.groupCollapsed(`%c  🔴 NENHUM vínculo resolvido para ${row.codigo}`, 'color: red; font-weight: bold');
        console.log('CSV responsaveis:', row.responsaveis);
        console.log('Resolvido (depId -> userId|null):', responsaveis);
        console.log('deptIdByName completo:', Object.fromEntries(deptIdByName));
        console.log('userIdByName completo:', Object.fromEntries(userIdByName));
        if (issues.length > 0) console.table(issues);
        console.groupEnd();
      }

      const cnpjDigits = onlyDigits(row.cnpj);

      const payload: Partial<Empresa> = {
        cadastrada: true,
        codigo: row.codigo,
        razao_social: row.razao_social || undefined,
        cnpj: row.cnpj || undefined,
        inscricao_estadual: row.inscricao_estadual || undefined,
        regime_federal: row.regime_federal || undefined,
        regime_estadual: row.regime_estadual || undefined,
        regime_municipal: row.regime_municipal || undefined,
        responsaveis,
        tipoInscricao: row.regime_federal === 'MEI' ? 'MEI' : cnpjDigits.length === 14 ? 'CNPJ' : cnpjDigits.length === 11 ? 'CPF' : '',
        tipoEstabelecimento: '',
        servicos: [],
        documentos: [],
        possuiRet: false,
        rets: [],
      };

      try {
        // Chamada DIRETA ao DB — pula log/notificação individual (economiza ~2 requests por empresa)
        await withRetry(() => db.insertEmpresa(payload, allDeptIds), `Criar ${row.codigo}`);
        created++;
      } catch (err) {
        console.error(`[IMPORT] ERRO ao criar empresa ${row.codigo}:`, err);
        errors++;
      }

      setImportProgress({ done: i + 1, total: totalOps, phase: `Criando empresas... (${i + 1}/${newRows.length})` });

      // Delay entre inserts para evitar rate-limit do Supabase
      if (i < newRows.length - 1) await new Promise((r) => setTimeout(r, 200));
    }

    // ── ATUALIZAR responsáveis das empresas existentes ──
    let updated = 0;
    setImportProgress((prev) => ({ ...prev, phase: 'Atualizando existentes...' }));
    console.log('%c═══════════════════════════════════════════════════════════', 'color: dodgerblue; font-weight: bold');
    console.log('%c[IMPORT] ATUALIZANDO EMPRESAS EXISTENTES', 'color: dodgerblue; font-weight: bold; font-size: 14px');
    console.log('%c═══════════════════════════════════════════════════════════', 'color: dodgerblue; font-weight: bold');

    for (let i = 0; i < existingRows.length; i++) {
      const row = existingRows[i];
      const empresa = empresaByCodigo.get(row.codigo);
      if (!empresa) {
        console.warn(`[IMPORT][UPD] Empresa ${row.codigo} não encontrada no sistema (empresaByCodigo). Pulando.`);
        continue;
      }

      const { resolved: resolvedMap, issues } = debugResolution(row, deptIdByName, userIdByName, norm);
      const responsaveis: Record<string, string | null> = {};
      let hasAny = false;
      for (const [depId, userIdOrNull] of Object.entries(resolvedMap)) {
        if (userIdOrNull) {
          // CSV tem responsável → atribuir
          responsaveis[depId] = userIdOrNull;
          hasAny = true;
        } else if (empresa.responsaveis[depId]) {
          // CSV está vazio mas empresa tem responsável → limpar
          responsaveis[depId] = null;
          hasAny = true;
        }
      }

      const hadRespInCsv = Object.keys(row.responsaveis).length > 0;
      const resolvedCount = Object.values(resolvedMap).filter((v) => !!v).length;
      const logColor = !hadRespInCsv ? 'color: gray' : hasAny ? (issues.length > 0 ? 'color: orange' : 'color: green') : 'color: red; font-weight: bold';
      console.log(
        `%c[IMPORT][UPD ${i + 1}/${existingRows.length}] Cod=${row.codigo} | ${row.razao_social.slice(0, 40)}`,
        logColor,
        `| CSV depts: ${JSON.stringify(row.responsaveis)}`,
        `| Resolvidos: ${resolvedCount}/${Object.keys(row.responsaveis).length}`,
        `| Vai atualizar: ${hasAny}`,
        issues.length > 0 ? `| PROBLEMAS: ${issues.map(iss => `${iss.deptName}→"${iss.personName}": ${iss.reason}`).join('; ')}` : '',
      );

      if (issues.length > 0) {
        empresasComProblema.push({ codigo: row.codigo, nome: row.razao_social, csvResp: row.responsaveis, resolved: resolvedMap, issues });
      }

      if (hadRespInCsv && !hasAny) {
        console.groupCollapsed(`%c  🔴 Empresa existente ${row.codigo}: CSV tem responsáveis, mas nenhuma mudança aplicável`, 'color: red; font-weight: bold');
        console.log('CSV responsaveis:', row.responsaveis);
        console.log('empresa.responsaveis atual:', empresa.responsaveis);
        console.log('resolvedMap (depId -> userId|null):', resolvedMap);
        console.log('deptIdByName completo:', Object.fromEntries(deptIdByName));
        console.log('userIdByName completo:', Object.fromEntries(userIdByName));
        if (issues.length > 0) console.table(issues);
        console.groupEnd();
      }

      if (hasAny) {
        try {
          await withRetry(() => db.updateEmpresa(empresa.id, { responsaveis }), `Atualizar ${row.codigo}`);
          updated++;
        } catch (err) {
          console.error(`[IMPORT] ERRO ao atualizar empresa ${row.codigo}:`, err);
          errors++;
        }
      }

      setImportProgress({ done: newRows.length + i + 1, total: totalOps, phase: `Atualizando existentes... (${i + 1}/${existingRows.length})` });

      if (i < existingRows.length - 1) await new Promise((r) => setTimeout(r, 200));
    }

    // ── RE-LINK PASS: re-vincular responsáveis que falharam na primeira passada ──
    // Após criar TODAS as empresas e usuários, faz uma segunda passada para garantir
    // que nenhuma empresa ficou sem responsáveis por timing/rate-limit.
    console.log('%c═══════════════════════════════════════════════════════════', 'color: hotpink; font-weight: bold');
    console.log('%c[RELINK] 🔗 RE-VINCULAÇÃO DE RESPONSÁVEIS', 'color: hotpink; font-weight: bold; font-size: 14px');
    console.log('%c═══════════════════════════════════════════════════════════', 'color: hotpink; font-weight: bold');
    setImportProgress((prev) => ({ ...prev, phase: 'Re-vinculando responsáveis...' }));

    let relinked = 0;
    for (const row of parsed) {
      const { resolved: responsaveis, issues } = debugResolution(row, deptIdByName, userIdByName, norm);
      const hasAnyUser = Object.values(responsaveis).some((v) => !!v);
      if (!hasAnyUser) continue; // nada para vincular

      try {
        // Buscar a empresa no banco pelo código
        const { data: empData } = await (await import('@/lib/supabase')).supabase
          .from('empresas')
          .select('id')
          .eq('codigo', row.codigo)
          .maybeSingle();
        if (!empData?.id) continue;

        // Verificar se os responsáveis atuais já estão corretos
        const { data: currentResps } = await (await import('@/lib/supabase')).supabase
          .from('responsaveis')
          .select('departamento_id, usuario_id')
          .eq('empresa_id', empData.id);

        const currentMap = new Map((currentResps || []).map((r: any) => [r.departamento_id, r.usuario_id]));
        let needsUpdate = false;
        for (const [depId, userId] of Object.entries(responsaveis)) {
          if (userId && currentMap.get(depId) !== userId) {
            needsUpdate = true;
            break;
          }
        }

        if (needsUpdate) {
          await withRetry(
            () => db.updateEmpresa(empData.id, { responsaveis }),
            `Relink ${row.codigo}`
          );
          relinked++;
          console.log(`[RELINK] ✅ ${row.codigo} — responsáveis re-vinculados`);
        }
      } catch (relinkErr) {
        console.warn(`[RELINK] ⚠️ Falha ao re-vincular ${row.codigo}:`, relinkErr);
      }

      // Pequeno delay para não sobrecarregar
      await new Promise((r) => setTimeout(r, 50));
    }
    console.log(`[RELINK] Total re-vinculados: ${relinked} de ${parsed.length} empresas`);

    // Recarregar tudo do banco (sincroniza state completo de uma vez)
    // Delay de 2s para dar tempo ao Supabase propagar escritas recentes (replication lag)
    setImportProgress((prev) => ({ ...prev, phase: 'Aguardando sincronização do banco...' }));
    await new Promise((r) => setTimeout(r, 2000));

    setImportProgress((prev) => ({ ...prev, phase: 'Sincronizando...' }));
    try {
      await reloadData();
      console.log('%c[IMPORT] ✅ reloadData() concluído com sucesso', 'color: green; font-weight: bold');
    } catch (reloadErr) {
      console.error('%c[IMPORT] ❌❌❌ reloadData() FALHOU! Os dados podem estar desatualizados na tela!', 'color: red; font-weight: bold; font-size: 14px');
      console.error('[IMPORT] Erro do reloadData:', reloadErr);
      // Tentar reloadData novamente após 3s
      await new Promise((r) => setTimeout(r, 3000));
      try {
        await reloadData();
        console.log('%c[IMPORT] ✅ reloadData() segunda tentativa OK', 'color: green; font-weight: bold');
      } catch (reloadErr2) {
        console.error('[IMPORT] reloadData segunda tentativa também falhou:', reloadErr2);
      }
    }

    // ═══ DIAGNÓSTICO PÓS-RELOAD: verificar se o state está correto ═══
    // Fazemos um fetch fresco DIRETO (não dependemos do React state que pode ser stale)
    console.log('%c═══════════════════════════════════════════════════════════', 'color: lime; font-weight: bold');
    console.log('%c[DIAG] 🔍 DIAGNÓSTICO PÓS-RELOAD (fetch direto)', 'color: lime; font-weight: bold; font-size: 14px');
    console.log('%c═══════════════════════════════════════════════════════════', 'color: lime; font-weight: bold');
    try {
      const diagUsers = await db.fetchUsuariosAdmin();
      const diagDepts = await db.fetchDepartamentos();
      const diagEmpresas = await db.fetchEmpresas();
      console.log(`[DIAG] Usuários no DB: ${diagUsers.length}`);
      console.log(`[DIAG] Departamentos no DB: ${diagDepts.length}`);
      console.log(`[DIAG] Empresas no DB: ${diagEmpresas.length}`);

      const diagUserMap = new Map(diagUsers.map(u => [u.id, u.nome]));
      const diagDeptMap = new Map(diagDepts.map(d => [d.id, d.nome]));

      // Checar TROPICAL GAS e outras empresas do CSV
      const checkCodes = ['382', '195', '224']; // Tropical Gas codes + primeiros do CSV
      const parsedCodes = parsed.slice(0, 5).map(r => r.codigo);
      const allChecks = [...new Set([...checkCodes, ...parsedCodes])];

      for (const code of allChecks) {
        const emp = diagEmpresas.find(e => e.codigo === code);
        if (!emp) continue;
        const respEntries = Object.entries(emp.responsaveis || {}).filter(([, uid]) => uid);
        const resolved = respEntries.map(([dId, uid]) => ({
          dept: diagDeptMap.get(dId) || `❌ DEPT ${dId.slice(0,8)} NÃO ENCONTRADO`,
          user: diagUserMap.get(uid!) || `❌ USER ${String(uid).slice(0,8)} NÃO ENCONTRADO`,
        }));
        console.log(`[DIAG] Cod=${code} | ${emp.razao_social?.slice(0,30)} | ${respEntries.length} resps → `,
          resolved.length > 0 ? resolved.map(r => `${r.dept}:${r.user}`).join(', ') : '⚠️ SEM RESPONSÁVEIS');
      }
    } catch (diagErr) {
      console.error('[DIAG] Erro no diagnóstico:', diagErr);
    }

    // ═══ VERIFICAÇÃO PÓS-IMPORT: consultar o banco diretamente ═══
    console.log('%c═══════════════════════════════════════════════════════════', 'color: gold; font-weight: bold');
    console.log('%c[VERIFY] 🔍 VERIFICAÇÃO PÓS-IMPORT — Consultando banco de dados...', 'color: gold; font-weight: bold; font-size: 14px');
    console.log('%c═══════════════════════════════════════════════════════════', 'color: gold; font-weight: bold');
    try {
      // Pegar amostra: até 10 empresas do CSV (mistura novas e existentes)
      const sampleRows = parsed.slice(0, Math.min(parsed.length, 10));
      const sampleCodigos = sampleRows.map((r) => r.codigo);

      // Buscar essas empresas no DB
      const { data: sampleEmpresas, error: sampleErr } = await (await import('@/lib/supabase')).supabase
        .from('empresas')
        .select('id, codigo, razao_social')
        .in('codigo', sampleCodigos);

      if (sampleErr) {
        console.error('[VERIFY] Erro ao buscar empresas amostra:', sampleErr);
      } else {
        const sampleEmpresaIds = (sampleEmpresas || []).map((e: any) => e.id);
        console.log(`[VERIFY] Empresas encontradas no DB: ${sampleEmpresas?.length ?? 0} de ${sampleCodigos.length} buscadas`);

        // Buscar responsáveis dessas empresas
        if (sampleEmpresaIds.length > 0) {
          const { data: sampleResps, error: respErr } = await (await import('@/lib/supabase')).supabase
            .from('responsaveis')
            .select('empresa_id, departamento_id, usuario_id')
            .in('empresa_id', sampleEmpresaIds);

          if (respErr) {
            console.error('[VERIFY] Erro ao buscar responsáveis amostra:', respErr);
          } else {
            console.log(`[VERIFY] Total de registros em responsaveis para amostra: ${sampleResps?.length ?? 0}`);

            // Agrupar por empresa
            const respByEmpresa = new Map<string, Array<{ dept: string; user: string | null }>>();
            for (const r of sampleResps || []) {
              const list = respByEmpresa.get(r.empresa_id) ?? [];
              list.push({ dept: r.departamento_id, user: r.usuario_id });
              respByEmpresa.set(r.empresa_id, list);
            }

            for (const emp of sampleEmpresas || []) {
              const csvRow = sampleRows.find((r) => r.codigo === emp.codigo);
              const dbResps = respByEmpresa.get(emp.id) ?? [];
              const withUser = dbResps.filter((r) => r.user);

              const logColor = withUser.length > 0 ? 'color: green' : (dbResps.length > 0 ? 'color: orange' : 'color: red; font-weight: bold');
              console.log(
                `%c[VERIFY] Cod=${emp.codigo} | ${(emp.razao_social || '').slice(0, 35)}`,
                logColor,
                `| CSV resps: ${JSON.stringify(csvRow?.responsaveis ?? {})}`,
                `| DB registros: ${dbResps.length} (${withUser.length} com usuario_id)`,
              );
              if (dbResps.length > 0) {
                for (const r of dbResps) {
                  console.log(`    dept=${r.dept} → user=${r.user ?? 'NULL'}`);
                }
              }
            }
          }
        }
      }

      // Verificar via fetch direto (evita stale closure do React — empresas/departamentos/usuarios
      // capturados no início da função NÃO refletem o novo state após reloadData)
      console.log('%c[VERIFY] 📋 Verificando dados pós-reload via fetch direto...', 'color: gold; font-weight: bold');
      try {
        const dbMod = await import('@/lib/db');
        const freshEmpresas = await dbMod.fetchEmpresas();
        const freshDepts = await dbMod.fetchDepartamentos();
        console.log(`  Empresas no DB (fresh fetch): ${freshEmpresas.length}`);
        console.log(`  Departamentos no DB (fresh fetch): ${freshDepts.length}`);

        const empresasComResp = freshEmpresas.filter((e) => {
          const uids = Object.values(e.responsaveis || {}).filter(Boolean);
          return uids.length > 0;
        });
        console.log(`  Empresas com pelo menos 1 responsável vinculado: ${empresasComResp.length} de ${freshEmpresas.length}`);

        // Checar amostra no fetch fresco
        for (const csvRow of sampleRows) {
          const empFresh = freshEmpresas.find((e) => e.codigo === csvRow.codigo);
          if (!empFresh) {
            console.warn(`%c[VERIFY] ⚠️ Empresa ${csvRow.codigo} NÃO encontrada no fetch fresco!`, 'color: red; font-weight: bold');
            continue;
          }
          const freshResps = empFresh.responsaveis || {};
          const withUser = Object.entries(freshResps).filter(([, uid]) => uid);
          const deptNames = withUser.map(([dId]) => freshDepts.find((d) => d.id === dId)?.nome ?? dId);
          console.log(
            `[VERIFY][FRESH] Cod=${csvRow.codigo} | responsaveis: ${withUser.length} com userId | depts: [${deptNames.join(', ')}]`,
          );
        }
      } catch (freshErr) {
        console.error('[VERIFY] Erro no fetch fresco:', freshErr);
      }
    } catch (verifyErr) {
      console.error('[VERIFY] Erro na verificação pós-import:', verifyErr);
    }

    // ═══ RELATÓRIO FINAL ═══
    console.log('%c═══════════════════════════════════════════════════════════', 'color: magenta; font-weight: bold');
    console.log('%c[IMPORT] ★ RELATÓRIO FINAL DA IMPORTAÇÃO ★', 'color: magenta; font-weight: bold; font-size: 16px');
    console.log('%c═══════════════════════════════════════════════════════════', 'color: magenta; font-weight: bold');
    console.log(`  Criadas: ${created}`);
    console.log(`  Atualizadas: ${updated}`);
    console.log(`  Erros: ${errors}`);
    console.log(`  Usuários com falha no vínculo: ${failedUsers}`);
    console.log(`  Departamentos criados: [${deptCreated.join(', ')}]`);

    if (empresasComProblema.length > 0) {
      console.log('%c[IMPORT] ⚠️⚠️⚠️ EMPRESAS COM PROBLEMAS DE RESPONSÁVEIS ⚠️⚠️⚠️', 'color: red; font-weight: bold; font-size: 14px');
      console.log(`Total: ${empresasComProblema.length} empresas`);
      for (const ep of empresasComProblema) {
        console.groupCollapsed(`🔴 Cod=${ep.codigo} | ${ep.nome}`);
        console.log('Responsáveis no CSV:', ep.csvResp);
        console.log('Resolução (deptId → userId):', ep.resolved);
        console.table(ep.issues);
        console.groupEnd();
      }
    } else {
      console.log('%c[IMPORT] ✅ Todas as empresas tiveram responsáveis resolvidos com sucesso!', 'color: green; font-weight: bold');
    }

    setResult({ created, updated, skipped: parsed.length - created - updated, errors, deptCreated });
    setImporting(false);

    const parts: string[] = [];
    if (created > 0) parts.push(`${created} criada(s)`);
    if (updated > 0) parts.push(`${updated} atualizada(s)`);
    if (errors > 0) parts.push(`${errors} erro(s)`);
    if (parts.length > 0) {
      mostrarAlerta('Importação concluída', parts.join(' • '), errors > 0 ? 'aviso' : 'sucesso');
    }
    if (failedUsers > 0) {
      mostrarAlerta('Atenção', `${failedUsers} vínculo(s) de responsável não puderam ser resolvidos (usuários não criados). Verifique e atribua manualmente.`, 'aviso');
    }
  };

  const newCount = parsed.filter((r) => !existingCodigos.has(r.codigo)).length;
  const skipCount = parsed.length - newCount;

  return (
    <ModalBase isOpen={true} onClose={onClose} dialogClassName="w-full max-w-3xl rounded-2xl bg-white shadow-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Importar Planilha do Domínio</h2>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition">
          <X size={20} className="text-gray-500" />
        </button>
      </div>
      {/* Drop zone */}
      {parsed.length === 0 && !result && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center hover:border-cyan-400 hover:bg-cyan-50/50 transition cursor-pointer"
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.csv,.tsv,.txt,.xls,.xlsx';
            input.onchange = (e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) handleFile(file);
            };
            input.click();
          }}
        >
          <Upload className="mx-auto text-gray-400 mb-4" size={48} />
          <div className="text-lg font-bold text-gray-700">Arraste o arquivo aqui ou clique para selecionar</div>
          <div className="text-sm text-gray-500 mt-2">Aceita arquivos .csv, .tsv ou .txt exportados do Domínio</div>
        </div>
      )}

      {/* Preview */}
      {parsed.length > 0 && !result && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
            <FileSpreadsheet className="text-cyan-600" size={20} />
            <div className="flex-1">
              <div className="font-semibold text-gray-900">{fileName}</div>
              <div className="text-sm text-gray-500">
                {parsed.length} empresa(s) encontrada(s)
                {skipCount > 0 && (
                  <span className="text-blue-600 ml-2">
                    • {skipCount} já cadastrada(s) — responsáveis serão atualizados
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => { setParsed([]); setFileName(''); }} className="p-2 rounded-lg hover:bg-gray-200 transition">
              <X size={18} className="text-gray-500" />
            </button>
          </div>

          {/* Table preview */}
          <div className="max-h-80 overflow-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Código</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Nome</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">CNPJ/CPF</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Regime Federal</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Responsáveis</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((row, i) => {
                  const exists = existingCodigos.has(row.codigo);
                  const respCount = Object.keys(row.responsaveis).length;
                  return (
                    <tr key={i} className={`border-t ${exists ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-2">
                        {exists ? (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-600">
                            <AlertTriangle size={14} /> Atualizar
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600">
                            <Check size={14} /> Nova
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">{row.codigo}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate">{row.razao_social}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.cnpj}</td>
                      <td className="px-3 py-2 text-xs">{row.regime_federal || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{respCount > 0 ? `${respCount} dept(s)` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2">
            <div className="text-sm text-gray-600">
              <span className="font-bold text-green-600">{newCount}</span> nova(s) •{' '}
              <span className="font-bold text-blue-600">{skipCount}</span> atualizar responsáveis
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setParsed([]); setFileName(''); }}
                className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={parsed.length === 0 || importing}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                Importar {parsed.length} empresa(s)
              </button>
            </div>
          </div>

          {/* Barra de progresso durante importação */}
          {importing && importProgress.total > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{importProgress.phase}</span>
                <span className="font-mono font-bold">{importProgress.done}/{importProgress.total}</span>
              </div>
              <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-300"
                  style={{ width: `${Math.round((importProgress.done / importProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-green-50 p-6 text-center">
            <Check className="mx-auto text-green-600 mb-3" size={48} />
            <div className="text-xl font-bold text-green-900">Importação concluída!</div>
            <div className="text-sm text-green-700 mt-2">
              {result.created > 0 && `${result.created} empresa(s) criada(s)`}
              {result.updated > 0 && `${result.created > 0 ? ' • ' : ''}${result.updated} empresa(s) atualizada(s)`}
              {result.skipped > 0 && ` • ${result.skipped} sem alterações`}
              {result.errors > 0 && <span className="text-red-600"> • {result.errors} erro(s)</span>}
            </div>
            {result.deptCreated.length > 0 && (
              <div className="text-sm text-green-700 mt-1">
                Departamentos criados automaticamente: {result.deptCreated.join(', ')}
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md transition"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </ModalBase>
  );
}
