import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = `http://localhost:${process.env.API_PORT || '3003'}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  preview: {
    allowedHosts: ['raspberrypi.local', 'localhost'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure: (proxy) => {
          // Override proxy.web so SSE requests get per-request options
          // (infinite timeout to prevent Vite from killing the long-lived connection)
          const origWeb = proxy.web.bind(proxy);
          (proxy as any).web = (req: any, res: any, opts: any) => {
            origWeb(req, res, (req as any)._proxyOptions || opts);
          };
        },
        bypass: (req: any) => {
          if (req.headers.accept === 'text/event-stream') {
            req._proxyOptions = {
              target: apiTarget,
              headers: { Connection: 'keep-alive' },
              proxyTimeout: 0,
              timeout: 0,
            };
          }
        },
      },
    },
  },
})
