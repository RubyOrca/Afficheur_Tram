import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        proxy: {
            // Proxy Yahoo Finance to bypass CORS
            '/yahoo-finance': {
                target: 'https://query1.finance.yahoo.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/yahoo-finance/, ''),
            },
        },
    },
});
