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
  ExternalLink
} from 'lucide-react';
import { aiService, AssistantMessage, ActionRequired } from '../../services/aiService';
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
  notification?: {
    deliveryStatus?: 'QUEUED' | 'ACCEPTED' | 'FAILED' | 'UNCERTAIN';
    messageId?: string;
    lastError?: string;
  };
}

export const PhysicsAiAssistantModal: React.FC<PhysicsAiAssistantModalProps> = ({
  isOpen,
  onClose,
  onActionApplied,
  departmentCode = 'PHY',
  departmentName = 'Physics Lab'
}) => {
  const [messages, setMessages] = useState<MessageItem[]>([
    {
      role: 'model',
      content: `Hello! I am your **${departmentName} AI Assistant**.\n\nI can help you review student clearance records, look up outstanding equipment dues (spectrometers, lasers, optical benches), and stage safe status approvals with your confirmation.`
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmingToken, setConfirmingToken] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    setErrorMsg(null);
    setConfirmSuccess(null);

    const newMessages: MessageItem[] = [
      ...messages,
      { role: 'user', content: text }
    ];

    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await aiService.chatWithAssistant(
        newMessages.map((m) => ({ role: m.role, content: m.content })),
        departmentCode
      );

      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          content: response.reply,
          actionRequired: response.actionRequired
        }
      ]);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to contact AI assistant.');
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          content: `⚠️ Sorry, I encountered an issue contacting the clearance engine: ${err.message}`
        }
      ]);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickPills = [
    'Who has outstanding dues in Physics Lab?',
    'Show clearance summary statistics',
    'Clear dues for 4MC21CS001',
    'Mark ₹350 due for Spectrometer Prism damage'
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[90vh] max-h-[720px] animate-in zoom-in-95 duration-150"
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

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Close Assistant"
          >
            <X className="w-5 h-5" />
          </button>
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
                        <span>Action Staged — Confirmation Required</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-amber-200/80 px-2 py-0.5 rounded text-amber-900 uppercase">
                        {msg.actionRequired.action === 'CLEAR_DUE'
                          ? 'Clear No Due'
                          : msg.actionRequired.action === 'MARK_DUE'
                          ? 'Add Due'
                          : msg.actionRequired.action}
                      </span>
                    </div>

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
                        <span className="text-slate-500 block">Target Laboratory:</span>
                        <span className="font-semibold text-indigo-900">
                          {msg.actionRequired.labName || 'Physics Lab'}
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
                      <div className="pt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleConfirmAction(msg.actionRequired!.token, idx)}
                          disabled={confirmingToken === msg.actionRequired.token}
                          className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors disabled:opacity-50"
                        >
                          {confirmingToken === msg.actionRequired.token ? (
                            <Clock className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          <span>Confirm & Save Change</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-4 py-2.5 text-xs text-slate-500 flex items-center gap-2 shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                <span>Consulting live database & formulating response...</span>
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
          <span className="text-[11px] font-semibold text-slate-400 shrink-0">Try:</span>
          {quickPills.map((pill, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSend(pill)}
              disabled={loading}
              className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 border border-slate-200 rounded-full text-xs text-slate-700 transition-colors shrink-0 disabled:opacity-50"
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
