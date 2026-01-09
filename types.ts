
export interface LyricLine {
  time: number;
  text: string;
}

export interface KaraokeState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isVocalRemoved: boolean;
  isLyricsLoading: boolean;
  lyrics: LyricLine[];
  videoUrl: string | null;
}

export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  ERROR = 'ERROR'
}
