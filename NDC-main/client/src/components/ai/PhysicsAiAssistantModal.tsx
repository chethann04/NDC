import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  X,
  Send,
  Bot,
  User,
  ShieldAlert,
  CheckCircle2,
  Clock,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  XCircle,
  Edit3,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { aiService, AssistantMessage, ActionRequired, ConversationLogItem } from '../../services/aiService';
import { MarkdownRenderer } from '../common/MarkdownRenderer';

interface PhysicsAiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onActionApplied?: () => void;
  departmentCode?: string;
  departmentName?: string;
}

interface MessageItem extends AssistantMessage {
  actionRequired?: ActionRequired | null;
  actionExecuted?: boolean;
  actionCancelled?: boolean;
  notification?: {
    deliveryStatus?: 'QUEUED' | 'ACCEPTED' | 'FAILED' | 'UNCERTAIN';
    messageId?: string;
    lastError?: string;
  };
  suggestions?: string[];
}

export const PhysicsAiAssistantModal: React.FC<PhysicsAiAssistantModalProps> = ({
  isOpen,
  onClose,
  onActionApplied,
  departmentCode = 'PHY',
  departmentName = 'Physics Lab'
}) => {
  const isLibrary = departmentCode === 'LIB' || departmentName.toLowerCase().includes('library');
  const isChemistry = departmentCode === 'CHEM' || departmentName.toLowerCase().includes('chemistry');

  const getGreeting = () => {
    if (isLibrary) {
      return `Hello! I am your **${departmentName} AI Assistant**.\n\nI can help you review student library records, check outstanding book dues (overdue textbooks, reference fines, lost book replacement costs), and stage safe clearance approvals with your confirmation.`;
    }
    if (isChemistry) {
      return `Hello! I am your **${departmentName} AI Assistant**.\n\nI can help you review student chemistry lab records, check apparatus breakages (burettes, pipettes, glassware), and stage safe clearance approvals with your confirmation.`;
    }
    return `Hello! I am your **${departmentName} AI Assistant**.\n\nI can help you review student clearance records, look up outstanding equipment dues (spectrometers, lasers, optical benches), and stage safe status approvals with your confirmation.`;
  };

  const storageKey = `ndc_ai_chat_${departmentCode}`;

  const [messages, setMessages] = useState<MessageItem[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      // Ignore parse error
    }
    return [{ role: 'model', content: getGreeting() }];
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [confirmingToken, setConfirmingToken] = useState<string | null>(null);
  const [cancellingToken, setCancellingToken] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Edit state
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<number | string>('');
  const [editReason, setEditReason] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Fetch persisted history from backend when opened
  useEffect(() => {
    if (!isOpen) return;

    scrollToBottom();

    const fetchHistory = async () => {
      try {
        setLoadingHistory(true);
        const historyLogs = await aiService.getConversationHistory(departmentCode, 50);
        if (Array.isArray(historyLogs) && historyLogs.length > 0) {
          const formatted: MessageItem[] = historyLogs.map((log) => ({
            role: log.role as 'user' | 'model',
            content: log.content,
            actionRequired: log.actionRequired,
            suggestions: log.metadata?.suggestions,
            notification: log.metadata?.notification
          }));
          setMessages(formatted);
          localStorage.setItem(storageKey, JSON.stringify(formatted));
        } else if (messages.length <= 1) {
          setMessages([{ role: 'model', content: getGreeting() }]);
        }
      } catch (err) {
        console.warn('Failed to load remote chat history, using local cache:', err);
      } finally {
        setLoadingHistory(false);
      }
    };

    fetchHistory();
  }, [isOpen, departmentCode]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  const handleClearHistory = async () => {
    if (!window.confirm(`Clear active conversation history for ${departmentName}?`)) return;
    try {
      await aiService.clearConversationHistory(departmentCode);
    } catch (err) {
      console.warn('Error clearing backend history:', err);
    }
    localStorage.removeItem(storageKey);
    setMessages([{ role: 'model', content: getGreeting() }]);
    setConfirmSuccess('Conversation history reset.');
    setTimeout(() => setConfirmSuccess(null), 3000);
  };

  if (!isOpen) return null;

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    setErrorMsg(null);
    setConfirmSuccess(null);
    setEditingToken(null);

    const newMessages: MessageItem[] = [
      ...messages,
      { role: 'user', content: text }
    ];

    setMessages(newMessages);
    localStorage.setItem(storageKey, JSON.stringify(newMessages));
    setInput('');
    setLoading(true);

    try {
      const response = await aiService.chatWithAssistant(
        newMessages.map((m) => ({ role: m.role, content: m.content })),
        departmentCode
      );

      const updatedWithReply: MessageItem[] = [
        ...newMessages,
        {
          role: 'model',
          content: response.reply,
          actionRequired: response.actionRequired,
          suggestions: response.suggestions
        }
      ];

      setMessages(updatedWithReply);
      localStorage.setItem(storageKey, JSON.stringify(updatedWithReply));
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to contact AI assistant.');
      const updatedWithError: MessageItem[] = [
        ...newMessages,
        {
          role: 'model',
          content: `⚠️ Sorry, I encountered an issue contacting the clearance engine: ${err.message}`
        }
      ];
      setMessages(updatedWithError);
      localStorage.setItem(storageKey, JSON.stringify(updatedWithError));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = async (token: string, messageIndex: number) => {
    try {
      setConfirmingToken(token);
      setErrorMsg(null);
      const result = await aiService.confirmAssistantAction(token);

      setConfirmSuccess(result.message || 'Action executed successfully.');

      // Mark message action as executed and store notification status
      setMessages((prev) =>
        prev.map((m, idx) =>
          idx === messageIndex
            ? { ...m, actionExecuted: true, notification: result.notification }
            : m
        )
      );

      // Trigger table refresh in parent component
      if (onActionApplied) {
        onActionApplied();
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to confirm action.');
    } finally {
      setConfirmingToken(null);
    }
  };

  const handleCancelAction = async (token: string, messageIndex: number) => {
    try {
      setCancellingToken(token);
      setErrorMsg(null);
      const res = await aiService.cancelAssistantAction(token);
      setConfirmSuccess(res.message || 'Action cancelled successfully. No changes were applied.');
      setMessages((prev) =>
        prev.map((m, idx) =>
          idx === messageIndex
            ? { ...m, actionCancelled: true, actionRequired: null }
            : m
        )
      );
      setEditingToken(null);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to cancel action.');
    } finally {
      setCancellingToken(null);
    }
  };

  const handleStartEdit = (action: ActionRequired) => {
    setEditingToken(action.token);
    setEditAmount(action.amount !== undefined ? action.amount : '');
    setEditReason(action.reason || '');
  };

  const handleSubmitEdit = () => {
    if (!editingToken) return;
    const parts: string[] = [];
    if (editAmount !== '') parts.push(`Change amount to ₹${editAmount}`);
    if (editReason.trim()) parts.push(`Change reason to ${editReason.trim()}`);
    if (parts.length > 0) {
      handleSend(parts.join(' and '));
    }
    setEditingToken(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickPills = isLibrary
    ? [
        'Who has overdue books in Central Library?',
        'Show library clearance summary statistics',
        'Clear dues for 4MC21CS001',
        'Mark ₹150 due for Reference textbook overdue'
      ]
    : isChemistry
    ? [
        'Who has outstanding dues in Chemistry Lab?',
        'Show chemistry clearance summary statistics',
        'Clear dues for 4MC21CS001',
        'Mark ₹200 due for Burette breakage'
      ]
    : [
        `Who has outstanding dues in ${departmentName}?`,
        'Show clearance summary statistics',
        'Clear dues for 4MC21CS001',
        'Mark ₹350 due for Spectrometer Prism damage'
      ];


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[90vh] max-h-[720px] animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-indigo-700 via-indigo-800 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 text-indigo-200">
              <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">
                  {departmentName} Assistant
                </h3>
                <span className="text-[10px] uppercase tracking-wider font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-full">
                  AI Active
                </span>
              </div>
              <p className="text-xs text-indigo-200/80">
                Check student lab records or stage clearance updates.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearHistory}
              className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1 text-xs"
              title="Start New Chat & Clear History"
            >
              <Trash2 className="w-4 h-4 text-rose-300" />
              <span className="hidden sm:inline text-[11px] text-indigo-100 font-medium">New Chat</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              title="Close Assistant"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-3 ${
                msg.role === 'user' ? 'flex-row-reverse' : ''
              }`}
            >
              {/* Avatar */}
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-emerald-600 text-white shadow-xs'
                }`}
              >
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              {/* Message Content with Markdown rendering */}
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-none'
                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                }`}
              >
                {msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <MarkdownRenderer content={msg.content} />
                )}

                {/* Staged Action Confirmation Card */}
                {msg.actionRequired && (
                  <div className="mt-3 p-3.5 rounded-xl border border-amber-200 bg-amber-50/80 text-slate-900 text-xs space-y-2.5">
                    <div className="flex items-center justify-between font-semibold text-amber-900 border-b border-amber-200/60 pb-2">
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-amber-600" />
                        <span>
                          {msg.actionRequired.batchActions && msg.actionRequired.batchActions.length > 1
                            ? `Batch Staged (${msg.actionRequired.batchActions.length} Operations) — Confirmation Required`
                            : 'Action Staged — Confirmation Required'}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-amber-200/80 px-2 py-0.5 rounded text-amber-900 uppercase">
                        {msg.actionRequired.action === 'BATCH_OPERATION'
                          ? `BATCH (${msg.actionRequired.batchActions?.length || 0})`
                          : msg.actionRequired.action === 'CLEAR_DUE'
                          ? 'Clear No Due'
                          : msg.actionRequired.action === 'MARK_DUE'
                          ? 'Add Due'
                          : msg.actionRequired.action}
                      </span>
                    </div>

                    {/* Batch Actions Table / List if multiple actions */}
                    {msg.actionRequired.batchActions && msg.actionRequired.batchActions.length > 1 ? (
                      <div className="space-y-2">
                        <div className="overflow-x-auto rounded-lg border border-amber-200 bg-white">
                          <table className="w-full text-[11px] text-left">
                            <thead className="bg-amber-100/60 text-amber-950 font-semibold border-b border-amber-200">
                              <tr>
                                <th className="p-2">#</th>
                                <th className="p-2">Student</th>
                                <th className="p-2">Operation</th>
                                <th className="p-2">Amount</th>
                                <th className="p-2">Reason / Apparatus</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-amber-100">
                              {msg.actionRequired.batchActions.map((act, bIdx) => (
                                <tr key={bIdx} className="hover:bg-amber-50/50">
                                  <td className="p-2 font-mono text-slate-500">{bIdx + 1}</td>
                                  <td className="p-2">
                                    <div className="font-semibold text-slate-800">{act.studentName || 'Student'}</div>
                                    <div className="font-mono text-[10px] text-slate-500">{act.usn}</div>
                                  </td>
                                  <td className="p-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      act.action === 'MARK_DUE' 
                                        ? 'bg-rose-100 text-rose-800' 
                                        : 'bg-emerald-100 text-emerald-800'
                                    }`}>
                                      {act.action === 'MARK_DUE' ? 'ADD DUE' : 'CLEAR DUE'}
                                    </span>
                                  </td>
                                  <td className="p-2 font-bold text-rose-700">
                                    {act.amount !== undefined ? `₹${act.amount}` : '—'}
                                  </td>
                                  <td className="p-2 text-slate-700 max-w-[140px] truncate" title={act.reason}>
                                    {act.reason || 'Clearance Update'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-500 block">Student Name:</span>
                          <span className="font-semibold">{msg.actionRequired.studentName}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Student USN:</span>
                          <span className="font-mono font-semibold">{msg.actionRequired.usn}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Target Section:</span>
                          <span className="font-semibold text-indigo-900">
                            {msg.actionRequired.labName || departmentName || 'Physics Lab'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Operation:</span>
                          <span className="font-semibold text-slate-900">
                            {msg.actionRequired.action === 'CLEAR_DUE'
                              ? 'Set Clearance to NO DUE'
                              : msg.actionRequired.action === 'MARK_DUE'
                              ? 'Add Outstanding Due'
                              : 'Hold Clearance'}
                          </span>
                        </div>
                        {msg.actionRequired.amount !== undefined && (
                          <div>
                            <span className="text-slate-500 block">Due Amount:</span>
                            <span className="font-bold text-rose-700">₹{msg.actionRequired.amount}</span>
                          </div>
                        )}
                        {msg.actionRequired.reason && (
                          <div className={msg.actionRequired.amount !== undefined ? '' : 'col-span-2'}>
                            <span className="text-slate-500 block">Apparatus / Reason:</span>
                            <span className="font-medium text-slate-800">{msg.actionRequired.reason}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Consequences */}
                    {msg.actionRequired.consequences && (
                      <div className="p-2 rounded-lg bg-amber-100/70 border border-amber-300 text-amber-950 text-[11px] leading-relaxed flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold block">Consequences:</span>
                          <span>{msg.actionRequired.consequences}</span>
                        </div>
                      </div>
                    )}

                    {/* Inline Edit Form */}
                    {editingToken === msg.actionRequired.token && (
                      <div className="p-2.5 rounded-lg bg-white border border-amber-200 space-y-2 mt-2">
                        <span className="font-semibold text-slate-700 block text-[11px]">
                          Edit Staged Action:
                        </span>
                        <div className="grid grid-cols-2 gap-2">
                          {msg.actionRequired.amount !== undefined && (
                            <div>
                              <label className="text-[10px] text-slate-500 block">New Amount (₹):</label>
                              <input
                                type="number"
                                value={editAmount}
                                onChange={(e) => setEditAmount(e.target.value)}
                                className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                                placeholder="Amount"
                              />
                            </div>
                          )}
                          <div className={msg.actionRequired.amount !== undefined ? '' : 'col-span-2'}>
                            <label className="text-[10px] text-slate-500 block">New Reason:</label>
                            <input
                              type="text"
                              value={editReason}
                              onChange={(e) => setEditReason(e.target.value)}
                              className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                              placeholder="Reason"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleSubmitEdit}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold"
                          >
                            Request Fresh Confirmation
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingToken(null)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs"
                          >
                            Cancel Edit
                          </button>
                        </div>
                      </div>
                    )}

                    {msg.actionExecuted ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-emerald-700 font-semibold bg-emerald-100/70 p-2 rounded-lg border border-emerald-200 text-xs">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>Executed and applied to live student clearance records!</span>
                        </div>
                        {msg.notification && (
                          <div className="flex items-center gap-2 text-[11px] font-medium pt-0.5">
                            {msg.notification.deliveryStatus === 'ACCEPTED' && (
                              <span className="text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1 shadow-2xs">
                                ✉️ Email Dispatched {msg.notification.messageId ? `(${msg.notification.messageId})` : ''}
                              </span>
                            )}
                            {msg.notification.deliveryStatus === 'QUEUED' && (
                              <span className="text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded flex items-center gap-1 shadow-2xs">
                                ✉️ Email Queued
                              </span>
                            )}
                            {msg.notification.deliveryStatus === 'UNCERTAIN' && (
                              <span className="text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1 shadow-2xs" title="HTTP timeout; automatic duplicate retry aborted">
                                ⚠️ Delivery Uncertain (Timeout - Retry Blocked)
                              </span>
                            )}
                            {msg.notification.deliveryStatus === 'FAILED' && (
                              <span className="text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded flex items-center gap-1 shadow-2xs">
                                ❌ Email Failed: {msg.notification.lastError || 'Undelivered'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="pt-1 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirmAction(msg.actionRequired!.token, idx)}
                          disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                          className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 min-w-[120px]"
                        >
                          {confirmingToken === msg.actionRequired.token ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          <span>Confirm & Save</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleStartEdit(msg.actionRequired!)}
                          disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                          className="py-1.5 px-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold rounded-lg text-xs flex items-center justify-center gap-1 shadow-2xs transition-colors disabled:opacity-50"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCancelAction(msg.actionRequired!.token, idx)}
                          disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                          className="py-1.5 px-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold rounded-lg text-xs flex items-center justify-center gap-1 shadow-2xs transition-colors disabled:opacity-50"
                        >
                          {cancellingToken === msg.actionRequired.token ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-rose-600" />
                          )}
                          <span>Cancel</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Cancelled state */}
                {msg.actionCancelled && (
                  <div className="mt-3 p-2.5 rounded-xl border border-slate-200 bg-slate-100 text-slate-600 text-xs flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-slate-500 shrink-0" />
                    <span><strong>Action Cancelled:</strong> Token invalidated. No changes were made.</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-3 animate-fade-in-up">
              <div className="relative w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white flex items-center justify-center text-xs shadow-xs shrink-0">
                <Bot className="w-4 h-4 relative z-10" />
                <span className="absolute -inset-1 rounded-full bg-indigo-400/30 animate-aura-pulse pointer-events-none" />
              </div>
              <div className="bg-gradient-to-r from-indigo-50/70 via-white to-purple-50/50 border border-indigo-100 rounded-2xl rounded-tl-none px-4 py-2.5 text-xs text-slate-700 flex items-center gap-2.5 shadow-xs">
                <div className="relative flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                  <span className="absolute -inset-1 rounded-full bg-indigo-400/25 animate-ping opacity-60" />
                </div>
                <span className="font-medium text-slate-700">Consulting live database & formulating response</span>
                <span className="inline-flex items-center gap-1.5 pl-1">
                  <span className="ai-typing-dot ai-typing-dot-1" />
                  <span className="ai-typing-dot ai-typing-dot-2" />
                  <span className="ai-typing-dot ai-typing-dot-3" />
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Global Notifications inside modal */}
        {errorMsg && (
          <div className="px-4 py-2 bg-rose-50 border-t border-rose-200 text-rose-700 text-xs flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {errorMsg}
            </span>
            <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {confirmSuccess && (
          <div className="px-4 py-2 bg-emerald-50 border-t border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              {confirmSuccess}
            </span>
            <button onClick={() => setConfirmSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Quick Suggestion Pills */}
        <div className="px-4 py-2 bg-white border-t border-slate-100 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
          <span className="text-[11px] font-semibold text-slate-400 shrink-0">Suggested:</span>
          {(([...messages].reverse().find((m) => m.role === 'model' && m.suggestions && m.suggestions.length > 0)?.suggestions) || quickPills).map((pill, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSend(pill)}
              disabled={loading}
              className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 border border-slate-200 rounded-full text-xs text-slate-700 transition-colors shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {pill}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="p-3 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about ${departmentName} dues, student status, or approve clearances...`}
            disabled={loading}
            className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all disabled:opacity-50"
          />

          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            title="Send query"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
