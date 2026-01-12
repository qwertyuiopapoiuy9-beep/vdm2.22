
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage, CommunityLog, MessageType, UserFeedback, User, Role, LogStatus, AuthState } from './types';
import { processUserMessage } from './services/geminiService';

// --- AUTH & USER LOGIC ---
// admin@vdm.ai is the hardcoded master admin.
// Any other email becomes a unique USER.
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
  
  // Session & Citizen Tracking
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => `sess-${Date.now()}`);
  const [selectedCitizenId, setSelectedCitizenId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  // Admin Filtering & Sorting
  const [statusFilter, setStatusFilter] = useState<LogStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'createdAt' | 'userName' | 'id'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- INITIALIZATION & PERSISTENCE ---
  useEffect(() => {
    // Restore authentication from localStorage
    const savedToken = localStorage.getItem('vdm_token'); // Token is the email
    const savedRole = localStorage.getItem('vdm_role') as Role;
    const savedName = localStorage.getItem('vdm_name');

    if (savedToken && savedRole && savedName) {
      setAuth({ 
        user: { id: savedToken, email: savedToken, role: savedRole, name: savedName }, 
        token: savedToken 
      });
    }

    // Load global logs
    const savedLogs = localStorage.getItem('vdm_logs');
    if (savedLogs) {
      setLogs(JSON.parse(savedLogs).map((l: any) => ({
        ...l,
        createdAt: new Date(l.createdAt),
        updatedAt: new Date(l.updatedAt)
      })));
    }

    // Load global messages
    const savedMessages = localStorage.getItem('vdm_messages');
    if (savedMessages) {
      const parsed = JSON.parse(savedMessages).map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp)
      }));
      setMessages(parsed);
    }
  }, []);

  // Update session ID when user logs in and has history
  useEffect(() => {
    if (auth.user?.role === 'USER') {
      const myMsgs = messages.filter(m => m.userId === auth.user?.id);
      if (myMsgs.length > 0) {
        setCurrentSessionId(myMsgs[myMsgs.length - 1].sessionId);
      }
    }
  }, [auth.user?.id, messages.length === 0]); // Re-run if messages load or user changes

  useEffect(() => {
    localStorage.setItem('vdm_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    localStorage.setItem('vdm_messages', JSON.stringify(messages));
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- AUTH ACTIONS ---
  const handleLogin = (email: string) => {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail) return;

    const isAdmin = cleanEmail === ADMIN_EMAIL;
    const role: Role = isAdmin ? 'ADMIN' : 'USER';
    const name = isAdmin ? 'System Admin' : cleanEmail.split('@')[0];
    
    const user: User = {
      id: cleanEmail, // Email serves as the persistent ID
      email: cleanEmail,
      role: role,
      name: name.charAt(0).toUpperCase() + name.slice(1)
    };

    localStorage.setItem('vdm_token', user.id);
    localStorage.setItem('vdm_role', user.role);
    localStorage.setItem('vdm_name', user.name);

    setAuth({ user, token: user.id });
    setActiveTab(isAdmin ? 'admin' : 'chat');
    setReplyingTo(null);
    setCurrentSessionId(`sess-${Date.now()}`);
  };

  const handleLogout = () => {
    localStorage.removeItem('vdm_token');
    localStorage.removeItem('vdm_role');
    localStorage.removeItem('vdm_name');
    setAuth({ user: null, token: null });
    setActiveTab('chat');
    setSelectedCitizenId(null);
    setReplyingTo(null);
  };

  const startNewSession = () => {
    const newId = `sess-${Date.now()}`;
    setCurrentSessionId(newId);
    setReplyingTo(null);
    setInput('');
  };

  // --- CHAT ACTIONS ---
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
    setInput('');
    setReplyingTo(null);

    if (auth.user.role === 'USER') {
      setIsTyping(true);
      const result = await processUserMessage(input);
      const assistantMsg: ChatMessage = { 
        id: `ai-${Date.now()}`, 
        userId: auth.user.id,
        role: 'assistant', 
        content: result.content, 
        type: result.type, 
        timestamp: new Date(),
        sessionId: currentSessionId
      };

      setMessages(prev => [...prev, assistantMsg]);
      setIsTyping(false);

      if (result.type === 'community_logged') {
        const logId = `LOG-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        const newLog: CommunityLog = {
          id: logId,
          userId: auth.user.id,
          userName: auth.user.name,
          originalMessage: input,
          aiAnalysis: result.content,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        setLogs(prev => [newLog, ...prev]);
        setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, logId } : m));
      }
    }
  };

  // --- ADMIN ACTIONS ---
  const handleAdminReplyFromDashboard = (log: CommunityLog) => {
    if (!adminResponseInput.trim() || !auth.user) return;

    const updatedLog: CommunityLog = {
      ...log,
      adminResponse: adminResponseInput,
      adminId: auth.user.id,
      status: 'resolved',
      updatedAt: new Date(),
    };

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

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // --- MEMOIZED DATA ---
  
  const userSessions = useMemo(() => {
    if (!auth.user || auth.user.role === 'ADMIN') return [];
    const myMessages = messages.filter(m => m.userId === auth.user?.id);
    const sessionsMap = new Map<string, { id: string, lastMsg: string, time: Date }>();
    
    myMessages.forEach(m => {
      if (!sessionsMap.has(m.sessionId) || m.timestamp > sessionsMap.get(m.sessionId)!.time) {
        sessionsMap.set(m.sessionId, {
          id: m.sessionId,
          lastMsg: m.content,
          time: m.timestamp
        });
      }
    });

    return Array.from(sessionsMap.values()).sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [messages, auth.user]);

  const activeConversations = useMemo(() => {
    if (auth.user?.role !== 'ADMIN') return [];
    const userIds = Array.from(new Set(messages.map(m => m.userId)));
    // We only want to show users who aren't the admin themselves (if admin chatted with AI for some reason)
    return userIds
      .filter(id => id !== ADMIN_EMAIL)
      .map(id => ({
        id: id,
        name: id.split('@')[0].charAt(0).toUpperCase() + id.split('@')[0].slice(1),
        email: id
      }));
  }, [messages, auth.user]);

  const citizenSessions = useMemo(() => {
    if (!selectedCitizenId || auth.user?.role !== 'ADMIN') return [];
    const msgs = messages.filter(m => m.userId === selectedCitizenId);
    const sessionsMap = new Map<string, { id: string, lastMsg: string, time: Date }>();
    msgs.forEach(m => {
      if (!sessionsMap.has(m.sessionId) || m.timestamp > sessionsMap.get(m.sessionId)!.time) {
        sessionsMap.set(m.sessionId, { id: m.sessionId, lastMsg: m.content, time: m.timestamp });
      }
    });
    return Array.from(sessionsMap.values()).sort((a, b) => b.time.getTime() - a.time.getTime());
  }, [messages, selectedCitizenId, auth.user]);

  const filteredMessages = useMemo(() => {
    if (!auth.user) return [];
    const targetUserId = auth.user.role === 'ADMIN' ? selectedCitizenId : auth.user.id;
    if (!targetUserId) return [];
    
    return messages.filter(m => m.userId === targetUserId && m.sessionId === currentSessionId);
  }, [messages, auth.user, selectedCitizenId, currentSessionId]);

  const processedLogs = useMemo(() => {
    let result = [...logs];
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      result = result.filter(l => 
        l.id.toLowerCase().includes(lowerSearch) || 
        l.userName.toLowerCase().includes(lowerSearch) || 
        l.originalMessage.toLowerCase().includes(lowerSearch)
      );
    }
    if (statusFilter !== 'all') {
      result = result.filter(l => l.status === statusFilter);
    }
    result.sort((a, b) => {
      let valA: any = a[sortField];
      let valB: any = b[sortField];
      if (valA instanceof Date) valA = valA.getTime();
      if (valB instanceof Date) valB = valB.getTime();
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [logs, searchTerm, statusFilter, sortField, sortOrder]);

  const selectedLog = useMemo(() => logs.find(l => l.id === selectedLogId), [logs, selectedLogId]);

  if (!auth.user) return <LoginView onLogin={handleLogin} />;

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans selection:bg-indigo-100">
      {/* SIDEBAR */}
      <aside className="w-20 md:w-64 bg-white border-r border-slate-200 flex flex-col p-4 shadow-[2px_0_10px_rgba(0,0,0,0.02)] z-30">
        <div className="flex items-center space-x-3 mb-10 px-2">
          <div className="bg-indigo-600 p-2.5 rounded-2xl text-white shadow-lg shadow-indigo-100">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <span className="font-black text-xl tracking-tight hidden md:block">VDM AI</span>
        </div>

        <nav className="space-y-1.5 flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <button 
            onClick={() => setActiveTab('chat')}
            className={`flex items-center space-x-3 w-full p-3.5 rounded-2xl transition-all duration-200 ${activeTab === 'chat' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 font-bold' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
            <span className="hidden md:block">Citizen Hub</span>
          </button>
          
          {auth.user.role === 'ADMIN' && (
            <button 
              onClick={() => setActiveTab('admin')}
              className={`flex items-center space-x-3 w-full p-3.5 rounded-2xl transition-all duration-200 ${activeTab === 'admin' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 font-bold' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              <span className="hidden md:block">Admin Console</span>
            </button>
          )}

          {auth.user.role === 'USER' && activeTab === 'chat' && (
            <div className="mt-8 pt-8 border-t border-slate-100 space-y-4 hidden md:block animate-in fade-in duration-500">
               <div className="flex items-center justify-between px-2">
                 <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Conversations</h3>
                 <button onClick={startNewSession} className="p-1 text-indigo-500 hover:bg-indigo-50 rounded-lg transition-all" title="New Conversation">
                   <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                 </button>
               </div>
               <div className="space-y-1">
                 {userSessions.map(s => (
                   <button 
                     key={s.id}
                     onClick={() => setCurrentSessionId(s.id)}
                     className={`w-full text-left p-3 rounded-xl text-xs transition-all flex items-center space-x-2 ${currentSessionId === s.id ? 'bg-indigo-50 text-indigo-700 font-bold border-l-4 border-indigo-600 pl-2' : 'text-slate-500 hover:bg-slate-50'}`}
                   >
                     <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                     <span className="truncate">{s.lastMsg}</span>
                   </button>
                 ))}
                 {userSessions.length === 0 && (
                   <div className="px-2 py-4 text-[11px] text-slate-400 italic">No history yet.</div>
                 )}
               </div>
            </div>
          )}
        </nav>

        <div className="mt-auto border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 px-1">
              <div className="w-9 h-9 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm shadow-sm">
                {auth.user.name[0]}
              </div>
              <div className="hidden md:block">
                <p className="text-xs font-bold text-slate-800 leading-none">{auth.user.name}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter mt-1">{auth.user.role}</p>
              </div>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 transition-colors hidden md:block hover:bg-red-50 rounded-xl">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN PANEL */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 z-20 shadow-sm">
          <div className="flex items-center space-x-2">
             <div className={`w-2.5 h-2.5 rounded-full animate-pulse ${auth.user.role === 'ADMIN' ? 'bg-amber-400' : 'bg-indigo-400'}`}></div>
             <h2 className="text-sm font-bold text-slate-600 uppercase tracking-widest">
               {activeTab === 'chat' ? 'Civic Intel Gateway' : 'Ops Dashboard'}
             </h2>
          </div>
          <div className="flex space-x-3">
             <div className="px-3 py-1 bg-slate-100 text-slate-500 rounded-full text-[10px] font-black tracking-widest flex items-center uppercase">
               v1.9.0 PERSISTENT IDS
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex">
          {activeTab === 'chat' ? (
            <div className="flex-1 flex overflow-hidden">
              {/* ADMIN SIDEBAR */}
              {auth.user.role === 'ADMIN' && (
                <div className="w-64 md:w-80 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
                  <div className="p-6 border-b border-slate-100">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Citizen Dispatch Hub</h3>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    <div className="space-y-2">
                       <p className="text-[10px] font-black text-slate-300 uppercase px-2">Active Profiles</p>
                       {activeConversations.map(u => (
                         <button 
                           key={u.id}
                           onClick={() => { setSelectedCitizenId(u.id); setReplyingTo(null); }}
                           className={`w-full text-left p-4 rounded-2xl flex items-center space-x-3 transition-all ${selectedCitizenId === u.id ? 'bg-indigo-50 border-indigo-100 border text-indigo-700 shadow-sm' : 'hover:bg-slate-50 border border-transparent text-slate-600'}`}
                         >
                           <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${selectedCitizenId === u.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                             {u.name[0]}
                           </div>
                           <p className="font-bold text-xs truncate">{u.name}</p>
                         </button>
                       ))}
                       {activeConversations.length === 0 && (
                         <p className="px-2 py-4 text-[10px] text-slate-400 italic">No records found.</p>
                       )}
                    </div>

                    {selectedCitizenId && (
                      <div className="space-y-2 pt-6 border-t border-slate-50 animate-in slide-in-from-left-2 duration-300">
                        <p className="text-[10px] font-black text-slate-300 uppercase px-2">Conversation Vault</p>
                        {citizenSessions.map(s => (
                          <button 
                            key={s.id}
                            onClick={() => setCurrentSessionId(s.id)}
                            className={`w-full text-left p-3 rounded-xl text-xs transition-all flex items-center space-x-2 ${currentSessionId === s.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                          >
                             <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                             <span className="truncate">{s.lastMsg}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* CHAT DISPLAY */}
              <div className="flex-1 flex flex-col bg-slate-50/30 relative overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col items-center">
                  <div className="w-full max-w-3xl space-y-8 pb-32">
                    {auth.user.role === 'ADMIN' && !selectedCitizenId ? (
                      <div className="flex flex-col items-center justify-center py-32 text-center opacity-40">
                         <div className="bg-white p-8 rounded-[40px] shadow-sm mb-6 border border-slate-100">
                           <svg className="w-16 h-16 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>
                        </div>
                        <h3 className="text-xl font-black text-slate-800 tracking-tight">Accessing Civic Records</h3>
                        <p className="text-sm font-medium mt-2 max-w-xs">Select a profile to view their persistent chat history and intervene in community matters.</p>
                      </div>
                    ) : (
                      <>
                        {filteredMessages.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-24 text-center">
                             <div className="bg-indigo-100/50 p-6 rounded-full mb-6 text-indigo-600">
                               <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                             </div>
                             <h3 className="text-xl font-black text-slate-800">Ready for Intelligence</h3>
                             <p className="text-sm text-slate-500 mt-2 max-w-sm">Every word in this session is tracked and archived. How can VDM assist you today?</p>
                          </div>
                        )}
                        {filteredMessages.map((m) => (
                          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300 group`}>
                            <div className={`max-w-[85%] md:max-w-[70%] rounded-[28px] p-6 shadow-sm relative transition-all ${
                              m.role === 'user' 
                                ? 'bg-indigo-600 text-white rounded-tr-none shadow-indigo-100 shadow-xl' 
                                : m.role === 'admin'
                                  ? 'bg-white border-2 border-indigo-100 text-slate-900 rounded-tl-none ring-4 ring-indigo-50/50'
                                  : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                            }`}>
                              {m.replyToContent && (
                                <div className={`mb-4 p-3 rounded-xl text-[11px] font-medium border-l-4 leading-relaxed ${
                                  m.role === 'user' ? 'bg-indigo-700/50 border-white/50 text-indigo-100' : 'bg-slate-50 border-indigo-400 text-slate-500'
                                }`}>
                                  <p className="line-clamp-2 italic">"{m.replyToContent}"</p>
                                </div>
                              )}
                              <p className="text-[14px] leading-relaxed whitespace-pre-wrap font-medium">{m.content}</p>
                              <div className="mt-4 flex items-center justify-between">
                                <span className={`text-[9px] font-bold tracking-widest opacity-40 ${m.role === 'user' ? 'text-white' : 'text-slate-500'}`}>
                                  {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <button onClick={() => setReplyingTo(m)} className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all ${m.role === 'user' ? 'hover:bg-indigo-500 text-indigo-100' : 'hover:bg-indigo-50 text-indigo-600'}`}>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                    {isTyping && (
                      <div className="flex justify-start">
                        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex space-x-1.5 ring-4 ring-slate-50">
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0s]"></div>
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                          <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                </div>

                {/* FOOTER */}
                {(auth.user.role === 'USER' || (auth.user.role === 'ADMIN' && selectedCitizenId)) && (
                  <footer className="bg-white border-t border-slate-200 p-8 z-20 shadow-[0_-15px_40px_rgba(0,0,0,0,0.02)] mt-auto">
                    <div className="max-w-3xl mx-auto">
                      {replyingTo && (
                        <div className="mb-4 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between animate-in slide-in-from-bottom-2 duration-300">
                           <div className="overflow-hidden">
                              <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest leading-none mb-1">Active Thread</p>
                              <p className="text-[12px] text-indigo-600 truncate font-bold italic">"{replyingTo.content}"</p>
                           </div>
                           <button onClick={() => setReplyingTo(null)} className="p-2 text-indigo-300 hover:text-indigo-600 transition-colors">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                           </button>
                        </div>
                      )}
                      <form onSubmit={handleSend} className="relative flex items-center group">
                        <input 
                          type="text" 
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          disabled={isTyping}
                          placeholder={auth.user.role === 'ADMIN' ? "Admin Human Response..." : "Secure communication..."}
                          className="w-full bg-slate-50 border-2 border-slate-200 rounded-[32px] px-8 py-6 pr-20 focus:outline-none focus:ring-8 focus:ring-indigo-50 focus:border-indigo-600 focus:bg-white transition-all text-[15px] font-bold shadow-inner"
                        />
                        <button type="submit" disabled={!input.trim() || isTyping} className="absolute right-2.5 p-5 bg-indigo-600 text-white rounded-[24px] shadow-2xl hover:bg-indigo-700 disabled:bg-slate-200 transition-all active:scale-90">
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                        </button>
                      </form>
                    </div>
                  </footer>
                )}
              </div>
            </div>
          ) : (
            /* ANALYTICS / OPS DASHBOARD */
            <div className="flex-1 overflow-y-auto p-4 md:p-12 flex flex-col items-center">
              <div className="w-full max-w-6xl space-y-12 animate-in fade-in duration-500 pb-12">
                 <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                    <div>
                       <h3 className="text-5xl font-black text-slate-800 tracking-tighter mb-3">Ops Dashboard</h3>
                       <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Citizen Issue Resolution</p>
                    </div>
                 </div>

                 <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                    <div className="lg:col-span-8 bg-white rounded-[48px] shadow-3xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
                       <div className="p-8 border-b border-slate-50 bg-slate-50/30 flex items-center justify-between">
                          <h4 className="text-sm font-black text-slate-700 uppercase tracking-widest">Incident Stream</h4>
                       </div>
                       <div className="overflow-x-auto">
                          <table className="w-full text-left">
                             <thead>
                                <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">
                                   <th className="px-8 py-6">Reference</th>
                                   <th className="px-8 py-6">Citizen</th>
                                   <th className="px-8 py-6">Status</th>
                                   <th className="px-8 py-6 text-right">Actions</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-50">
                                {processedLogs.map((l) => (
                                   <tr key={l.id} onClick={() => setSelectedLogId(l.id)} className={`group cursor-pointer transition-all ${selectedLogId === l.id ? 'bg-indigo-50/50' : 'hover:bg-slate-50/30'}`}>
                                      <td className="px-8 py-8">
                                         <p className="text-[13px] font-black text-slate-800">{l.id}</p>
                                         <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">"{l.originalMessage}"</p>
                                      </td>
                                      <td className="px-8 py-8"><span className="text-[13px] font-bold text-slate-700">{l.userName}</span></td>
                                      <td className="px-8 py-8">
                                         <span className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border-2 ${
                                            l.status === 'pending' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-green-50 text-green-600 border-green-100'
                                         }`}>
                                            {l.status}
                                         </span>
                                      </td>
                                      <td className="px-8 py-8 text-right">
                                         <button className="text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-white border border-slate-100 px-4 py-2 rounded-xl">Review</button>
                                      </td>
                                   </tr>
                                ))}
                                {processedLogs.length === 0 && (
                                  <tr><td colSpan={4} className="p-12 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">No incidents logged</td></tr>
                                )}
                             </tbody>
                          </table>
                       </div>
                    </div>

                    <div className="lg:col-span-4">
                       {selectedLog ? (
                          <div className="bg-white rounded-[48px] shadow-3xl shadow-indigo-100/50 border border-slate-100 p-10 animate-in slide-in-from-right-8 duration-500">
                             <div className="flex justify-between items-start mb-10">
                                <h4 className="text-2xl font-black text-slate-800 tracking-tight leading-none">Intelligence File</h4>
                                <button onClick={() => setSelectedLogId(null)} className="p-2.5 text-slate-300 hover:text-slate-600 bg-slate-50 rounded-2xl transition-all">
                                   <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                             </div>
                             <div className="space-y-8">
                                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 text-[13px] italic text-slate-600">"{selectedLog.originalMessage}"</div>
                                <div className="bg-indigo-50/30 p-6 rounded-3xl border border-indigo-100/50 text-[13px] font-bold text-slate-700">{selectedLog.aiAnalysis}</div>
                                {selectedLog.status !== 'resolved' && (
                                   <div className="pt-8 border-t border-slate-100">
                                      <textarea 
                                         value={adminResponseInput}
                                         onChange={(e) => setAdminResponseInput(e.target.value)}
                                         placeholder="Resolution details..."
                                         className="w-full bg-slate-50 border-2 border-slate-200 rounded-[32px] p-6 text-[13px] font-medium focus:ring-8 focus:ring-indigo-50 focus:border-indigo-600 outline-none h-48 resize-none shadow-inner"
                                      />
                                      <button 
                                         onClick={() => handleAdminReplyFromDashboard(selectedLog)}
                                         className="w-full mt-6 bg-indigo-600 text-white py-6 rounded-[32px] font-black text-sm uppercase tracking-widest hover:bg-indigo-700 shadow-2xl transition-all"
                                      >
                                         Finalize Incident
                                      </button>
                                   </div>
                                )}
                             </div>
                          </div>
                       ) : (
                          <div className="bg-slate-100/50 rounded-[48px] border-4 border-dashed border-slate-200 flex flex-col items-center justify-center p-12 text-center h-[600px] opacity-60">
                             <svg className="w-12 h-12 text-slate-300 mb-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6" /></svg>
                             <h4 className="text-sm font-black text-slate-500 uppercase tracking-[0.4em]">Queue Idle</h4>
                          </div>
                       )}
                    </div>
                 </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </div>
  );
};

const LoginView: React.FC<{ onLogin: (email: string) => void }> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6 font-sans">
      <div className="bg-white p-16 rounded-[64px] shadow-3xl shadow-indigo-200/50 max-w-lg w-full border border-white">
        <div className="flex justify-center mb-14">
          <div className="bg-indigo-600 p-7 rounded-[36px] text-white shadow-3xl shadow-indigo-300">
            <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
        </div>
        <h1 className="text-5xl font-black text-center text-slate-800 tracking-tighter mb-4">VDM AI</h1>
        <p className="text-slate-400 text-center mb-16 font-black uppercase tracking-[0.4em] text-[11px]">Civic Intelligence Network</p>
        
        <form onSubmit={(e) => { e.preventDefault(); onLogin(email); }} className="space-y-8">
          <input 
            type="email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-10 py-6 bg-slate-50 border-2 border-slate-100 rounded-[32px] focus:ring-8 focus:ring-indigo-50 focus:border-indigo-600 focus:bg-white outline-none transition-all font-bold text-slate-800 text-lg shadow-inner"
            placeholder="Enter your personal or admin email"
            required
          />
          <button type="submit" className="w-full bg-indigo-600 text-white py-7 rounded-[32px] font-black text-base uppercase tracking-[0.2em] hover:bg-indigo-700 shadow-3xl shadow-indigo-300 transition-all active:scale-95">
            Initialize Session
          </button>
        </form>
        
        <div className="mt-20 pt-10 border-t border-slate-100 flex flex-col items-center">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-6">Master Access Protocol</p>
          <div className="flex flex-wrap justify-center gap-4">
             <button onClick={() => onLogin(ADMIN_EMAIL)} className="px-7 py-3 bg-slate-50 text-[11px] font-black text-indigo-600 rounded-2xl border-2 border-slate-100 hover:bg-indigo-50 transition-all uppercase tracking-widest shadow-sm">Admin Portal</button>
             <button onClick={() => onLogin('citizen@example.com')} className="px-7 py-3 bg-slate-50 text-[11px] font-black text-slate-500 rounded-2xl border-2 border-slate-100 hover:bg-slate-50 transition-all uppercase tracking-widest shadow-sm">Test Citizen</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
