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
import { useAuthStore } from '../../store/useAuthStore';
import { usePortalContext } from '../../context/PortalContext';

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
  actionExpired?: boolean;
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
  departmentCode: propDeptCode,
  departmentName: propDeptName
}) => {
  const { user } = useAuthStore();
  const { context } = usePortalContext();

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const departmentCode = propDeptCode || context?.department?.code || (isAdmin ? 'ADM' : 'PHY');
  const departmentName = propDeptName || context?.department?.name || (isAdmin ? 'Administration Block' : 'Clearance Desk');

  const isLibrary = departmentCode === 'LIB' || departmentName.toLowerCase().includes('library');
  const isChemistry = departmentCode === 'CHEM' || departmentName.toLowerCase().includes('chemistry');

  const getGreeting = () => {
    if (context?.assistantConfig?.greeting && !propDeptCode) {
      return context.assistantConfig.greeting;
    }
    if (departmentCode === 'ADM' || isAdmin) {
      return `Hi! What institutional clearance records or departments would you like to review today?`;
    }
    return `Hi! What clearance records or student dues would you like to check for **${departmentName}** today?`;
  };

  const storageKey = `ndc_ai_chat_${user?.id || 'officer'}_${departmentCode}`;
  const activeConversationKey = `${storageKey}_active`;
  const [conversationId, setConversationId] = useState(() => localStorage.getItem(activeConversationKey) || 'legacy');
  const [conversations, setConversations] = useState<{ id: string; title: string; updatedAt: string; messageCount: number }[]>([]);
  const [showHistory, setShowHistory] = useState(false);

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
        const [historyLogs, savedConversations] = await Promise.all([
          aiService.getConversationHistory(departmentCode, 100, conversationId),
          aiService.getConversationList(departmentCode)
        ]);
        setConversations(savedConversations);
        if (Array.isArray(historyLogs) && historyLogs.length > 0) {
          const formatted: MessageItem[] = historyLogs.map((log) => ({
            role: log.role as 'user' | 'model',
            content: log.content,
            actionRequired: log.actionRequired,
            actionExecuted: log.actionExecuted,
            actionCancelled: log.actionCancelled,
            actionExpired: log.actionExpired,
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
  }, [isOpen, departmentCode, conversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length]);

  useEffect(() => {
    localStorage.setItem(activeConversationKey, conversationId);
  }, [activeConversationKey, conversationId]);

  const handleNewChat = () => {
    const nextId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setConversationId(nextId);
    setMessages([{ role: 'model', content: getGreeting() }]);
    setShowHistory(false);
    setInput('');
  };

  const handleOpenChat = (id: string) => {
    setConversationId(id);
    setShowHistory(false);
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
        departmentCode,
        conversationId
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
    aiService.getConversationList(departmentCode).then(setConversations).catch(() => undefined);
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

      // Mark message action as executed and append completion message
      setMessages((prev) => {
        const updated = prev.map((m, idx) =>
          idx === messageIndex
            ? { ...m, actionExecuted: true, actionRequired: null, notification: result.notification }
            : m
        );
        if (result.completionReply) {
          updated.push({
            role: 'model',
            content: result.completionReply,
            suggestions: [
              `Show pending dues in ${departmentName}`,
              ...(result.usn ? [`Lookup student ${result.usn}`] : []),
              `Show ${departmentName} clearance summary`
            ]
          });
        }
        localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });

      // Trigger table refresh in parent component and globally
      if (onActionApplied) {
        onActionApplied();
      }
      window.dispatchEvent(new CustomEvent('ndc_clearance_updated'));
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Failed to confirm action.';
      setErrorMsg(errMsg);
      if (errMsg.includes('already been confirmed and executed') || errMsg.includes('already confirmed')) {
        setMessages((prev) => {
          const updated = prev.map((m, idx) =>
            idx === messageIndex
              ? { ...m, actionExecuted: true, actionRequired: m.actionRequired ? { ...m.actionRequired, lifecycleStatus: 'EXECUTED' as const } : null }
              : m
          );
          localStorage.setItem(storageKey, JSON.stringify(updated));
          return updated;
        });
      }
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
      setMessages((prev) => {
        const updated = prev.map((m, idx) =>
          idx === messageIndex
            ? { ...m, actionCancelled: true, actionRequired: null }
            : m
        );
        if (res.completionReply) {
          updated.push({
            role: 'model',
            content: res.completionReply,
            suggestions: [
              `Show pending dues in ${departmentName}`,
              `Show ${departmentName} clearance summary`
            ]
          });
        }
        localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });
      setEditingToken(null);
      window.dispatchEvent(new CustomEvent('ndc_clearance_updated'));
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Failed to cancel action.';
      setErrorMsg(errMsg);
      if (errMsg.includes('already confirmed and executed') || errMsg.includes('already been confirmed')) {
        setMessages((prev) => {
          const updated = prev.map((m, idx) =>
            idx === messageIndex
              ? { ...m, actionExecuted: true, actionRequired: m.actionRequired ? { ...m.actionRequired, lifecycleStatus: 'EXECUTED' as const } : null }
              : m
          );
          localStorage.setItem(storageKey, JSON.stringify(updated));
          return updated;
        });
      }
    } finally {
      setCancellingToken(null);
    }
  };

  const handleStartEdit = (action: ActionRequired) => {
    setEditingToken(action.token);
    setEditAmount(action.amount !== undefined ? action.amount : '');
    setEditReason(action.reason || '');
  };

  const handleSubmitEdit = async () => {
    if (!editingToken) return;
    try {
      setLoading(true);
      setErrorMsg(null);
      const parsedAmount = editAmount !== '' ? Number(editAmount) : undefined;
      const res = await aiService.editAssistantAction({
        token: editingToken,
        amount: parsedAmount,
        reason: editReason.trim() || undefined
      });

      // Update current message with new token and reply without executing
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.actionRequired?.token === editingToken
            ? {
                ...m,
                actionRequired: res.actionRequired,
                content: res.reply || m.content
              }
            : m
        );
        localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });

      setConfirmSuccess('Staged action details updated successfully.');
      setEditingToken(null);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to update staged action.');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickPills =
    context?.assistantConfig?.suggestedQueries && context.assistantConfig.suggestedQueries.length > 0 && !propDeptCode
      ? context.assistantConfig.suggestedQueries
      : departmentCode === 'ADM' || isAdmin
      ? [
          'Show institution-wide clearance summary',
          'Which departments have pending clearance requests?',
          'Lookup student 4MC21CS001 across all departments',
          'Show students blocked from certificate generation'
        ]
      : isLibrary
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
          `Show ${departmentName} clearance summary`,
          'Clear dues for 4MC21CS001',
          `Add due for USN 4MC21CS001 in ${departmentName}`
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
              onClick={handleNewChat}
              className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors flex items-center gap-1 text-xs"
              title="Start a separate conversation"
            >
              <Sparkles className="w-4 h-4 text-indigo-200" />
              <span className="hidden sm:inline text-[11px] text-indigo-100 font-medium">New Chat</span>
            </button>
            <button type="button" onClick={() => setShowHistory((open) => !open)} className="px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 rounded">
              Chats ({conversations.length})
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

        {showHistory && <div className="max-h-40 overflow-y-auto bg-white border-b p-2 space-y-1">
          {conversations.map((chat) => <button key={chat.id} onClick={() => handleOpenChat(chat.id)} className={`block w-full text-left rounded px-2 py-1.5 text-xs hover:bg-indigo-50 ${conversationId === chat.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}>
            <span className="block truncate font-semibold">{chat.title || 'New conversation'}</span>
            <span className="text-slate-400">{chat.messageCount} messages · {new Date(chat.updatedAt).toLocaleDateString()}</span>
          </button>)}
          {conversations.length === 0 && <p className="p-2 text-xs text-slate-500">No saved chats yet.</p>}
        </div>}

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

                {/* Staged Action Confirmation Box */}
                {msg.actionRequired && !msg.actionExecuted && (
                  <>
                    {msg.actionCancelled ? (
                      <div className="mt-3 p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs flex items-center gap-2">
                        <XCircle className="w-4 h-4 text-slate-500 shrink-0" />
                        <span>The staged action has been cancelled. No changes were made to the database.</span>
                      </div>
                    ) : msg.actionExpired ? (
                      <div className="mt-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>This confirmation token has expired. Please initiate the request again.</span>
                      </div>
                    ) : msg.actionRequired.batchActions && msg.actionRequired.batchActions.length > 1 ? (
                      /* Batch Staged Actions */
                      <div className="mt-3 p-3.5 rounded-xl border border-amber-200 bg-amber-50/80 text-slate-900 text-xs space-y-3">
                        <div className="flex items-center justify-between font-semibold text-amber-900 border-b border-amber-200/60 pb-2">
                          <div className="flex items-center gap-1.5">
                            <ShieldAlert className="w-4 h-4 text-amber-600" />
                            <span>Batch Staged ({msg.actionRequired.batchActions.length} Operations)</span>
                          </div>
                          <span className="text-[10px] font-mono bg-amber-200/60 px-1.5 py-0.5 rounded text-amber-900 font-bold uppercase">
                            BATCH
                          </span>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-amber-200 bg-white">
                          <table className="w-full text-[11px] text-left">
                            <thead className="bg-amber-100/60 text-amber-950 font-semibold border-b border-amber-200">
                              <tr>
                                <th className="p-2">#</th>
                                <th className="p-2">Student</th>
                                <th className="p-2">Operation</th>
                                <th className="p-2">Amount</th>
                                <th className="p-2">Reason</th>
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
                                      act.action === 'MARK_DUE' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
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
                        <p className="text-xs font-medium text-slate-800">Do you want to confirm all {msg.actionRequired.batchActions.length} operations?</p>
                        <div className="pt-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleConfirmAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 cursor-pointer min-w-[120px]"
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
                            onClick={() => handleCancelAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="py-1.5 px-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 font-semibold rounded-lg text-xs flex items-center justify-center gap-1 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {cancellingToken === msg.actionRequired.token ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            )}
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    ) : msg.actionRequired.isModification || msg.actionRequired.operationType === 'MODIFY_DUE' ? (
                      /* Section 2: Modify Existing Due */
                      <div className="mt-3 p-3.5 rounded-xl border border-amber-200 bg-amber-50/70 text-slate-900 text-xs space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-amber-200/70">
                          <div className="flex items-center gap-1.5 font-semibold text-amber-900 text-xs">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>Update Due Amount</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded uppercase">
                            Modification
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-slate-500">Student:</span>
                            <span className="font-semibold text-slate-900">{msg.actionRequired.studentName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Department:</span>
                            <span className="font-semibold text-slate-800">{msg.actionRequired.targetClearanceDesk || msg.actionRequired.labName || departmentName}</span>
                          </div>
                          {msg.actionRequired.reason && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Reason:</span>
                              <span className="font-medium text-slate-800">{msg.actionRequired.reason}</span>
                            </div>
                          )}

                          {/* Old vs New Amount Comparison - Visually Prominent */}
                          <div className="mt-2 p-2.5 rounded-lg bg-white border border-amber-200 grid grid-cols-3 gap-2 text-center items-center">
                            <div>
                              <span className="text-[10px] text-slate-500 block uppercase font-medium">Current Amount</span>
                              <span className="text-xs font-semibold text-slate-500 line-through">₹{msg.actionRequired.previousAmount ?? msg.actionRequired.currentAmount ?? 0}</span>
                            </div>
                            <div className="border-x border-amber-100 px-1">
                              <span className="text-[10px] text-emerald-800 block uppercase font-bold">New Amount</span>
                              <span className="text-sm font-extrabold text-emerald-700">₹{msg.actionRequired.newAmount ?? msg.actionRequired.amount}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block uppercase font-medium">Difference</span>
                              <span className={`text-xs font-bold ${Number(msg.actionRequired.difference ?? 0) >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {Number(msg.actionRequired.difference ?? 0) >= 0 ? `+₹${msg.actionRequired.difference ?? 0}` : `-₹${Math.abs(Number(msg.actionRequired.difference ?? 0))}`}
                              </span>
                            </div>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          {msg.actionRequired.consequences || 'Your change will update the outstanding amount. The NDC status will remain Blocked until the due is cleared.'}
                        </p>

                        <p className="text-xs font-medium text-slate-800">Should I save this change?</p>

                        {/* Two buttons: Confirm & Save and Cancel */}
                        <div className="pt-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleConfirmAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 cursor-pointer min-w-[120px]"
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
                            onClick={() => handleCancelAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="py-1.5 px-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 font-semibold rounded-lg text-xs flex items-center justify-center gap-1 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {cancellingToken === msg.actionRequired.token ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            )}
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    ) : msg.actionRequired.action === 'MARK_DUE' ? (
                      /* Section 1: New Outstanding Due */
                      <div className="mt-3 p-3.5 rounded-xl border border-amber-200 bg-amber-50/70 text-slate-900 text-xs space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-amber-200/70">
                          <div className="flex items-center gap-1.5 font-semibold text-amber-900 text-xs">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>New Outstanding Due</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded uppercase">
                            Add Due
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-slate-500">Student:</span>
                            <span className="font-semibold text-slate-900">{msg.actionRequired.studentName}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Department:</span>
                            <span className="font-semibold text-slate-800">{msg.actionRequired.targetClearanceDesk || msg.actionRequired.labName || departmentName}</span>
                          </div>
                          {msg.actionRequired.reason && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Reason:</span>
                              <span className="font-medium text-slate-800">{msg.actionRequired.reason}</span>
                            </div>
                          )}
                          <div className="flex justify-between items-center pt-1 border-t border-amber-200/50">
                            <span className="text-slate-500">Amount:</span>
                            <span className="text-sm font-extrabold text-rose-700">₹{msg.actionRequired.amount}</span>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          {msg.actionRequired.consequences || `Adding this due will change the student's ${msg.actionRequired.targetClearanceDesk || msg.actionRequired.labName || departmentName} clearance to Due and temporarily block the NDC certificate until payment is completed.`}
                        </p>

                        <p className="text-xs font-medium text-slate-800">Do you want to continue?</p>

                        {/* Two buttons: Confirm & Save and Cancel */}
                        <div className="pt-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleConfirmAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 cursor-pointer min-w-[120px]"
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
                            onClick={() => handleCancelAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="py-2 px-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 font-semibold rounded-lg text-xs flex items-center justify-center gap-1 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {cancellingToken === msg.actionRequired.token ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            )}
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Clear Due / General Staged Action */
                      <div className="mt-3 p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70 text-slate-900 text-xs space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-emerald-200/70">
                          <div className="flex items-center gap-1.5 font-semibold text-emerald-900 text-xs">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>Clearance Approval</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded uppercase">
                            No Due
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-slate-500">Student:</span>
                            <span className="font-semibold text-slate-900">{msg.actionRequired.studentName} ({msg.actionRequired.usn})</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Department:</span>
                            <span className="font-semibold text-slate-800">{msg.actionRequired.targetClearanceDesk || msg.actionRequired.labName || departmentName}</span>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          Approving clearance will certify that the student has No Due in {msg.actionRequired.targetClearanceDesk || msg.actionRequired.labName || departmentName} and allow their NDC progress to advance.
                        </p>

                        <p className="text-xs font-medium text-slate-800">Do you want to continue?</p>

                        {/* Two buttons: Confirm & Save and Cancel */}
                        <div className="pt-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleConfirmAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 cursor-pointer min-w-[120px]"
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
                            onClick={() => handleCancelAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="py-1.5 px-2.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 font-semibold rounded-lg text-xs flex items-center justify-center gap-1 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {cancellingToken === msg.actionRequired.token ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            )}
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
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

export const AiAssistantModal = PhysicsAiAssistantModal;
