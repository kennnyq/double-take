import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const exec = promisify(execFile);
export const MAX_DURATION = 60;
export class UploadError extends Error {
  code: string; details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) { super(message); this.code = code; this.details = details; }
}
export interface MediaInfo {
  duration: number; width: number; height: number; hasAudio: boolean;
  format: string; videoCodec: string; audioCodec?: string; pixelFormat: string;
  containerDuration?: number; rotation: number; videoIndex: number; audioIndex?: number; audioProfile?: string; audioDuration?: number;
}
function diagnostic(error: unknown, path: string) {
  const e = error as { stderr?: string; killed?: boolean; code?: unknown };
  return { timedOut: e.killed === true, exitCode: typeof e.code === 'number' ? e.code : undefined,
    diagnostic: String(e.stderr ?? '').split(path).join('<upload>').slice(-1800) };
}
function positive(value: unknown): number | undefined {
  const n = Number(value); return Number.isFinite(n) && n > 0 ? n : undefined;
}
export async function probe(path: string): Promise<MediaInfo> {
  let p;
  try {
    const { stdout } = await exec('ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-show_format','-show_streams','-of','json',path], { timeout:15000,maxBuffer:1024*1024 });
    p = JSON.parse(stdout);
  } catch (error) { throw new UploadError('unreadable_container','The video file could not be opened. Export it as MP4 or MOV and try again.',diagnostic(error,path)); }
  const streams = Array.isArray(p.streams) ? p.streams : [];
  const v = streams.find((s: {codec_type?: string; disposition?: {attached_pic?: number}}) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.find((s: {codec_type?: string}) => s.codec_type === 'audio');
  const format = typeof p.format?.format_name === 'string' ? p.format.format_name : '';
  const containerDuration = positive(p.format?.duration);
  const metadata = { format, videoCodec:v?.codec_name, audioCodec:audio?.codec_name, containerDuration, videoDuration:positive(v?.duration), width:v?.width, height:v?.height };
  if (!v) throw new UploadError('missing_video','This file has no playable video track.',metadata);
  if (!format.split(',').some((s: string) => ['mov','mp4'].includes(s))) throw new UploadError('unsupported_container','Choose an MP4 or MOV video.',metadata);
  // MOV audio padding can extend the container beyond the actual video segment.
  const duration = positive(v.duration) ?? containerDuration;
  if (duration === undefined) throw new UploadError('missing_duration','The video duration could not be read. Export the recording again and retry.',metadata);
  if (duration > MAX_DURATION) throw new UploadError('duration_exceeded',`This video is ${duration.toFixed(1)} seconds long. Choose a video up to ${MAX_DURATION} seconds.`,{...metadata,duration,maxDuration:MAX_DURATION});
  if (!Number.isFinite(v.width) || !Number.isFinite(v.height) || v.width <= 0 || v.height <= 0 || v.width*v.height > 3840*2160) throw new UploadError('resolution_exceeded',`This video is ${v.width ?? '?'} × ${v.height ?? '?'}. Export it at 4K or lower.`,metadata);
  try {
    await exec('ffmpeg',['-v','error','-xerror','-threads','2','-protocol_whitelist','file,pipe','-i',path,'-map',`0:${v.index}`,'-an','-threads','2','-f','null','-'],{timeout:90000,maxBuffer:1024*1024});
  } catch (error) {
    const detail = diagnostic(error,path);
    throw new UploadError(detail.timedOut ? 'decode_timeout' : 'decode_failed',detail.timedOut ? 'This recording took too long to read. Export a shorter segment or a lower resolution and retry.' : 'The video has damaged or unsupported frames. Export it as H.264 MP4 and retry.',{...metadata,...detail});
  }
  const rotation = Number(v.side_data_list?.find((s: {rotation?: number}) => s.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0);
  const rotated = Math.abs(rotation)%180 === 90;
  return {duration,width:rotated?v.height:v.width,height:rotated?v.width:v.height,hasAudio:!!audio,
    format,videoCodec:v.codec_name ?? '',audioCodec:audio?.codec_name,pixelFormat:v.pix_fmt ?? '',containerDuration,rotation,videoIndex:v.index,audioIndex:audio?.index,audioProfile:audio?.profile,audioDuration:positive(audio?.duration)};
}

/** Display proxy only. Analysis and result identity always use the original upload. */
export async function preparePlayback(path: string, info: MediaInfo): Promise<'playback.mp4' | undefined> {
  const copyVideo = info.videoCodec === 'h264' && info.pixelFormat === 'yuv420p';
  const audioTail = (info.audioDuration ?? info.containerDuration ?? info.duration) > info.duration + .001;
  const compatibleAudio = !info.hasAudio || (info.audioCodec === 'aac' && info.audioProfile === 'LC');
  if (copyVideo && compatibleAudio && !audioTail) return undefined;
  const target = join(dirname(path),'playback.mp4');
  try {
    await exec('ffmpeg',['-v','error','-nostdin','-y','-threads','2','-protocol_whitelist','file,pipe','-i',path,'-map',`0:${info.videoIndex}`,
      ...(info.audioIndex === undefined ? [] : ['-map',`0:${info.audioIndex}`]),
      ...(copyVideo ? ['-c:v','copy'] : ['-c:v','libx264','-preset','veryfast','-crf','20','-maxrate','16M','-bufsize','32M','-pix_fmt','yuv420p','-threads','2','-fps_mode','vfr']),
      ...(info.hasAudio ? ['-af',`atrim=duration=${info.duration},asetpts=PTS-STARTPTS`,'-c:a','aac','-profile:a','aac_low','-b:a','128k'] : []),
      '-t',String(info.duration),'-movflags','+faststart',target],{timeout:120000,maxBuffer:1024*1024});
    if ((await stat(target)).size > 160*1024*1024) throw new Error('Playback proxy exceeds storage envelope');
    const playback = await probe(target);
    if (playback.width !== info.width || playback.height !== info.height || Math.abs(playback.duration-info.duration) > .25 || playback.hasAudio !== info.hasAudio) throw new Error('Playback proxy changed video geometry or timing');
    return 'playback.mp4';
  } catch (error) { throw new UploadError('playback_failed','This video decoded, but playback preparation failed. Export it as H.264 MP4 and retry.',{...info,...diagnostic(error,path)}); }
}
