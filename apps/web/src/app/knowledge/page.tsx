"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Trash2,
  Search,
  Plus,
  Loader2,
  FileText,
  Sparkles,
  CheckCircle2,
  Layers,
  Database,
  UploadCloud,
  FileSpreadsheet,
  FileCode,
  File as FileIcon,
  X,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import type { KnowledgeDocument, KnowledgeSearchResult } from "@ai-opc/shared";
import {
  fetchKnowledgeDocs,
  ingestKnowledgeDoc,
  deleteKnowledgeDoc,
  searchKnowledgeApi,
  parseKnowledgeFileApi,
} from "@/lib/api";
import { parseUploadedFileClient, type ParsedFileResult } from "@ai-opc/shared";
import { useI18n } from "@/context/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function KnowledgePage() {
  const { t, locale } = useI18n();
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [source, setSource] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // File upload & parsing state
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [fileMeta, setFileMeta] = useState<ParsedFileResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function refresh() {
    try {
      const data = await fetchKnowledgeDocs();
      setDocs(data as KnowledgeDocument[]);
    } catch (err) {
      if (err instanceof Error && err.message !== "Unauthorized") {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function processSelectedFile(file: File) {
    setError(null);
    setIsParsing(true);
    try {
      let parsed: ParsedFileResult | null = null;
      try {
        const serverResult = (await parseKnowledgeFileApi(file)) as ParsedFileResult;
        if (serverResult && serverResult.content) {
          parsed = serverResult;
        }
      } catch {
        // Fallback to client parser
      }

      if (!parsed || !parsed.content) {
        parsed = await parseUploadedFileClient(file);
      }

      setFileMeta(parsed);
      setTitle(parsed.title);
      setSource(parsed.source);
      setContent(parsed.content);
      if (parsed.warning) {
        setError(parsed.warning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : (locale === "vi" ? "Lỗi khi phân tích tệp" : "Failed to parse file"));
    } finally {
      setIsParsing(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  }

  function clearFile() {
    setFileMeta(null);
    setTitle("");
    setContent("");
    setSource("");
  }

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) {
      setError(locale === "vi" ? "Nội dung tài liệu không được để trống." : "Document content cannot be empty.");
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setIngesting(true);
    try {
      const res = (await ingestKnowledgeDoc(
        title.trim() || (locale === "vi" ? "Tài liệu không tiêu đề" : "Untitled Document"),
        content,
        source.trim() || undefined
      )) as { documentId: string; chunkCount: number; engine?: "remote" | "builtin" };

      setTitle("");
      setContent("");
      setSource("");
      setFileMeta(null);

      const engineNote =
        res.engine === "remote"
          ? (locale === "vi" ? "đã tạo Neural Vector Embeddings từ API" : "generated Neural Vector Embeddings from API")
          : (locale === "vi" ? "đã tạo Built-in Semantic & TF-IDF Vectors (chạy cục bộ 0 token cost)" : "generated Built-in Semantic & TF-IDF Vectors (local, 0 token cost)");
      setSuccessMsg(
        locale === "vi"
          ? `Đã nạp thành công tài liệu với ${res.chunkCount} chunks (${engineNote})!`
          : `Document successfully ingested with ${res.chunkCount} chunks (${engineNote})!`
      );
      await refresh();
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : (locale === "vi" ? "Nạp tài liệu thất bại" : "Document ingestion failed"));
    } finally {
      setIngesting(false);
    }
  }

  async function handleDelete(documentId: string, docTitle: string) {
    if (!window.confirm(locale === "vi" ? `Xoá tài liệu "${docTitle}" khỏi Company Knowledge Base?` : `Delete document "${docTitle}" from Knowledge Base?`)) return;
    try {
      await deleteKnowledgeDoc(documentId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : (locale === "vi" ? "Xóa tài liệu thất bại" : "Failed to delete document"));
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const searchRes = (await searchKnowledgeApi(query)) as KnowledgeSearchResult[];
      setResults(searchRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : (locale === "vi" ? "Search thất bại" : "Search failed"));
    } finally {
      setSearching(false);
    }
  }

  const totalChunks = docs.reduce((acc, d) => acc + (d.chunkCount || 1), 0);
  const estimatedChunks = Math.max(1, Math.ceil(content.length / 500));

  function getFileIcon(type?: string) {
    if (!type) return <FileText className="h-4 w-4 text-accent" />;
    if (type.includes("CSV") || type.includes("SPREADSHEET"))
      return <FileSpreadsheet className="h-4 w-4 text-emerald-400" />;
    if (type.includes("JSON") || type.includes("CODE") || type.includes("YAML") || type.includes("XML"))
      return <FileCode className="h-4 w-4 text-amber-400" />;
    return <FileText className="h-4 w-4 text-accent" />;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> {t.nav.backToHome}
        </Link>
        <LanguageSwitcher />
      </div>

      {/* Header Banner */}
      <div className="rounded-2xl border border-border/80 bg-panel/90 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <BookOpen className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-bold text-zinc-100">{t.knowledge.title}</h1>
            </div>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-2xl">
              {t.knowledge.desc}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-canvas/60 px-3.5 py-2">
              <Database className="h-4 w-4 text-purple-400" />
              <div className="text-left">
                <p className="text-[10px] text-zinc-500 uppercase font-mono">{t.knowledge.totalDocs}</p>
                <p className="font-mono text-sm font-semibold text-zinc-200">{docs.length}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-canvas/60 px-3.5 py-2">
              <Layers className="h-4 w-4 text-accent" />
              <div className="text-left">
                <p className="text-[10px] text-zinc-500 uppercase font-mono">Vector Chunks</p>
                <p className="font-mono text-sm font-semibold text-zinc-200">{totalChunks}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 p-4 text-xs sm:text-sm text-danger animate-in fade-in duration-150">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs sm:text-sm text-emerald-300 animate-in fade-in duration-150">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Ingest New Document Form */}
      <form
        onSubmit={handleIngest}
        className="space-y-4 rounded-2xl border border-border/80 bg-panel p-6 shadow-sm"
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Plus className="h-4 w-4 text-accent" /> {t.knowledge.addDoc}
          </h2>
          <span className="text-[11px] text-zinc-500">{locale === "vi" ? "Tự động chia chunk & tính vector embedding" : "Auto-chunks & computes vector embeddings"}</span>
        </div>

        {/* Upload Dropzone */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".txt,.md,.markdown,.csv,.json,.pdf,.docx,.doc,.html,.xml,.yaml,.yml,.log"
          className="hidden"
        />

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 transition-all cursor-pointer select-none ${
            isDragging
              ? "border-accent bg-accent/10 scale-[1.005]"
              : "border-border/80 bg-canvas/40 hover:border-accent/60 hover:bg-canvas/70"
          }`}
        >
          {isParsing ? (
            <div className="flex flex-col items-center gap-2 py-3 text-accent">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-xs sm:text-sm font-medium">{locale === "vi" ? "Đang đọc và phân tích cấu trúc file..." : "Reading and parsing file structure..."}</p>
              <p className="text-[11px] text-zinc-400">{locale === "vi" ? "Trích xuất văn bản, bảng biểu, danh mục và tiêu đề" : "Extracting text, tables, categories, and titles"}</p>
            </div>
          ) : fileMeta ? (
            <div className="flex flex-wrap items-center justify-between gap-3 w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent border border-accent/20">
                  {getFileIcon(fileMeta.fileType)}
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-xs sm:text-sm text-zinc-200 truncate">
                      {fileMeta.source}
                    </span>
                    <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent border border-accent/30">
                      {fileMeta.fileType}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    {locale === "vi"
                      ? <>Trích xuất được <strong className="text-zinc-200">{fileMeta.characterCount.toLocaleString()}</strong> ký tự (≈{fileMeta.wordCount.toLocaleString()} từ)</>
                      : <>Extracted <strong className="text-zinc-200">{fileMeta.characterCount.toLocaleString()}</strong> characters (≈{fileMeta.wordCount.toLocaleString()} words)</>}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-border/80 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-colors"
                >
                  {locale === "vi" ? "Chọn file khác" : "Choose other file"}
                </button>
                <button
                  type="button"
                  onClick={clearFile}
                  className="rounded-lg border border-border/80 bg-white/5 p-1.5 text-zinc-400 hover:border-danger/40 hover:bg-danger/10 hover:text-danger transition-colors"
                  title={locale === "vi" ? "Xoá và nhập lại" : "Clear and reset"}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-zinc-400 border border-border/60">
                <UploadCloud className="h-6 w-6 text-accent" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs sm:text-sm font-medium text-zinc-200">
                  {t.knowledge.uploadHint}
                </p>
                <p className="text-[11px] text-zinc-500">
                  PDF, Word (.docx), Markdown (.md), Text (.txt), CSV, JSON, YAML, HTML
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3 text-xs sm:text-sm">
          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
              {t.knowledge.docTitle} <span className="text-accent">*</span>
            </label>
            <input
              required
              placeholder={locale === "vi" ? "Ví dụ: Bảng giá dịch vụ 2026, Quy trình xử lý lỗi kỹ thuật (SOP)..." : "e.g., Pricing 2026, Technical SOP Playbook..."}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-border/80 bg-canvas/60 px-3.5 py-2 text-xs sm:text-sm text-zinc-200 placeholder-zinc-500 outline-none transition-colors focus:border-accent focus:bg-canvas"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-medium text-zinc-400">
                {t.knowledge.docContent} <span className="text-accent">*</span>
              </label>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                <span>{content.length.toLocaleString()} {locale === "vi" ? "ký tự" : "chars"}</span>
                <span>·</span>
                <span>≈ {estimatedChunks} vector chunks</span>
              </div>
            </div>
            <textarea
              required
              rows={7}
              placeholder={locale === "vi" ? "Dán nội dung tài liệu, SOP, quy định, chính sách, playbook vào đây..." : "Paste full document text, SOPs, guidelines, playbooks here..."}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full rounded-xl border border-border/80 bg-canvas/60 p-3.5 text-xs sm:text-sm text-zinc-200 placeholder-zinc-500 outline-none transition-colors focus:border-accent focus:bg-canvas font-mono leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
              {t.knowledge.docSource}
            </label>
            <input
              placeholder="e.g.: pricing_2026.csv, sales_playbook.md, internal_sop"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full rounded-xl border border-border/80 bg-canvas/60 px-3.5 py-2 text-xs sm:text-sm text-zinc-200 placeholder-zinc-500 outline-none transition-colors focus:border-accent focus:bg-canvas font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-border/40">
          <div className="text-[11px] text-zinc-500">
            {content.length > 0 && (
              <button
                type="button"
                onClick={clearFile}
                className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" /> {t.common.reset}
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={ingesting || !content.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2 text-xs sm:text-sm font-semibold text-black shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            {ingesting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.knowledge.ingesting}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {t.knowledge.ingestBtn}
              </>
            )}
          </button>
        </div>
      </form>

      {/* Documents List */}
      <div className="rounded-2xl border border-border/80 bg-panel p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <FileText className="h-4 w-4 text-zinc-400" /> {locale === "vi" ? "Tài liệu đã nạp" : "Ingested Documents"} ({docs.length})
          </h2>
          <button
            onClick={refresh}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            {t.common.refresh}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-zinc-500 justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-accent" /> {t.common.loading}
          </div>
        ) : docs.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-500 space-y-1">
            <p className="font-medium text-zinc-300">{t.knowledge.noDocs}</p>
            <p>{locale === "vi" ? "Hãy tải lên file bảng giá hoặc quy trình công ty ở form trên để AI bắt đầu học." : "Upload pricing files or company SOPs in the form above for AI memory."}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {docs.map((d) => (
              <div
                key={d.documentId}
                className="flex items-center justify-between py-3 px-1 transition-colors hover:bg-white/[0.02]"
              >
                <div className="space-y-1 min-w-0 pr-4">
                  <p className="font-medium text-xs sm:text-sm text-zinc-200 truncate">{d.title}</p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                    <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] text-purple-300 border border-purple-500/20">
                      {d.chunkCount} chunks
                    </span>
                    <span className="font-mono text-zinc-400">{d.source ?? "manual"}</span>
                    <span>·</span>
                    <span>{new Date(d.createdAt).toLocaleString(locale === "vi" ? "vi-VN" : "en-US")}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(d.documentId, d.title)}
                  className="rounded-lg border border-border/60 bg-white/5 p-2 text-zinc-400 transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger shrink-0 cursor-pointer"
                  title={t.common.delete}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Interactive Semantic Search Tester */}
      <div className="rounded-2xl border border-border/80 bg-panel p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Search className="h-4 w-4 text-accent" /> {locale === "vi" ? "Thử nghiệm Semantic Search (Vector Match)" : "Test Semantic Search (Vector Match)"}
          </h2>
          <p className="text-xs text-zinc-500">
            {locale === "vi" ? "Kiểm tra khả năng tìm kiếm ngữ nghĩa của mô hình embedding đối với các tài liệu đã nạp." : "Evaluate semantic retrieval and embedding match precision across ingested docs."}
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            placeholder={t.knowledge.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 rounded-xl border border-border/80 bg-canvas/60 px-3.5 py-2 text-xs sm:text-sm text-zinc-200 placeholder-zinc-500 outline-none transition-colors focus:border-accent focus:bg-canvas"
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-white/5 px-4 py-2 text-xs sm:text-sm font-medium text-zinc-200 hover:bg-white/10 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span>{t.common.search}</span>
          </button>
        </form>

        {results !== null && (
          <div className="space-y-2.5 pt-2 animate-in fade-in duration-150">
            {results.length === 0 ? (
              <p className="text-xs text-zinc-500 italic py-2">
                {locale === "vi" ? "Không tìm thấy đoạn kiến thức nào có độ tương đồng phù hợp với truy vấn." : "No relevant knowledge chunks found matching your search query."}
              </p>
            ) : (
              results.map((r, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/80 bg-canvas/80 p-4 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="font-medium text-zinc-200">{r.title}</span>
                    <span className="rounded bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent border border-accent/20">
                      {locale === "vi" ? `Độ tương đồng: ${(r.score * 100).toFixed(1)}%` : `Similarity: ${(r.score * 100).toFixed(1)}%`}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-zinc-300 leading-relaxed font-sans text-xs bg-zinc-950/40 p-3 rounded-lg border border-border/40">
                    {r.content}
                  </p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}
