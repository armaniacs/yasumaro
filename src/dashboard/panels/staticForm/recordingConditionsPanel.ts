import { type StaticFormPanel } from '../types.js';
import { initRecordingConditionsSettings } from '../../recordingConditionsSettings.js';

export function createRecordingConditionsPanel(): StaticFormPanel {
  return {
    id: 'panel-recording-conditions',
    category: 'static-form',
    async mount(_container) {
      await initRecordingConditionsSettings();
    },
    async refresh() {},
  };
}
