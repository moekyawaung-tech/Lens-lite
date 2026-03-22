/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Camera, Image as ImageIcon, Sparkles, Languages, X, RefreshCw, Volume2, VolumeX, Eye, Repeat, Mic, Volume1, Download, Wand2, ArrowLeft, History, WifiOff, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { analyzeImage, generateImage } from './geminiService';
import { LiveAudioSession } from './liveAudio';
import { saveToHistory, getHistory, deleteFromHistory, HistoryItem } from './historyService';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type Language = 'en' | 'my';

export default function App() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [language, setLanguage] = useState<Language>('en');
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(0.9);
  const [volume, setVolume] = useState(1.0);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [appMode, setAppMode] = useState<'analyze' | 'generate' | 'history'>('analyze');
  const [generationPrompt, setGenerationPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const liveSessionRef = useRef<LiveAudioSession | null>(null);

  // Cleanup speech synthesis on unmount and handle online/offline
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
    };
  }, []);

  const loadHistory = async () => {
    const items = await getHistory();
    setHistoryItems(items);
  };

  useEffect(() => {
    if (appMode === 'history') {
      loadHistory();
    }
  }, [appMode]);

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      } else {
        setHasApiKey(true);
      }
    };
    checkApiKey();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setImagePreviewUrl(URL.createObjectURL(file));
      setResult(null);
      setError(null);
      stopSpeaking();
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        } else {
          reject(new Error('Failed to convert to base64'));
        }
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const speakText = (text: string, lang: Language, rate: number = playbackRate, vol: number = volume) => {
    if (!window.speechSynthesis) return;
    
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === 'en' ? 'en-US' : 'my-MM';
    utterance.rate = rate;
    utterance.volume = vol;
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    window.speechSynthesis.speak(utterance);
  };

  const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newRate = parseFloat(e.target.value);
    setPlaybackRate(newRate);
    if (isSpeaking && result) {
      speakText(result, language, newRate, volume);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    if (isSpeaking && result) {
      speakText(result, language, playbackRate, newVol);
    }
  };

  const stopSpeaking = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  const startLiveConversation = async () => {
    setIsLiveMode(true);
    setLiveStatus('connecting');
    setError(null);
    stopSpeaking();
    
    try {
      const session = new LiveAudioSession((process.env.API_KEY || process.env.GEMINI_API_KEY) as string);
      liveSessionRef.current = session;
      
      session.onConnect = () => setLiveStatus('connected');
      session.onDisconnect = () => {
        setLiveStatus('idle');
        setIsLiveMode(false);
      };
      session.onError = (err) => {
        setError(err.message);
        setLiveStatus('error');
        setIsLiveMode(false);
      };
      
      await session.start(language);
    } catch (err) {
      setError('Failed to start live conversation.');
      setIsLiveMode(false);
      setLiveStatus('idle');
    }
  };

  const stopLiveConversation = () => {
    if (liveSessionRef.current) {
      liveSessionRef.current.stop();
      liveSessionRef.current = null;
    }
    setIsLiveMode(false);
    setLiveStatus('idle');
  };

  const handleAnalyze = async () => {
    if (!imageFile || isOffline) return;

    setIsAnalyzing(true);
    setError(null);
    stopSpeaking();
    
    try {
      const base64Image = await fileToBase64(imageFile);
      const analysisResult = await analyzeImage(base64Image, imageFile.type, language);
      setResult(analysisResult);
      
      // Save to history
      await saveToHistory({
        imagePreviewUrl: `data:${imageFile.type};base64,${base64Image}`,
        result: analysisResult,
        language,
        type: 'analysis'
      });

      // Automatically announce the result
      speakText(analysisResult, language);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const resetApp = () => {
    setImageFile(null);
    setImagePreviewUrl(null);
    setResult(null);
    setError(null);
    setGeneratedImageUrl(null);
    setGenerationPrompt('');
    stopSpeaking();
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleDownloadImage = () => {
    const urlToDownload = imagePreviewUrl || generatedImageUrl;
    if (!urlToDownload) return;
    const a = document.createElement('a');
    a.href = urlToDownload;
    a.download = imageFile?.name || 'generated-image.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleGenerateImage = async () => {
    if (!generationPrompt.trim() || isOffline) return;
    setIsGenerating(true);
    setError(null);
    setGeneratedImageUrl(null);
    stopSpeaking();
    
    try {
      const promptWithLang = language === 'my' 
        ? `Generate an image based on this Burmese description: ${generationPrompt}`
        : generationPrompt;
      const url = await generateImage(promptWithLang);
      setGeneratedImageUrl(url);

      // Save to history
      await saveToHistory({
        imagePreviewUrl: url,
        result: generationPrompt,
        language,
        type: 'generation'
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate image';
      if (errorMessage.includes('Requested entity was not found')) {
        setHasApiKey(false);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleLanguage = () => {
    setLanguage((prev) => {
      const newLang = prev === 'en' ? 'my' : 'en';
      // If there's already a result, we might want to re-translate, but for simplicity we just stop speaking
      stopSpeaking();
      return newLang;
    });
  };

  if (hasApiKey === false) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 text-center font-sans">
        <Wand2 size={64} className="text-purple-500 mb-6" />
        <h1 className="text-3xl font-bold text-white mb-4">API Key Required</h1>
        <p className="text-gray-400 max-w-md mb-8 text-lg">
          To use the high-resolution professional image generation model, you need to select a Google Cloud project with billing enabled.
          <br /><br />
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">
            Learn more about billing
          </a>
        </p>
        <button
          onClick={async () => {
            if (window.aistudio?.openSelectKey) {
              await window.aistudio.openSelectKey();
              setHasApiKey(true);
            }
          }}
          className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-full font-bold text-xl shadow-lg transition-all active:scale-95"
        >
          Select API Key
        </button>
      </div>
    );
  }

  if (hasApiKey === null) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col font-sans text-gray-100">
      {/* Header */}
      <header className="bg-gray-800 shadow-md px-4 py-4 flex items-center justify-between sticky top-0 z-10 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/20 p-2.5 rounded-full text-emerald-400">
            <Eye size={24} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white hidden sm:block">Lookout</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setAppMode(appMode === 'history' ? 'analyze' : 'history');
              if (appMode !== 'history') resetApp();
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-base font-medium transition-colors border ${
              appMode === 'history' 
                ? 'bg-emerald-600 border-emerald-500 text-white' 
                : 'bg-gray-700 hover:bg-gray-600 border-gray-600 text-gray-200'
            }`}
            aria-label="Toggle History"
          >
            <History size={18} />
            <span className="hidden sm:inline">{language === 'en' ? 'History' : 'မှတ်တမ်း'}</span>
          </button>
          <button
            onClick={toggleLanguage}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-full text-base font-medium transition-colors border border-gray-600 text-gray-200"
            aria-label="Toggle Language"
          >
            <Languages size={18} />
            {language === 'en' ? 'English' : 'မြန်မာ'}
          </button>
        </div>
      </header>

      {/* Offline Banner */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-red-500/20 border-b border-red-500/30 px-4 py-3 flex items-center justify-center gap-3 text-red-200"
          >
            <WifiOff size={18} />
            <span className="font-medium text-sm sm:text-base">
              {language === 'en' 
                ? 'You are offline. You can only view previously saved history.' 
                : 'အင်တာနက်ချိတ်ဆက်မှုမရှိပါ။ မှတ်တမ်းဟောင်းများကိုသာ ကြည့်ရှုနိုင်ပါသည်။'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col w-full max-w-2xl mx-auto p-4 relative">
        <AnimatePresence mode="wait">
          {appMode === 'history' ? (
            <motion.div
              key="history-state"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col gap-6"
            >
              <div className="flex items-center gap-4 mb-2">
                <button 
                  onClick={() => setAppMode('analyze')}
                  className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full transition-colors border border-gray-700"
                >
                  <ArrowLeft size={24} />
                </button>
                <h2 className="text-2xl font-bold text-white">
                  {language === 'en' ? 'Saved History' : 'သိမ်းဆည်းထားသော မှတ်တမ်း'}
                </h2>
              </div>

              {historyItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-500 space-y-4">
                  <History size={48} className="opacity-50" />
                  <p className="text-lg">
                    {language === 'en' ? 'No history found.' : 'မှတ်တမ်းမရှိပါ။'}
                  </p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {historyItems.map((item) => (
                    <div key={item.id} className="bg-gray-800 border border-gray-700 rounded-2xl p-4 flex gap-4 items-start">
                      <div className="w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-black border border-gray-700">
                        <img src={item.imagePreviewUrl} alt="History thumbnail" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-md">
                            {item.type === 'generation' ? (language === 'en' ? 'Generated' : 'ဖန်တီးထားသည်') : (language === 'en' ? 'Analyzed' : 'စိစစ်ထားသည်')}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(item.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300 line-clamp-2">
                          {item.result}
                        </p>
                        <div className="flex items-center gap-2 mt-auto pt-2">
                          <button
                            onClick={() => {
                              speakText(item.result, item.language);
                            }}
                            className="p-2 bg-gray-700 hover:bg-gray-600 rounded-full text-emerald-400 transition-colors"
                            title={language === 'en' ? 'Play' : 'ဖွင့်ရန်'}
                          >
                            <Volume2 size={16} />
                          </button>
                          <button
                            onClick={async () => {
                              await deleteFromHistory(item.id);
                              loadHistory();
                            }}
                            className="p-2 bg-gray-700 hover:bg-red-900/50 rounded-full text-red-400 transition-colors ml-auto"
                            title={language === 'en' ? 'Delete' : 'ဖျက်ရန်'}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          ) : appMode === 'generate' ? (
            <motion.div
              key="generate-state"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col gap-6"
            >
              <div className="flex items-center gap-4 mb-2">
                <button 
                  onClick={() => { setAppMode('analyze'); resetApp(); }}
                  className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full transition-colors border border-gray-700"
                >
                  <ArrowLeft size={24} />
                </button>
                <h2 className="text-2xl font-bold text-white">
                  {language === 'en' ? 'Generate Image' : 'ပုံဖန်တီးရန်'}
                </h2>
              </div>

              {!generatedImageUrl && !isGenerating && (
                <div className="flex flex-col gap-4">
                  <textarea
                    value={generationPrompt}
                    onChange={(e) => setGenerationPrompt(e.target.value)}
                    placeholder={language === 'en' ? 'Describe what you want to see...' : 'သင်မြင်ချင်သောအရာကို ဖော်ပြပါ...'}
                    className="w-full h-32 bg-gray-800 border border-gray-700 rounded-2xl p-4 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                  />
                  <button
                    onClick={handleGenerateImage}
                    disabled={!generationPrompt.trim() || isOffline}
                    className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 disabled:cursor-not-allowed text-white px-6 py-5 rounded-3xl text-xl font-bold shadow-lg transition-all active:scale-95"
                  >
                    <Sparkles size={24} />
                    {language === 'en' ? 'Generate' : 'ဖန်တီးရန်'}
                  </button>
                </div>
              )}

              {isGenerating && (
                <div className="flex flex-col items-center justify-center py-10 space-y-6 bg-gray-800 rounded-3xl border border-gray-700">
                  <div className="relative w-20 h-20">
                    <div className="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-purple-500 rounded-full border-t-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-purple-500">
                      <Wand2 size={28} className="animate-pulse" />
                    </div>
                  </div>
                  <p className="text-purple-400 font-bold text-xl animate-pulse">
                    {language === 'en' ? 'Generating...' : 'ဖန်တီးနေသည်...'}
                  </p>
                </div>
              )}

              {error && (
                <div className="bg-red-900/50 text-red-200 p-5 rounded-3xl border border-red-800 text-lg font-medium text-center">
                  {error}
                </div>
              )}

              {generatedImageUrl && (
                <div className="flex flex-col gap-6">
                  <div className="relative rounded-3xl overflow-hidden shadow-2xl bg-black aspect-auto max-h-[50vh] flex items-center justify-center border border-gray-700">
                    <img
                      src={generatedImageUrl}
                      alt="Generated"
                      className="max-w-full max-h-[50vh] object-contain opacity-90"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute top-4 right-4 flex gap-2">
                      <button
                        onClick={handleDownloadImage}
                        className="bg-black/60 hover:bg-black/80 text-white p-3 rounded-full backdrop-blur-md transition-colors border border-white/10"
                        aria-label="Download Image"
                        title={language === 'en' ? 'Download Image' : 'ပုံဒေါင်းလုဒ်လုပ်ရန်'}
                      >
                        <Download size={24} />
                      </button>
                      <button
                        onClick={() => setGeneratedImageUrl(null)}
                        className="bg-black/60 hover:bg-black/80 text-white p-3 rounded-full backdrop-blur-md transition-colors border border-white/10"
                        aria-label="Close"
                      >
                        <X size={24} />
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setGeneratedImageUrl(null);
                      setGenerationPrompt('');
                    }}
                    className="w-full flex items-center justify-center gap-3 bg-gray-800 border-2 border-gray-700 hover:bg-gray-700 text-white px-6 py-5 rounded-3xl text-lg font-semibold shadow-sm transition-all active:scale-95"
                  >
                    <RefreshCw size={20} />
                    {language === 'en' ? 'Generate Another' : 'နောက်တစ်ခုဖန်တီးရန်'}
                  </button>
                </div>
              )}
            </motion.div>
          ) : isLiveMode ? (
            <motion.div
              key="live-state"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex-1 flex flex-col items-center justify-center text-center space-y-10 py-12"
            >
              <div className="relative w-48 h-48 flex items-center justify-center">
                {liveStatus === 'connected' && (
                  <>
                    <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping"></div>
                    <div className="absolute inset-4 bg-emerald-500/30 rounded-full animate-pulse"></div>
                  </>
                )}
                <div className={`relative z-10 w-32 h-32 rounded-full flex items-center justify-center shadow-2xl transition-colors duration-500 ${liveStatus === 'connected' ? 'bg-emerald-500 text-white' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>
                  <Mic size={56} className={liveStatus === 'connected' ? 'animate-pulse' : ''} />
                </div>
              </div>
              
              <div className="space-y-4">
                <h2 className="text-3xl font-bold text-white">
                  {liveStatus === 'connecting' 
                    ? (language === 'en' ? 'Connecting...' : 'ချိတ်ဆက်နေသည်...') 
                    : (language === 'en' ? 'Listening...' : 'နားထောင်နေသည်...')}
                </h2>
                <p className="text-gray-400 max-w-sm mx-auto text-lg">
                  {language === 'en' 
                    ? 'Speak naturally in English or Burmese.' 
                    : 'အင်္ဂလိပ် သို့မဟုတ် မြန်မာဘာသာဖြင့် သဘာဝကျကျ ပြောဆိုပါ။'}
                </p>
              </div>

              <button 
                onClick={stopLiveConversation} 
                className="bg-red-600 hover:bg-red-500 text-white px-10 py-5 rounded-full font-bold text-xl shadow-lg transition-all active:scale-95 flex items-center gap-3"
              >
                <X size={24} />
                {language === 'en' ? 'End Conversation' : 'စကားပြောဆိုမှု ရပ်ရန်'}
              </button>
            </motion.div>
          ) : !imagePreviewUrl ? (
            <motion.div
              key="empty-state"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col items-center justify-center text-center space-y-10 py-12"
            >
              <div className="space-y-6">
                <div className="w-32 h-32 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto text-emerald-400 border border-emerald-500/20">
                  <Volume2 size={64} strokeWidth={1.5} />
                </div>
                <h2 className="text-3xl font-bold text-white">
                  {language === 'en' ? 'Hear what you see' : 'သင်မြင်ရသည်များကို နားထောင်ပါ'}
                </h2>
                <p className="text-gray-400 max-w-sm mx-auto text-lg">
                  {language === 'en'
                    ? 'Take a photo to hear a description or translation of the text in front of you.'
                    : 'သင့်ရှေ့ရှိ အရာဝတ္ထုများ သို့မဟုတ် စာသားများကို ဖတ်ပြရန် ဓာတ်ပုံရိုက်ပါ။'}
                </p>
              </div>

              <div className="flex flex-col gap-4 w-full max-w-sm">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={cameraInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={isOffline}
                  className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 disabled:cursor-not-allowed text-white px-6 py-6 rounded-3xl text-xl font-bold shadow-lg transition-all active:scale-95"
                >
                  <Camera size={28} />
                  {language === 'en' ? 'Open Camera' : 'ကင်မရာဖွင့်ရန်'}
                </button>

                <button
                  onClick={startLiveConversation}
                  disabled={isOffline}
                  className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white px-6 py-5 rounded-3xl text-lg font-bold shadow-lg transition-all active:scale-95"
                >
                  <Mic size={24} />
                  {language === 'en' ? 'Live Voice Chat' : 'တိုက်ရိုက် အသံဖြင့် စကားပြောရန်'}
                </button>

                <button
                  onClick={() => setAppMode('generate')}
                  disabled={isOffline}
                  className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 disabled:cursor-not-allowed text-white px-6 py-5 rounded-3xl text-lg font-bold shadow-lg transition-all active:scale-95"
                >
                  <Wand2 size={24} />
                  {language === 'en' ? 'Generate Image' : 'ပုံဖန်တီးရန်'}
                </button>

                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isOffline}
                  className="w-full flex items-center justify-center gap-3 bg-gray-800 border-2 border-gray-700 hover:bg-gray-700 disabled:bg-gray-800/50 disabled:cursor-not-allowed text-white px-6 py-5 rounded-3xl text-lg font-semibold shadow-sm transition-all active:scale-95"
                >
                  <ImageIcon size={24} />
                  {language === 'en' ? 'Choose Image' : 'ပုံရွေးချယ်ရန်'}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="preview-state"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col gap-6"
            >
              <div className="relative rounded-3xl overflow-hidden shadow-2xl bg-black aspect-auto max-h-[45vh] flex items-center justify-center border border-gray-700">
                <img
                  src={imagePreviewUrl}
                  alt="Preview"
                  className="max-w-full max-h-[45vh] object-contain opacity-90"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-4 right-4 flex gap-2">
                  <button
                    onClick={handleDownloadImage}
                    className="bg-black/60 hover:bg-black/80 text-white p-3 rounded-full backdrop-blur-md transition-colors border border-white/10"
                    disabled={isAnalyzing}
                    aria-label="Download Image"
                    title={language === 'en' ? 'Download Image' : 'ပုံဒေါင်းလုဒ်လုပ်ရန်'}
                  >
                    <Download size={24} />
                  </button>
                  <button
                    onClick={resetApp}
                    className="bg-black/60 hover:bg-black/80 text-white p-3 rounded-full backdrop-blur-md transition-colors border border-white/10"
                    disabled={isAnalyzing}
                    aria-label="Close"
                  >
                    <X size={24} />
                  </button>
                </div>
              </div>

              {!result && !isAnalyzing && (
                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={handleAnalyze}
                  disabled={isOffline}
                  className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 disabled:cursor-not-allowed text-white px-6 py-6 rounded-3xl text-xl font-bold shadow-lg transition-all active:scale-95"
                >
                  <Volume2 size={28} />
                  {language === 'en' ? 'Analyze & Speak' : 'စိစစ်ပြီး ဖတ်ပြရန်'}
                </motion.button>
              )}

              {isAnalyzing && (
                <div className="flex flex-col items-center justify-center py-10 space-y-6 bg-gray-800 rounded-3xl border border-gray-700">
                  <div className="relative w-20 h-20">
                    <div className="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-emerald-500 rounded-full border-t-transparent animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-emerald-500">
                      <Eye size={28} className="animate-pulse" />
                    </div>
                  </div>
                  <p className="text-emerald-400 font-bold text-xl animate-pulse">
                    {language === 'en' ? 'Looking...' : 'ကြည့်ရှုနေသည်...'}
                  </p>
                </div>
              )}

              {error && (
                <div className="bg-red-900/50 text-red-200 p-5 rounded-3xl border border-red-800 text-lg font-medium text-center">
                  {error}
                </div>
              )}

              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-gray-800 rounded-3xl shadow-xl border border-gray-700 p-6 space-y-6"
                >
                  <div className="flex items-center justify-between border-b border-gray-700 pb-4">
                    <h3 className="font-bold text-xl flex items-center gap-2 text-white">
                      <Volume2 size={24} className="text-emerald-400" />
                      {language === 'en' ? 'Announcement' : 'ကြေညာချက်'}
                    </h3>
                    <button
                      onClick={handleAnalyze}
                      disabled={isOffline}
                      className="bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:bg-gray-700/50 disabled:cursor-not-allowed p-2.5 rounded-full transition-colors border border-gray-600"
                      title={language === 'en' ? 'Analyze Again' : 'ထပ်မံကြိုးစားရန်'}
                      aria-label="Retry analysis"
                    >
                      <RefreshCw size={20} />
                    </button>
                  </div>
                  
                  <div className="text-xl leading-relaxed text-gray-200 font-medium min-h-[4rem]">
                    {/* We render plain text since we asked Gemini not to use markdown, 
                        but we keep Markdown component just in case it sneaks some in */}
                    <Markdown>{result}</Markdown>
                  </div>

                  {/* Playback Controls */}
                  <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 border-t border-gray-700">
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => {
                          if (isSpeaking) stopSpeaking();
                          else speakText(result, language);
                        }}
                        className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-full font-bold transition-colors ${
                          isSpeaking 
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' 
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                        }`}
                      >
                        {isSpeaking ? <><VolumeX size={20} /> {language === 'en' ? 'Stop' : 'ရပ်ရန်'}</> : <><Volume2 size={20} /> {language === 'en' ? 'Play' : 'ဖွင့်ရန်'}</>}
                      </button>
                      
                      <button
                        onClick={() => speakText(result, language)}
                        className="p-3 bg-gray-700 text-gray-300 hover:bg-gray-600 rounded-full transition-colors border border-gray-600"
                        title={language === 'en' ? 'Repeat' : 'ထပ်ဖွင့်ရန်'}
                        aria-label="Repeat announcement"
                      >
                        <Repeat size={20} />
                      </button>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto sm:ml-auto">
                      {/* Volume Slider */}
                      <div className="flex items-center gap-3 w-full sm:w-auto bg-gray-900/50 px-4 py-2.5 rounded-full border border-gray-700">
                        <Volume1 size={18} className="text-gray-400" />
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={volume}
                          onChange={handleVolumeChange}
                          className="w-full sm:w-24 accent-emerald-500"
                          aria-label="Volume"
                        />
                      </div>

                      {/* Speed Slider */}
                      <div className="flex items-center gap-3 w-full sm:w-auto bg-gray-900/50 px-4 py-2.5 rounded-full border border-gray-700">
                        <span className="text-sm text-gray-400 font-medium w-10 text-right">{playbackRate.toFixed(1)}x</span>
                        <input
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.1"
                          value={playbackRate}
                          onChange={handleRateChange}
                          className="w-full sm:w-24 accent-emerald-500"
                          aria-label="Playback speed"
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
