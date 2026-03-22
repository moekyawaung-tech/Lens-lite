import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

export class LiveAudioSession {
  private ai: GoogleGenAI;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sessionPromise: Promise<any> | null = null;
  private nextPlayTime: number = 0;
  private isConnected: boolean = false;
  
  public onConnect?: () => void;
  public onDisconnect?: () => void;
  public onError?: (err: Error) => void;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async start(language: 'en' | 'my') {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      const systemInstruction = language === 'en' 
        ? "You are a helpful accessibility assistant. Converse with the user in English or Burmese. Keep answers concise, helpful, and natural for voice."
        : "You are a helpful accessibility assistant. Converse with the user in Burmese (Myanmar language) or English. Keep answers concise, helpful, and natural for voice.";

      this.sessionPromise = this.ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            this.isConnected = true;
            this.onConnect?.();
          },
          onmessage: (message: LiveServerMessage) => {
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && this.audioContext) {
              this.playAudioChunk(base64Audio);
            }
            
            if (message.serverContent?.interrupted) {
              this.nextPlayTime = this.audioContext?.currentTime || 0;
            }
          },
          onclose: () => {
            this.stop();
          },
          onerror: (err: any) => {
            console.error("Live API Error:", err);
            this.onError?.(new Error("Live API Error"));
            this.stop();
          }
        }
      });

      this.processor.onaudioprocess = (e) => {
        if (!this.isConnected) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }
        const buffer = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < buffer.byteLength; i++) {
          binary += String.fromCharCode(buffer[i]);
        }
        const base64 = btoa(binary);
        this.sessionPromise?.then(session => {
          session.sendRealtimeInput({ audio: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
        });
      };

    } catch (err) {
      console.error("Failed to start live audio:", err);
      this.onError?.(err as Error);
      this.stop();
    }
  }

  private playAudioChunk(base64Audio: string) {
    if (!this.audioContext) return;
    
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }
    
    const audioBuffer = this.audioContext.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);
    
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    
    const startTime = Math.max(this.nextPlayTime, this.audioContext.currentTime);
    source.start(startTime);
    this.nextPlayTime = startTime + audioBuffer.duration;
  }

  stop() {
    this.isConnected = false;
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.sessionPromise) {
      this.sessionPromise.then(session => session.close?.());
      this.sessionPromise = null;
    }
    this.onDisconnect?.();
  }
}
