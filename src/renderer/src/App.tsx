import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.esm.js'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cloud,
  Combine,
  Crop,
  ExternalLink,
  FileAudio2,
  FileVideo2,
  Film,
  FolderOpen,
  HardDrive,
  Info,
  Loader2,
  Music2,
  Play,
  RefreshCw,
  Replace,
  Scissors,
  Settings2,
  SlidersHorizontal,
  Square,
  Video,
  Wand2,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type {
  AudioChannels,
  AudioFormat,
  ExtractedOutput,
  ExtractionTarget,
  MediaStreamInfo,
  MuxAudioMode,
  ProbeResult,
  RepairStrategy,
  TrimMode,
  TrimTarget,
  ToolStatus,
  VideoAudioMode,
  VideoCodec,
  VideoPreset
} from '../../shared/media'

type RunState = 'idle' | 'probing' | 'working' | 'done' | 'error'
type ToolMode = 'info' | 'repair' | 'extract' | 'convert' | 'video' | 'trim' | 'mux' | 'replace'

type ExtractOption = {
  value: ExtractionTarget
  label: string
  icon: LucideIcon
}

type ToolOption = {
  value: ToolMode
  label: string
  icon: LucideIcon
}

const toolOptions: ToolOption[] = [
  { value: 'info', label: '媒体信息', icon: Info },
  { value: 'repair', label: '自动修复', icon: Wrench },
  { value: 'extract', label: '轨道提取', icon: Scissors },
  { value: 'convert', label: '音频转换', icon: SlidersHorizontal },
  { value: 'video', label: '视频转码', icon: Video },
  { value: 'trim', label: '音视频裁剪', icon: Crop },
  { value: 'mux', label: '重新合成', icon: Combine },
  { value: 'replace', label: '片段替换', icon: Replace }
]

const extractOptions: ExtractOption[] = [
  { value: 'audio', label: 'audio_only', icon: Music2 },
  { value: 'video', label: 'video_only', icon: Film },
  { value: 'both', label: '全部', icon: Scissors }
]

const audioFormats: AudioFormat[] = ['m4a', 'mp3', 'wav', 'flac', 'opus']
const sampleRates = [16000, 22050, 24000, 32000, 44100, 48000, 96000]
const videoPresets: VideoPreset[] = ['ultrafast', 'veryfast', 'fast', 'medium', 'slow']
const resolutionOptions = [
  { value: 'source', label: '保持原始', width: 'source' as const, height: 'source' as const },
  { value: '2160p', label: '3840 x 2160', width: 3840, height: 2160 },
  { value: '1440p', label: '2560 x 1440', width: 2560, height: 1440 },
  { value: '1080p', label: '1920 x 1080', width: 1920, height: 1080 },
  { value: '720p', label: '1280 x 720', width: 1280, height: 720 },
  { value: '480p', label: '854 x 480', width: 854, height: 480 },
  { value: '360p', label: '640 x 360', width: 640, height: 360 }
]

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return '--'
  }

  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const secs = rounded % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function formatPrecise(seconds: number): string {
  return Number.isFinite(seconds) ? seconds.toFixed(3) : '0.000'
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return '--'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatBitRate(bitRate: number | null): string {
  if (bitRate === null) {
    return '--'
  }

  return `${Math.round(bitRate / 1000)} kbps`
}

function streamLabel(stream: MediaStreamInfo): string {
  if (stream.kind === 'video') {
    const resolution = stream.width && stream.height ? `${stream.width} x ${stream.height}` : '--'
    const fps = stream.fps ? `${stream.fps.toFixed(stream.fps >= 100 ? 0 : 2)} fps` : '--'
    return `${resolution} · ${fps}`
  }

  if (stream.kind === 'audio') {
    const channels = stream.channels ? `${stream.channels} ch` : '--'
    const sampleRate = stream.sampleRate ? `${Math.round(stream.sampleRate / 1000)} kHz` : '--'
    return `${channels} · ${sampleRate}`
  }

  return stream.title || stream.language || '--'
}

function toolLine(status: ToolStatus | null): string {
  if (!status) {
    return '检测中'
  }

  if (!status.ffmpeg || !status.ffprobe) {
    return '未找到 FFmpeg / FFprobe'
  }

  return 'FFmpeg 已就绪'
}

function outputName(output: ExtractedOutput): string {
  return output.path.split(/[\\/]/).pop() ?? output.path
}

function outputIcon(kind: ExtractedOutput['kind']): LucideIcon {
  if (
    kind === 'video' ||
    kind === 'muxed-video' ||
    kind === 'repaired-media' ||
    kind === 'transcoded-video' ||
    kind === 'trimmed-media' ||
    kind === 'trimmed-video'
  ) {
    return Film
  }

  return Music2
}

function outputLabel(kind: ExtractedOutput['kind']): string {
  switch (kind) {
    case 'audio':
      return 'audio_only'
    case 'video':
      return 'video_only'
    case 'converted-audio':
      return 'converted'
    case 'muxed-video':
      return 'muxed_mp4'
    case 'edited-audio':
      return 'edited_audio'
    case 'repaired-media':
      return 'repaired_mp4'
    case 'transcoded-video':
      return 'transcoded'
    case 'trimmed-media':
      return 'trimmed_media'
    case 'trimmed-video':
      return 'trimmed_video'
    case 'trimmed-audio':
      return 'trimmed_audio'
  }
}

function App(): ReactElement {
  const [mode, setMode] = useState<ToolMode>('info')
  const [mediaPath, setMediaPath] = useState('')
  const [outputDir, setOutputDir] = useState('')
  const [target, setTarget] = useState<ExtractionTarget>('both')
  const [overwrite, setOverwrite] = useState(false)
  const [probe, setProbe] = useState<ProbeResult | null>(null)
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null)
  const [runState, setRunState] = useState<RunState>('idle')
  const [message, setMessage] = useState('')
  const [outputs, setOutputs] = useState<ExtractedOutput[]>([])
  const [log, setLog] = useState('')

  const [convertPath, setConvertPath] = useState('')
  const [convertFormat, setConvertFormat] = useState<AudioFormat>('m4a')
  const [convertSampleRate, setConvertSampleRate] = useState<number | 'source'>('source')
  const [convertChannels, setConvertChannels] = useState<AudioChannels>('source')
  const [convertBitrate, setConvertBitrate] = useState<number | 'auto'>('auto')

  const [muxVideoPath, setMuxVideoPath] = useState('')
  const [muxAudioPath, setMuxAudioPath] = useState('')
  const [muxAudioMode, setMuxAudioMode] = useState<MuxAudioMode>('aac')
  const [muxShortest, setMuxShortest] = useState(true)

  const [sourceAudioPath, setSourceAudioPath] = useState('')
  const [replacementAudioPath, setReplacementAudioPath] = useState('')
  const [replaceStart, setReplaceStart] = useState(0)
  const [replaceEnd, setReplaceEnd] = useState(5)
  const [replaceFormat, setReplaceFormat] = useState<AudioFormat>('m4a')
  const [replaceSampleRate, setReplaceSampleRate] = useState(48000)
  const [replaceChannels, setReplaceChannels] = useState<Exclude<AudioChannels, 'source'>>('stereo')

  const [repairStrategy, setRepairStrategy] = useState<RepairStrategy>('remux')
  const [videoCodec, setVideoCodec] = useState<VideoCodec>('h264')
  const [videoResolution, setVideoResolution] = useState('source')
  const [videoCrf, setVideoCrf] = useState(22)
  const [videoPreset, setVideoPreset] = useState<VideoPreset>('veryfast')
  const [videoAudioMode, setVideoAudioMode] = useState<VideoAudioMode>('aac')
  const [trimTarget, setTrimTarget] = useState<TrimTarget>('media')
  const [trimMode, setTrimMode] = useState<TrimMode>('copy')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(10)

  const busy = runState === 'probing' || runState === 'working'
  const audioStreams = useMemo(() => probe?.streams.filter((stream) => stream.kind === 'audio') ?? [], [probe])
  const videoStreams = useMemo(() => probe?.streams.filter((stream) => stream.kind === 'video') ?? [], [probe])
  const canExtract = Boolean(mediaPath && outputDir && probe && !busy)
  const canConvert = Boolean(convertPath && outputDir && !busy)
  const canMux = Boolean(muxVideoPath && muxAudioPath && outputDir && !busy)
  const canReplace = Boolean(
    sourceAudioPath && replacementAudioPath && outputDir && replaceEnd > replaceStart && !busy
  )
  const canRepair = Boolean(mediaPath && outputDir && !busy)
  const canTranscodeVideo = Boolean(mediaPath && outputDir && !busy)
  const canTrim = Boolean(mediaPath && outputDir && trimEnd > trimStart && !busy)

  useEffect(() => {
    window.zzMedia.getToolStatus().then(setToolStatus).catch(() => {
      setToolStatus({ ffmpeg: null, ffprobe: null })
    })
  }, [])

  async function chooseMediaFile(): Promise<void> {
    const selected = await window.zzMedia.selectFile('media')
    if (!selected) {
      return
    }

    setMediaPath(selected)
    setProbe(null)
    setOutputs([])
    setLog('')
    await inspectFile(selected)
  }

  async function chooseOutputDir(defaultPath?: string): Promise<void> {
    const selected = await window.zzMedia.selectOutputDir(defaultPath || mediaPath || convertPath || sourceAudioPath)
    if (selected) {
      setOutputDir(selected)
    }
  }

  async function inspectFile(path = mediaPath): Promise<void> {
    if (!path) {
      return
    }

    setRunState('probing')
    setMessage('读取媒体信息')
    setOutputs([])
    setLog('')

    try {
      const result = await window.zzMedia.probeMedia(path)
      setProbe(result)
      setRunState('idle')
      setMessage('媒体信息已更新')
    } catch (error) {
      setRunState('error')
      setMessage(error instanceof Error ? error.message : '读取失败')
    }
  }

  async function chooseAudioFile(setter: (path: string) => void, options?: { loadWaveform?: boolean }): Promise<void> {
    const selected = await window.zzMedia.selectFile('audio')
    if (!selected) {
      return
    }

    setter(selected)
    if (options?.loadWaveform) {
      setReplaceStart(0)
      setReplaceEnd(5)
    }
  }

  async function chooseVideoFile(setter: (path: string) => void): Promise<void> {
    const selected = await window.zzMedia.selectFile('video')
    if (selected) {
      setter(selected)
    }
  }

  async function runJob(job: () => Promise<{ outputs: ExtractedOutput[]; log: string }>, successMessage: string): Promise<void> {
    setRunState('working')
    setMessage('FFmpeg 正在处理')
    setOutputs([])
    setLog('')

    try {
      const result = await job()
      setOutputs(result.outputs)
      setLog(result.log)
      setRunState('done')
      setMessage(successMessage)
    } catch (error) {
      setRunState('error')
      setMessage(error instanceof Error ? error.message : '处理失败')
    }
  }

  async function extract(): Promise<void> {
    if (!canExtract) {
      return
    }

    await runJob(
      () =>
        window.zzMedia.extractMedia({
          inputPath: mediaPath,
          outputDir,
          target,
          overwrite
        }),
      '轨道导出完成'
    )
  }

  async function convertAudio(): Promise<void> {
    if (!canConvert) {
      return
    }

    await runJob(
      () =>
        window.zzMedia.convertAudio({
          inputPath: convertPath,
          outputDir,
          format: convertFormat,
          sampleRate: convertSampleRate,
          channels: convertChannels,
          bitrateKbps: convertBitrate,
          overwrite
        }),
      '音频转换完成'
    )
  }

  async function muxMedia(): Promise<void> {
    if (!canMux) {
      return
    }

    await runJob(
      () =>
        window.zzMedia.muxMedia({
          videoPath: muxVideoPath,
          audioPath: muxAudioPath,
          outputDir,
          audioMode: muxAudioMode,
          shortest: muxShortest,
          overwrite
        }),
      '音视频合成完成'
    )
  }

  async function replaceAudio(): Promise<void> {
    if (!canReplace) {
      return
    }

    await runJob(
      () =>
        window.zzMedia.replaceAudioSegment({
          sourceAudioPath,
          replacementAudioPath,
          outputDir,
          startSeconds: replaceStart,
          endSeconds: replaceEnd,
          format: replaceFormat,
          sampleRate: replaceSampleRate,
          channels: replaceChannels,
          overwrite
        }),
      '音频片段替换完成'
    )
  }

  async function repairMedia(): Promise<void> {
    if (!canRepair) {
      return
    }

    await runJob(
      () =>
        window.zzMedia.repairMedia({
          inputPath: mediaPath,
          outputDir,
          strategy: repairStrategy,
          overwrite
        }),
      repairStrategy === 'remux' ? '重封装修复完成' : '重建编码完成'
    )
  }

  async function transcodeVideo(): Promise<void> {
    if (!canTranscodeVideo) {
      return
    }

    const resolution = resolutionOptions.find((option) => option.value === videoResolution) ?? resolutionOptions[0]
    await runJob(
      () =>
        window.zzMedia.transcodeVideo({
          inputPath: mediaPath,
          outputDir,
          codec: videoCodec,
          width: resolution.width,
          height: resolution.height,
          crf: videoCrf,
          preset: videoPreset,
          audioMode: videoAudioMode,
          overwrite
        }),
      '视频转码完成'
    )
  }

  async function trimMedia(): Promise<void> {
    if (!canTrim) {
      return
    }

    await runJob(
      () =>
        window.zzMedia.trimMedia({
          inputPath: mediaPath,
          outputDir,
          target: trimTarget,
          mode: trimMode,
          startSeconds: trimStart,
          endSeconds: trimEnd,
          overwrite
        }),
      '裁剪导出完成'
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ZZ Media</p>
          <h1>音视频处理工作台</h1>
        </div>
        <div className={`tool-pill ${toolStatus?.ffmpeg && toolStatus?.ffprobe ? 'ready' : 'missing'}`}>
          <Settings2 size={16} />
          <span>{toolLine(toolStatus)}</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="side-panel">
          <div className="panel-block">
            <div className="section-title">
              <FileVideo2 size={18} />
              <span>主素材</span>
            </div>
            <button className="primary-button" type="button" onClick={chooseMediaFile}>
              <FolderOpen size={18} />
              <span>选择媒体</span>
            </button>
            <PathBox path={mediaPath} />
          </div>

          <div className="panel-block">
            <div className="section-title">
              <HardDrive size={18} />
              <span>输出目录</span>
            </div>
            <button className="secondary-button" type="button" onClick={() => chooseOutputDir()}>
              <FolderOpen size={18} />
              <span>选择目录</span>
            </button>
            <PathBox path={outputDir} />
          </div>

          <div className="panel-block">
            <div className="section-title">
              <Wand2 size={18} />
              <span>工具</span>
            </div>
            <nav className="tool-list" aria-label="工具">
              {toolOptions.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.value}
                    className={mode === option.value ? 'active' : ''}
                    type="button"
                    onClick={() => setMode(option.value)}
                  >
                    <Icon size={17} />
                    <span>{option.label}</span>
                  </button>
                )
              })}
            </nav>
          </div>

          <label className="toggle-row">
            <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
            <span>覆盖同名文件</span>
          </label>
        </aside>

        <section className="content-panel">
          <div className="status-row">
            <div className={`status-card ${runState}`}>
              {runState === 'error' ? (
                <AlertTriangle size={18} />
              ) : runState === 'done' ? (
                <CheckCircle2 size={18} />
              ) : runState === 'probing' || runState === 'working' ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <Clock3 size={18} />
              )}
              <span>{message || '等待操作'}</span>
            </div>
            <button className="icon-button" type="button" onClick={() => inspectFile()} disabled={!mediaPath || busy}>
              <RefreshCw size={17} />
              <span>刷新</span>
            </button>
          </div>

          {mode === 'info' && <InfoPanel probe={probe} audioStreams={audioStreams} videoStreams={videoStreams} />}

          {mode === 'repair' && (
            <RepairPanel
              inputPath={mediaPath}
              strategy={repairStrategy}
              canRun={canRepair}
              onStrategy={setRepairStrategy}
              onRun={repairMedia}
            />
          )}

          {mode === 'extract' && (
            <ExtractPanel
              target={target}
              setTarget={setTarget}
              canRun={canExtract}
              onRun={extract}
              probe={probe}
              audioStreams={audioStreams}
              videoStreams={videoStreams}
            />
          )}

          {mode === 'convert' && (
            <ConvertPanel
              inputPath={convertPath}
              format={convertFormat}
              sampleRate={convertSampleRate}
              channels={convertChannels}
              bitrate={convertBitrate}
              canRun={canConvert}
              onPick={() => chooseAudioFile(setConvertPath)}
              onFormat={setConvertFormat}
              onSampleRate={setConvertSampleRate}
              onChannels={setConvertChannels}
              onBitrate={setConvertBitrate}
              onRun={convertAudio}
            />
          )}

          {mode === 'video' && (
            <VideoPanel
              inputPath={mediaPath}
              codec={videoCodec}
              resolution={videoResolution}
              crf={videoCrf}
              preset={videoPreset}
              audioMode={videoAudioMode}
              canRun={canTranscodeVideo}
              onCodec={setVideoCodec}
              onResolution={setVideoResolution}
              onCrf={setVideoCrf}
              onPreset={setVideoPreset}
              onAudioMode={setVideoAudioMode}
              onRun={transcodeVideo}
            />
          )}

          {mode === 'trim' && (
            <TrimPanel
              inputPath={mediaPath}
              target={trimTarget}
              mode={trimMode}
              start={trimStart}
              end={trimEnd}
              canRun={canTrim}
              onTarget={setTrimTarget}
              onMode={setTrimMode}
              onStart={setTrimStart}
              onEnd={setTrimEnd}
              onRun={trimMedia}
            />
          )}

          {mode === 'mux' && (
            <MuxPanel
              videoPath={muxVideoPath}
              audioPath={muxAudioPath}
              audioMode={muxAudioMode}
              shortest={muxShortest}
              canRun={canMux}
              onPickVideo={() => chooseVideoFile(setMuxVideoPath)}
              onPickAudio={() => chooseAudioFile(setMuxAudioPath)}
              onAudioMode={setMuxAudioMode}
              onShortest={setMuxShortest}
              onRun={muxMedia}
            />
          )}

          {mode === 'replace' && (
            <ReplacePanel
              sourceAudioPath={sourceAudioPath}
              replacementAudioPath={replacementAudioPath}
              start={replaceStart}
              end={replaceEnd}
              format={replaceFormat}
              sampleRate={replaceSampleRate}
              channels={replaceChannels}
              canRun={canReplace}
              onPickSource={() => chooseAudioFile(setSourceAudioPath, { loadWaveform: true })}
              onPickReplacement={() => chooseAudioFile(setReplacementAudioPath)}
              onSelection={(start, end) => {
                setReplaceStart(start)
                setReplaceEnd(end)
              }}
              onStart={setReplaceStart}
              onEnd={setReplaceEnd}
              onFormat={setReplaceFormat}
              onSampleRate={setReplaceSampleRate}
              onChannels={setReplaceChannels}
              onRun={replaceAudio}
            />
          )}

          <ResultPanel outputs={outputs} log={log} />
        </section>
      </section>
    </main>
  )
}

function InfoPanel({
  probe,
  audioStreams,
  videoStreams
}: {
  probe: ProbeResult | null
  audioStreams: MediaStreamInfo[]
  videoStreams: MediaStreamInfo[]
}): ReactElement {
  return (
    <div className="tool-surface">
      <div className="surface-header">
        <div>
          <h2>媒体信息</h2>
          <p>查看封装、码率、轨道、分辨率、帧率和音频参数。</p>
        </div>
      </div>

      {probe ? (
        <>
          <div className="media-summary">
            <Metric label="文件" value={probe.fileName} />
            <Metric label="封装" value={probe.formatName} />
            <Metric label="时长" value={formatDuration(probe.durationSeconds)} />
            <Metric label="大小" value={formatBytes(probe.sizeBytes)} />
          </div>

          <div className="info-grid">
            <div className="info-panel">
              <h3>概览</h3>
              <dl className="detail-table">
                <div>
                  <dt>完整路径</dt>
                  <dd title={probe.filePath}>{probe.filePath}</dd>
                </div>
                <div>
                  <dt>整体码率</dt>
                  <dd>{formatBitRate(probe.bitRate)}</dd>
                </div>
                <div>
                  <dt>轨道数量</dt>
                  <dd>{probe.streams.length}</dd>
                </div>
              </dl>
            </div>
            <StreamGroup title="视频轨" streams={videoStreams} emptyText="无视频轨" />
            <StreamGroup title="音频轨" streams={audioStreams} emptyText="无音频轨" />
          </div>
        </>
      ) : (
        <EmptyState icon={Info} label="请选择媒体文件后查看信息" />
      )}
    </div>
  )
}

function RepairPanel({
  inputPath,
  strategy,
  canRun,
  onStrategy,
  onRun
}: {
  inputPath: string
  strategy: RepairStrategy
  canRun: boolean
  onStrategy: (strategy: RepairStrategy) => void
  onRun: () => void
}): ReactElement {
  return (
    <div className="tool-surface">
      <div className="surface-header">
        <div>
          <h2>自动修复</h2>
          <p>尝试修复轻微损坏、时间戳异常或 moov 位置不理想的 MP4。</p>
        </div>
        <button className="run-button compact" type="button" onClick={onRun} disabled={!canRun}>
          <Wrench size={18} />
          <span>修复</span>
        </button>
      </div>

      <FileField icon={FileVideo2} label="输入媒体" path={inputPath} />

      <div className="choice-grid two">
        <button className={strategy === 'remux' ? 'selected' : ''} type="button" onClick={() => onStrategy('remux')}>
          <strong>快速重封装</strong>
          <span>保留原编码，重建容器和时间戳，速度快。</span>
        </button>
        <button className={strategy === 'reencode' ? 'selected' : ''} type="button" onClick={() => onStrategy('reencode')}>
          <strong>重建编码</strong>
          <span>转为 H.264 + AAC，更慢但更容易绕过坏帧。</span>
        </button>
      </div>

      <div className="note-row">
        <AlertTriangle size={17} />
        <span>如果 MP4 的 moov 元数据完全丢失，本地工具通常无法无损恢复，只能尝试重建可读片段。</span>
      </div>
    </div>
  )
}

function VideoPanel({
  inputPath,
  codec,
  resolution,
  crf,
  preset,
  audioMode,
  canRun,
  onCodec,
  onResolution,
  onCrf,
  onPreset,
  onAudioMode,
  onRun
}: {
  inputPath: string
  codec: VideoCodec
  resolution: string
  crf: number
  preset: VideoPreset
  audioMode: VideoAudioMode
  canRun: boolean
  onCodec: (codec: VideoCodec) => void
  onResolution: (resolution: string) => void
  onCrf: (crf: number) => void
  onPreset: (preset: VideoPreset) => void
  onAudioMode: (mode: VideoAudioMode) => void
  onRun: () => void
}): ReactElement {
  return (
    <div className="tool-surface">
      <div className="surface-header">
        <div>
          <h2>视频转码</h2>
          <p>转换 H.264 / H.265，并缩放到常用分辨率。</p>
        </div>
        <button className="run-button compact" type="button" onClick={onRun} disabled={!canRun}>
          <Video size={18} />
          <span>转码</span>
        </button>
      </div>

      <FileField icon={FileVideo2} label="视频输入" path={inputPath} />

      <div className="form-grid three">
        <div className="field-stack">
          <span>编码</span>
          <div className="chip-row two">
            <button className={codec === 'h264' ? 'selected' : ''} type="button" onClick={() => onCodec('h264')}>
              H.264
            </button>
            <button className={codec === 'h265' ? 'selected' : ''} type="button" onClick={() => onCodec('h265')}>
              H.265
            </button>
          </div>
        </div>
        <SelectField
          label="分辨率"
          value={resolution}
          onChange={onResolution}
          options={resolutionOptions.map((option) => ({ value: option.value, label: option.label }))}
        />
        <SelectField
          label="音频"
          value={audioMode}
          onChange={(value) => onAudioMode(value as VideoAudioMode)}
          options={[
            { value: 'aac', label: 'AAC 兼容' },
            { value: 'copy', label: '保持原始' },
            { value: 'none', label: '移除音频' }
          ]}
        />
      </div>

      <div className="form-grid two">
        <NumberField label="CRF" value={crf} step={1} min={0} onChange={onCrf} />
        <SelectField
          label="速度预设"
          value={preset}
          onChange={(value) => onPreset(value as VideoPreset)}
          options={videoPresets.map((option) => ({ value: option, label: option }))}
        />
      </div>
    </div>
  )
}

function TrimPanel({
  inputPath,
  target,
  mode,
  start,
  end,
  canRun,
  onTarget,
  onMode,
  onStart,
  onEnd,
  onRun
}: {
  inputPath: string
  target: TrimTarget
  mode: TrimMode
  start: number
  end: number
  canRun: boolean
  onTarget: (target: TrimTarget) => void
  onMode: (mode: TrimMode) => void
  onStart: (start: number) => void
  onEnd: (end: number) => void
  onRun: () => void
}): ReactElement {
  return (
    <div className="tool-surface">
      <div className="surface-header">
        <div>
          <h2>音视频裁剪</h2>
          <p>按秒裁剪整段媒体、仅视频或仅音频。</p>
        </div>
        <button className="run-button compact" type="button" onClick={onRun} disabled={!canRun}>
          <Crop size={18} />
          <span>裁剪</span>
        </button>
      </div>

      <FileField icon={FileVideo2} label="输入媒体" path={inputPath} />

      <div className="form-grid four">
        <SelectField
          label="导出对象"
          value={target}
          onChange={(value) => onTarget(value as TrimTarget)}
          options={[
            { value: 'media', label: '音频 + 视频' },
            { value: 'video', label: '仅视频' },
            { value: 'audio', label: '仅音频' }
          ]}
        />
        <SelectField
          label="裁剪方式"
          value={mode}
          onChange={(value) => onMode(value as TrimMode)}
          options={[
            { value: 'copy', label: '快速无重编码' },
            { value: 'reencode', label: '精确重编码' }
          ]}
        />
        <NumberField label="开始秒" value={start} step={0.001} min={0} onChange={onStart} />
        <NumberField label="结束秒" value={end} step={0.001} min={0.001} onChange={onEnd} />
      </div>

      <div className="note-row">
        <Clock3 size={17} />
        <span>快速裁剪通常更快但可能贴近关键帧；精确裁剪会重编码，耗时更长。</span>
      </div>
    </div>
  )
}

function ExtractPanel({
  target,
  setTarget,
  canRun,
  onRun,
  probe,
  audioStreams,
  videoStreams
}: {
  target: ExtractionTarget
  setTarget: (target: ExtractionTarget) => void
  canRun: boolean
  onRun: () => void
  probe: ProbeResult | null
  audioStreams: MediaStreamInfo[]
  videoStreams: MediaStreamInfo[]
}): ReactElement {
  return (
    <div className="tool-surface">
      <div className="surface-header">
        <div>
          <h2>轨道提取</h2>
          <p>从 MP4 中拆出 audio_only 和 video_only。</p>
        </div>
        <button className="run-button compact" type="button" onClick={onRun} disabled={!canRun}>
          <Scissors size={18} />
          <span>导出</span>
        </button>
      </div>

      <div className="segmented" role="radiogroup" aria-label="提取类型">
        {extractOptions.map((option) => {
          const Icon = option.icon
          return (
            <button
              key={option.value}
              className={target === option.value ? 'selected' : ''}
              type="button"
              role="radio"
              aria-checked={target === option.value}
              onClick={() => setTarget(option.value)}
            >
              <Icon size={16} />
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>

      {probe ? (
        <>
          <div className="media-summary">
            <Metric label="文件" value={probe.fileName} />
            <Metric label="时长" value={formatDuration(probe.durationSeconds)} />
            <Metric label="大小" value={formatBytes(probe.sizeBytes)} />
            <Metric label="码率" value={formatBitRate(probe.bitRate)} />
          </div>

          <div className="stream-grid">
            <StreamGroup title="视频轨" streams={videoStreams} emptyText="无视频轨" />
            <StreamGroup title="音频轨" streams={audioStreams} emptyText="无音频轨" />
          </div>
        </>
      ) : (
        <EmptyState icon={FileVideo2} label="请选择一个媒体文件" />
      )}
    </div>
  )
}

function ConvertPanel({
  inputPath,
  format,
  sampleRate,
  channels,
  bitrate,
  canRun,
  onPick,
  onFormat,
  onSampleRate,
  onChannels,
  onBitrate,
  onRun
}: {
  inputPath: string
  format: AudioFormat
  sampleRate: number | 'source'
  channels: AudioChannels
  bitrate: number | 'auto'
  canRun: boolean
  onPick: () => void
  onFormat: (format: AudioFormat) => void
  onSampleRate: (sampleRate: number | 'source') => void
  onChannels: (channels: AudioChannels) => void
  onBitrate: (bitrate: number | 'auto') => void
  onRun: () => void
}): ReactElement {
  return (
    <div className="tool-surface">
      <div className="surface-header">
        <div>
          <h2>音频转换</h2>
          <p>格式、采样率、声道和常用语音码率。</p>
        </div>
        <button className="run-button compact" type="button" onClick={onRun} disabled={!canRun}>
          <SlidersHorizontal size={18} />
          <span>转换</span>
        </button>
      </div>

      <div className="form-grid two">
        <FileField icon={FileAudio2} label="音频输入" path={inputPath} onPick={onPick} />
        <div className="field-stack">
          <label>格式</label>
          <div className="chip-row">
            {audioFormats.map((option) => (
              <button
                key={option}
                className={format === option ? 'selected' : ''}
                type="button"
                onClick={() => onFormat(option)}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="form-grid three">
        <SelectField
          label="采样率"
          value={String(sampleRate)}
          onChange={(value) => onSampleRate(value === 'source' ? 'source' : Number(value))}
          options={[
            { value: 'source', label: '保持原始' },
            ...sampleRates.map((rate) => ({ value: String(rate), label: `${rate} Hz` }))
          ]}
        />
        <SelectField
          label="声道"
          value={channels}
          onChange={(value) => onChannels(value as AudioChannels)}
          options={[
            { value: 'source', label: '保持原始' },
            { value: 'mono', label: 'Mono' },
            { value: 'stereo', label: 'Stereo' }
          ]}
        />
        <SelectField
          label="码率"
          value={String(bitrate)}
          onChange={(value) => onBitrate(value === 'auto' ? 'auto' : Number(value))}
          options={[
            { value: 'auto', label: '自动' },
            { value: '64', label: '64 kbps' },
            { value: '96', label: '96 kbps' },
            { value: '128', label: '128 kbps' },
            { value: '192', label: '192 kbps' },
            { value: '320', label: '320 kbps' }
          ]}
        />
      </div>
    </div>
  )
}

function MuxPanel({
  videoPath,
  audioPath,
  audioMode,
  shortest,
  canRun,
  onPickVideo,
  onPickAudio,
  onAudioMode,
  onShortest,
  onRun
}: {
  videoPath: string
  audioPath: string
  audioMode: MuxAudioMode
  shortest: boolean
  canRun: boolean
  onPickVideo: () => void
  onPickAudio: () => void
  onAudioMode: (mode: MuxAudioMode) => void
  onShortest: (shortest: boolean) => void
  onRun: () => void
}): ReactElement {
  return (
    <div className="tool-surface">
      <div className="surface-header">
        <div>
          <h2>重新合成</h2>
          <p>把 video_only 和 audio_only 合成新的 MP4。</p>
        </div>
        <button className="run-button compact" type="button" onClick={onRun} disabled={!canRun}>
          <Combine size={18} />
          <span>合成</span>
        </button>
      </div>

      <div className="form-grid two">
        <FileField icon={FileVideo2} label="video_only" path={videoPath} onPick={onPickVideo} />
        <FileField icon={FileAudio2} label="audio_only" path={audioPath} onPick={onPickAudio} />
      </div>

      <div className="form-grid two">
        <SelectField
          label="音频编码"
          value={audioMode}
          onChange={(value) => onAudioMode(value as MuxAudioMode)}
          options={[
            { value: 'aac', label: 'AAC 兼容' },
            { value: 'copy', label: 'Stream Copy' }
          ]}
        />
        <label className="toggle-row block">
          <input type="checkbox" checked={shortest} onChange={(event) => onShortest(event.target.checked)} />
          <span>按较短轨道结束</span>
        </label>
      </div>
    </div>
  )
}

function ReplacePanel({
  sourceAudioPath,
  replacementAudioPath,
  start,
  end,
  format,
  sampleRate,
  channels,
  canRun,
  onPickSource,
  onPickReplacement,
  onSelection,
  onStart,
  onEnd,
  onFormat,
  onSampleRate,
  onChannels,
  onRun
}: {
  sourceAudioPath: string
  replacementAudioPath: string
  start: number
  end: number
  format: AudioFormat
  sampleRate: number
  channels: Exclude<AudioChannels, 'source'>
  canRun: boolean
  onPickSource: () => void
  onPickReplacement: () => void
  onSelection: (start: number, end: number) => void
  onStart: (start: number) => void
  onEnd: (end: number) => void
  onFormat: (format: AudioFormat) => void
  onSampleRate: (sampleRate: number) => void
  onChannels: (channels: Exclude<AudioChannels, 'source'>) => void
  onRun: () => void
}): ReactElement {
  return (
    <div className="tool-surface">
      <div className="surface-header">
        <div>
          <h2>片段替换</h2>
          <p>用一段新音频替换源音频中的选区。</p>
        </div>
        <button className="run-button compact" type="button" onClick={onRun} disabled={!canRun}>
          <Replace size={18} />
          <span>替换</span>
        </button>
      </div>

      <div className="form-grid two">
        <FileField icon={FileAudio2} label="源音频" path={sourceAudioPath} onPick={onPickSource} />
        <FileField icon={Music2} label="替换音频" path={replacementAudioPath} onPick={onPickReplacement} />
      </div>

      <WaveformEditor filePath={sourceAudioPath} start={start} end={end} onSelectionChange={onSelection} />

      <div className="form-grid five">
        <NumberField label="开始秒" value={start} step={0.001} min={0} onChange={onStart} />
        <NumberField label="结束秒" value={end} step={0.001} min={0.001} onChange={onEnd} />
        <SelectField
          label="格式"
          value={format}
          onChange={(value) => onFormat(value as AudioFormat)}
          options={audioFormats.map((option) => ({ value: option, label: option.toUpperCase() }))}
        />
        <SelectField
          label="采样率"
          value={String(sampleRate)}
          onChange={(value) => onSampleRate(Number(value))}
          options={sampleRates.map((rate) => ({ value: String(rate), label: `${rate} Hz` }))}
        />
        <SelectField
          label="声道"
          value={channels}
          onChange={(value) => onChannels(value as Exclude<AudioChannels, 'source'>)}
          options={[
            { value: 'mono', label: 'Mono' },
            { value: 'stereo', label: 'Stereo' }
          ]}
        />
      </div>

      <div className="ai-strip">
        <Cloud size={17} />
        <span>DashScope 接入点已预留：后续可把选区音频送 ASR / TTS，再回填为替换片段。</span>
      </div>
    </div>
  )
}

function WaveformEditor({
  filePath,
  start,
  end,
  onSelectionChange
}: {
  filePath: string
  start: number
  end: number
  onSelectionChange: (start: number, end: number) => void
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const waveSurferRef = useRef<WaveSurfer | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let destroyed = false
    setReady(false)
    setPlaying(false)
    setDuration(0)
    setLoadError('')

    if (!filePath || !containerRef.current || !timelineRef.current) {
      return undefined
    }

    window.zzMedia.createMediaUrl(filePath).then((url) => {
      if (destroyed || !containerRef.current || !timelineRef.current) {
        return
      }

      const regions = RegionsPlugin.create()
      const wavesurfer = WaveSurfer.create({
        container: containerRef.current,
        url,
        height: 136,
        normalize: true,
        minPxPerSec: 60,
        waveColor: '#98a8b4',
        progressColor: '#146c5d',
        cursorColor: '#9a4f21',
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        dragToSeek: true,
        plugins: [
          regions,
          TimelinePlugin.create({ container: timelineRef.current }),
          HoverPlugin.create({
            lineColor: '#27313a',
            labelBackground: '#27313a',
            labelColor: '#ffffff'
          })
        ]
      })

      const syncRegion = (region: Region): void => {
        const nextStart = Math.max(0, Number(region.start.toFixed(3)))
        const nextEnd = Math.max(nextStart, Number((region.end ?? region.start).toFixed(3)))
        onSelectionChange(nextStart, nextEnd)
      }

      regions.enableDragSelection({
        color: 'rgba(20, 108, 93, 0.22)',
        drag: true,
        resize: true
      })

      regions.on('region-created', (region) => {
        regions.getRegions().forEach((existing) => {
          if (existing.id !== region.id) {
            existing.remove()
          }
        })
        syncRegion(region)
      })

      regions.on('region-updated', (region) => {
        syncRegion(region)
      })

      wavesurfer.on('ready', (audioDuration) => {
        setReady(true)
        setDuration(audioDuration)
        if (audioDuration > 0) {
          const safeStart = Math.min(Math.max(0, start), Math.max(0, audioDuration - 0.05))
          const safeEnd = Math.min(Math.max(end, safeStart + 0.05), audioDuration)
          regions.addRegion({
            start: safeStart,
            end: safeEnd,
            color: 'rgba(20, 108, 93, 0.22)',
            drag: true,
            resize: true,
            minLength: 0.05
          })
        }
      })

      wavesurfer.on('play', () => setPlaying(true))
      wavesurfer.on('pause', () => setPlaying(false))
      wavesurfer.on('finish', () => setPlaying(false))
      wavesurfer.on('error', (error) => {
        setLoadError(error instanceof Error ? error.message : '波形加载失败')
      })

      waveSurferRef.current = wavesurfer
    }).catch((error) => {
      setLoadError(error instanceof Error ? error.message : '波形加载失败')
    })

    return () => {
      destroyed = true
      waveSurferRef.current?.destroy()
      waveSurferRef.current = null
    }
  }, [filePath])

  function togglePlayback(): void {
    waveSurferRef.current?.playPause()
  }

  function stopPlayback(): void {
    waveSurferRef.current?.stop()
    setPlaying(false)
  }

  return (
    <div className="waveform-panel">
      <div className="waveform-toolbar">
        <div>
          <span>波形选区</span>
          <strong>
            {formatPrecise(start)}s - {formatPrecise(end)}s
          </strong>
        </div>
        <div className="waveform-actions">
          <button className="icon-button" type="button" onClick={togglePlayback} disabled={!ready}>
            {playing ? <Square size={15} /> : <Play size={15} />}
            <span>{playing ? '暂停' : '播放'}</span>
          </button>
          <button className="icon-button square" type="button" onClick={stopPlayback} disabled={!ready}>
            <Square size={15} />
          </button>
        </div>
      </div>
      <div className="waveform-canvas" ref={containerRef}>
        {!filePath && <EmptyState icon={FileAudio2} label="选择源音频后显示波形" compact />}
        {filePath && !ready && !loadError && (
          <div className="waveform-loading">
            <Loader2 className="spin" size={18} />
            <span>加载波形</span>
          </div>
        )}
        {loadError && (
          <div className="waveform-loading error">
            <AlertTriangle size={18} />
            <span>{loadError}</span>
          </div>
        )}
      </div>
      <div className="waveform-timeline" ref={timelineRef} />
      <div className="waveform-meta">
        <span>总时长 {formatDuration(duration || null)}</span>
        <span>选区长度 {formatPrecise(Math.max(0, end - start))}s</span>
      </div>
    </div>
  )
}

function ResultPanel({ outputs, log }: { outputs: ExtractedOutput[]; log: string }): ReactElement {
  return (
    <div className="result-panel">
      {outputs.length > 0 && (
        <div className="result-list">
          <div className="section-title">
            <CheckCircle2 size={18} />
            <span>输出文件</span>
          </div>
          {outputs.map((output) => {
            const Icon = outputIcon(output.kind)
            return (
              <button key={output.path} className="output-row" type="button" onClick={() => window.zzMedia.showItem(output.path)}>
                <Icon size={17} />
                <em>{outputLabel(output.kind)}</em>
                <span>{outputName(output)}</span>
                <ExternalLink size={16} />
              </button>
            )
          })}
        </div>
      )}

      {log && (
        <details className="log-box">
          <summary>FFmpeg 日志</summary>
          <pre>{log}</pre>
        </details>
      )}
    </div>
  )
}

function StreamGroup({
  title,
  streams,
  emptyText
}: {
  title: string
  streams: MediaStreamInfo[]
  emptyText: string
}): ReactElement {
  return (
    <div className="stream-panel">
      <h3>{title}</h3>
      {streams.length === 0 ? (
        <div className="stream-empty">{emptyText}</div>
      ) : (
        <div className="stream-list">
          {streams.map((stream) => (
            <div className="stream-row" key={stream.index}>
              <div className="stream-index">#{stream.index}</div>
              <div>
                <strong>{stream.codecName}</strong>
                <span>{streamLabel(stream)}</span>
              </div>
              <em>{formatBitRate(stream.bitRate)}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  )
}

function FileField({
  icon: Icon,
  label,
  path,
  onPick
}: {
  icon: LucideIcon
  label: string
  path: string
  onPick?: () => void
}): ReactElement {
  return (
    <div className="file-field">
      <div className="field-label">
        <Icon size={17} />
        <span>{label}</span>
      </div>
      {onPick && (
        <button className="secondary-button" type="button" onClick={onPick}>
          <FolderOpen size={17} />
          <span>选择</span>
        </button>
      )}
      <PathBox path={path} />
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}): ReactElement {
  return (
    <label className="field-stack">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function NumberField({
  label,
  value,
  step,
  min,
  onChange
}: {
  label: string
  value: number
  step: number
  min: number
  onChange: (value: number) => void
}): ReactElement {
  return (
    <label className="field-stack">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function PathBox({ path }: { path: string }): ReactElement {
  return (
    <div className="path-box" title={path || '未选择'}>
      {path || '未选择'}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  label,
  compact = false
}: {
  icon: LucideIcon
  label: string
  compact?: boolean
}): ReactElement {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <Icon size={compact ? 26 : 42} />
      <span>{label}</span>
    </div>
  )
}

export default App
