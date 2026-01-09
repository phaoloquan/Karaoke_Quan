
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { KaraokeState, AppStatus, LyricLine } from './types';
import Visualizer from './components/Visualizer';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [showYoutubeHelp, setShowYoutubeHelp] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [showRecordingModal, setShowRecordingModal] = useState(false);

  const [state, setState] = useState<KaraokeState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    isVocalRemoved: false,
    isLyricsLoading: false,
    lyrics: [],
    videoUrl: null,
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  
  // Nodes cho audio processing
  const splitterNodeRef = useRef<ChannelSplitterNode | null>(null);
  const mergerNodeRef = useRef<ChannelMergerNode | null>(null);
  const gainInverterNodeRef = useRef<GainNode | null>(null);
  const vocalRemovalOutputNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Ghi âm chuyên nghiệp
  const micStreamRef = useRef<MediaStream | null>(null);
  const micNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const mixingDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);

  const initAudioProcessing = useCallback(async () => {
    if (!videoRef.current || audioContextRef.current) return;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = ctx;

    const source = ctx.createMediaElementSource(videoRef.current);
    sourceNodeRef.current = source;

    // Thiết lập hệ thống tách lời
    const splitter = ctx.createChannelSplitter(2);
    const inverter = ctx.createGain();
    inverter.gain.value = -1;
    const merger = ctx.createChannelMerger(2);
    const output = ctx.createGain();
    const analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;

    // Mixing Destination để ghi âm cả nhạc và mic
    const mixedDest = ctx.createMediaStreamDestination();

    splitterNodeRef.current = splitter;
    gainInverterNodeRef.current = inverter;
    mergerNodeRef.current = merger;
    vocalRemovalOutputNodeRef.current = output;
    analyserRef.current = analyserNode;
    mixingDestinationRef.current = mixedDest;
    setAnalyser(analyserNode);

    // Mặc định kết nối trực tiếp
    source.connect(analyserNode);
    analyserNode.connect(ctx.destination);
    analyserNode.connect(mixedDest); // Luôn gửi nhạc vào bộ trộn
  }, []);

  const toggleVocalCut = () => {
    if (!audioContextRef.current || !sourceNodeRef.current || !splitterNodeRef.current || !mergerNodeRef.current || !gainInverterNodeRef.current || !vocalRemovalOutputNodeRef.current || !analyserRef.current || !mixingDestinationRef.current) return;

    const isNowRemoved = !state.isVocalRemoved;
    sourceNodeRef.current.disconnect();
    splitterNodeRef.current.disconnect();
    gainInverterNodeRef.current.disconnect();
    mergerNodeRef.current.disconnect();
    vocalRemovalOutputNodeRef.current.disconnect();
    analyserRef.current.disconnect();

    if (isNowRemoved) {
      sourceNodeRef.current.connect(splitterNodeRef.current);
      splitterNodeRef.current.connect(mergerNodeRef.current, 0, 0);
      splitterNodeRef.current.connect(mergerNodeRef.current, 0, 1);
      splitterNodeRef.current.connect(gainInverterNodeRef.current, 1);
      gainInverterNodeRef.current.connect(mergerNodeRef.current, 0, 0);
      gainInverterNodeRef.current.connect(mergerNodeRef.current, 0, 1);
      mergerNodeRef.current.connect(vocalRemovalOutputNodeRef.current);
      vocalRemovalOutputNodeRef.current.connect(analyserRef.current);
    } else {
      sourceNodeRef.current.connect(analyserRef.current);
    }
    
    analyserRef.current.connect(audioContextRef.current.destination);
    analyserRef.current.connect(mixingDestinationRef.current); // Gửi nhạc đã xử lý vào bộ trộn

    setState(prev => ({ ...prev, isVocalRemoved: isNowRemoved }));
  };

  const handleStartRecording = async () => {
    if (!audioContextRef.current || !mixingDestinationRef.current) {
        await initAudioProcessing();
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      
      const ctx = audioContextRef.current!;
      const micSource = ctx.createMediaStreamSource(stream);
      const micGain = ctx.createGain();
      micGain.gain.value = 1.5; // Tăng giọng hát lên một chút cho chuyên nghiệp

      micSource.connect(micGain);
      micGain.connect(mixingDestinationRef.current!); // Gửi giọng hát vào bộ trộn
      
      micNodeRef.current = micSource;
      micGainRef.current = micGain;

      // Bắt đầu ghi âm từ bộ trộn
      const recorder = new MediaRecorder(mixingDestinationRef.current!.stream);
      recordingChunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordingUrl(url);
        setShowRecordingModal(true);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      
      // Tự động phát nhạc nếu chưa phát
      if (!state.isPlaying) togglePlay();
      
    } catch (err) {
      console.error("Lỗi truy cập Micro:", err);
      alert("Bạn cần cấp quyền truy cập Micro để ghi âm!");
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      // Tắt stream micro
      micStreamRef.current?.getTracks().forEach(track => track.stop());
      
      // Ngắt kết nối micro khỏi bộ trộn
      micNodeRef.current?.disconnect();
      micGainRef.current?.disconnect();

      if (state.isPlaying) togglePlay();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus(AppStatus.PROCESSING);
    const url = URL.createObjectURL(file);
    
    setState(prev => ({
      ...prev,
      videoUrl: url,
      isLyricsLoading: true,
      lyrics: []
    }));

    setTimeout(() => {
      const mockLyrics: LyricLine[] = [
        { time: 0, text: "Chuẩn bị bắt đầu..." },
        { time: 5, text: "Giai điệu đang vang lên" },
        { time: 10, text: "Hãy bắt đầu phần hát của bạn ngay bây giờ" },
        { time: 15, text: "AI đã loại bỏ giọng ca sĩ để bạn tỏa sáng" },
        { time: 20, text: "Hát thật tự tin nào!" },
        { time: 30, text: "Cố gắng lên, bạn đang làm rất tốt" },
        { time: 45, text: "Điệp khúc sắp đến rồi" }
      ];
      
      setState(prev => ({ ...prev, lyrics: mockLyrics, isLyricsLoading: false }));
      setStatus(AppStatus.READY);
      setShowYoutubeHelp(false);
    }, 2500);
  };

  const handleYoutubeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl) return;
    setShowYoutubeHelp(true);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setState(prev => ({
        ...prev,
        currentTime: videoRef.current?.currentTime || 0,
        duration: videoRef.current?.duration || 0
      }));
    }
  };

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setState(prev => ({ ...prev, currentTime: time }));
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (audioContextRef.current?.state === 'suspended') audioContextRef.current.resume();

    if (state.isPlaying) {
      videoRef.current.pause();
    } else {
      initAudioProcessing();
      videoRef.current.play();
    }
    setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  };

  const activeLyricIndex = state.lyrics.findLastIndex(l => l.time <= state.currentTime);

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-10 gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl karaoke-gradient flex items-center justify-center shadow-lg shadow-purple-500/20">
            <i className="fas fa-microphone-alt text-2xl text-white"></i>
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tighter neon-text italic leading-none">
              KARAOKE <span className="text-pink-500">AI</span> PRO
            </h1>
            <p className="text-slate-500 text-[10px] uppercase tracking-[0.2em] font-bold mt-1">Phòng thu thông minh tại gia</p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row w-full lg:w-auto gap-4">
          <label className="flex-1 lg:flex-none cursor-pointer px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm transition-all flex items-center justify-center gap-3 shadow-lg shadow-indigo-600/20 active:scale-95">
            <i className="fas fa-cloud-upload-alt"></i>
            <span>TẢI VIDEO LÊN</span>
            <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
          </label>

          <form onSubmit={handleYoutubeSubmit} className="flex flex-1 sm:w-80 gap-2">
            <div className="relative flex-1">
              <i className="fab fa-youtube absolute left-4 top-1/2 -translate-y-1/2 text-red-500"></i>
              <input 
                type="text" 
                placeholder="Dán link YouTube..." 
                className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white/5 border border-white/10 focus:border-red-500 outline-none transition-all text-sm text-white"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
              />
            </div>
            <button type="submit" className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 font-bold text-xs transition-all text-white">
              Hỗ trợ
            </button>
          </form>
        </div>
      </header>

      {/* Main UI */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="relative aspect-video glass-panel rounded-[2.5rem] overflow-hidden shadow-2xl border-2 border-white/5 group bg-black/40">
            {state.videoUrl ? (
              <video 
                ref={videoRef}
                src={state.videoUrl}
                onTimeUpdate={handleTimeUpdate}
                className="w-full h-full object-contain"
                onEnded={() => setState(prev => ({ ...prev, isPlaying: false }))}
                crossOrigin="anonymous"
              />
            ) : (
              <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer group hover:bg-white/5 transition-all p-12 text-center">
                <div className="w-32 h-32 rounded-full bg-indigo-600/10 flex items-center justify-center mb-8 group-hover:scale-110 transition-all border-2 border-indigo-500/20 group-hover:border-indigo-500 shadow-2xl shadow-indigo-500/10">
                  <i className="fas fa-cloud-upload-alt text-5xl text-indigo-500"></i>
                </div>
                <h3 className="text-2xl font-black text-white mb-3 italic uppercase tracking-tighter">BẤM VÀO ĐÂY ĐỂ TẢI VIDEO</h3>
                <input type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
              </label>
            )}
            
            {/* Visualizer and Recording Overlay */}
            <div className="absolute bottom-0 left-0 right-0 pointer-events-none opacity-40 px-8 pb-6">
               <Visualizer analyser={analyser} />
            </div>

            {isRecording && (
              <div className="absolute top-8 right-8 flex items-center gap-3 bg-red-600 text-white px-5 py-2 rounded-full font-black text-xs animate-pulse shadow-lg shadow-red-600/50">
                <div className="w-2 h-2 bg-white rounded-full"></div>
                LIVE RECORDING
              </div>
            )}
          </div>

          <div className="glass-panel p-8 rounded-[2.5rem] flex flex-wrap items-center justify-between gap-8 border-b-4 border-indigo-500/20">
            <div className="flex items-center gap-8">
              <button 
                onClick={togglePlay}
                disabled={!state.videoUrl}
                className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 hover:scale-105 flex items-center justify-center shadow-xl shadow-indigo-500/20 transition-all disabled:opacity-20 active:scale-95"
              >
                <i className={`fas ${state.isPlaying ? 'fa-pause' : 'fa-play'} text-3xl text-white`}></i>
              </button>
              
              <div className="flex flex-col gap-2">
                <button 
                  onClick={toggleVocalCut}
                  disabled={!state.videoUrl}
                  className={`px-8 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all border-2 ${
                    state.isVocalRemoved 
                    ? 'bg-pink-600 border-pink-400 text-white' 
                    : 'bg-white/5 border-white/10 text-slate-500'
                  } disabled:opacity-20`}
                >
                  {state.isVocalRemoved ? 'VOCAL: ĐÃ TẮT' : 'VOCAL: ĐANG BẬT'}
                </button>

                {!isRecording ? (
                  <button 
                    onClick={handleStartRecording}
                    disabled={!state.videoUrl}
                    className="px-8 py-3 rounded-2xl bg-white text-black font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all shadow-xl shadow-white/5 flex items-center justify-center gap-3 disabled:opacity-20"
                  >
                    <i className="fas fa-microphone text-red-600"></i>
                    BẮT ĐẦU GHI ÂM
                  </button>
                ) : (
                  <button 
                    onClick={handleStopRecording}
                    className="px-8 py-3 rounded-2xl bg-red-600 text-white font-black text-xs uppercase tracking-widest hover:bg-red-500 transition-all shadow-xl shadow-red-600/20 flex items-center justify-center gap-3"
                  >
                    <i className="fas fa-stop"></i>
                    DỪNG & LƯU BÀI
                  </button>
                )}
              </div>
            </div>

            {/* Thanh điều khiển tiến trình (Seeker) chuyên nghiệp */}
            <div className="flex-1 min-w-[300px] space-y-3 px-4">
               <div className="flex justify-between text-[11px] text-slate-400 font-mono font-bold tracking-widest">
                 <span className="text-indigo-400 px-2 py-1 bg-indigo-500/10 rounded-lg">{formatTime(state.currentTime)}</span>
                 <span className="opacity-50 px-2 py-1 bg-white/5 rounded-lg">{formatTime(state.duration)}</span>
               </div>
               <div className="relative h-6 flex items-center group">
                 <input 
                  type="range"
                  min={0}
                  max={state.duration || 0}
                  step={0.1}
                  value={state.currentTime}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  disabled={!state.videoUrl}
                  className="w-full appearance-none bg-slate-900 h-2.5 rounded-full outline-none cursor-pointer overflow-hidden border border-white/5 seeker-input"
                  style={{
                    background: `linear-gradient(to right, #6366f1 ${(state.currentTime / state.duration) * 100 || 0}%, #0f172a ${(state.currentTime / state.duration) * 100 || 0}%)`
                  }}
                 />
                 <div className="absolute top-1/2 -translate-y-1/2 pointer-events-none w-full flex justify-between px-[2px]">
                   {/* Các điểm mốc tinh tế */}
                   <div className="w-0.5 h-1 bg-white/10 rounded-full"></div>
                   <div className="w-0.5 h-1 bg-white/10 rounded-full"></div>
                   <div className="w-0.5 h-1 bg-white/10 rounded-full"></div>
                   <div className="w-0.5 h-1 bg-white/10 rounded-full"></div>
                 </div>
               </div>
            </div>
          </div>
        </div>

        {/* Lời Bài Hát */}
        <div className="lg:col-span-1">
          <div className="glass-panel h-full min-h-[500px] rounded-[2.5rem] flex flex-col p-8 overflow-hidden relative border-t-8 border-indigo-500/40">
            <h3 className="text-2xl font-black italic flex items-center gap-4 mb-10">
              <span className="w-2 h-8 bg-indigo-500 rounded-full"></span>
              LYRICS
            </h3>
            
            <div className="flex-1 overflow-y-auto space-y-10 pr-2 scrollbar-hide py-4">
              {state.lyrics.length > 0 ? (
                state.lyrics.map((line, idx) => {
                  const isActive = idx === activeLyricIndex;
                  return (
                    <div 
                      key={idx} 
                      className={`transition-all duration-700 text-2xl font-black leading-tight cursor-pointer hover:text-white/60 ${
                        isActive ? 'text-white scale-110 origin-left drop-shadow-[0_0_15px_rgba(255,255,255,0.4)] translate-x-2' : 'text-slate-700 opacity-40'
                      }`}
                      onClick={() => handleSeek(line.time)}
                    >
                      {line.text}
                    </div>
                  );
                })
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 text-center gap-6">
                  <p className="text-[10px] font-black uppercase tracking-[0.3em]">Đang chờ tải video...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Recording Preview Modal */}
      {showRecordingModal && recordingUrl && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-2xl z-50 flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="glass-panel max-w-lg w-full rounded-[3rem] p-10 text-center border-t-8 border-pink-500 relative shadow-[0_0_100px_rgba(236,72,153,0.2)]">
            <button 
              onClick={() => setShowRecordingModal(false)}
              className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10"
            >
              <i className="fas fa-times"></i>
            </button>

            <div className="w-24 h-24 rounded-full karaoke-gradient mx-auto mb-8 flex items-center justify-center shadow-xl shadow-pink-500/30">
              <i className="fas fa-headphones-alt text-4xl text-white"></i>
            </div>
            
            <h2 className="text-3xl font-black italic text-white mb-2 tracking-tighter uppercase">Hoàn tất bản thu!</h2>
            <p className="text-slate-400 text-sm mb-10">Bản thu đã gộp giọng hát và nhạc nền đã sẵn sàng.</p>
            
            <div className="bg-black/40 p-6 rounded-[2rem] mb-10 border border-white/5">
              <audio src={recordingUrl} controls className="w-full h-12 custom-audio-player" />
            </div>

            <div className="flex flex-col gap-4">
              <a 
                href={recordingUrl} 
                download="my-karaoke-performance.webm"
                className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest hover:bg-indigo-500 transition-all flex items-center justify-center gap-3"
              >
                <i className="fas fa-download"></i>
                TẢI BẢN THU VỀ MÁY
              </a>
              <button 
                onClick={() => setShowRecordingModal(false)}
                className="w-full py-4 rounded-2xl bg-white/5 text-slate-400 font-black text-xs uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                THỬ LẠI LẦN NỮA
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-16 py-10 text-center border-t border-white/5 opacity-40">
        <p className="text-slate-600 text-[10px] uppercase font-black tracking-[0.5em]">KARAOKE AI PRO &bull; 2024</p>
      </footer>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .custom-audio-player::-webkit-media-controls-panel { background-color: transparent; }
        .custom-audio-player::-webkit-media-controls-current-time-display,
        .custom-audio-player::-webkit-media-controls-time-remaining-display { color: white; }

        .seeker-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 18px;
          width: 18px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(99, 102, 241, 0.8), 0 0 20px rgba(99, 102, 241, 0.4);
          border: 4px solid #6366f1;
          transition: transform 0.2s ease-in-out;
        }

        .seeker-input:hover::-webkit-slider-thumb {
          transform: scale(1.2);
        }

        .seeker-input::-moz-range-thumb {
          height: 18px;
          width: 18px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(99, 102, 241, 0.8);
          border: 4px solid #6366f1;
        }
      `}</style>
    </div>
  );
};

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export default App;
