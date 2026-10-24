import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes } from './schemas/index.ts'
import { studioConfiguration } from './studioConfiguration.ts'

export default defineConfig({
  name: 'royal-fusion-blogs',
  title: 'Royal Fusion Blogs — production',
  projectId: studioConfiguration.projectId,
  dataset: studioConfiguration.dataset,
  plugins: [structureTool()],
  schema: { types: schemaTypes },
  // Leave authentication, document IDs and Draft/Publish actions to Sanity.
})
