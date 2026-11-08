import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import type { DocumentPickerAsset } from 'expo-document-picker';
import type { InvestigationResult } from './contract';
import { ClientServiceError, responseError, serviceConfig, serviceRequest, serviceUrl, UPLOAD_TIMEOUT_MS, validateJobResponse } from './client-config';
export { ClientServiceError, isServiceUnavailable } from './client-config';
// Keep direct env references so Expo can inline public build-time configuration.
export const jobsConfig = serviceConfig(process.env.EXPO_PUBLIC_JOBS_URL, process.env.NODE_ENV !== 'development');
export const reviewConfig = serviceConfig(process.env.EXPO_PUBLIC_REVIEW_URL, process.env.NODE_ENV !== 'development');
export const JOBS_URL = jobsConfig.available ? jobsConfig.url : undefined;
export const REVIEW_URL = reviewConfig.available ? reviewConfig.url : undefined;
export interface ClientJob {
  id: string; state: 'queued' | 'running' | 'complete' | 'error';
  duration: number; width: number; height: number; hasAudio: boolean;
  sha256?: string; result?: InvestigationResult; error?: string;
}
const key = (id: string) => encodeURIComponent(id);
export const mediaUrl = (id: string, prepared = false) => serviceUrl(jobsConfig, `/${prepared ? 'prepared' : 'jobs'}/${key(id)}/media`);
async function json(response: Response, fallback: string, id?: string): Promise<unknown> {
  if (!response.ok) {
    if (response.status >= 500 || [408, 429, 401, 403].includes(response.status)) throw responseError(response.status, null, fallback, id);
    throw responseError(response.status, await response.json().catch(() => null), fallback, id);
  }
  try { return await response.json(); }
  catch { throw new ClientServiceError('invalid_response', 'Upload result unavailable. Retry to continue.'); }
}
function job(value: unknown, id: string, prepared = false): ClientJob {
  validateJobResponse(value, id, prepared); return value as ClientJob;
}
export async function listPrepared(): Promise<{ id: string }[]> {
  return serviceRequest(jobsConfig, '/prepared', async (url, signal) => {
    const value = await json(await fetch(url, { signal }), 'Examples unavailable. Try again shortly.');
    if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== 'string')) throw new ClientServiceError('invalid_response');
    return value;
  });
}
// Coalesce overlapping UI polling/recovery reads; a stalled request cannot pile up.
const pendingReads = new Map<string, Promise<ClientJob>>();
export function getJob(id: string, prepared = false): Promise<ClientJob> {
  const path = `/${prepared ? 'prepared' : 'jobs'}/${key(id)}`;
  const pending = pendingReads.get(path); if (pending) return pending;
  const request = serviceRequest(jobsConfig, path, async (url, signal) => job(await json(await fetch(url, { signal }), 'Upload not saved yet. Choose the video again to retry.', id), id, prepared))
    .finally(() => pendingReads.delete(path));
  pendingReads.set(path, request); return request;
}
export async function upload(id: string, asset: DocumentPickerAsset): Promise<ClientJob> {
  return serviceRequest(jobsConfig, `/jobs/${key(id)}`, async (url, signal) => {
    if ((asset.size ?? 0) > 100 * 1024 * 1024) throw new ClientServiceError('rejected', 'Choose a video under 100 MB.');
    if (Platform.OS === 'web' && !asset.file) throw new ClientServiceError('rejected', 'Choose the video again to retry.');
    const body = Platform.OS === 'web' ? asset.file! : new File(asset.uri);
    return job(await json(await expoFetch(url, { method: 'PUT', signal, headers: { 'Content-Type': asset.mimeType ?? 'application/octet-stream' }, body }), 'Upload failed. Retry to continue.', id), id);
  }, UPLOAD_TIMEOUT_MS);
}
export async function deleteJob(id: string) {
  return serviceRequest(jobsConfig, `/jobs/${key(id)}`, async (url, signal) => {
    const response = await fetch(url, { method: 'DELETE', signal });
    if (!response.ok) throw responseError(response.status, null, 'Wait for analysis to finish before deleting.');
  });
}
// Read-only review namespace. Never falls back to jobs or prepared examples.
export const candidateMediaUrl = (id: string, fixture = false) => serviceUrl(reviewConfig, `/${fixture ? 'fixtures' : 'candidates'}/${key(id)}/media`);
export async function getCandidate(id: string, fixture = false): Promise<ClientJob> {
  return serviceRequest(reviewConfig, `/${fixture ? 'fixtures' : 'candidates'}/${key(id)}`, async (url, signal) => {
    const result = job(await json(await fetch(url, { signal }), 'Candidate unavailable. Return to review and reload.'), id, true);
    if (result.state !== 'complete') throw new ClientServiceError('invalid_response', 'Candidate revision mismatch.');
    return result;
  });
}
export async function uploadLink(id: string, url: string): Promise<ClientJob> {
  return serviceRequest(jobsConfig, `/jobs/${key(id)}`, async (endpoint, signal) => job(await json(await fetch(endpoint, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  }), 'Could not open that link. Select a video from your device.', id), id), UPLOAD_TIMEOUT_MS);
}
