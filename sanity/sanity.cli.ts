import { defineCliConfig } from 'sanity/cli'
import { studioConfiguration } from './studioConfiguration.ts'

export default defineCliConfig({
  api: { projectId: studioConfiguration.projectId, dataset: studioConfiguration.dataset },
  deployment: { autoUpdates: false },
  schemaExtraction: { enabled: false },
  typegen: { enabled: false },
})
