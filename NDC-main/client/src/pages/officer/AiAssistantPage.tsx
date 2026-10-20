import React, { useState, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Sparkles,
  Send,
  Bot,
  User,
  ShieldAlert,
  CheckCircle2,
  Clock,
  RotateCcw,
  AlertTriangle,
  ArrowRight,
  Atom,
  HelpCircle,
  ShieldCheck,
  Check,
  Search,
  ExternalLink,
  XCircle,
  Edit3,
  RefreshCw,
  Trash2,
  Building
} from 'lucide-react';
import { aiService, AssistantMessage, ActionRequired } from '../../services/aiService';
import { MarkdownRenderer } from '../../components/common/MarkdownRenderer';
import api from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';
import { usePortalContext } from '../../context/PortalContext';

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

export const AiAssistantPage: React.FC = () => {
  const { user } = useAuthStore();
  const { context, stats: portalStats, refreshContext } = usePortalContext();
  const { deptCode: routeDeptCode } = useParams<{ deptCode?: string }>();

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // Active assistant is derived strictly from the route, page, or authenticated context.
  // There is NO global selector, dropdown, tabs, or manual assistant switching.
  const normalizedRouteDept = routeDeptCode?.trim()?.toUpperCase();
  const deptCode = normalizedRouteDept || (isAdmin ? 'ADM' : context?.department?.code || 'PHY');

  // Sync context when navigating to a specific department assistant route
  useEffect(() => {
    if (deptCode && context?.department?.code !== deptCode) {
      refreshContext(deptCode);
    }
  }, [deptCode, context?.department?.code, refreshContext]);

  const deptName = context?.department?.name || (deptCode === 'ADM' ? 'Administration Block' : `${deptCode} Clearance Desk`);
  const assistantTitle = context?.assistantConfig?.title || (deptCode === 'ADM' ? 'Administration AI Assistant' : `${deptName} AI Assistant`);
  const assistantBadge = context?.assistantConfig?.badge || deptCode;
  const assistantDescription =
    context?.assistantConfig?.description ||
    (deptCode === 'ADM'
      ? 'Institutional clearance governance, cross-department searches, clearance bottleneck analytics, and certificate verification.'
      : `Institutional clearance intelligence, ${deptName} records, outstanding dues, and authorized clearance actions.`);

  const getGreeting = () => {
    if (context?.assistantConfig?.greeting) {
      return context.assistantConfig.greeting;
    }
    if (deptCode === 'ADM') {
      return `Hello! I am the **Administration AI Assistant** at Malnad College of Engineering (MCE).\n\nI provide institution-wide administrative intelligence across all clearance desks, monitor overall student clearance queues, and check certificate generation eligibility.\n\nHow can I assist administrative operations today?`;
    }
    return `Hello! I am the **${assistantTitle}**.\n\nI can read real-time clearance records, check outstanding dues, and stage safe approvals with your explicit confirmation.\n\nHow can I assist your desk today?`;
  };

  const storageKey = `ndc_ai_chat_${user?.id || 'officer'}_${deptCode}`;

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

  // Edit action state
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<number | string>('');
  const [editReason, setEditReason] = useState<string>('');

  // Live department stats
  const [stats, setStats] = useState({ total: 0, pending: 0, due: 0, cleared: 0 });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Reset or load greeting when department context changes
  useEffect(() => {
    if (messages.length <= 1) {
      setMessages([{ role: 'model', content: getGreeting() }]);
    }
  }, [deptCode, context?.assistantConfig?.greeting]);

  // Load persisted history from backend
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoadingHistory(true);
        const historyLogs = await aiService.getConversationHistory(deptCode, 50);
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
        } else {
          setMessages([{ role: 'model', content: getGreeting() }]);
        }
      } catch (err) {
        console.warn('Failed to load remote chat history:', err);
      } finally {
        setLoadingHistory(false);
      }
    };
    fetchHistory();
  }, [deptCode, user?.id]);

  const handleClearHistory = async () => {
    if (!window.confirm(`Clear active conversation history for ${deptName}?`)) return;
    try {
      await aiService.clearConversationHistory(deptCode);
    } catch (err) {
      console.warn('Error clearing backend history:', err);
    }
    localStorage.removeItem(storageKey);
    setMessages([{ role: 'model', content: getGreeting() }]);
    setConfirmSuccess('Conversation history reset.');
    setTimeout(() => setConfirmSuccess(null), 3000);
  };

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
        deptCode
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
          content: `⚠️ Sorry, I encountered an issue: ${err.message}`
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

      setMessages((prev) => {
        const updated = prev.map((m, idx) =>
          idx === messageIndex
            ? { ...m, actionExecuted: true, actionRequired: m.actionRequired ? { ...m.actionRequired, lifecycleStatus: 'EXECUTED' as const } : null, notification: result.notification }
            : m
        );
        if (result.completionReply) {
          updated.push({
            role: 'model',
            content: result.completionReply,
            suggestions: [
              `Show pending dues in ${deptName}`,
              ...(result.usn ? [`Lookup student ${result.usn}`] : []),
              `Show ${deptName} clearance summary`
            ]
          });
        }
        localStorage.setItem(storageKey, JSON.stringify(updated));
        return updated;
      });

      // Dispatch global update event
      window.dispatchEvent(new CustomEvent('ndc_clearance_updated'));

      // Re-fetch stats
      const statsRes = await api.get('/ndc/officer/stats');
      if (statsRes.data?.data) {
        const d = statsRes.data.data;
        setStats({
          total: d.TOTAL || 0,
          pending: d.PENDING || 0,
          due: d.DUE || 0,
          cleared: d.CLEARED || 0
        });
      }
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
              `Show pending dues in ${deptName}`,
              `Show ${deptName} clearance summary`
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
    context?.assistantConfig?.suggestedQueries && context.assistantConfig.suggestedQueries.length > 0
      ? context.assistantConfig.suggestedQueries
      : isAdmin
      ? [
          'Show institution-wide clearance summary',
          'Which departments have the most pending clearance requests?',
          'Lookup student 4MC21CS001 across all departments',
          'Show students blocked from certificate generation'
        ]
      : [
          `Who has outstanding dues in ${deptName}?`,
          `What is the current clearance summary for ${deptName}?`,
          'Clear dues for USN 4MC21CS001',
          'Show guidelines for clearances'
        ];

  const presets =
    context?.assistantConfig?.presets && context.assistantConfig.presets.length > 0
      ? context.assistantConfig.presets
      : isAdmin
      ? [
          { label: 'Administrative Clearance Approval', reason: 'Administrative review cleared' },
          { label: 'Institutional Fee Clearance Hold', amount: 500, reason: 'Pending college administrative dues' },
          { label: 'Certificate Sign-off Review', reason: 'Final institutional verification completed' }
        ]
      : [
          { label: 'Standard Clearance No Due', amount: 0, reason: 'Clearance verified and approved' },
          { label: 'Breakage / Equipment Replacement Due', amount: 300, reason: 'Equipment damage charge' },
          { label: 'Overdue Fine', amount: 100, reason: 'Late return / overdue penalty' }
        ];

  const clearanceQueueUrl = (isAdmin && deptCode === 'ADM')
    ? '/admin/ndc'
    : deptCode === 'LIB'
    ? '/officer/central-library'
    : deptCode === 'CHEM'
    ? '/officer/chemistry-lab'
    : deptCode === 'PHY'
    ? '/officer/physics-lab'
    : deptCode === 'LAB'
    ? '/officer/department-lab'
    : '/officer/clearances';

  return (
    <div className="space-y-5">
      {/* Clean Department-Scoped AI Assistant Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
            {deptCode === 'ADM' ? <Building className="w-5 h-5 text-indigo-600" /> : <Sparkles className="w-5 h-5 text-indigo-600" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">
                {assistantTitle}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                [{assistantBadge}]
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {assistantDescription}
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 shrink-0">

          <button
            type="button"
            onClick={handleClearHistory}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            title="Start New Chat & Clear Current History"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
            <span>New Chat</span>
          </button>

          <Link
            to={clearanceQueueUrl}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <Atom className="w-3.5 h-3.5 text-cyan-600" />
            <span>{isAdmin ? 'NDC Clearance Monitor' : 'Clearance Queue'}</span>
          </Link>

          <Link
            to="/officer/logbook-scanner"
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>{isAdmin ? 'Document Scanner' : 'Scan Register'}</span>
          </Link>
        </div>
      </div>

      {/* Main Grid: Left Chat Panel, Right Info Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chat Interface (2 Columns) */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col h-[750px] overflow-hidden">
          {/* Notification Banners */}
          {errorMsg && (
            <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 text-rose-700 text-xs flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {errorMsg}
              </span>
              <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-700">
                ×
              </button>
            </div>
          )}

          {confirmSuccess && (
            <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                {confirmSuccess}
              </span>
              <button onClick={() => setConfirmSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
                ×
              </button>
            </div>
          )}

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50/40">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-3 ${
                  msg.role === 'user' ? 'flex-row-reverse' : ''
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-emerald-600 text-white shadow-xs'
                  }`}
                >
                  {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

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
                        <span className="text-[10px] font-mono bg-amber-200/60 px-1.5 py-0.5 rounded text-amber-900 font-bold uppercase">
                          {msg.actionRequired.action === 'BATCH_OPERATION'
                            ? `BATCH (${msg.actionRequired.batchActions?.length || 0})`
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
                              {msg.actionRequired.labName || deptName || 'Department Section'}
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

                      {/* Consequences of Action */}
                      {msg.actionRequired.consequences && (
                        <div className="p-2.5 rounded-lg bg-amber-100/70 border border-amber-300 text-amber-950 text-[11px] leading-relaxed flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold block">Consequences:</span>
                            <span>{msg.actionRequired.consequences}</span>
                          </div>
                        </div>
                      )}

                      {/* Inline Edit Box if user clicks Edit */}
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
                              <label className="text-[10px] text-slate-500 block">New Reason / Apparatus:</label>
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
                      ) : msg.actionCancelled ? (
                        <div className="flex items-center gap-1.5 text-slate-700 font-semibold bg-slate-100 p-2 rounded-lg border border-slate-200 text-xs">
                          <XCircle className="w-4 h-4 text-slate-500 shrink-0" />
                          <span>Action Cancelled: Confirmation token invalidated. Zero live changes were made.</span>
                        </div>
                      ) : msg.actionExpired ? (
                        <div className="flex items-center gap-1.5 text-amber-800 font-semibold bg-amber-50 p-2 rounded-lg border border-amber-200 text-xs">
                          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>Action Expired: This confirmation token has expired. Please initiate the request again.</span>
                        </div>
                      ) : (
                        <div className="pt-1 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleConfirmAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors disabled:opacity-50 cursor-pointer min-w-[140px]"
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
                            className="py-2 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-slate-600" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCancelAction(msg.actionRequired!.token, idx)}
                            disabled={confirmingToken === msg.actionRequired.token || cancellingToken === msg.actionRequired.token}
                            className="py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
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

          {/* Quick Prompt Suggestions */}
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
              placeholder={
                isAdmin
                  ? 'Ask about administrative clearance, student status across departments, or institutional metrics...'
                  : `Ask about ${deptName} dues, student status, or clear approvals...`
              }
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all disabled:opacity-50"
            />

            <button
              type="button"
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 cursor-pointer"
              title="Send query"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Info & Live Context Panel (1 Column) */}
        <div className="space-y-4">
          {/* Live KPI Statistics */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              {isAdmin ? <Building className="w-4 h-4 text-indigo-600" /> : <Atom className="w-4 h-4 text-cyan-600" />}
              <span>
                {context?.scope === 'INSTITUTION_WIDE'
                  ? 'Institution-Wide Live Overview'
                  : `${deptName} Overview`}
              </span>
            </h3>

            {context?.scope === 'INSTITUTION_WIDE' ? (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Students</span>
                  <span className="text-lg font-black text-slate-800">{portalStats?.totalStudents ?? stats.total}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/60">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">Fully Cleared</span>
                  <span className="text-lg font-black text-emerald-800">{portalStats?.fullyCleared ?? stats.cleared}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/60">
                  <span className="text-[10px] uppercase font-bold text-amber-700 block">Pending Queue</span>
                  <span className="text-lg font-black text-amber-800">{portalStats?.pending ?? stats.pending}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-200/60">
                  <span className="text-[10px] uppercase font-bold text-rose-700 block">Blocked With Dues</span>
                  <span className="text-lg font-black text-rose-800">{portalStats?.blocked ?? stats.due}</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Records</span>
                  <span className="text-lg font-black text-slate-800">{portalStats?.total ?? stats.total}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/60">
                  <span className="text-[10px] uppercase font-bold text-amber-700 block">Pending</span>
                  <span className="text-lg font-black text-amber-800">{portalStats?.pending ?? stats.pending}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-rose-50/70 border border-rose-200/60">
                  <span className="text-[10px] uppercase font-bold text-rose-700 block">Dues Flagged</span>
                  <span className="text-lg font-black text-rose-800">{portalStats?.due ?? stats.due}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200/60">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">Cleared</span>
                  <span className="text-lg font-black text-emerald-800">{portalStats?.cleared ?? stats.cleared}</span>
                </div>
              </div>
            )}
          </div>

          {/* Role & Department Aware Presets */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-indigo-600" />
              <span>
                {context?.scope === 'INSTITUTION_WIDE'
                  ? 'Administrative Actions & Presets'
                  : `${deptName} Presets`}
              </span>
            </h3>

            <div className="space-y-1.5 text-xs">
              {presets.map((preset, i) => (
                <div
                  key={i}
                  onClick={() =>
                    handleSend(
                      preset.amount !== undefined && preset.amount > 0
                        ? `Mark ₹${preset.amount} due for ${preset.label}`
                        : preset.reason
                        ? `${preset.label}: ${preset.reason}`
                        : preset.label
                    )
                  }
                  className="p-2 rounded-lg bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span className="text-slate-700 font-medium">{preset.label}</span>
                  {preset.amount !== undefined && preset.amount > 0 ? (
                    <span className="font-bold text-rose-600">₹{preset.amount}</span>
                  ) : (
                    <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">Action</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Safety & Audit Guarantee */}
          <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-4 rounded-2xl border border-indigo-100 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold text-indigo-950">
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              <span>Safe Mutation Guarantee</span>
            </div>
            <p className="text-indigo-900/80 leading-relaxed text-[11px]">
              Every database modification staged by this assistant uses a unique HMAC confirmation token bound to your user ID. Changes trigger real-time overall status recalculations, student email notifications, and irreversible audit logs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
