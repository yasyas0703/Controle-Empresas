'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, Download, ExternalLink, FileText, Highlighter, Image as ImageIcon,
  Loader2, MessageSquare, Trash2, X,
} from 'lucide-react';
import ModalBase from './ModalBase';
import {
  createArquivoAnotacao,
  deleteArquivoAnotacao,
  fetchArquivoAnotacoes,
  getExtratoSignedUrl,
  updateArquivoAnotacao,
} from '@/lib/db';
import { useSistema } from '@/app/context/SistemaContext';
import type { AnotacaoContexto, ArquivoAnotacao, UUID } from '@/app/types';

// react-pdf-viewer (carregado dinamicamente pra evitar SSR issues)
import { Worker, Viewer } from '@react-pdf-viewer/core';
import {
  highlightPlugin, Trigger,
  type HighlightArea,
  type RenderHighlightContentProps,
  type RenderHighlightTargetProps,
  type RenderHighlightsProps,
} from '@react-pdf-viewer/highlight';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/highlight/lib/styles/index.css';

const PDF_WORKER_URL = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';

const CORES_HIGHLIGHT = [
  { hex: '#FFEB3B', label: 'Amarelo' },
  { hex: '#A5F3FC', label: 'Azul' },
  { hex: '#BBF7D0', label: 'Verde' },
  { hex: '#FBCFE8', label: 'Rosa' },
  { hex: '#FED7AA', label: 'Laranja' },
];

type TipoArquivo = 'pdf' | 'imagem' | 'outro';

function detectarTipo(nome: string): TipoArquivo {
  const ext = (nome.split('.').pop() ?? '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return 'imagem';
  return 'outro';
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  arquivoPath: string;
  arquivoNome: string;
  /** ID do extrato/documento. Se passar junto com empresaId, ativa anotações persistentes (apenas em PDF). */
  arquivoId?: string;
  /** ID da empresa dona — necessário pra criar anotação (passa pelo RLS). */
  empresaId?: UUID;
  contexto?: AnotacaoContexto;
  uploadedPorNome?: string;
  uploadedEm?: string;
  signedUrlOverride?: string | null;
}

export default function ModalVisualizadorArquivo({
  isOpen, onClose, arquivoPath, arquivoNome,
  empresaId, contexto = 'extrato',
  uploadedPorNome, uploadedEm, signedUrlOverride,
}: Props) {
  const { mostrarAlerta, currentUser, currentUserId } = useSistema();
  const [signedUrl, setSignedUrl] = useState<string | null>(signedUrlOverride ?? null);
  const [carregandoUrl, setCarregandoUrl] = useState(false);
  const [anotacoes, setAnotacoes] = useState<ArquivoAnotacao[]>([]);
  const [carregandoAnotacoes, setCarregandoAnotacoes] = useState(false);
  const [corAtual, setCorAtual] = useState(CORES_HIGHLIGHT[0].hex);
  const tipo = detectarTipo(arquivoNome);
  const podeAnotar = tipo === 'pdf' && !!empresaId && !!currentUserId;

  // Busca signed URL
  useEffect(() => {
    if (!isOpen) return;
    if (signedUrlOverride) {
      setSignedUrl(signedUrlOverride);
      return;
    }
    let cancelado = false;
    setCarregandoUrl(true);
    getExtratoSignedUrl(arquivoPath)
      .then((url) => { if (!cancelado) setSignedUrl(url); })
      .catch((err) => {
        console.error(err);
        if (!cancelado) {
          mostrarAlerta('Erro', 'Não foi possível abrir o arquivo.', 'erro');
          onClose();
        }
      })
      .finally(() => { if (!cancelado) setCarregandoUrl(false); });
    return () => { cancelado = true; };
  }, [isOpen, arquivoPath, signedUrlOverride, mostrarAlerta, onClose]);

  // Carrega anotações
  useEffect(() => {
    if (!isOpen || !podeAnotar) return;
    let cancelado = false;
    setCarregandoAnotacoes(true);
    fetchArquivoAnotacoes(arquivoPath)
      .then((lista) => { if (!cancelado) setAnotacoes(lista); })
      .catch((err) => {
        console.warn('Falha ao carregar anotações:', err);
      })
      .finally(() => { if (!cancelado) setCarregandoAnotacoes(false); });
    return () => { cancelado = true; };
  }, [isOpen, podeAnotar, arquivoPath]);

  function baixar() {
    if (!signedUrl) return;
    const a = document.createElement('a');
    a.href = signedUrl;
    a.download = arquivoNome;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function abrirEmNovaAba() {
    if (!signedUrl) return;
    window.open(signedUrl, '_blank', 'noopener,noreferrer');
  }

  function formatDataHora(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  // ─── Plugin de highlight ───────────────────────────────────
  const highlightPluginInstance = useMemo(() => {
    if (!podeAnotar) return null;

    return highlightPlugin({
      trigger: Trigger.TextSelection,

      // Aparece um botão "Destacar" quando o usuário seleciona texto
      renderHighlightTarget: (props: RenderHighlightTargetProps) => (
        <div
          style={{
            background: '#1f2937',
            display: 'flex',
            position: 'absolute',
            left: `${props.selectionRegion.left}%`,
            top: `${props.selectionRegion.top + props.selectionRegion.height}%`,
            transform: 'translate(0, 8px)',
            zIndex: 1,
            borderRadius: 6,
            padding: 4,
            gap: 4,
          }}
        >
          <button
            onClick={async () => {
              try {
                if (!empresaId) return;
                const novo = await createArquivoAnotacao({
                  arquivoPath,
                  contexto,
                  empresaId,
                  tipo: 'highlight',
                  pagina: (props.highlightAreas[0]?.pageIndex ?? 0) + 1,
                  conteudo: {
                    highlightAreas: props.highlightAreas,
                    selectedText: props.selectedText,
                  },
                  cor: corAtual,
                  comentario: null,
                  criadoPorId: currentUserId,
                  criadoPorNome: currentUser?.nome,
                });
                setAnotacoes((prev) => [...prev, novo]);
                props.cancel();
              } catch (err) {
                console.error(err);
                mostrarAlerta('Erro', 'Não foi possível salvar o destaque.', 'erro');
              }
            }}
            title="Grifar trecho"
            style={{ background: corAtual, border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}
          >
            <Highlighter size={12} style={{ display: 'inline', marginRight: 4 }} />
            Grifar
          </button>
          <button
            onClick={() => props.cancel()}
            title="Cancelar"
            style={{ background: '#374151', color: 'white', border: 'none', borderRadius: 4, padding: '4px 6px', cursor: 'pointer', fontSize: 12 }}
          >
            ×
          </button>
        </div>
      ),

      // Não usamos o "renderHighlightContent" (form de comentário inline) —
      // o comentário pode ser editado depois clicando na anotação na sidebar.
      renderHighlightContent: (_props: RenderHighlightContentProps) => <></>,

      // Renderiza as anotações persistidas em cima do PDF
      renderHighlights: (props: RenderHighlightsProps) => (
        <div>
          {anotacoes
            .filter((a) => a.tipo === 'highlight')
            .flatMap((a) => {
              const conteudo = a.conteudo as { highlightAreas?: HighlightArea[] } | null;
              const areas = Array.isArray(conteudo?.highlightAreas) ? conteudo!.highlightAreas! : [];
              return areas
                .filter((area) => area.pageIndex === props.pageIndex)
                .map((area, i) => (
                  <div
                    key={`${a.id}-${i}`}
                    title={a.comentario ? `${a.comentario} — ${a.criadoPorNome ?? ''}` : `${a.criadoPorNome ?? ''}`}
                    style={Object.assign(
                      { background: a.cor, opacity: 0.4, borderRadius: 2 },
                      props.getCssProperties(area, props.rotation)
                    )}
                  />
                ));
            })}
        </div>
      ),
    });
  }, [podeAnotar, anotacoes, corAtual, empresaId, contexto, arquivoPath, currentUser, currentUserId, mostrarAlerta]);

  async function removerAnotacao(id: UUID) {
    try {
      await deleteArquivoAnotacao(id);
      setAnotacoes((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível remover a anotação.', 'erro');
    }
  }

  async function editarComentario(id: UUID, comentario: string) {
    try {
      const atualizado = await updateArquivoAnotacao(id, { comentario });
      setAnotacoes((prev) => prev.map((a) => (a.id === id ? atualizado : a)));
    } catch (err) {
      console.error(err);
      mostrarAlerta('Erro', 'Não foi possível salvar o comentário.', 'erro');
    }
  }

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="modal-visualizador-titulo"
      dialogClassName="w-full max-w-6xl rounded-2xl bg-white shadow-2xl max-h-[95vh] overflow-hidden flex flex-col"
      zIndex={1500}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-600 to-blue-700 text-white p-3 sm:p-4 flex items-center gap-3 shrink-0">
        <div className="p-2 bg-white/20 rounded-lg shrink-0">
          {tipo === 'pdf' ? <FileText size={20} /> : tipo === 'imagem' ? <ImageIcon size={20} /> : <FileText size={20} />}
        </div>
        <div className="flex-1 min-w-0">
          <h2 id="modal-visualizador-titulo" className="text-base font-bold truncate">{arquivoNome}</h2>
          {(uploadedPorNome || uploadedEm) && (
            <p className="text-[11px] text-white/80 truncate">
              {uploadedPorNome ? `por ${uploadedPorNome}` : ''}
              {uploadedPorNome && uploadedEm ? ' · ' : ''}
              {uploadedEm ? formatDataHora(uploadedEm) : ''}
            </p>
          )}
        </div>
        {podeAnotar && (
          <div className="flex items-center gap-1 bg-white/15 rounded-lg p-1 shrink-0">
            <span className="text-[10px] font-bold text-white/80 px-1">Cor:</span>
            {CORES_HIGHLIGHT.map((c) => (
              <button
                key={c.hex}
                onClick={() => setCorAtual(c.hex)}
                className={`h-5 w-5 rounded transition ${corAtual === c.hex ? 'ring-2 ring-white' : 'opacity-70 hover:opacity-100'}`}
                style={{ background: c.hex }}
                title={c.label}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={baixar}
            disabled={!signedUrl}
            className="rounded-lg bg-white/20 hover:bg-white/30 text-white p-2 transition disabled:opacity-50"
            title="Baixar"
          >
            <Download size={18} />
          </button>
          <button
            onClick={abrirEmNovaAba}
            disabled={!signedUrl}
            className="rounded-lg bg-white/20 hover:bg-white/30 text-white p-2 transition disabled:opacity-50"
            title="Abrir em nova aba"
          >
            <ExternalLink size={18} />
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-white/20 hover:bg-white/30 text-white p-2 transition"
            title="Fechar"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Conteúdo + Sidebar de anotações */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 bg-gray-100 overflow-auto">
          {carregandoUrl || !signedUrl ? (
            <div className="h-[600px] flex items-center justify-center text-gray-400 text-sm">
              <Loader2 size={20} className="animate-spin mr-2" /> Carregando...
            </div>
          ) : tipo === 'pdf' && podeAnotar && highlightPluginInstance ? (
            <Worker workerUrl={PDF_WORKER_URL}>
              <div style={{ height: '85vh' }}>
                <Viewer fileUrl={signedUrl} plugins={[highlightPluginInstance]} />
              </div>
            </Worker>
          ) : tipo === 'pdf' ? (
            <iframe src={signedUrl} title={arquivoNome} className="w-full h-[80vh] border-0 bg-white" />
          ) : tipo === 'imagem' ? (
            <div className="flex items-center justify-center p-4 min-h-[400px]">
              <img src={signedUrl} alt={arquivoNome} className="max-w-full max-h-[80vh] object-contain rounded shadow" />
            </div>
          ) : (
            <div className="h-[400px] flex flex-col items-center justify-center text-gray-600 p-8 text-center">
              <AlertTriangle size={36} className="text-amber-500 mb-3" />
              <p className="text-sm font-bold mb-1">Pré-visualização não disponível pra esse formato</p>
              <p className="text-xs text-gray-500 mb-4">
                O navegador não consegue renderizar arquivos do tipo <code className="font-mono bg-gray-200 px-1 rounded">{(arquivoNome.split('.').pop() ?? '').toLowerCase()}</code> direto na página. Mas você pode baixar:
              </p>
              <button
                onClick={baixar}
                className="rounded-lg bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-700 hover:to-blue-800 text-white px-4 py-2 text-sm font-bold inline-flex items-center gap-2 transition"
              >
                <Download size={16} /> Baixar arquivo
              </button>
            </div>
          )}
        </div>

        {/* Sidebar com anotações (só PDF anotável) */}
        {podeAnotar && (
          <aside className="w-80 shrink-0 border-l border-gray-200 bg-white flex flex-col">
            <div className="p-3 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <Highlighter size={14} /> Anotações ({anotacoes.length})
              </div>
              <p className="text-[10px] text-gray-500 mt-1">
                Selecione um trecho do PDF e clique em &quot;Grifar&quot;.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {carregandoAnotacoes ? (
                <div className="p-4 text-center text-gray-400 text-xs">
                  <Loader2 size={14} className="inline animate-spin mr-1" /> Carregando...
                </div>
              ) : anotacoes.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-xs">
                  Nenhuma anotação ainda.
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {anotacoes.map((a) => (
                    <ItemAnotacao
                      key={a.id}
                      anotacao={a}
                      onSalvarComentario={(texto) => editarComentario(a.id, texto)}
                      onRemover={() => removerAnotacao(a.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>
    </ModalBase>
  );
}

function ItemAnotacao({
  anotacao, onSalvarComentario, onRemover,
}: {
  anotacao: ArquivoAnotacao;
  onSalvarComentario: (texto: string) => Promise<void>;
  onRemover: () => Promise<void>;
}) {
  const [editandoComentario, setEditandoComentario] = useState(false);
  const [comentario, setComentario] = useState(anotacao.comentario ?? '');
  const [salvando, setSalvando] = useState(false);

  const conteudo = anotacao.conteudo as { selectedText?: string } | null;
  const trecho = (conteudo?.selectedText ?? '').trim();

  return (
    <li className="p-2.5 hover:bg-gray-50 transition group">
      <div className="flex items-start gap-2">
        <span
          className="inline-block w-3 h-3 rounded mt-1 shrink-0"
          style={{ background: anotacao.cor }}
        />
        <div className="flex-1 min-w-0 text-xs">
          <div className="text-gray-800 font-medium line-clamp-3" title={trecho}>
            &quot;{trecho || '(sem texto)'}&quot;
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            pág. {anotacao.pagina} · {anotacao.criadoPorNome ?? '?'}
          </div>
          {editandoComentario ? (
            <div className="mt-1.5 space-y-1">
              <textarea
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                rows={2}
                placeholder="Comentário..."
                className="w-full text-[11px] rounded border border-gray-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-none"
                autoFocus
              />
              <div className="flex gap-1">
                <button
                  onClick={async () => {
                    setSalvando(true);
                    try {
                      await onSalvarComentario(comentario);
                      setEditandoComentario(false);
                    } finally {
                      setSalvando(false);
                    }
                  }}
                  disabled={salvando}
                  className="rounded bg-emerald-500 hover:bg-emerald-600 text-white px-2 py-1 text-[10px] font-bold inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {salvando ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Salvar
                </button>
                <button
                  onClick={() => { setComentario(anotacao.comentario ?? ''); setEditandoComentario(false); }}
                  className="rounded bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-1 text-[10px] font-bold"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              {anotacao.comentario && (
                <div className="mt-1 text-[11px] text-gray-700 italic bg-amber-50 border-l-2 border-amber-300 px-2 py-1 rounded-r">
                  {anotacao.comentario}
                </div>
              )}
              <div className="mt-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={() => setEditandoComentario(true)}
                  className="rounded bg-cyan-50 hover:bg-cyan-100 text-cyan-700 px-1.5 py-0.5 text-[10px] font-bold inline-flex items-center gap-1"
                  title="Comentar"
                >
                  <MessageSquare size={10} /> {anotacao.comentario ? 'Editar' : 'Comentar'}
                </button>
                <button
                  onClick={onRemover}
                  className="rounded bg-red-50 hover:bg-red-100 text-red-600 px-1.5 py-0.5 text-[10px] font-bold inline-flex items-center gap-1"
                  title="Remover"
                >
                  <Trash2 size={10} /> Remover
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
