
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage, CommunityLog, MessageType, User, Role, LogStatus, AuthState } from './types.ts';
import { streamUserMessage } from './services/geminiService.ts';

const ADMIN_EMAIL = 'admin@vdm.ai';

const App: React.FC = () => {
  const [auth, setAuth] = useState<AuthState>({ user: null, token: null });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [logs, setLogs] = useState<CommunityLog[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'admin'>('chat');
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [adminResponseInput, setAdminResponseInput] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => `sess-${Date.now()}`);
  const [selectedCitizenId, setSelectedCitizenId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- INITIAL LOAD ---
  useEffect(() => {
    const savedToken = localStorage.getItem('vdm_token');
    const savedRole = localStorage.getItem('vdm_role') as Role;
    const savedName = localStorage.getItem('vdm_name');

    if (savedToken && savedRole && savedName) {
      setAuth({ 
        user: { id: savedToken, email: savedToken, role: savedRole, name: savedName }, 
        token: savedToken 
      });
    }

    const savedLogs = localStorage.getItem('vdm_logs');
    if (savedLogs) {
      setLogs(JSON.parse(savedLogs).map((l: any) => ({
        ...l,
        createdAt: new Date(l.createdAt),
        updatedAt: new Date(l.updatedAt)
      })));
    }

    const savedMessages = localStorage.getItem('vdm_messages');
    if (savedMessages) {
      setMessages(JSON.parse(savedMessages).map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp)
      })));
    }
  }, []);

  // --- PERSISTENCE ---
  useEffect(() => {
    localStorage.setItem('vdm_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('vdm_messages', JSON.stringify(messages));
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Restore latest session on login
  useEffect(() => {
    if (auth.user?.role === 'USER') {
      const myMsgs = messages.filter(m => m.userId === auth.user?.id);
      if (myMsgs.length > 0) {
        setCurrentSessionId(myMsgs[myMsgs.length - 1].sessionId);
      }
    }
  }, [auth.user, messages.length === 0]);

  // --- ACTIONS ---
  const handleLogin = (email: string) => {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail) return;

    const isAdmin = cleanEmail === ADMIN_EMAIL;
    const role: Role = isAdmin ? 'ADMIN' : 'USER';
    const name = isAdmin ? 'System Administrator' : cleanEmail.split('@')[0];
    
    const user: User = {
      id: cleanEmail, 
      email: cleanEmail,
      role: role,
      name: name.charAt(0).toUpperCase() + name.slice(1)
    };

    localStorage.setItem('vdm_token', user.id);
    localStorage.setItem('vdm_role', user.role);
    localStorage.setItem('vdm_name', user.name);

    setAuth({ user, token: user.id });
    setActiveTab(isAdmin ? 'admin' : 'chat');

    const userMsgs = messages.filter(m => m.userId === user.id);
    if (userMsgs.length > 0) {
      setCurrentSessionId(userMsgs[userMsgs.length - 1].sessionId);
    } else {
      setCurrentSessionId(`sess-${Date.now()}`);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('vdm_token');
    localStorage.removeItem('vdm_role');
    localStorage.removeItem('vdm_name');
    setAuth({ user: null, token: null });
    setActiveTab('chat');
    setSelectedCitizenId(null);
  };

  const startNewSession = () => {
    setCurrentSessionId(`sess-${Date.now()}`);
    setReplyingTo(null);
    setInput('');
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping || !auth.user) return;

    const targetUserId = auth.user.role === 'ADMIN' ? selectedCitizenId : auth.user.id;
    if (!targetUserId) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      userId: targetUserId,
      role: auth.user.role === 'ADMIN' ? 'admin' : 'user',
      content: input,
      timestamp: new Date(),
      replyToId: replyingTo?.id,
      replyToContent: replyingTo?.content,
      sessionId: currentSessionId
    };

    setMessages(prev => [...prev, userMsg]);
    const originalInput = input;
    setInput('');
    setReplyingTo(null);

    if (auth.user.role === 'USER') {
      setIsTyping(true);
      const assistantMsgId = `ai-${Date.now()}`;
      
      setMessages(prev => [...prev, {
        id: assistantMsgId,
        userId: auth.user!.id,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        sessionId: currentSessionId,
        type: 'general'
      }]);

      // Using an object to bypass TypeScript's control flow analysis that would otherwise 
      // incorrectly narrow local variables updated within the awaited streaming closure.
      const streamResults = {
        content: "",
        type: 'general' as MessageType
      };

      await streamUserMessage(originalInput, (content, type) => {
        streamResults.content = content;
        streamResults.type = type;
        setMessages(prev => prev.map(m => 
          m.id === assistantMsgId ? { ...m, content, type } : m
        ));
      });

      setIsTyping(false);

      if (streamResults.type === 'community_logged') {
        const logId = `LOG-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        setLogs(prev => [{
          id: logId,
          userId: auth.user!.id,
          userName: auth.user!.name,
          originalMessage: originalInput,
          aiAnalysis: streamResults.content,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        }, ...prev]);
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, logId } : m));
      }
    }
  };

  const handleAdminReplyFromDashboard = (log: CommunityLog) => {
    if (!adminResponseInput.trim() || !auth.user) return;
    const updatedLog: CommunityLog = { ...log, adminResponse: adminResponseInput, adminId: auth.user.id, status: 'resolved', updatedAt: new Date() };
    setLogs(prev => prev.map(l => l.id === log.id ? updatedLog : l));

    const adminMsg: ChatMessage = {
      id: `admin-${Date.now()}`,
      userId: log.userId,
      role: 'admin',
      content: adminResponseInput,
      type: 'admin_response',
      timestamp: new Date(),
      logId: log.id,
      sessionId: currentSessionId
    };

    setMessages(prev => [...prev, adminMsg]);
    setAdminResponseInput('');
    setSelectedLogId(null);
  };

  // --- MEMOS ---
  const userSessions = useMemo(() => {
    if (!auth.user || auth.user.role === 'ADMIN') return [];
    const myMessages = messages.filter(m => m.userId === auth.user?.id);
    const sessionsMap = new Map<string, { id: string, lastMsg: string, time: Date }>();
    myMessages.forEach(m => {
      if (!sessionsMap.has(m.sessionId) || m.timestamp > sessionsMap.get(m.sessionId)!.time) {
        sessionsMap.set(m.sessionId, { id: m.sessionId, lastMsg: m.content, time: m.timestamp });
      }
    });
    return Array.from(sessionsMap.values()).sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [messages, auth.user]);

  const activeConversations = useMemo(() => {
    if (auth.user?.role !== 'ADMIN') return [];
    const userIds = Array.from(new Set(messages.map(m => m.userId))).filter(id => id !== ADMIN_EMAIL);
    return userIds.map(id => ({ id, name: id.split('@')[0].charAt(0).toUpperCase() + id.split('@')[0].slice(1) }));
  }, [messages, auth.user]);

  const filteredMessages = useMemo(() => {
    if (!auth.user) return [];
    const targetUserId = auth.user.role === 'ADMIN' ? selectedCitizenId : auth.user.id;
    return messages.filter(m => m.userId === targetUserId && m.sessionId === currentSessionId);
  }, [messages, auth.user, selectedCitizenId, currentSessionId]);

  if (!auth.user) return <LoginView onLogin={handleLogin} />;

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      <aside className="w-20 md:w-64 bg-white border-r border-slate-200 flex flex-col p-4 z-30 shadow-sm">
        <div className="flex items-center space-x-3 mb-10 px-2">
          <div className="bg-indigo-600 p-2.5 rounded-2xl text-white shadow-lg shadow-indigo-100">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <span className="font-extrabold text-xl hidden md:block tracking-tight">VDM AI</span>
        </div>

        <nav className="space-y-1.5 flex-1 overflow-y-auto no-scrollbar">
          <button onClick={() => setActiveTab('chat')} className={`flex items-center space-x-3 w-full p-3.5 rounded-2xl transition-all ${activeTab === 'chat' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-100'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
            <span className="hidden md:block font-semibold">Intelligence</span>
          </button>
          {auth.user.role === 'ADMIN' && (
            <button onClick={() => setActiveTab('admin')} className={`flex items-center space-x-3 w-full p-3.5 rounded-2xl transition-all ${activeTab === 'admin' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-100'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              <span className="hidden md:block font-semibold">Command Center</span>
            </button>
          )}

          {auth.user.role === 'USER' && (
            <div className="mt-8 pt-6 border-t border-slate-100 hidden md:block">
              <div className="flex items-center justify-between mb-4 px-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Saved Channels</span>
                <button onClick={startNewSession} className="text-indigo-600 hover:bg-indigo-50 p-1 rounded-lg">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                </button>
              </div>
              <div className="space-y-1">
                {userSessions.map(s => (
                  <button key={s.id} onClick={() => setCurrentSessionId(s.id)} className={`w-full text-left p-3 rounded-xl text-xs transition-all ${currentSessionId === s.id ? 'bg-indigo-50 text-indigo-700 font-bold border-l-4 border-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}>
                    <p className="truncate line-clamp-1">{s.lastMsg}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="mt-auto pt-4 border-t border-slate-100">
           <div className="flex items-center justify-between px-1">
              <div className="flex items-center space-x-3 truncate">
                 <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold shadow-sm">{auth.user.name[0]}</div>
                 <div className="hidden md:block truncate">
                   <p className="text-xs font-bold truncate text-slate-800">{auth.user.name}</p>
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">{auth.user.role}</p>
                 </div>
              </div>
              <button onClick={handleLogout} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
           </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shadow-sm z-20">
          <div className="flex items-center space-x-3">
             <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></div>
             <h2 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">
               {activeTab === 'chat' ? 'Civic Intelligence Gateway' : 'Infrastructure Monitoring'}
             </h2>
          </div>
          <div className="flex items-center space-x-4">
             <div className="bg-slate-100 px-3 py-1 rounded-full text-[10px] font-black text-slate-400 tracking-widest">VDM-V1.9.4P</div>
          </div>
        </header>

        {activeTab === 'chat' ? (
          <div className="flex-1 flex overflow-hidden">
             {auth.user.role === 'ADMIN' && (
               <div className="w-64 border-r border-slate-200 bg-white flex flex-col shadow-sm">
                 <div className="p-5 border-b border-slate-100 font-black text-[10px] uppercase text-slate-400 tracking-widest">Verified Citizens</div>
                 <div className="flex-1 overflow-y-auto no-scrollbar">
                    {activeConversations.map(u => (
                      <button key={u.id} onClick={() => { setSelectedCitizenId(u.id); setReplyingTo(null); }} className={`w-full text-left p-5 hover:bg-slate-50 transition-all border-b border-slate-50 flex items-center space-x-3 ${selectedCitizenId === u.id ? 'bg-indigo-50 border-r-4 border-r-indigo-600 shadow-inner' : ''}`}>
                         <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${selectedCitizenId === u.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{u.name[0]}</div>
                         <div className="truncate"><p className="text-xs font-bold truncate text-slate-700">{u.name}</p></div>
                      </button>
                    ))}
                    {activeConversations.length === 0 && <div className="p-8 text-center text-slate-300 italic text-xs">No active citizens.</div>}
                 </div>
               </div>
             )}

             <div className="flex-1 flex flex-col relative bg-slate-50/50">
                <div className="flex-1 overflow-y-auto p-4 md:p-12 no-scrollbar">
                   <div className="max-w-3xl mx-auto space-y-8 pb-32">
                      {filteredMessages.map(m => (
                        <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                           <div className={`max-w-[85%] rounded-[28px] p-6 shadow-sm border transition-all ${m.role === 'user' ? 'bg-indigo-600 text-white border-indigo-500 rounded-tr-none shadow-indigo-100' : 'bg-white border-slate-200 text-slate-800 rounded-tl-none shadow-slate-100'}`}>
                              {m.type === 'community_logged' && <div className="text-[10px] font-black text-amber-600 uppercase mb-3 border-b border-amber-50 pb-2 flex items-center gap-2"><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/></svg> Community Record Archived</div>}
                              <p className="text-[15px] leading-relaxed whitespace-pre-wrap font-medium">{m.content || (isTyping && m.role === 'assistant' ? "" : "")}</p>
                              <div className="mt-4 text-[10px] font-bold opacity-30 flex justify-between items-center uppercase tracking-widest">
                                 <span>{m.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                 <button onClick={() => setReplyingTo(m)} className="p-1 hover:text-indigo-500"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg></button>
                              </div>
                           </div>
                        </div>
                      ))}
                      {isTyping && <div className="flex justify-start"><div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 space-x-1.5 flex"><div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div><div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]"></div><div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s]"></div></div></div>}
                      <div ref={chatEndRef} />
                   </div>
                </div>

                <footer className="p-8 bg-white border-t border-slate-200 z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.02)]">
                   <div className="max-w-3xl mx-auto">
                      {replyingTo && (
                        <div className="mb-4 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between animate-in slide-in-from-bottom-2">
                           <p className="text-xs text-indigo-600 font-bold italic truncate">"{replyingTo.content}"</p>
                           <button onClick={() => setReplyingTo(null)} className="p-1 text-indigo-300 hover:text-indigo-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg></button>
                        </div>
                      )}
                      <form onSubmit={handleSend} className="relative flex items-center group">
                        <input 
                          type="text" 
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          placeholder={auth.user.role === 'ADMIN' ? "Admin dispatch reply..." : "Report a problem or ask a question..."}
                          className="w-full bg-slate-50 border-2 border-slate-200 rounded-[32px] px-8 py-6 pr-20 focus:outline-none focus:border-indigo-600 focus:bg-white transition-all text-sm font-bold shadow-inner"
                        />
                        <button type="submit" disabled={!input.trim() || isTyping} className="absolute right-3 p-4 bg-indigo-600 text-white rounded-[24px] shadow-2xl shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-90 disabled:bg-slate-200">
                           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                        </button>
                      </form>
                   </div>
                </footer>
             </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-12 no-scrollbar">
             <div className="max-w-6xl mx-auto">
               <div className="flex justify-between items-end mb-12">
                 <div>
                   <h2 className="text-5xl font-black text-slate-800 tracking-tighter mb-3">Ops Terminal</h2>
                   <p className="text-slate-400 font-black uppercase tracking-widest text-[11px]">Civic Conflict & Resource Management</p>
                 </div>
               </div>

               <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                  <div className="lg:col-span-2 space-y-4">
                     {logs.map(l => (
                       <div key={l.id} onClick={() => setSelectedLogId(l.id)} className={`p-8 bg-white border-2 rounded-[32px] cursor-pointer transition-all hover:shadow-xl ${selectedLogId === l.id ? 'border-indigo-600 ring-4 ring-indigo-50 shadow-indigo-100' : 'border-slate-100 shadow-sm'}`}>
                          <div className="flex justify-between items-center mb-6">
                             <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-xl uppercase tracking-[0.2em]">{l.id}</span>
                             <span className={`text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-[0.2em] ${l.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{l.status}</span>
                          </div>
                          <p className="text-lg font-extrabold text-slate-800 mb-2 line-clamp-1">{l.originalMessage}</p>
                          <div className="flex items-center space-x-3 text-slate-400">
                             <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-[10px]">{l.userName[0]}</div>
                             <span className="text-[11px] font-bold">{l.userName} • {l.createdAt.toLocaleDateString()}</span>
                          </div>
                       </div>
                     ))}
                     {logs.length === 0 && <div className="p-20 text-center border-4 border-dashed border-slate-200 rounded-[40px] text-slate-300 font-black uppercase tracking-widest text-sm">Clear Queue</div>}
                  </div>
                  <div>
                     {selectedLogId ? (
                        <div className="bg-white border-2 border-slate-100 rounded-[40px] p-10 sticky top-4 shadow-2xl shadow-slate-200 animate-in slide-in-from-right-8 duration-500">
                           <h3 className="text-2xl font-black mb-8 tracking-tight">Resolution Intel</h3>
                           <div className="space-y-8">
                              <div className="p-6 bg-slate-50 rounded-3xl text-sm italic font-medium text-slate-600 border border-slate-100">"{logs.find(l=>l.id===selectedLogId)?.originalMessage}"</div>
                              <div className="pt-4 space-y-4">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Official Dispatch</label>
                                <textarea 
                                  value={adminResponseInput}
                                  onChange={e => setAdminResponseInput(e.target.value)}
                                  placeholder="Formulate official citizen response..."
                                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-[28px] p-6 text-sm h-48 focus:outline-none focus:border-indigo-600 transition-all font-medium shadow-inner"
                                />
                                <button onClick={() => handleAdminReplyFromDashboard(logs.find(l=>l.id===selectedLogId)!)} className="w-full py-6 bg-indigo-600 text-white rounded-[28px] font-black text-sm uppercase tracking-widest shadow-2xl shadow-indigo-200 hover:bg-indigo-700 transition-all">Resolve Incident</button>
                              </div>
                           </div>
                        </div>
                     ) : (
                        <div className="h-96 border-4 border-dashed border-slate-200 rounded-[40px] flex flex-col items-center justify-center text-slate-300 gap-4 opacity-50">
                           <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                           <span className="text-xs font-black uppercase tracking-[0.3em]">Selection Required</span>
                        </div>
                     )}
                  </div>
               </div>
             </div>
          </div>
        )}
      </main>
    </div>
  );
};

const LoginView: React.FC<{ onLogin: (email: string) => void }> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6 font-sans">
       <div className="bg-white p-12 md:p-20 rounded-[64px] shadow-[0_50px_100px_-20px_rgba(79,70,229,0.15)] max-w-lg w-full border border-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-16 -mt-16 opacity-50"></div>
          <div className="flex justify-center mb-10">
             <div className="bg-indigo-600 p-8 rounded-[36px] text-white shadow-2xl shadow-indigo-200 transform hover:scale-110 transition-transform">
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
             </div>
          </div>
          <h1 className="text-6xl font-black text-center text-slate-800 mb-3 tracking-tighter italic">VDM AI</h1>
          <p className="text-slate-400 text-center text-[11px] font-black uppercase tracking-[0.5em] mb-16">Secure Intelligence Gateway</p>
          <form onSubmit={e => { e.preventDefault(); onLogin(email); }} className="space-y-8">
             <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@domain.ai" className="w-full px-10 py-7 bg-slate-50 border-2 border-slate-100 rounded-[32px] focus:outline-none focus:border-indigo-600 focus:bg-white transition-all font-bold text-xl text-slate-800 shadow-inner" required />
             <button type="submit" className="w-full bg-indigo-600 text-white py-8 rounded-[32px] font-black text-lg uppercase tracking-widest shadow-[0_20px_50px_rgba(79,70,229,0.3)] hover:bg-indigo-700 active:scale-95 transition-all">Initialize Protocol</button>
          </form>
          <div className="mt-16 pt-10 border-t border-slate-50 flex flex-col items-center gap-6">
             <button onClick={() => onLogin(ADMIN_EMAIL)} className="text-[11px] font-black text-indigo-500 uppercase tracking-[0.2em] hover:text-indigo-800 transition-colors">Emergency Admin Portal</button>
             <div className="flex items-center gap-3 opacity-20">
               <div className="w-1 h-1 rounded-full bg-slate-400"></div>
               <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Persistence Keyed to Identity</p>
               <div className="w-1 h-1 rounded-full bg-slate-400"></div>
             </div>
          </div>
       </div>
    </div>
  );
};

export default App;
