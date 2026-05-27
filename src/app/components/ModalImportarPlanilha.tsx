'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, X, Check, Loader2, Trash2 } from 'lucide-react';
import { useSistema } from '@/app/context/SistemaContext';
import type { Empresa } from '@/app/types';
import ModalBase from '@/app/components/ModalBase';
import { gerarSenhaSegura } from '@/app/utils/password';
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

const REGIME_FEDERAL_OPTIONS = ['', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI'] as const;

function cleanQuotes(val: string): string {
  return val.replace(/^["']+|["']+$/g, '').trim();
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
    .replace(/[̀-ͯ]/g, '')
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

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 1) return [];

  // ── Detectar se a primeira linha é cabeçalho ou dados ──
  const rawHeaderCols = splitDelimitedLine(lines[0], separator).map(cleanQuotes);
  const headerLower = rawHeaderCols.map((h) => (h || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const HEADER_KEYWORDS = ['id', 'codigo', 'nome', 'cnpj', 'inscricao estadual', 'ativo/inativo', 'cadastro', 'contabil', 'fiscal', 'pessoal', 'declaracoes', 'parcelamentos'];
  const headerHits = headerLower.filter((h) => HEADER_KEYWORDS.some((kw) => h === kw || h.startsWith(kw))).length;
  const hasHeader = headerHits >= 3;

  // Posições fixas do formato Gestta (quando CSV não tem cabeçalho):
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
  let dataLines: string[];

  if (hasHeader) {
    headerCols = rawHeaderCols;
    for (let i = 0; i < headerCols.length; i++) {
      const name = headerCols[i]?.trim() ?? '';
      if (!name) continue;
      const canonical = canonicalDeptFromHeader(name);
      if (canonical) {
        const arr = deptColsByCanonical.get(canonical) ?? [];
        arr.push(i);
        deptColsByCanonical.set(canonical, arr);
      }
    }
    dataLines = lines.slice(1);
  } else {
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
    dataLines = lines;
  }

  const result = dataLines
    .map((line) => {
      const cols = splitDelimitedLine(line, separator).map(cleanQuotes);
      const codigo = cols[1] || '';
      const nome = cols[2] || '';
      const cnpj = cols[3] || '';

      if (!codigo && !nome && !cnpj) return null;

      const responsaveis: Record<string, string> = {};

      for (const canonical of CANONICAL_DEPTS) {
        const indices = deptColsByCanonical.get(canonical) ?? [];
        let picked = '';
        for (const col of indices) {
          const val = String(cols[col] || '').trim();
          if (val) { picked = val; break; }
        }
        if (picked) {
          responsaveis[canonical] = picked;
        } else if (indices.length > 0) {
          responsaveis[canonical] = '';
        }
      }

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

  return result;
}

interface ModalImportarPlanilhaProps {
  onClose: () => void;
}

export default function ModalImportarPlanilha({ onClose }: ModalImportarPlanilhaProps) {
  const { empresas, departamentos, criarDepartamento, usuarios, mostrarAlerta, reloadData } = useSistema();

  // editing = só as novas (já filtradas), com edições do usuário aplicadas.
  const [editing, setEditing] = useState<ParsedRow[]>([]);
  const [totalDoArquivo, setTotalDoArquivo] = useState(0);
  const [descartadas, setDescartadas] = useState(0);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, phase: '' });
  const [result, setResult] = useState<{ created: number; descartadas: number; errors: number; deptCreated: string[] } | null>(null);

  // Ref pra ler empresas mais recentes dentro do handleFile (que é useCallback estável).
  const empresasRef = useRef(empresas);
  useEffect(() => {
    empresasRef.current = empresas;
  }, [empresas]);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setResult(null);

    // Tentar UTF-8 primeiro; se o resultado tiver caracteres corrompidos, retenta com Windows-1252
    const tryRead = (encoding: string) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (encoding === 'UTF-8' && text.includes('�')) {
          tryRead('windows-1252');
          return;
        }
        const rows = parseFile(text);
        const codigosExistentes = new Set(empresasRef.current.map((emp) => emp.codigo));
        const novas = rows.filter((r) => !codigosExistentes.has(r.codigo));
        setTotalDoArquivo(rows.length);
        setDescartadas(rows.length - novas.length);
        setEditing(novas);
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

  const updateRowField = (idx: number, field: 'codigo' | 'razao_social' | 'cnpj' | 'regime_federal', value: string) => {
    setEditing((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  };

  const removeRow = (idx: number) => {
    setEditing((prev) => prev.filter((_, i) => i !== idx));
  };

  const resetFile = () => {
    setEditing([]);
    setTotalDoArquivo(0);
    setDescartadas(0);
    setFileName('');
  };

  const handleImport = async () => {
    setImporting(true);
    const deptCreated: string[] = [];

    const norm = (s: string) =>
      String(s || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
    const slug = (s: string) =>
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '');

    const randomPassword = () => gerarSenhaSegura(16);
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
          issues.push({ deptName, personName, reason: 'departamento não encontrado' });
          continue;
        }
        if (!personName.trim()) {
          resolved[deptId] = null;
          continue;
        }
        const personKey = normFn(personName);
        const userId = userIdByName.get(personKey);
        if (!userId) {
          issues.push({ deptName, personName, reason: 'usuário não encontrado' });
          resolved[deptId] = null;
          continue;
        }
        resolved[deptId] = userId;
      }
      return { resolved, issues };
    };

    // Garantir departamentos referenciados em editing
    const deptIdByName = new Map(departamentos.map((d) => [norm(d.nome), d.id]));
    const allDeptNames = new Set<string>();
    for (const row of editing) {
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

    // Auto-departamento por pessoa (mais frequente)
    const personDeptCount = new Map<string, Map<string, number>>();
    for (const row of editing) {
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
    const personBestDept = new Map<string, string>();
    for (const [pKey, deptCounts] of personDeptCount) {
      let best = '';
      let bestCount = 0;
      for (const [dKey, count] of deptCounts) {
        if (count > bestCount) { best = dKey; bestCount = count; }
      }
      const deptId = deptIdByName.get(best);
      if (deptId) personBestDept.set(pKey, deptId);
    }

    // Mapas de usuários
    const userIdByName = new Map(usuarios.map((u) => [norm(u.nome), u.id]));
    const usedEmails = new Set(usuarios.map((u) => u.email.toLowerCase().trim()));
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

    // Coletar todas as pessoas referenciadas
    const allPeople = new Set<string>();
    for (const row of editing) {
      for (const personName of Object.values(row.responsaveis)) {
        const p = String(personName || '').trim();
        if (p) allPeople.add(p);
      }
    }
    const failedUserCreations: Array<{ name: string; key: string; reason: string }> = [];
    const usersToCreate: Array<{ nome: string; key: string; email: string; autoDeptId: string | null }> = [];
    for (const personName of Array.from(allPeople)) {
      const key = norm(personName);
      const existingId = resolveUserId(personName);
      if (existingId !== null) {
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

    // BATCH: criar usuários
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
        for (const r of batchResult.results) {
          const key = norm(r.nome);
          if (r.id) userIdByName.set(key, r.id);
          else failedUserCreations.push({ name: r.nome, key, reason: r.error || 'Falha desconhecida' });
        }
      } catch (batchErr) {
        console.error('[IMPORT][USER] BATCH FALHOU. Tentando criação individual...', batchErr);
        for (let pi = 0; pi < usersToCreate.length; pi++) {
          const { nome: personName, key, email, autoDeptId } = usersToCreate[pi];
          if (userIdByName.has(key)) continue;
          if (pi > 0) await new Promise((r) => setTimeout(r, 800));
          let id: string | null = null;
          for (let attempt = 0; attempt < 5 && !id; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt - 1), 8000)));
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
          if (id) userIdByName.set(key, id);
          else failedUserCreations.push({ name: personName, key, reason: 'Fallback individual falhou' });
        }
      }
    }

    // Fetch fresco pra recuperar quem ficou pra trás
    try {
      const freshUsers = await db.fetchUsuariosAdmin();
      for (const u of freshUsers) {
        const uKey = norm(u.nome);
        if (!userIdByName.has(uKey)) userIdByName.set(uKey, u.id);
      }
      for (let fi = failedUserCreations.length - 1; fi >= 0; fi--) {
        if (userIdByName.has(failedUserCreations[fi].key)) failedUserCreations.splice(fi, 1);
      }
    } catch (fetchErr) {
      console.error('[IMPORT][USER] Erro no fetch fresco:', fetchErr);
    }

    let created = 0;
    let errors = 0;
    let failedUsers = 0;
    const allDeptIds = Array.from(deptIdByName.values());

    setImportProgress({ done: 0, total: editing.length, phase: 'Criando empresas...' });

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

    // CRIAR empresas — todas as linhas em editing são novas (duplicadas foram filtradas no upload)
    for (let i = 0; i < editing.length; i++) {
      const row = editing[i];
      const { resolved: responsaveis, issues } = debugResolution(row, deptIdByName, userIdByName, norm);
      for (const iss of issues) {
        if (iss.reason.includes('usuário')) failedUsers++;
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
        await withRetry(() => db.insertEmpresa(payload, allDeptIds), `Criar ${row.codigo}`);
        created++;
      } catch (err) {
        console.error(`[IMPORT] ERRO ao criar empresa ${row.codigo}:`, err);
        errors++;
      }

      setImportProgress({ done: i + 1, total: editing.length, phase: `Criando empresas... (${i + 1}/${editing.length})` });
      if (i < editing.length - 1) await new Promise((r) => setTimeout(r, 200));
    }

    // RE-LINK: garante que responsáveis foram gravados nas empresas recém-criadas
    setImportProgress((prev) => ({ ...prev, phase: 'Re-vinculando responsáveis...' }));
    let relinked = 0;
    for (const row of editing) {
      const { resolved: responsaveis } = debugResolution(row, deptIdByName, userIdByName, norm);
      const hasAnyUser = Object.values(responsaveis).some((v) => !!v);
      if (!hasAnyUser) continue;
      try {
        const supa = (await import('@/lib/supabase')).supabase;
        const { data: empData } = await supa
          .from('empresas')
          .select('id')
          .eq('codigo', row.codigo)
          .maybeSingle();
        if (!empData?.id) continue;

        const { data: currentResps } = await supa
          .from('responsaveis')
          .select('departamento_id, usuario_id')
          .eq('empresa_id', empData.id);
        const currentMap = new Map(
          (currentResps || []).map((r: { departamento_id: string; usuario_id: string | null }) => [r.departamento_id, r.usuario_id])
        );
        let needsUpdate = false;
        for (const [depId, userId] of Object.entries(responsaveis)) {
          if (userId && currentMap.get(depId) !== userId) { needsUpdate = true; break; }
        }
        if (needsUpdate) {
          await withRetry(() => db.updateEmpresa(empData.id, { responsaveis }), `Relink ${row.codigo}`);
          relinked++;
        }
      } catch (relinkErr) {
        console.warn(`[RELINK] Falha ao re-vincular ${row.codigo}:`, relinkErr);
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    // Reload + sync
    setImportProgress((prev) => ({ ...prev, phase: 'Aguardando sincronização do banco...' }));
    await new Promise((r) => setTimeout(r, 2000));
    setImportProgress((prev) => ({ ...prev, phase: 'Sincronizando...' }));
    try {
      await reloadData();
    } catch (reloadErr) {
      console.error('[IMPORT] reloadData() falhou:', reloadErr);
      await new Promise((r) => setTimeout(r, 3000));
      try { await reloadData(); } catch (reloadErr2) { console.error('[IMPORT] reload retry falhou:', reloadErr2); }
    }

    setResult({ created, descartadas, errors, deptCreated });
    setImporting(false);

    const parts: string[] = [];
    if (created > 0) parts.push(`${created} criada(s)`);
    if (relinked > 0) parts.push(`${relinked} re-vinculada(s)`);
    if (errors > 0) parts.push(`${errors} erro(s)`);
    if (descartadas > 0) parts.push(`${descartadas} já existente(s) ignorada(s)`);
    if (parts.length > 0) {
      mostrarAlerta('Importação concluída', parts.join(' • '), errors > 0 ? 'aviso' : 'sucesso');
    }
    if (failedUsers > 0) {
      mostrarAlerta('Atenção', `${failedUsers} vínculo(s) de responsável não puderam ser resolvidos. Verifique e atribua manualmente.`, 'aviso');
    }
  };

  const showDropZone = totalDoArquivo === 0 && !result;
  const showPreview = totalDoArquivo > 0 && !result;

  return (
    <ModalBase isOpen={true} onClose={onClose} dialogClassName="w-full max-w-5xl rounded-2xl bg-white shadow-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Importar Planilha do Domínio</h2>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition">
          <X size={20} className="text-gray-500" />
        </button>
      </div>

      {/* Drop zone */}
      {showDropZone && (
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
          <div className="text-sm text-gray-500 mt-2">Aceita arquivos .csv, .tsv ou .txt exportados do Domínio/Onvio</div>
          <div className="text-xs text-gray-400 mt-3">Empresas que já existem no sistema (mesmo código) serão descartadas automaticamente</div>
        </div>
      )}

      {/* Preview */}
      {showPreview && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50">
            <FileSpreadsheet className="text-cyan-600" size={20} />
            <div className="flex-1">
              <div className="font-semibold text-gray-900">{fileName}</div>
              <div className="text-sm text-gray-500">
                <span className="font-bold text-green-600">{editing.length}</span> nova(s) a criar
                {descartadas > 0 && (
                  <span className="text-gray-500 ml-2">
                    • {descartadas} já cadastrada(s) — descartada(s)
                  </span>
                )}
              </div>
            </div>
            <button onClick={resetFile} className="p-2 rounded-lg hover:bg-gray-200 transition" title="Trocar arquivo">
              <X size={18} className="text-gray-500" />
            </button>
          </div>

          {/* Aviso se nada vai ser importado */}
          {editing.length === 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
              <div className="text-amber-800 font-semibold">Nenhuma empresa nova nesta planilha.</div>
              <div className="text-sm text-amber-700 mt-1">
                Todas as {totalDoArquivo} empresas do arquivo já estão cadastradas no sistema.
              </div>
            </div>
          )}

          {/* Tabela editável das novas */}
          {editing.length > 0 && (
            <div className="max-h-[480px] overflow-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700 w-10">#</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700 w-24">Código</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700">Razão Social</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700 w-44">CNPJ/CPF</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700 w-44">Regime Federal</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-700 w-20">Resp.</th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-700 w-12">×</th>
                  </tr>
                </thead>
                <tbody>
                  {editing.map((row, i) => {
                    const respCount = Object.values(row.responsaveis).filter((v) => v.trim()).length;
                    return (
                      <tr key={`${row.codigo}-${i}`} className="border-t hover:bg-gray-50">
                        <td className="px-2 py-1 text-xs text-gray-400 font-mono">{i + 1}</td>
                        <td className="px-2 py-1">
                          <input
                            value={row.codigo}
                            onChange={(e) => updateRowField(i, 'codigo', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-gray-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={row.razao_social}
                            onChange={(e) => updateRowField(i, 'razao_social', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={row.cnpj}
                            onChange={(e) => updateRowField(i, 'cnpj', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-gray-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={row.regime_federal}
                            onChange={(e) => updateRowField(i, 'regime_federal', e.target.value)}
                            className="w-full px-2 py-1 rounded border border-gray-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                          >
                            {REGIME_FEDERAL_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt || '—'}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-xs text-gray-500 text-center">
                          {respCount > 0 ? `${respCount}` : '—'}
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            onClick={() => removeRow(i)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition"
                            title="Descartar esta empresa da importação"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 pt-2">
            <div className="text-sm text-gray-600">
              Vai importar <span className="font-bold text-green-600">{editing.length}</span> empresa(s)
            </div>
            <div className="flex gap-3">
              <button
                onClick={resetFile}
                className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 transition font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={editing.length === 0 || importing}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white font-bold hover:from-cyan-700 hover:to-teal-600 shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
                Importar {editing.length} empresa(s)
              </button>
            </div>
          </div>

          {/* Barra de progresso */}
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
              {result.descartadas > 0 && `${result.created > 0 ? ' • ' : ''}${result.descartadas} já existente(s) descartada(s)`}
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
