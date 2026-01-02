
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { LANGUAGES, TOPICS } from './constants';
import { ConversationSettings, Message, ProficiencyLevel } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio';

// --- Icons (Inline SVGs) ---
const MicIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>;
const StopIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>;
const GlobeIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>;
const SettingsIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>;

const App: React.FC = () => {
  const [settings, setSettings] = useState<ConversationSettings>({
    language: LANGUAGES[0],
    level: 'Beginner',
    topic: TOPICS[0]
  });
  const [isActive, setIsActive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');

  // Audio Context References
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);

  // Transcription states
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  const startSession = async () => {
    setStatus('connecting');
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      // Setup Audio Contexts
      if (!inputAudioCtxRef.current) {
        inputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const systemPrompt = `You are a friendly and encouraging language learning partner.
        Conversation Settings:
        - Target Language: ${settings.language.name}
        - Proficiency Level: ${settings.level}
        - Topic: ${settings.topic}

        Instructions:
        1. Always speak in ${settings.language.name} primarily. 
        2. If the user is at a Beginner level, use simple sentences and occasionally provide translations or explanations in English if they seem stuck.
        3. Gently correct the user's grammar or vocabulary in a supportive way.
        4. Keep the conversation flowing around the topic of ${settings.topic}.
        5. Your output must be natural, human-like, and conversational.`;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: systemPrompt,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('Session opened');
            setStatus('connected');
            setIsActive(true);
            
            // Microphone Streaming
            const source = inputAudioCtxRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioCtxRef.current!.createScriptProcessor(4096, 1, 1);
            processorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioCtxRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Audio
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && outputAudioCtxRef.current) {
              const ctx = outputAudioCtxRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.addEventListener('ended', () => {
                sourcesRef.current.delete(source);
              });
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }

            // Handle Interrupts
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }

            // Handle Transcription
            if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            }
            if (message.serverContent?.turnComplete) {
              if (currentInputTranscription.current || currentOutputTranscription.current) {
                setMessages(prev => [
                  ...prev,
                  ...(currentInputTranscription.current ? [{ role: 'user', text: currentInputTranscription.current, timestamp: Date.now() } as Message] : []),
                  ...(currentOutputTranscription.current ? [{ role: 'model', text: currentOutputTranscription.current, timestamp: Date.now() } as Message] : []),
                ]);
                currentInputTranscription.current = '';
                currentOutputTranscription.current = '';
              }
            }
          },
          onerror: (err) => {
            console.error('Session error:', err);
            setStatus('error');
            stopSession();
          },
          onclose: () => {
            console.log('Session closed');
            stopSession();
          }
        }
      });

      sessionRef.current = await sessionPromise;

    } catch (err) {
      console.error('Failed to start session:', err);
      setStatus('error');
    }
  };

  const stopSession = () => {
    setIsActive(false);
    setStatus('idle');
    
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  };

  const toggleSession = () => {
    if (isActive) stopSession();
    else startSession();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 md:p-8">
      {/* Header */}
      <header className="w-full max-w-4xl flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg">L</div>
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">LingoFlow AI</h1>
        </div>
        <button 
          onClick={() => stopSession()}
          className="p-2 text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <SettingsIcon />
        </button>
      </header>

      <main className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Sidebar Controls */}
        <div className="md:col-span-1 space-y-6">
          <section className="glass p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">
              <GlobeIcon /> Setup Session
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Language</label>
                <select 
                  disabled={isActive}
                  value={settings.language.code}
                  onChange={(e) => setSettings(s => ({ ...s, language: LANGUAGES.find(l => l.code === e.target.value)! }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
                >
                  {LANGUAGES.map(lang => (
                    <option key={lang.code} value={lang.code}>{lang.flag} {lang.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Proficiency</label>
                <select 
                  disabled={isActive}
                  value={settings.level}
                  onChange={(e) => setSettings(s => ({ ...s, level: e.target.value as ProficiencyLevel }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
                >
                  <option value="Beginner">Beginner</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                  <option value="Fluent">Fluent</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Topic</label>
                <select 
                  disabled={isActive}
                  value={settings.topic}
                  onChange={(e) => setSettings(s => ({ ...s, topic: e.target.value }))}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
                >
                  {TOPICS.map(topic => (
                    <option key={topic} value={topic}>{topic}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="bg-indigo-600 p-6 rounded-2xl shadow-xl text-white">
            <h3 className="text-lg font-bold mb-2">Practice Goals</h3>
            <p className="text-indigo-100 text-sm leading-relaxed">
              Today you're practicing <strong>{settings.language.name}</strong> focusing on <strong>{settings.topic}</strong>.
              Try to speak for at least 5 minutes!
            </p>
          </section>
        </div>

        {/* Conversation Area */}
        <div className="md:col-span-2 flex flex-col gap-4">
          <div className="glass flex-1 min-h-[500px] rounded-3xl shadow-sm border border-slate-200 flex flex-col overflow-hidden relative">
            
            {/* Messages Display */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <MicIcon />
                  </div>
                  <p>Hit the start button below to begin your real-time conversation.</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl p-4 text-sm ${
                      msg.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-tr-none shadow-md' 
                      : 'bg-white text-slate-800 rounded-tl-none border border-slate-100 shadow-sm'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
              <div id="messages-end"></div>
            </div>

            {/* Interaction Indicator */}
            {status === 'connecting' && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="font-medium text-slate-600">Connecting to Gemini...</p>
              </div>
            )}

            {/* Control Bar */}
            <div className="p-6 bg-white/50 border-t border-slate-100 flex items-center justify-center gap-6">
               <button 
                onClick={toggleSession}
                className={`group relative flex items-center justify-center w-16 h-16 rounded-full transition-all duration-300 transform active:scale-95 shadow-xl ${
                  isActive 
                  ? 'bg-rose-500 hover:bg-rose-600 text-white' 
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}
              >
                {isActive ? <StopIcon /> : <MicIcon />}
                
                {/* Ping Animation when active */}
                {isActive && (
                  <span className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-25"></span>
                )}
              </button>
              
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Status</span>
                <span className={`text-sm font-medium ${
                  status === 'connected' ? 'text-emerald-500' : 
                  status === 'error' ? 'text-rose-500' : 'text-slate-500'
                }`}>
                  {status === 'idle' ? 'Ready' : 
                   status === 'connecting' ? 'Connecting...' :
                   status === 'connected' ? 'Live Session Active' : 'Connection Error'}
                </span>
              </div>
            </div>
          </div>
          
          {/* Tips / Feedback card */}
          <div className="p-4 bg-white rounded-2xl border border-slate-200 flex items-start gap-4 shadow-sm">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 shrink-0">
               <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-800">Learning Tip</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                If you don't understand a word, just ask in English: "What does that word mean?" Your partner will explain it simply.
              </p>
            </div>
          </div>
        </div>
      </main>
      
      <footer className="mt-auto pt-8 text-slate-400 text-xs">
        &copy; 2024 LingoFlow AI. Powered by Gemini 2.5 Native Audio.
      </footer>
    </div>
  );
};

export default App;
