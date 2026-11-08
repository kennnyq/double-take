import { useCloudConfig } from '@/config/cloud';
import { isPipelineName, resolvePipeline } from './settings';
import { useDevSettings } from './store';

/** The cloud's default tells pipeline (`app_config.tells_pipeline`), or null until/unless it's known. */
export function useCloudPipeline(): string | null {
  return useCloudConfig<string | null>('tells_pipeline', null, (v): v is string | null => v === null || isPipelineName(v));
}

/** The tells pipeline every clip shows: the viewer's dev pick, else the cloud default, else main. */
export function useTellsPipeline(): string {
  const { pipelinePick } = useDevSettings();
  return resolvePipeline(pipelinePick, useCloudPipeline());
}
