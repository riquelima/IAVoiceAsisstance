import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AssistantStatus } from './types';

// Type definitions for SpeechRecognition API to ensure TypeScript compatibility
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  start(): void;
  stop(): void;
}
declare global {
  interface Window {
    SpeechRecognition: { new(): SpeechRecognition };
    webkitSpeechRecognition: { new(): SpeechRecognition };
  }
}

// A tiny, silent audio file as a Base64 string to unlock audio context on mobile.
const SILENT_AUDIO = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';


const App: React.FC = () => {
  const [status, setStatus] = useState<AssistantStatus>(AssistantStatus.IDLE);
  const [statusText, setStatusText] = useState('Clique para falar');
  
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTranscriptRef = useRef<string>('');
  const isStoppingRef = useRef<boolean>(false);
  
  const beepAudioRef = useRef<HTMLAudioElement>(null);
  const responseAudioRef = useRef<HTMLAudioElement>(null);
  const audioUnlockedRef = useRef<boolean>(false);

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const stopAndProcess = useCallback(async () => {
    if (isStoppingRef.current || statusRef.current !== AssistantStatus.LISTENING) {
      return;
    }
    isStoppingRef.current = true;
    
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
        recognitionRef.current = null;
    }

    const transcript = lastTranscriptRef.current.trim();
    if (transcript === '') {
      setStatus(AssistantStatus.IDLE);
      isStoppingRef.current = false;
      return;
    }

    setStatus(AssistantStatus.PROCESSING);

    try {
      const response = await fetch("https://primary-production-ed845.up.railway.app/webhook/receber-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta: transcript })
      });

      if (!response.ok) {
        throw new Error(`Erro na resposta do servidor: ${response.statusText}`);
      }

      const blob = await response.blob();
      const audioEl = responseAudioRef.current;
      
      if (!audioEl) {
        throw new Error("Elemento de áudio de resposta não encontrado.");
      }
      
      const audioURL = URL.createObjectURL(blob);
      
      if (audioEl.src && audioEl.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioEl.src);
      }
      
      const cleanupAndReset = () => {
        if (audioEl.src && audioEl.src.startsWith('blob:')) {
            URL.revokeObjectURL(audioEl.src);
        }
        setStatus(AssistantStatus.IDLE);
        isStoppingRef.current = false;
        audioEl.onplay = null;
        audioEl.onended = null;
        audioEl.onerror = null;
      };

      audioEl.src = audioURL;
      audioEl.load();

      audioEl.onplay = () => setStatus(AssistantStatus.PLAYING);
      audioEl.onended = cleanupAndReset;
      audioEl.onerror = (e) => {
        console.error("Erro ao tocar áudio:", e);
        setStatus(AssistantStatus.ERROR);
        setStatusText("Falha ao tocar o áudio.");
        cleanupAndReset();
      };
      
      await audioEl.play().catch(e => {
          console.error("Falha ao iniciar a reprodução de áudio:", e);
          setStatus(AssistantStatus.ERROR);
          setStatusText("Clique para permitir a reprodução de áudio.");
          cleanupAndReset();
      });

    } catch (err) {
      console.error("Erro ao enviar ou processar resposta:", err);
      setStatus(AssistantStatus.ERROR);
      if (err instanceof Error) {
          setStatusText('Erro de comunicação.');
      } else {
          setStatusText("Erro ao falar com a IA");
      }
      isStoppingRef.current = false;
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (!SpeechRecognition) {
      setStatus(AssistantStatus.ERROR);
      setStatusText('Reconhecimento de voz não é suportado.');
      return;
    }
    
    if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
    }
    
    if (beepAudioRef.current) {
        beepAudioRef.current.play().catch(e => console.error("Erro ao tocar o bipe:", e));
    }

    lastTranscriptRef.current = '';
    isStoppingRef.current = false;
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setStatus(AssistantStatus.LISTENING);
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = setTimeout(() => stopAndProcess(), 4000); // Stop if no speech detected within 4s
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // Rebuild the transcript from scratch each time for robustness.
      let final_transcript = '';
      let interim_transcript = '';
      for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final_transcript += event.results[i][0].transcript;
        } else {
          interim_transcript += event.results[i][0].transcript;
        }
      }

      // Always save the most complete transcript available to ensure the webhook is fired.
      const full_transcript = (final_transcript + interim_transcript).trim();
      lastTranscriptRef.current = full_transcript;
      setStatusText(full_transcript || "Ouvindo...");


      // Reset the silence timeout every time new audio is received.
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = setTimeout(() => stopAndProcess(), 1500); // Stop after 1.5s of silence
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Erro no reconhecimento de voz:', event.error, event.message);
      if (isStoppingRef.current) return;
      setStatus(AssistantStatus.ERROR);
      if (event.error === 'no-speech') {
        setStatusText("Não ouvi nada. Tente de novo.");
      } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setStatusText("A permissão do microfone foi negada.");
      } else {
        setStatusText(`Erro de microfone: ${event.error}`);
      }
    };

    // By leaving onend empty, we prevent the browser from prematurely stopping recognition.
    // The app is now in full control via the silence timer or user click.
    recognition.onend = () => {};
    
    try {
      recognition.start();
    } catch (e) {
      console.error("Falha ao iniciar o reconhecimento:", e);
      setStatus(AssistantStatus.ERROR);
      setStatusText("Não foi possível iniciar o microfone.");
    }
  }, [SpeechRecognition, stopAndProcess]);

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    try {
      const audio = new Audio(SILENT_AUDIO);
      audio.volume = 0;
      audio.play().catch(() => {});
      audioUnlockedRef.current = true;
      console.log('Audio context unlocked.');
    } catch (e) {
      console.error('Could not unlock audio context:', e);
    }
  }, []);

  const handleOrbClick = useCallback(() => {
    unlockAudio();

    if (status === AssistantStatus.LISTENING) {
      stopAndProcess();
    } else if (status === AssistantStatus.IDLE || status === AssistantStatus.ERROR) {
      startRecognition();
    }
  }, [status, startRecognition, stopAndProcess, unlockAudio]);
  
  useEffect(() => {
    switch (status) {
      case AssistantStatus.IDLE:
        setStatusText("Clique para falar");
        break;
      case AssistantStatus.LISTENING:
        // Set initial listening text here, but allow onresult to override
        if (!lastTranscriptRef.current) {
            setStatusText("Ouvindo...");
        }
        break;
      case AssistantStatus.PROCESSING:
        setStatusText("Processando...");
        break;
      case AssistantStatus.PLAYING:
        setStatusText("Respondendo...");
        break;
      case AssistantStatus.ERROR:
        // Error text is now set directly in the error handlers for more specific messages.
        break;
    }
  }, [status]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (responseAudioRef.current && responseAudioRef.current.src.startsWith('blob:')) {
          URL.revokeObjectURL(responseAudioRef.current.src);
      }
    };
  }, []);
  
  const getOrbClasses = () => {
    const base = "w-52 h-52 rounded-full flex items-center justify-center transition-all duration-300";
    const shadowIdle = "shadow-[0_0_40px_rgba(0,255,255,0.5)]";
    const shadowListening = "shadow-[0_0_50px_#00ffff]";
    const shadowPlaying = "shadow-[0_0_50px_rgba(255,0,255,0.6)]";
    const shadowProcessing = "shadow-[0_0_50px_#00ffff]";
    const shadowError = "shadow-[0_0_50px_rgba(255,0,0,0.7)]";

    switch(status) {
        case AssistantStatus.LISTENING:
            return `${base} bg-gradient-to-br from-cyan-200 to-teal-600 ${shadowListening}`;
        case AssistantStatus.PROCESSING:
             return `${base} bg-gradient-to-br from-cyan-300 to-teal-700 ${shadowProcessing}`;
        case AssistantStatus.PLAYING:
            return `${base} bg-gradient-to-br from-fuchsia-500 to-purple-900 ${shadowPlaying}`;
        case AssistantStatus.ERROR:
            return `${base} bg-gradient-to-br from-red-500 to-red-900 ${shadowError}`;
        case AssistantStatus.IDLE:
        default:
            return `${base} bg-gradient-to-br from-cyan-400 to-cyan-800 ${shadowIdle}`;
    }
  };

  const getRingClasses = () => {
      const base = "absolute w-64 h-64 rounded-full pointer-events-none";
      const shadowIdle = "shadow-[0_0_30px_rgba(0,255,255,0.3)]";
      const shadowListening = "shadow-[0_0_40px_rgba(0,255,255,0.7)]";
      const shadowProcessing = "shadow-[0_0_50px_rgba(0,255,255,0.5)]";

      switch(status) {
          case AssistantStatus.LISTENING:
              return `${base} animation-vibrate ${shadowListening}`;
          case AssistantStatus.PROCESSING:
              return `${base} animation-pulse-fast ${shadowProcessing}`;
          case AssistantStatus.PLAYING:
              return `${base} animation-glow-fuchsia`;
          case AssistantStatus.ERROR:
              return `${base} animation-glow-red`;
          case AssistantStatus.IDLE:
          default:
              return `${base} animation-pulse ${shadowIdle}`;
      }
  };
  
  const isClickable = status === AssistantStatus.IDLE || status === AssistantStatus.ERROR || status === AssistantStatus.LISTENING;

  return (
    <main className="bg-black text-white font-sans flex flex-col justify-center items-center h-screen m-0 overflow-hidden">
        <div 
            className={`relative w-64 h-64 flex items-center justify-center ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
            onClick={isClickable ? handleOrbClick : undefined}
            title={isClickable ? "Clique para falar com a IA" : ""}
            aria-live="polite"
        >
            <div className={getRingClasses()}></div>
            <div className={getOrbClasses()}></div>
        </div>
        <div className="mt-5 text-lg text-gray-400 font-light italic text-center px-4">
            {statusText}
        </div>
      <audio ref={beepAudioRef} src="https://actions.google.com/sounds/v1/alarms/beep_short.mp3" preload="auto"></audio>
      <audio ref={responseAudioRef} preload="auto"></audio>
    </main>
  );
};

export default App;