import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ENV } from '../../config/env';

export class CloudflaredTunnel {
  private tunnelProcess: ChildProcess | null = null;
  private publicUrl: string | null = null;

  /**
   * Menemukan lokasi file executable cloudflared di komputer pengguna
   */
  public findBinaryPath(): string {
    const candidates = [
      'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
      'C:\\Program Files\\cloudflared\\cloudflared.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cloudflared', 'cloudflared.exe'),
      path.join(process.env.USERPROFILE || '', 'cloudflared.exe'),
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return 'cloudflared';
  }

  /**
   * Memulai Cloudflare Tunnel secara otomatis di latar belakang dan mendeteksi URL publiknya
   */
  public start(port: number): Promise<string | null> {
    return new Promise((resolve) => {
      const binaryPath = this.findBinaryPath();

      console.log(`\n☁️  [Cloudflare Tunnel] Menyiapkan tunnel otomatis untuk port ${port}...`);

      try {
        this.tunnelProcess = spawn(binaryPath, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });

        let isResolved = false;
        const timeout = setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            console.warn(
              `⚠️ [Cloudflare Tunnel] Waktu tunggu deteksi URL habis (15 detik). Anda tetap bisa menjalankan manual:`
            );
            console.warn(`   cloudflared tunnel --url http://localhost:${port}\n`);
            resolve(null);
          }
        }, 15000);

        const onData = (chunk: Buffer | string) => {
          const text = chunk.toString();
          // Deteksi pola URL resmi Cloudflare Quick Tunnel (trycloudflare.com)
          const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/i);
          if (match && !isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            this.publicUrl = match[0];
            const webhookUrl = `${this.publicUrl}/webhook`;
            const verifyToken = ENV.META_VERIFY_TOKEN || 'kemnaker_protokol_secure_token_2026';

            console.log(`\n╔══════════════════════════════════════════════════════════════════════════════╗`);
            console.log(`║  🌐 CLOUDFLARE TUNNEL BERHASIL DIBUAT (TRYCLOUDFLARE)!                       ║`);
            console.log(`╠══════════════════════════════════════════════════════════════════════════════╣`);
            console.log(`║                                                                              ║`);
            console.log(`║  👉 Salin Callback URL berikut ke Meta Developer Dashboard:                  ║`);
            console.log(`║     ${webhookUrl.padEnd(72)} ║`);
            console.log(`║                                                                              ║`);
            console.log(`║  🔑 Verify Token:                                                            ║`);
            console.log(`║     ${verifyToken.padEnd(72)} ║`);
            console.log(`║                                                                              ║`);
            console.log(`╚══════════════════════════════════════════════════════════════════════════════╝\n`);

            resolve(this.publicUrl);
          }
        };

        this.tunnelProcess.stdout?.on('data', onData);
        this.tunnelProcess.stderr?.on('data', onData);

        this.tunnelProcess.on('error', (err) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            console.warn(`⚠️ [Cloudflare Tunnel] Gagal menjalankan ${binaryPath}: ${err.message}`);
            console.warn(`💡 Tip: Pastikan cloudflared terpasang (winget install --id Cloudflare.cloudflared)\n`);
            resolve(null);
          }
        });

        this.tunnelProcess.on('exit', () => {
          this.tunnelProcess = null;
        });

        // Matikan proses tunnel secara otomatis saat Node.js berhenti
        const handleExit = () => {
          this.stop();
        };
        process.once('exit', handleExit);
        process.once('SIGINT', handleExit);
        process.once('SIGTERM', handleExit);
      } catch (err: any) {
        console.warn(`⚠️ [Cloudflare Tunnel] Error memulai proses: ${err.message}`);
        resolve(null);
      }
    });
  }

  /**
   * Menghentikan proses tunnel
   */
  public stop(): void {
    if (this.tunnelProcess) {
      try {
        this.tunnelProcess.kill('SIGTERM');
        this.tunnelProcess.kill('SIGKILL');
      } catch {}
      this.tunnelProcess = null;
    }
  }
}

export const cloudflaredTunnel = new CloudflaredTunnel();

