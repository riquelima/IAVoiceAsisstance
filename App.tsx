
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


const App: React.FC = () => {
  const [status, setStatus] = useState<AssistantStatus>(AssistantStatus.IDLE);
  const [statusText, setStatusText] = useState('Clique para falar');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTranscriptRef = useRef<string>('');
  const beepAudioRef = useRef<HTMLAudioElement>(null);

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const stopAndProcess = useCallback(async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }

    const transcript = lastTranscriptRef.current.trim();
    if (transcript === '') {
      setStatus(AssistantStatus.IDLE);
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
      const audioURL = URL.createObjectURL(blob);
      const audio = new Audio(audioURL);

      audio.onplay = () => {
        setStatus(AssistantStatus.PLAYING);
      };

      audio.onended = () => {
        URL.revokeObjectURL(audioURL);
        setStatus(AssistantStatus.IDLE);
      };

      audio.onerror = (e) => {
        console.error("Erro ao tocar áudio:", e);
        setStatus(AssistantStatus.ERROR);
      };

      audio.play();

    } catch (err) {
      console.error("Erro ao enviar ou processar resposta:", err);
      setStatus(AssistantStatus.ERROR);
      if (err instanceof Error) {
          setStatusText(`Erro: ${err.message}`);
      } else {
          setStatusText("Erro ao falar com a IA");
      }
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (!SpeechRecognition) {
      setStatus(AssistantStatus.ERROR);
      setStatusText('Reconhecimento de voz não é suportado neste navegador.');
      return;
    }
    
    if (beepAudioRef.current) {
        beepAudioRef.current.play().catch(e => console.error("Error playing beep:", e));
    }

    lastTranscriptRef.current = '';
    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setStatus(AssistantStatus.LISTENING);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          lastTranscriptRef.current += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      setStatusText(lastTranscriptRef.current + interimTranscript || "Ouvindo...");

      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      silenceTimeoutRef.current = setTimeout(() => {
        stopAndProcess();
      }, 1500); // Increased delay for better experience
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Erro no reconhecimento de voz:', event.error);
      setStatus(AssistantStatus.ERROR);
      setStatusText(`Erro: ${event.error}`);
    };

    recognition.onend = () => {
       if (status === AssistantStatus.LISTENING) {
          stopAndProcess();
       }
    };
    
    recognition.start();
  }, [SpeechRecognition, status, stopAndProcess]);


  const handleOrbClick = useCallback(() => {
    if (status === AssistantStatus.LISTENING) {
      stopAndProcess();
    } else if (status === AssistantStatus.IDLE || status === AssistantStatus.ERROR) {
      startRecognition();
    }
  }, [status, startRecognition, stopAndProcess]);
  
  useEffect(() => {
    switch (status) {
      case AssistantStatus.IDLE:
        setStatusText("Clique para falar");
        break;
      case AssistantStatus.LISTENING:
        // Text is set by onresult
        break;
      case AssistantStatus.PROCESSING:
        setStatusText("Processando...");
        break;
      case AssistantStatus.PLAYING:
        setStatusText("Respondendo...");
        break;
      case AssistantStatus.ERROR:
        // Text is set by the error handler
        break;
    }
  }, [status]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
    };
  }, []);

  const getOrbClasses = () => {
    let base = 'w-52 h-52 rounded-full flex items-center justify-center z-10 transition-all duration-300 ease-in-out';
    switch (status) {
      case AssistantStatus.LISTENING:
        return `${base} bg-gradient-radial from-teal-400 to-cyan-700 shadow-[0_0_50px_#00ffff]`;
      case AssistantStatus.PLAYING: // No longer rendered, but kept for logic consistency
        return `${base} bg-gradient-radial from-fuchsia-500 to-purple-800 shadow-[0_0_50px_rgba(255,0,255,0.6)]`;
      default:
        return `${base} bg-gradient-radial from-cyan-400 to-cyan-800 shadow-[0_0_40px_rgba(0,255,255,0.53)]`;
    }
  };
  
  const getRingClasses = () => {
    let base = 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-60 h-60 rounded-full pointer-events-none z-0';
    switch (status) {
        case AssistantStatus.LISTENING:
            return `${base} animation-vibrate shadow-[0_0_30px_rgba(0,255,255,0.34)]`;
        case AssistantStatus.PLAYING: // No longer rendered
            return `${base} animation-glow`;
        default:
            return `${base} animation-pulse shadow-[0_0_30px_rgba(0,255,255,0.34)]`;
    }
  };


  return (
    <main className="bg-black text-white font-sans flex flex-col justify-center items-center h-screen m-0 overflow-hidden">
      {status === AssistantStatus.PLAYING ? (
        <div className="relative w-[250px] h-40 flex items-center justify-center">
          <div 
            className="absolute left-0 top-0 w-40 h-40 rounded-full bg-black/30 animation-glow-cyan" 
            style={{ animationDuration: '2.4s' }}
          ></div>
          <div 
            className="absolute right-0 top-0 w-40 h-40 rounded-full bg-black/30 animation-glow-cyan" 
            style={{ animationDuration: '2.4s', animationDelay: '-1.2s' }}
          ></div>
        </div>
      ) : (
        <div 
            className="relative w-60 h-60 flex items-center justify-center cursor-pointer"
            onClick={handleOrbClick}
            title="Clique para falar com a IA"
        >
            <div id="ring" className={getRingClasses()}></div>
            <div id="orb" className={getOrbClasses()}></div>
        </div>
      )}
      <div className="mt-8 text-lg text-gray-400 font-light italic min-h-[28px]">
        {statusText}
      </div>
      <audio ref={beepAudioRef} src="https://cdn.jsdelivr.net/gh/pixelbrackets/g-sounds/sounds/sfx/beep.mp3" preload="auto"></audio>
    </main>
  );
};

export default App;
