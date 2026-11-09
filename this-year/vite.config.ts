import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({root: fileURLToPath(new URL('./src', import.meta.url)),base:'/master/this-year/',publicDir:'../public',plugins:[react()],build:{outDir:'../.build',emptyOutDir:true,assetsDir:'assets'}});
