import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'api-tester': resolve(__dirname, 'api-tester.html'),
        'fullcam-generator': resolve(__dirname, 'fullcam-generator.html'),
        'fullcam-tsv-processor': resolve(__dirname, 'fullcam-tsv-processor.html'),
        'spatial-data-updater': resolve(__dirname, 'spatial-data-updater.html'),
      },
    },
  },
})
