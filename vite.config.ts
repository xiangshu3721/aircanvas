import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base 用相对路径 './'：同一份构建产物既能放在 GitHub Pages 子路径 /aircanvas/，
// 也能放在腾讯云 CloudBase 静态托管的根目录或任意子目录。
// 如需绝对路径，可用 VITE_BASE=/aircanvas/ npm run build
export default defineConfig({
  base: process.env.VITE_BASE || './',
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as never);
