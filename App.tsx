
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage, CommunityLog, MessageType, UserFeedback, User, Role, LogStatus, AuthState } from './types.ts';
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

  const [statusFilter, setStatusFilter] = useState<LogStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'createdAt' | 'userName' | 'id'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- INITIALIZATION ---
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

  // Restore session logic
  useEffect(() => {
    if (auth.user?.role === 'USER') {
      const myMsgs = messages.filter(m => m.userId === auth.user?.id);
      if (myMsgs.length > 0) {
        setCurrentSessionId(myMsgs[myMsgs.length - 1].sessionId);
      }
    }
  }, [auth.user?.id, messages.length > 0]);

  // Persistence triggers
  useEffect(() => {
    localStorage.setItem('vdm_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('vdm_messages', JSON.stringify(messages));
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- AUTH ---
  const handleLogin = (email: string) => {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail) return;

    const isAdmin = cleanEmail === ADMIN_EMAIL;
    const role: Role = isAdmin ? 'ADMIN' : 'USER';
    const name = isAdmin ? 'Master Administrator' : cleanEmail.split('@')[0];
    
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

  // --- STREAMING CHAT ---
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
      // Add empty message for streaming
      setMessages(prev => [...prev, {
        id: assistantMsgId,
        userId: auth.user!.id,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        sessionId: currentSessionId,
        type: 'general'
      }]);

      await streamUserMessage(originalInput, (content, type) => {
        setMessages(prev => prev.map(m => 
          m.id === assistantMsgId ? { ...m, content, type } : m
        ));
      });

      setIsTyping(false);

      // Post-processing for logged issues
      const finalMsg = messages.find(m => m.id === assistantMsgId);
      if (finalMsg?.type === 'community_logged') {
        const logId = `LOG-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        setLogs(prev => [{
          id: logId,
          userId: auth.user!.id,
          userName: auth.user!.name,
          originalMessage: originalInput,
          aiAnalysis: finalMsg.content,
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

    const originalMsg = messages.find(m => m.content === log.originalMessage && m.userId === log.userId);
    const targetSessionId = originalMsg?.sessionId || currentSessionId;

    const adminMsg: ChatMessage = {
      id: `admin-${Date.now()}`,
      userId: log.userId,
      role: 'admin',
      content: adminResponseInput,
      type: 'admin_response',
      timestamp: new Date(),
      logId: log.id,
      sessionId: targetSessionId
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
    const userIds = Array.from(new Set(messages.map(m => m.userId)));
    return userIds
      .filter(id => id !== ADMIN_EMAIL)
      .map(id => ({ id, name: id.split('@')[0].charAt(0).toUpperCase() + id.split('@')[0].slice(1) }));
  }, [messages, auth.user]);

  const citizenSessions = useMemo(() => {
    if (!selectedCitizenId) return [];
    const msgs = messages.filter(m => m.userId === selectedCitizenId);
    const sessionsMap = new Map<string, { id: string, lastMsg: string, time: Date }>();
    msgs.forEach(m => {
      if (!sessionsMap.has(m.sessionId) || m.timestamp > sessionsMap.get(m.sessionId)!.time) {
        sessionsMap.set(m.sessionId, { id: m.sessionId, lastMsg: m.content, time: m.timestamp });
      }
    });
    return Array.from(sessionsMap.values()).sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [messages, selectedCitizenId]);

  const filteredMessages = useMemo(() => {
    if (!auth.user) return [];
    const targetUserId = auth.user.role === 'ADMIN' ? selectedCitizenId : auth.user.id;
    return messages.filter(m => m.userId === targetUserId && m.sessionId === currentSessionId);
  }, [messages, auth.user, selectedCitizenId, currentSessionId]);

  if (!auth.user) return <LoginView onLogin={handleLogin} />;

  return (
    <div className="flex h-screen bg-white text-slate-900 font-sans">
      {/* SIDEBAR */}
      <aside className="w-20 md:w-64 bg-slate-50 border-r border-slate-200 flex flex-col p-4 z-30">
        <div className="flex items-center space-x-3 mb-10 px-2">
          <div className="bg-indigo-600 p-2 rounded-xl text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <span className="font-bold text-lg hidden md:block">VDM AI</span>
        </div>

        <nav className="space-y-1 flex-1 overflow-y-auto no-scrollbar">
          <button onClick={() => setActiveTab('chat')} className={`flex items-center space-x-3 w-full p-3 rounded-xl ${activeTab === 'chat' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-200'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
            <span className="hidden md:block">Chat</span>
          </button>
          {auth.user.role === 'ADMIN' && (
            <button onClick={() => setActiveTab('admin')} className={`flex items-center space-x-3 w-full p-3 rounded-xl ${activeTab === 'admin' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-200'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              <span className="hidden md:block">Dashboard</span>
            </button>
          )}

          {auth.user.role === 'USER' && (
            <div className="mt-8 pt-4 border-t border-slate-200 hidden md:block">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase">History</span>
                <button onClick={startNewSession} className="text-indigo-600 hover:bg-indigo-50 p-1 rounded">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                </button>
              </div>
              {userSessions.map(s => (
                <button key={s.id} onClick={() => setCurrentSessionId(s.id)} className={`w-full text-left p-2 rounded text-xs truncate ${currentSessionId === s.id ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-slate-500 hover:bg-slate-100'}`}>
                  {s.lastMsg}
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="mt-auto pt-4 border-t border-slate-200">
           <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 truncate">
                 <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">{auth.user.name[0]}</div>
                 <div className="hidden md:block truncate"><p className="text-xs font-bold truncate">{auth.user.name}</p></div>
              </div>
              <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              </button>
           </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-slate-50">
        {activeTab === 'chat' ? (
          <div className="flex-1 flex overflow-hidden">
             {auth.user.role === 'ADMIN' && (
               <div className="w-64 border-r border-slate-200 bg-white flex flex-col">
                 <div className="p-4 border-b border-slate-200 font-bold text-xs uppercase text-slate-400">Citizens</div>
                 <div className="flex-1 overflow-y-auto">
                    {activeConversations.map(u => (
                      <button key={u.id} onClick={() => setSelectedCitizenId(u.id)} className={`w-full text-left p-4 hover:bg-slate-50 border-b border-slate-100 flex items-center space-x-3 ${selectedCitizenId === u.id ? 'bg-indigo-50 border-r-2 border-r-indigo-600' : ''}`}>
                         <div className="w-8 h-8 rounded bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold">{u.name[0]}</div>
                         <div className="truncate"><p className="text-xs font-bold truncate">{u.name}</p></div>
                      </button>
                    ))}
                 </div>
               </div>
             )}

             <div className="flex-1 flex flex-col relative">
                <div className="flex-1 overflow-y-auto p-4 md:p-10 no-scrollbar">
                   <div className="max-w-3xl mx-auto space-y-6 pb-20">
                      {filteredMessages.map(m => (
                        <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in duration-300`}>
                           <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
                              <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content || (isTyping && m.role === 'assistant' ? "..." : "")}</p>
                              <div className="mt-2 text-[10px] opacity-50 flex justify-between items-center">
                                 <span>{m.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                 {m.type === 'community_logged' && <span className="text-amber-500 font-bold ml-2">ARCHIVED</span>}
                              </div>
                           </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                   </div>
                </div>

                <footer className="p-4 bg-white border-t border-slate-200">
                   <form onSubmit={handleSend} className="max-w-3xl mx-auto relative">
                      <input 
                        type="text" 
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Type a message..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-full px-6 py-4 pr-16 focus:outline-none focus:border-indigo-600 focus:bg-white transition-all text-sm font-medium"
                      />
                      <button type="submit" disabled={!input.trim() || isTyping} className="absolute right-2 top-2 p-2 bg-indigo-600 text-white rounded-full disabled:bg-slate-300">
                         <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                      </button>
                   </form>
                </footer>
             </div>
          </div>
        ) : (
          <div className="p-10 max-w-6xl mx-auto w-full overflow-y-auto no-scrollbar">
             <h2 className="text-3xl font-bold mb-10">Logged Community Issues</h2>
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-4">
                   {logs.map(l => (
                     <div key={l.id} onClick={() => setSelectedLogId(l.id)} className={`p-6 bg-white border rounded-2xl cursor-pointer hover:shadow-md transition-all ${selectedLogId === l.id ? 'border-indigo-600 ring-1 ring-indigo-600' : 'border-slate-200'}`}>
                        <div className="flex justify-between items-start mb-2">
                           <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded uppercase tracking-wider">{l.id}</span>
                           <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${l.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{l.status}</span>
                        </div>
                        <p className="text-sm font-bold text-slate-800 line-clamp-1 mb-1">{l.originalMessage}</p>
                        <p className="text-xs text-slate-500">{l.userName} • {l.createdAt.toLocaleDateString()}</p>
                     </div>
                   ))}
                </div>
                <div>
                   {selectedLogId ? (
                      <div className="bg-white border border-slate-200 rounded-2xl p-8 sticky top-0 shadow-sm">
                         <h3 className="text-lg font-bold mb-4">Resolution Center</h3>
                         <div className="space-y-4">
                            <div className="p-4 bg-slate-50 rounded-xl text-xs italic text-slate-600">"{logs.find(l=>l.id===selectedLogId)?.originalMessage}"</div>
                            <textarea 
                              value={adminResponseInput}
                              onChange={e => setAdminResponseInput(e.target.value)}
                              placeholder="Type response to citizen..."
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm h-32 focus:outline-none focus:border-indigo-600"
                            />
                            <button onClick={() => handleAdminReplyFromDashboard(logs.find(l=>l.id===selectedLogId)!)} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg">Finalize & Send</button>
                         </div>
                      </div>
                   ) : (
                      <div className="h-64 border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 text-sm italic font-medium">Select an incident to review</div>
                   )}
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
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
       <div className="bg-white p-12 rounded-[40px] shadow-2xl max-w-md w-full border border-white">
          <div className="flex justify-center mb-8">
             <div className="bg-indigo-600 p-6 rounded-3xl text-white shadow-xl">
                <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
             </div>
          </div>
          <h1 className="text-4xl font-bold text-center text-slate-800 mb-2 italic">VDM AI</h1>
          <p className="text-slate-400 text-center text-sm font-bold uppercase tracking-widest mb-10">Civic Intelligence Network</p>
          <form onSubmit={e => { e.preventDefault(); onLogin(email); }} className="space-y-6">
             <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-indigo-600 transition-all font-bold" required />
             <button type="submit" className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg shadow-xl hover:bg-indigo-700 active:scale-95 transition-all">Initialize Gateway</button>
          </form>
          <div className="mt-12 pt-6 border-t border-slate-50 flex flex-col items-center gap-3">
             <button onClick={() => onLogin(ADMIN_EMAIL)} className="text-[10px] font-black text-indigo-500 uppercase tracking-widest hover:underline">Internal Admin Portal</button>
             <p className="text-[9px] text-slate-300 font-bold uppercase text-center leading-relaxed">Secure persistence enabled via email tracking.</p>
          </div>
       </div>
    </div>
  );
};

export default App;
