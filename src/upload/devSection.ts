import { registerDevSection, settingSwitch } from '@/devtools/api';

/*
 * Dev settings → Model → Upload: show which models ran each step of "How we
 * checked". Off by default: people see what was checked, not model names.
 * On for judges and demos. Registered when the result's timeline loads.
 */
registerDevSection({
  id: 'upload/models',
  tab: 'model',
  title: 'Upload',
  keywords: 'how we checked models nemotron planner trace judges demo',
  order: 40,
  rows: (s) => [settingSwitch(s, 'showModels', 'Show models in How we checked', 'The planner and each step’s models, under the steps. For judges and demos.')],
});
