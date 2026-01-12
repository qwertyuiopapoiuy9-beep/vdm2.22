import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage, CommunityLog, MessageType, User, Role, AuthState } from './types.ts';
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
      try {
        setLogs(JSON.parse(savedLogs).map((l: any) => ({
          ...l,
          createdAt: new Date(l.createdAt),
          updatedAt: new Date(l.updatedAt)
        })));
      } catch (e) { console.error("Failed to parse logs", e); }
    }

    const savedMessages = localStorage.getItem('vdm_messages');
    if (savedMessages) {
      try {
        setMessages(JSON.parse(savedMessages).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        })));
      } catch (e) { console.error("Failed to parse messages", e); }
    }
  }, []);

  useEffect(() => {
    if (logs.length > 0) localStorage.setItem('vdm_logs', JSON.stringify(logs));
  }, [logs]);

  useEffect(() => {
    if (messages.length > 0) localStorage.setItem('vdm_messages', JSON.stringify(messages));
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleLogin = (email: string) => {
    const cleanEmail = email.toLowerCase().trim();
    if (!cleanEmail) return;

    const isAdmin = cleanEmail === ADMIN_EMAIL;
    const role: Role = isAdmin ? 'ADMIN' : 'USER';
    const name = isAdmin ? 'System Admin' : cleanEmail.split('@')[0];
    
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
  };

  const handleLogout = () => {
    localStorage.removeItem('vdm_token');
    localStorage.removeItem('vdm_role');
    localStorage.removeItem('vdm_name');
    setAuth({ user: null, token: null });
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

      let fullContent = "";
      let finalType: MessageType = 'general';

      await streamUserMessage(originalInput, (content, type) => {
        fullContent = content;
        finalType = type;
        setMessages(prev => prev.map(m => 
          m.id === assistantMsgId ? { ...m, content, type } : m
        ));
      });

      setIsTyping(false);

      // Explicitly cast finalType to MessageType to avoid TS narrowing errors 
      // where it thinks finalType remains 'general' after the async operation.
      if ((finalType as MessageType) === 'community_logged') {
        const logId = `LOG-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
        setLogs(prev => [{
          id: logId,
          userId: auth.user!.id,
          userName: auth.user!.name,
          originalMessage: originalInput,
          aiAnalysis: fullContent,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        }, ...prev]);
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, logId } : m));
      }
    }
  };

  const activeConversations = useMemo(() => {
    if (auth.user?.role !== 'ADMIN') return [];
    const userIds = Array.from(new Set(messages.map(m => m.userId))).filter(id => id !== ADMIN_EMAIL);
    return userIds.map(id => ({ id, name: id.split('@')[0].charAt(0).toUpperCase() + id.split('@')[0].slice(1) }));
  }, [messages, auth.user]);

  const filteredMessages = useMemo(() => {
    if (!auth.user) return [];
    const targetUserId = auth.user.role === 'ADMIN' ? selectedCitizenId : auth.user.id;
    return messages.filter(m => m.userId === targetUserId);
  }, [messages, auth.user, selectedCitizenId]);

  if (!auth.user) return <LoginView onLogin={handleLogin} />;

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans">
      <aside className="w-20 md:w-64 bg-white border-r border-slate-200 flex flex-col p-4 shadow-sm">
        <div className="flex items-center space-x-3 mb-10 px-2">
          <div className="bg-indigo-600 p-2 rounded-xl text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <span className="font-bold text-lg hidden md:block tracking-tight">VeryDeepMission</span>
        </div>

        <nav className="space-y-2 flex-1">
          <button onClick={() => setActiveTab('chat')} className={`flex items-center space-x-3 w-full p-3 rounded-xl transition-all ${activeTab === 'chat' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
            <span className="hidden md:block font-medium">Intelligence</span>
          </button>
          {auth.user.role === 'ADMIN' && (
            <button onClick={() => setActiveTab('admin')} className={`flex items-center space-x-3 w-full p-3 rounded-xl transition-all ${activeTab === 'admin' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              <span className="hidden md:block font-medium">Command Center</span>
            </button>
          )}
        </nav>

        <div className="mt-auto border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 truncate">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">{auth.user.name[0]}</div>
              <span className="text-xs font-bold hidden md:block truncate">{auth.user.name}</span>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" /></svg></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">
            {activeTab === 'chat' ? 'Civic Gateway' : 'Infrastructure Monitoring'}
          </h2>
        </header>

        {activeTab === 'chat' ? (
          <div className="flex-1 flex overflow-hidden">
            {auth.user.role === 'ADMIN' && (
               <div className="w-64 border-r border-slate-200 bg-white flex flex-col">
                 <div className="p-4 border-b font-bold text-xs uppercase text-slate-400">Citizens</div>
                 <div className="flex-1 overflow-y-auto">
                    {activeConversations.map(u => (
                      <button key={u.id} onClick={() => setSelectedCitizenId(u.id)} className={`w-full text-left p-4 hover:bg-slate-50 border-b ${selectedCitizenId === u.id ? 'bg-indigo-50 border-r-4 border-indigo-600' : ''}`}>
                         <p className="text-xs font-bold text-slate-700">{u.name}</p>
                      </button>
                    ))}
                 </div>
               </div>
            )}
            <div className="flex-1 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 no-scrollbar">
                {filteredMessages.map(m => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200'}`}>
                      {m.type === 'community_logged' && <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full uppercase mb-2 block w-fit">Logged Concern</span>}
                      <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                ))}
                {isTyping && <div className="text-xs text-slate-400 italic">Intelligence is processing...</div>}
                <div ref={chatEndRef} />
              </div>
              <footer className="p-6 bg-white border-t">
                <form onSubmit={handleSend} className="max-w-4xl mx-auto flex space-x-4">
                  <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message or report a community problem..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600" />
                  <button type="submit" disabled={!input.trim() || isTyping} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50">Send</button>
                </form>
              </footer>
            </div>
          </div>
        ) : (
          <div className="flex-1 p-8 overflow-y-auto">
            <h3 className="text-2xl font-bold mb-8">Civic Incident Dashboard</h3>
            <div className="grid grid-cols-1 gap-6">
              {logs.map(l => (
                <div key={l.id} className="bg-white border p-6 rounded-2xl shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                   <div>
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-[10px] font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-500 uppercase">{l.id}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${l.status === 'pending' ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>{l.status}</span>
                      </div>
                      <p className="font-bold text-slate-800">{l.originalMessage}</p>
                      <p className="text-xs text-slate-500">Reported by {l.userName} on {l.createdAt.toLocaleDateString()}</p>
                   </div>
                   <button onClick={() => { setActiveTab('chat'); setSelectedCitizenId(l.userId); }} className="text-indigo-600 text-sm font-bold hover:underline">View Conversation</button>
                </div>
              ))}
              {logs.length === 0 && <div className="text-center py-20 text-slate-400">No community incidents reported yet.</div>}
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
    <div className="min-h-screen bg-indigo-600 flex items-center justify-center p-6">
      <div className="bg-white p-10 rounded-[32px] shadow-2xl max-w-md w-full text-center">
        <div className="bg-indigo-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </div>
        <h1 className="text-3xl font-bold text-slate-800 mb-2">VeryDeepMission</h1>
        <p className="text-slate-500 mb-8 text-sm">Enter your mission portal</p>
        <form onSubmit={e => { e.preventDefault(); onLogin(email); }} className="space-y-4">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email Address" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600" required />
          <button type="submit" className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold shadow-lg hover:bg-indigo-700 transition-all">Initialize Access</button>
        </form>
        <button onClick={() => onLogin(ADMIN_EMAIL)} className="mt-6 text-indigo-600 text-xs font-bold hover:underline">Administrator Login</button>
      </div>
    </div>
  );
};

export default App;