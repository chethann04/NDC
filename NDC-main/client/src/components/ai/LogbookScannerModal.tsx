import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  X,
  Sparkles,
  Save,
  CheckSquare,
  Square,
  ShieldCheck,
  Edit2,
  RefreshCw,
  Search,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Eye,
  Target,
  Layers,
  Info,
  Lock
} from 'lucide-react';
import {
  aiService,
  ScanJob,
  ScanEntry,
  checkEntryApprovalEligibility,
  parseEntryForensics
} from '../../services/aiService';

interface LogbookScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDuesApplied?: () => void;
  departmentId?: string;
  departmentName?: string;
}

export const LogbookScannerModal: React.FC<LogbookScannerModalProps> = ({
  isOpen,
  onClose,
  onDuesApplied,
  departmentId,
  departmentName = 'Physics Lab'
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [scanJob, setScanJob] = useState<ScanJob | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ usn: string; amount: number; reason: string }>({
    usn: '',
    amount: 0,
    reason: ''
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyingEntryId, setApplyingEntryId] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ appliedCount: number; message: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [showProcessed, setShowProcessed] = useState<boolean>(false);
  const [appliedNotifications, setAppliedNotifications] = useState<Record<string, { deliveryStatus?: string; messageId?: string; lastError?: string }>>({});
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setErrorMsg(null);
      setScanJob(null);
      setApplyResult(null);

      if (selected.type.startsWith('image/')) {
        const url = URL.createObjectURL(selected);
        setPreviewUrl(url);
      } else {
        setPreviewUrl(null);
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setErrorMsg(null);
      setScanJob(null);
      setApplyResult(null);

      if (dropped.type.startsWith('image/')) {
        setPreviewUrl(URL.createObjectURL(dropped));
      } else {
        setPreviewUrl(null);
      }
    }
  };

  const handleExtract = async () => {
    if (!file || extracting) return;

    try {
      setExtracting(true);
      setErrorMsg(null);
      setApplyResult(null);

      const job = await aiService.uploadLogbook(file, departmentId);
      setScanJob(job);

      // Pre-select ONLY eligible entries by default
      const eligibleIds = job.entries
        .filter((e) => checkEntryApprovalEligibility(e).isEligible)
        .map((e) => e.id);
      setSelectedEntryIds(new Set(eligibleIds));
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Logbook OCR extraction failed.');
    } finally {
      setExtracting(false);
    }
  };

  const handleToggleSelect = (entry: ScanEntry) => {
    const { isEligible } = checkEntryApprovalEligibility(entry);
    if (!isEligible) return;
    const next = new Set(selectedEntryIds);
    if (next.has(entry.id)) next.delete(entry.id);
    else next.add(entry.id);
    setSelectedEntryIds(next);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked && scanJob) {
      // Select-all must select ONLY eligible entries
      const allEligible = scanJob.entries
        .filter((e) => checkEntryApprovalEligibility(e).isEligible)
        .map((e) => e.id);
      setSelectedEntryIds(new Set(allEligible));
    } else {
      setSelectedEntryIds(new Set());
    }
  };

  const handleStartEdit = (entry: ScanEntry) => {
    setEditingEntryId(entry.id);
    setEditForm({
      usn: entry.correctedUsn || entry.extractedUsn,
      amount: entry.correctedAmount ?? entry.extractedAmount,
      reason: entry.correctedReason || entry.extractedReason
    });
  };

  const handleCancelEdit = () => {
    setEditingEntryId(null);
  };

  const handleSaveEdit = async (entryId: string) => {
    try {
      setSavingEdit(true);
      const updated = await aiService.updateScanEntry(entryId, {
        correctedUsn: editForm.usn.trim(),
        correctedAmount: Number(editForm.amount),
        correctedReason: editForm.reason.trim()
      });

      // Update in state
      if (scanJob) {
        const updatedEntries = scanJob.entries.map((e) => (e.id === entryId ? { ...e, ...updated } : e));
        setScanJob({
          ...scanJob,
          entries: updatedEntries
        });

        // If newly eligible, select it
        if (checkEntryApprovalEligibility(updated).isEligible) {
          setSelectedEntryIds((prev) => new Set([...prev, entryId]));
        }
      }

      setEditingEntryId(null);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to update entry.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Independent Single-Entry Approval
  const handleApplySingleEntry = async (entry: ScanEntry) => {
    const eligibility = checkEntryApprovalEligibility(entry);
    if (!eligibility.isEligible || applying || applyingEntryId) return;

    try {
      setApplyingEntryId(entry.id);
      setErrorMsg(null);

      const result = await aiService.applyScanEntries(scanJob!.id, [entry.id]);

      if (result.results && Array.isArray(result.results)) {
        const notifMap: Record<string, any> = {};
        for (const r of result.results) {
          if (r.entryId && r.notification) {
            notifMap[r.entryId] = r.notification;
          }
        }
        setAppliedNotifications((prev) => ({ ...prev, ...notifMap }));
      }

      setApplyResult({
        appliedCount: result.appliedCount,
        message: `Successfully approved & applied due of ₹${entry.correctedAmount ?? entry.extractedAmount} for ${
          entry.matchedStudentName || entry.matchedStudentUsn || entry.extractedUsn
        }.`
      });

      const refreshedJob = await aiService.getScanJob(scanJob!.id);
      setScanJob(refreshedJob);
      setSelectedEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });

      if (onDuesApplied) {
        onDuesApplied();
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to apply due.');
    } finally {
      setApplyingEntryId(null);
    }
  };

  const handleApplyDues = async () => {
    if (!scanJob || selectedEntryIds.size === 0 || applying || applyingEntryId) return;

    try {
      setApplying(true);
      setErrorMsg(null);

      const result = await aiService.applyScanEntries(scanJob.id, Array.from(selectedEntryIds));

      if (result.results && Array.isArray(result.results)) {
        const notifMap: Record<string, any> = {};
        for (const r of result.results) {
          if (r.entryId && r.notification) {
            notifMap[r.entryId] = r.notification;
          }
        }
        setAppliedNotifications((prev) => ({ ...prev, ...notifMap }));
      }

      setApplyResult({
        appliedCount: result.appliedCount,
        message: `Successfully applied ${result.appliedCount} student dues directly to live departmental clearance records.`
      });

      // Refresh scan job data
      const refreshedJob = await aiService.getScanJob(scanJob.id);
      setScanJob(refreshedJob);
      setSelectedEntryIds(new Set());

      // Trigger table refresh in parent component
      if (onDuesApplied) {
        onDuesApplied();
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to apply dues.');
    } finally {
      setApplying(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreviewUrl(null);
    setScanJob(null);
    setSelectedEntryIds(new Set());
    setErrorMsg(null);
    setApplyResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const eligibleEntriesCount = scanJob
    ? scanJob.entries.filter((e) => checkEntryApprovalEligibility(e).isEligible).length
    : 0;

  const selectedTotal = scanJob
    ? scanJob.entries
        .filter((e) => selectedEntryIds.has(e.id))
        .reduce((sum, e) => sum + (e.correctedAmount ?? e.extractedAmount), 0)
    : 0;

  const filteredEntries = (scanJob?.entries || []).filter((entry) => {
    if (!searchFilter.trim()) return true;
    const query = searchFilter.toLowerCase();
    const usn = (entry.correctedUsn || entry.extractedUsn || '').toLowerCase();
    const name = (entry.matchedStudentName || '').toLowerCase();
    const reason = (entry.correctedReason || entry.extractedReason || '').toLowerCase();
    return usn.includes(query) || name.includes(query) || reason.includes(query);
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[92vh] max-h-[850px] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-blue-700 via-indigo-800 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 text-blue-200">
              <Sparkles className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">
                  Scan Lab Register — {departmentName}
                </h3>
                <span className="text-[10px] uppercase tracking-wider font-semibold bg-blue-500/30 text-blue-200 border border-blue-400/30 px-2 py-0.5 rounded-full">
                  Scanner Active
                </span>
              </div>
              <p className="text-xs text-blue-200/80">
                Upload register photo to extract and record student equipment dues
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Close Scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 bg-slate-50/50 space-y-5">
          {/* Notification Messages */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-700">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {applyResult && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-bold block text-sm">Clearance Dues Successfully Applied!</span>
                  <span>{applyResult.message}</span>
                </div>
              </div>
              <button onClick={() => setApplyResult(null)} className="text-emerald-500 hover:text-emerald-700">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* STAGE 1: Upload Dropzone if no scanJob exists yet */}
          {!scanJob && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all ${
                  file
                    ? 'border-indigo-400 bg-indigo-50/40'
                    : 'border-slate-300 hover:border-indigo-500 hover:bg-slate-100/50 bg-white'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  className="hidden"
                />

                <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 mx-auto flex items-center justify-center mb-4 shadow-xs">
                  {file?.type.startsWith('image/') ? (
                    <ImageIcon className="w-7 h-7" />
                  ) : file ? (
                    <FileText className="w-7 h-7" />
                  ) : (
                    <UploadCloud className="w-7 h-7" />
                  )}
                </div>

                {file ? (
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">{file.name}</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      {(file.size / (1024 * 1024)).toFixed(2)} MB • {file.type || 'Document'}
                    </p>
                    <p className="text-xs text-indigo-600 font-semibold mt-2">
                      Click to choose another file or drag & drop to replace
                    </p>
                  </div>
                ) : (
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">
                      Upload Lab Breakage / Due Logbook
                    </h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Drag and drop image (JPG, PNG) or PDF of handwritten register
                    </p>
                    <span className="inline-block mt-3 px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-full border border-indigo-200">
                      Browse Files
                    </span>
                  </div>
                )}
              </div>

              {previewUrl && (
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <span className="text-xs font-semibold text-slate-500 block mb-2">Image Preview:</span>
                  <div className="max-h-56 overflow-hidden rounded-lg flex items-center justify-center bg-slate-900/5">
                    <img src={previewUrl} alt="Preview" className="max-h-56 object-contain" />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={!file || extracting}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {extracting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Scanning Image for Dues...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      <span>Scan Image for Dues</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STAGE 2: Verification Data Grid once scanJob exists */}
          {scanJob && (
            <div className="space-y-4">
              {/* Summary Stats Header */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3 rounded-xl border border-slate-200">
                  <span className="text-[11px] font-semibold text-slate-400 block">Total Extracted</span>
                  <span className="text-lg font-bold text-slate-800">{scanJob.totalEntries}</span>
                </div>
                <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-200">
                  <span className="text-[11px] font-semibold text-emerald-700 block">Matched Students</span>
                  <span className="text-lg font-bold text-emerald-800">{scanJob.matchedEntries}</span>
                </div>
                <div className="bg-amber-50/60 p-3 rounded-xl border border-amber-200">
                  <span className="text-[11px] font-semibold text-amber-700 block">Needs Correction</span>
                  <span className="text-lg font-bold text-amber-800">{scanJob.unmatchedEntries}</span>
                </div>
                <div className="bg-indigo-50/60 p-3 rounded-xl border border-indigo-200">
                  <span className="text-[11px] font-semibold text-indigo-700 block">Already Applied</span>
                  <span className="text-lg font-bold text-indigo-800">{scanJob.appliedEntries}</span>
                </div>
              </div>

              {/* Original Document Reference Inspection Viewer */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs p-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 border-b border-slate-100 gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileText className="w-3.5 h-3.5 text-indigo-600" />
                    <span className="font-bold text-slate-800 text-xs">
                      Document Reference: <span className="text-slate-500 font-normal">{scanJob.originalFilename}</span>
                    </span>
                    <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold border border-indigo-100">
                      {scanJob.totalEntries === 1 ? '1 Visible Entry' : `${scanJob.totalEntries} Visible Entries`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRotation((r) => (r + 90) % 360)}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      title="Rotate Document 90°"
                    >
                      <RotateCw className="w-3 h-3" />
                      <span>{rotation}°</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                      className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition-colors cursor-pointer"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-3 h-3" />
                    </button>
                    <span className="text-[11px] font-mono text-slate-500 min-w-8 text-center">{Math.round(zoom * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                      className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition-colors cursor-pointer"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowProcessed((s) => !s)}
                      className={`px-2 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                        showProcessed ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                      title="Toggle Enhanced Contrast"
                    >
                      <Eye className="w-3 h-3" />
                      <span>{showProcessed ? 'Enhanced' : 'Original'}</span>
                    </button>
                  </div>
                </div>

                <div className="mt-2 max-h-64 overflow-auto bg-slate-900/5 rounded-lg p-2 flex items-center justify-center border border-slate-100">
                  <img
                    src={previewUrl || aiService.getJobImageUrl(scanJob.id, showProcessed)}
                    alt="Scanned logbook reference"
                    style={{
                      transform: `rotate(${rotation}deg) scale(${zoom})`,
                      transition: 'transform 0.2s ease-in-out',
                      transformOrigin: 'center center'
                    }}
                    className="max-h-60 object-contain rounded shadow-xs"
                  />
                </div>
              </div>

              {/* Stage Metrics & Extraction Pipeline Discrepancy Banner */}
              {scanJob.extractionRaw && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Layers className="w-3.5 h-3.5 text-indigo-600" />
                      <span className="text-xs font-bold text-slate-800">
                        Layout Analysis & Candidate Pipeline
                      </span>
                      {scanJob.extractionRaw.layoutType && (
                        <span className="text-[9px] font-semibold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                          {scanJob.extractionRaw.layoutType}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap text-[10px]">
                      <span className="px-2 py-0.5 bg-white border border-slate-200 rounded text-slate-700">
                        Physical Lines: <strong>{scanJob.extractionRaw.stageMetrics?.detectedRowCount ?? scanJob.extractionRaw.detectedRowCount ?? scanJob.totalEntries}</strong>
                      </span>
                      <span className="px-2 py-0.5 bg-white border border-slate-200 rounded text-indigo-700">
                        Candidates: <strong>{scanJob.totalEntries}</strong>
                      </span>
                      {Boolean(scanJob.extractionRaw.stageMetrics?.blankLinesSkippedCount) && (
                        <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600">
                          Empty Skipped: <strong>{scanJob.extractionRaw.stageMetrics?.blankLinesSkippedCount}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  {scanJob.extractionRaw.stageMetrics?.discrepancyExplanation && (
                    <div className="mt-2 pt-2 border-t border-slate-200/70 flex items-start gap-1.5 text-[11px] text-slate-600">
                      <Info className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold text-slate-800">Tracking: </span>
                        <span>{scanJob.extractionRaw.stageMetrics.discrepancyExplanation}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Extraction Table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        onChange={handleSelectAll}
                        disabled={eligibleEntriesCount === 0 || applying || applyingEntryId !== null}
                        checked={
                          selectedEntryIds.size > 0 &&
                          selectedEntryIds.size === eligibleEntriesCount
                        }
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                      />
                      <span>Select All Ready ({eligibleEntriesCount} ready to add)</span>
                    </label>
                    <span className="text-xs text-slate-500">
                      ({selectedEntryIds.size} selected • Total: ₹{selectedTotal})
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5 flex-wrap">
                    <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 hover:text-slate-900 text-xs font-semibold select-none bg-white border border-slate-200 px-2.5 py-1.5 rounded-lg shadow-2xs">
                      <input
                        type="checkbox"
                        checked={showTechnicalDetails}
                        onChange={(e) => setShowTechnicalDetails(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span>Show OCR Details</span>
                    </label>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                      <input
                        type="text"
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                        placeholder="Search USN, name..."
                        className="pl-7 pr-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs focus:outline-hidden focus:ring-1 focus:ring-indigo-500 w-36 sm:w-44"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleReset}
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Upload Another</span>
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200">
                        <th className="py-2.5 px-3 w-10 text-center">#</th>
                        <th className="py-2.5 px-3 min-w-[200px]">Student</th>
                        <th className="py-2.5 px-3 min-w-[170px]">Reason / Apparatus</th>
                        <th className="py-2.5 px-3 w-24">Amount</th>
                        <th className="py-2.5 px-3 min-w-[150px]">Status</th>
                        {showTechnicalDetails && (
                          <th className="py-2.5 px-3 min-w-[180px]">OCR Raw Text & Confidence</th>
                        )}
                        <th className="py-2.5 px-3 text-right min-w-[140px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredEntries.map((entry) => {
                        const isEditing = editingEntryId === entry.id;
                        const isSelected = selectedEntryIds.has(entry.id);
                        const isApplied = entry.status === 'APPLIED';
                        const isSingleApplying = applyingEntryId === entry.id;
                        const displayUsn = entry.correctedUsn || entry.extractedUsn;
                        const displayAmount = entry.correctedAmount ?? entry.extractedAmount;
                        const displayReason = entry.correctedReason || entry.extractedReason;

                        const rawMeta = scanJob.extractionRaw?.entries?.[entry.entryIndex - 1] || null;
                        const forensics = parseEntryForensics(entry, rawMeta);
                        const eligibility = checkEntryApprovalEligibility(entry);

                        return (
                          <tr
                            key={entry.id}
                            className={`hover:bg-slate-50/80 transition-colors ${
                              isApplied ? 'bg-emerald-50/20 opacity-75' : !eligibility.isEligible ? 'bg-amber-50/15' : ''
                            }`}
                          >
                            {/* Checkbox & Index */}
                            <td className="py-3 px-3 align-top text-center">
                              <div className="flex flex-col items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={!eligibility.isEligible || isApplied || applying || isSingleApplying}
                                  onChange={() => handleToggleSelect(entry)}
                                  title={eligibility.isEligible ? 'Select for approval' : eligibility.blockerReason}
                                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30 cursor-pointer"
                                />
                                <span className="text-[10px] font-mono text-slate-400">
                                  #{entry.entryIndex}
                                </span>
                              </div>
                            </td>

                            {/* Student Details: USN and Matched Name */}
                            <td className="py-3 px-3 align-top">
                              {isEditing ? (
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-500 uppercase">Student USN</label>
                                  <input
                                    type="text"
                                    value={editForm.usn}
                                    onChange={(e) => setEditForm({ ...editForm, usn: e.target.value.toUpperCase() })}
                                    placeholder="e.g. 4MC24IS022"
                                    className="w-full px-2 py-1 bg-white border border-indigo-500 rounded text-xs font-mono font-bold uppercase focus:ring-1 focus:ring-indigo-500"
                                  />
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-mono font-bold text-slate-900 text-xs">
                                      {displayUsn || <span className="text-rose-500 italic">No USN</span>}
                                    </span>
                                    {entry.matchedStudentName && (
                                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                                        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" /> Matched
                                      </span>
                                    )}
                                  </div>

                                  {entry.matchedStudentName ? (
                                    <div className="font-medium text-slate-700 text-xs">
                                      {entry.matchedStudentName}
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                        <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                                        <span>Not in database</span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleStartEdit(entry)}
                                        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold underline cursor-pointer"
                                      >
                                        Edit USN
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Reason / Apparatus */}
                            <td className="py-3 px-3 align-top">
                              {isEditing ? (
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-500 uppercase">Reason / Apparatus</label>
                                  <input
                                    type="text"
                                    value={editForm.reason}
                                    onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                                    placeholder="e.g. Breaking thermometer"
                                    className="w-full px-2 py-1 bg-white border border-indigo-500 rounded text-xs focus:ring-1 focus:ring-indigo-500"
                                  />
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  <span className="text-slate-800 text-xs font-medium block">
                                    {displayReason || <span className="text-slate-400 italic">None</span>}
                                  </span>
                                  {forensics.isCrossedOut && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1 py-0.5 rounded">
                                      <AlertTriangle className="w-2.5 h-2.5" /> Struck out
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>

                            {/* Amount */}
                            <td className="py-3 px-3 align-top">
                              {isEditing ? (
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-500 uppercase">Amount (₹)</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={editForm.amount}
                                    onChange={(e) => setEditForm({ ...editForm, amount: Number(e.target.value) })}
                                    className="w-20 px-2 py-1 bg-white border border-indigo-500 rounded text-xs font-bold focus:ring-1 focus:ring-indigo-500"
                                  />
                                </div>
                              ) : displayAmount > 0 ? (
                                <span className="font-bold text-slate-900 text-xs">
                                  ₹{displayAmount}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                  ⚠️ Amount
                                </span>
                              )}
                            </td>

                            {/* Status */}
                            <td className="py-3 px-3 align-top">
                              <div className="space-y-1">
                                {isApplied ? (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
                                      <Check className="w-3 h-3 text-emerald-700" /> Added to NDC
                                    </span>
                                    {appliedNotifications[entry.id] && (
                                      <div className="text-[9px] font-medium pt-0.5 text-slate-500">
                                        {appliedNotifications[entry.id].deliveryStatus === 'ACCEPTED' && '✉️ Email Sent'}
                                        {appliedNotifications[entry.id].deliveryStatus === 'QUEUED' && '✉️ Email Queued'}
                                        {appliedNotifications[entry.id].deliveryStatus === 'UNCERTAIN' && '⚠️ Email Uncertain'}
                                        {appliedNotifications[entry.id].deliveryStatus === 'FAILED' && '❌ Email Failed'}
                                      </div>
                                    )}
                                  </div>
                                ) : eligibility.isEligible ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Ready to Approve
                                  </span>
                                ) : (
                                  <div className="space-y-0.5">
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                      <AlertCircle className="w-3 h-3 text-amber-600" /> Action Needed
                                    </span>
                                    <p className="text-[9px] text-slate-500 leading-tight">
                                      {!entry.matchedStudentName
                                        ? 'Edit USN to match student'
                                        : displayAmount <= 0
                                        ? 'Enter due amount'
                                        : 'Review details'}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Optional Technical Details */}
                            {showTechnicalDetails && (
                              <td className="py-3 px-3 align-top max-w-xs">
                                <div className="space-y-1 text-[10px]">
                                  <div className="flex items-center gap-1 text-slate-500">
                                    <span>P{forensics.pageNumber}:R{forensics.rowNumber}</span>
                                    <span className="font-bold text-indigo-700 font-mono">({forensics.confidencePercent}%)</span>
                                  </div>
                                  {forensics.rawText && (
                                    <div className="bg-slate-100 rounded px-1.5 py-0.5 font-mono text-slate-600 truncate max-w-[180px]" title={forensics.rawText}>
                                      "{forensics.rawText}"
                                    </div>
                                  )}
                                </div>
                              </td>
                            )}

                            {/* Actions */}
                            <td className="py-3 px-3 align-top text-right">
                              <div className="flex items-center justify-end gap-1">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEdit(entry.id)}
                                      disabled={savingEdit}
                                      className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                    >
                                      {savingEdit ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                      <span>Save</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleCancelEdit}
                                      disabled={savingEdit}
                                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded font-medium text-xs cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleStartEdit(entry)}
                                      disabled={isApplied}
                                      className="px-2 py-1 text-slate-700 hover:text-indigo-700 hover:bg-indigo-50 border border-slate-200 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="Edit USN, Amount, or Reason"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                      <span>Edit</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleApplySingleEntry(entry)}
                                      disabled={!eligibility.isEligible || isApplied || applying || isSingleApplying}
                                      title={
                                        isApplied
                                          ? 'Already applied to database'
                                          : eligibility.isEligible
                                          ? 'Approve and apply this entry'
                                          : 'Cannot approve until USN matches a registered student'
                                      }
                                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold flex items-center gap-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                    >
                                      {isSingleApplying ? (
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <Check className="w-3 h-3" />
                                      )}
                                      <span>{isApplied ? 'Added' : 'Add Due'}</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Bar */}
              <div className="p-4 bg-white rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-slate-600">
                  <span className="font-semibold text-slate-800">{selectedEntryIds.size}</span> student dues
                  selected for application • Total amount:{' '}
                  <span className="font-bold text-rose-700">₹{selectedTotal}</span>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 sm:flex-none px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    Close
                  </button>

                  <button
                    type="button"
                    onClick={handleApplyDues}
                    disabled={selectedEntryIds.size === 0 || applying || applyingEntryId !== null}
                    className="flex-1 sm:flex-none px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {applying ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Saving Dues to Database...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>Add {selectedEntryIds.size} Selected Dues to Records</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
